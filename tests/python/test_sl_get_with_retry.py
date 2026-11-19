"""2026-11-19 — tests sl_get_with_retry (fix post-incidente BQ workflow).

Verifica que el helper sobrevive al RemoteDisconnected / ConnectionError que
dispara SAP SL tras un HTTP 400. El workflow fallaba porque session.get()
en resolve_bike_group_code (línea 458 pre-fix) reutilizaba la conexión
pooleada cerrada por SAP y propagaba la excepción.

Patrón del fix: cerrar el pool de conexiones + sleep + retry. Al cerrar
session, urllib3 descarta el pool; el próximo request abre un socket fresh.

Ejecutar: python -m pytest tests/python/test_sl_get_with_retry.py -v
         (o python tests/python/test_sl_get_with_retry.py para smoke)
"""

import sys
import time
import unittest
from unittest.mock import MagicMock, patch


# Importar directamente sin pasar por main() del script.
sys.path.insert(0, 'scripts')


class SlGetWithRetryTests(unittest.TestCase):
    """Tests del helper sl_get_with_retry."""

    def setUp(self):
        # Importación perezosa — el script sync_sap_to_bigquery.py tiene
        # imports pesados (google.cloud.bigquery, firebase_admin). Para los
        # tests unit sólo necesitamos la función pura + requests.
        import requests
        self.requests = requests
        # Patch de los imports pesados antes de cargar el módulo.
        with patch.dict('sys.modules', {
            'google.cloud.bigquery': MagicMock(),
            'firebase_admin': MagicMock(),
            'firebase_admin.credentials': MagicMock(),
            'firebase_admin.firestore': MagicMock(),
        }):
            # Carga del módulo con mocks instalados.
            import importlib
            import sync_sap_to_bigquery
            importlib.reload(sync_sap_to_bigquery)
            self.sl_get_with_retry = sync_sap_to_bigquery.sl_get_with_retry

    def test_T1_happy_path(self):
        """GET exitoso en el primer intento → devuelve response sin retry."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=200)
        session.get.return_value = mock_resp
        result = self.sl_get_with_retry(session, 'https://sap/items', 'test', timeout=30)
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
            self.requests.exceptions.ConnectionError('mock disconnect'),
            mock_resp,
        ]
        with patch('time.sleep'):
            result = self.sl_get_with_retry(
                session, 'https://sap/x', 'test', timeout=30, max_retries=2
            )
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 2)
        # Sesión cerrada tras el primer fallo.
        self.assertEqual(session.close.call_count, 1)

    def test_T3_connection_error_all_retries_fail(self):
        """Todos los retries fallan → devuelve None (fail-open controlado)."""
        session = MagicMock()
        session.get.side_effect = self.requests.exceptions.ConnectionError('persistent')
        with patch('time.sleep'):
            result = self.sl_get_with_retry(
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
            self.requests.exceptions.ChunkedEncodingError('mock chunk'),
            mock_resp,
        ]
        with patch('time.sleep'):
            result = self.sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 2)

    def test_T5_ssl_error_retry_because_subclass_of_connection_error(self):
        """SSLError hereda de ConnectionError en requests → se retria igual
        que ConnectionError (patrón usado en PR #1389 para el CA bundle)."""
        session = MagicMock()
        session.get.side_effect = self.requests.exceptions.SSLError('cert fail')
        with patch('time.sleep'):
            result = self.sl_get_with_retry(
                session, 'https://sap/x', 'test', max_retries=1
            )
        self.assertIsNone(result)
        # 1 inicial + 1 retry = 2 calls.
        self.assertEqual(session.get.call_count, 2)

    def test_T6_timeout_propaga(self):
        """Timeout error también propaga (no es pool issue)."""
        session = MagicMock()
        session.get.side_effect = self.requests.exceptions.Timeout('too slow')
        with self.assertRaises(self.requests.exceptions.Timeout):
            self.sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertEqual(session.get.call_count, 1)

    def test_T7_http_4xx_NO_retry(self):
        """HTTP 400 NO dispara retry — es un response válido (devuelve a caller)."""
        session = MagicMock()
        mock_resp = MagicMock(status_code=400, ok=False)
        session.get.return_value = mock_resp
        result = self.sl_get_with_retry(session, 'https://sap/x', 'test')
        self.assertIs(result, mock_resp)
        self.assertEqual(session.get.call_count, 1)
        session.close.assert_not_called()

    def test_T8_headers_passed_through(self):
        """El parámetro `headers` se pasa a session.get."""
        session = MagicMock()
        session.get.return_value = MagicMock(status_code=200)
        headers = {'Prefer': 'odata.maxpagesize=500'}
        self.sl_get_with_retry(session, 'https://sap/x', 'test', headers=headers)
        call_kwargs = session.get.call_args.kwargs
        self.assertIn('headers', call_kwargs)
        self.assertEqual(call_kwargs['headers'], headers)

    def test_T9_session_close_exception_swallowed(self):
        """Si session.close() lanza, igual continúa con el retry."""
        session = MagicMock()
        session.close.side_effect = RuntimeError('mock close failure')
        session.get.side_effect = [
            self.requests.exceptions.ConnectionError('mock disc'),
            MagicMock(status_code=200),
        ]
        with patch('time.sleep'):
            # NO debe explotar por el close() rompiendo.
            result = self.sl_get_with_retry(session, 'https://sap/x', 'test', max_retries=2)
        self.assertIsNotNone(result)
        self.assertEqual(session.get.call_count, 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
