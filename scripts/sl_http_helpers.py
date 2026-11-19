"""2026-11-19 fix post incidente BQ: helpers HTTP reutilizables para SAP SL.

Aislado del script productivo `sync_sap_to_bigquery.py` para que los tests
unit NO dependan de `google-cloud-bigquery` ni `firebase-admin` (que el
script importa top-level con sys.exit si faltan).

Este módulo SOLO depende de `requests` (standard ecosystem).
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional

import requests


def _default_log(msg: str, /) -> None:
    """Default logger: imprime a stdout con flush. Los callers productivos
    pueden inyectar otro logger (ej. el `log(msg)` del script principal que
    agrega timestamp ISO)."""
    print(msg, flush=True)


def sl_get_with_retry(
    session: requests.Session,
    url: str,
    caller: str,
    timeout: int = 30,
    headers: Optional[dict] = None,
    max_retries: int = 2,
    retry_delay_s: float = 2.0,
    log: Optional[Callable[[str], None]] = None,
) -> Optional[requests.Response]:
    """Fix post incidente BQ 2026-11-19: GET helper con retry ante
    RemoteDisconnected / ConnectionError.

    Causa raíz del incidente: SAP SL cierra la conexión TCP después de
    responder HTTP 400 (Items UDF inválido). El `session.get` del próximo
    helper que reutiliza la conexión pooleada falla con
    `urllib3.exceptions.ProtocolError('Connection aborted', RemoteDisconnected)`.
    El wrapper `requests` lo traduce a `requests.exceptions.ConnectionError`.

    Mitigation: ante ese tipo de error, cerramos el pool + sleep + retry.
    `session.close()` descarta todas las conexiones pooleadas → el próximo
    request abre un socket nuevo.

    Devuelve `requests.Response` o None (si todos los retries fallaron).
    Nunca propaga la excepción al caller cuando es ConnectionError —
    deja al caller decidir el fallback. Otros RequestException sí se
    propagan sin retry (TLS, DNS, etc). SSLError es subclase de
    ConnectionError en requests y por lo tanto SÍ se retria (útil para
    caídas intermitentes de TLS).
    """
    _log: Callable[[str], None] = log or _default_log
    attempts = 0
    while attempts <= max_retries:
        try:
            if headers:
                return session.get(url, timeout=timeout, headers=headers)
            return session.get(url, timeout=timeout)
        except (requests.exceptions.ConnectionError, requests.exceptions.ChunkedEncodingError) as e:
            attempts += 1
            if attempts > max_retries:
                _log(
                    f'[sl_get_with_retry/{caller}] agotados {max_retries} retries - '
                    f'ultimo error: {type(e).__name__}: {str(e)[:120]}'
                )
                return None
            _log(
                f'[sl_get_with_retry/{caller}] intento {attempts}/{max_retries + 1} fallo '
                f'({type(e).__name__}); cerrando conexion pooleada + sleep {retry_delay_s}s'
            )
            try:
                session.close()
            except Exception:
                pass
            time.sleep(retry_delay_s)
        except requests.exceptions.RequestException as e:
            # Otros errores (TLS mal configurado, DNS, timeout) propagados sin
            # retry aqui — el caller decide.
            _log(
                f'[sl_get_with_retry/{caller}] RequestException no-retriable: '
                f'{type(e).__name__}: {str(e)[:120]}'
            )
            raise
    return None
