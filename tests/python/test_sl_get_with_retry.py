"""2026-11-19 — tests sl_get_with_retry (fix post-incidente BQ workflow).

Verifica que el helper sobrevive al RemoteDisconnected / ConnectionError que
dispara SAP SL tras un HTTP 400. El workflow fallaba porque session.get()
en resolve_bike_group_code (línea 458 pre-fix) reutilizaba la conexión
pooleada cerrada por SAP y propagaba la excepción.

El helper vive en `scripts/sl_http_helpers.py` aislado del script productivo
`sync_sap_to_bigquery.py` que tiene imports top-level de `google-cloud-bigquery`
y `firebase-admin` con `sys.exit(2)` si faltan. El aislamiento permite que
los tests corran en el CI `test` job sin instalar esas 2 deps pesadas.

Ejecutar:
  python -m pytest tests/python/test_sl_get_with_retry.py -v
  python tests/python/test_sl_get_with_retry.py  (smoke)
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import requests

# Agregar scripts/ al path para importar el helper puro.
SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'scripts')
sys.path.insert(0, SCRIPTS_DIR)

from sl_http_helpers import sl_get_with_retry


class SlGetWithRetryTests(unittest.TestCase):
    """Tests del helper sl_get_with_retry."""

    def test_T1_happy_path(self):
        """GET exitoso en el primer intento → devuelve response sin retry."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=200)
        session.get.return_value = mock_resp
        result = sl_get_with_retry(session, 'https://sap/items', 'test', timeout=30)
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 1)
        # NO se cerró la sesión (no hubo retry).
        session.close.assert_not_called()

    def test_T2_connection_error_retry_success(self):
        """Primer intento ConnectionError → segundo intento OK."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=200)
        # Falla la primera, OK la segunda.
        session.get.side_effect = [
            requests.exceptions.ConnectionError('mock disconnect'),
            mock_resp,
        ]
        with patch('time.sleep'):
            result = sl_get_with_retry(
                session, 'https://sap/x', 'test', timeout=30, max_retries=2
            )
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 2)
        # Sesión cerrada tras el primer fallo.
        self.assertEqual(session.close.call_count, 1)

    def test_T3_connection_error_all_retries_fail(self):
        """Todos los retries fallan → devuelve None (fail-open controlado)."""
        session = MagicMock()
        session.get.side_effect = requests.exceptions.ConnectionError('persistent')
        with patch('time.sleep'):
            result = sl_get_with_retry(
                session, 'https://sap/x', 'test', timeout=30, max_retries=2
            )
        self.assertIsNone(result)
        # 1 intento inicial + 2 retries = 3 calls.
        self.assertEqual(session.get.call_count, 3)
        # Sesión cerrada en ambos retries.
        self.assertEqual(session.close.call_count, 2)

    def test_T4_chunked_encoding_error_retries(self):
        """ChunkedEncodingError (otra manifestación de disconnect) también retria."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=200)
        session.get.side_effect = [
            requests.exceptions.ChunkedEncodingError('mock chunk'),
            mock_resp,
        ]
        with patch('time.sleep'):
            result = sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 2)

    def test_T5_ssl_error_retry_because_subclass_of_connection_error(self):
        """SSLError hereda de ConnectionError en requests → se retria igual
        que ConnectionError (patrón usado en PR #1389 para el CA bundle)."""
        session = MagicMock()
        session.get.side_effect = requests.exceptions.SSLError('cert fail')
        with patch('time.sleep'):
            result = sl_get_with_retry(
                session, 'https://sap/x', 'test', max_retries=1
            )
        self.assertIsNone(result)
        # 1 inicial + 1 retry = 2 calls.
        self.assertEqual(session.get.call_count, 2)

    def test_T6_timeout_propaga(self):
        """Timeout error también propaga (no es pool issue)."""
        session = MagicMock()
        session.get.side_effect = requests.exceptions.Timeout('too slow')
        with self.assertRaises(requests.exceptions.Timeout):
            sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertEqual(session.get.call_count, 1)

    def test_T7_http_4xx_NO_retry(self):
        """HTTP 400 NO dispara retry — es un response válido (devuelve a caller)."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=400, ok=False)
        session.get.return_value = mock_resp
        result = sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 1)
        session.close.assert_not_called()

    def test_T8_headers_passed_through(self):
        """El parámetro `headers` se pasa a session.get."""
        session = MagicMock()
        session.get.return_value = MagicMock(status_code=200)
        headers = {'Prefer': 'odata.maxpagesize=500'}
        sl_get_with_retry(session, 'https://sap/x', 'test', headers=headers)
        call_kwargs = session.get.call_args.kwargs
        self.assertIn('headers', call_kwargs)
        self.assertEqual(call_kwargs['headers'], headers)

    def test_T9_session_close_exception_swallowed(self):
        """Si session.close() lanza, igual continúa con el retry."""
        session = MagicMock()
        session.close.side_effect = RuntimeError('mock close failure')
        session.get.side_effect = [
            requests.exceptions.ConnectionError('mock disc'),
            MagicMock(status_code=200),
        ]
        with patch('time.sleep'):
            # NO debe explotar por el close() rompiendo.
            result = sl_get_with_retry(session, 'https://sap/x', 'test', max_retries=2)
        self.assertIsNotNone(result)
        self.assertEqual(session.get.call_count, 2)

    def test_T10_custom_logger_injected(self):
        """El parámetro `log` inyectable permite al caller usar su logger."""
        session = MagicMock()
        session.get.side_effect = requests.exceptions.ConnectionError('mock disc')
        logs = []
        with patch('time.sleep'):
            sl_get_with_retry(
                session, 'https://sap/x', 'test',
                max_retries=1, log=lambda msg: logs.append(msg)
            )
        # Hubo al menos 2 logs (retry + agotado).
        self.assertGreaterEqual(len(logs), 2)
        # Primer log menciona retry.
        self.assertTrue(any('intento' in m for m in logs))
        # Último log menciona agotados.
        self.assertTrue(any('agotados' in m for m in logs))


if __name__ == '__main__':
    unittest.main(verbosity=2)
