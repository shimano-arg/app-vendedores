"""
Probe directo a la API SETUP para verificar si publica movimientos en los
ultimos N dias. Independiente de nuestra CF/cliente — llama a SETUP en
frio.

Uso:
  SETUP_API_PASSWORD=<pwd> python scripts/probe_setup_ultimos_dias.py

Output: por cada ventana (7d cada una, cubriendo 21 dias), reporta count.
Si la ventana mas reciente da 0 → SETUP no publica movimientos hace >=7d
= problema de SETUP, no nuestro.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from urllib import request as urlreq
from urllib.error import HTTPError

SETUP_URL = 'https://nur-integra.setuponline.com.ar'
SETUP_USER = 'nur'


def _log(msg: str) -> None:
    print(msg, flush=True)


def login(password: str) -> str:
    body = json.dumps({'Username': SETUP_USER, 'Password': password}).encode()
    req = urlreq.Request(
        f'{SETUP_URL}/CreateToken',
        data=body,
        method='POST',
        headers={'Content-Type': 'application/json'},
    )
    with urlreq.urlopen(req, timeout=30) as r:
        payload = json.loads(r.read().decode())
    tok = payload.get('Token') or payload.get('token') or payload.get('access_token')
    if not tok:
        raise RuntimeError(f'Login OK pero sin token en body: {payload}')
    _log('[login] OK, token obtenido')
    return tok


def fetch_window(token: str, desde: str, hasta: str) -> list:
    body = json.dumps({
        'ID_Nota_de_venta': '',
        'ID_Cliente': '',
        'ID_Destinatario': '',
        'Codigo_deposito': 1,
        'Fecha_desde': desde,
        'Fecha_hasta': hasta,
    }).encode()
    # SETUP acepta GET con body — usamos urllib
    req = urlreq.Request(
        f'{SETUP_URL}/GetMovimientosSalida',
        data=body,
        method='GET',
        headers={
            'Content-Type': 'application/json',
            'Content-Length': str(len(body)),
            'Authorization': f'Bearer {token}',
        },
    )
    try:
        with urlreq.urlopen(req, timeout=60) as r:
            payload = json.loads(r.read().decode())
    except HTTPError as e:
        _log(f'  ERROR HTTP {e.code}: {e.read().decode()[:200]}')
        return []
    data = payload.get('VFPData')
    if not data:
        _log('  Sin VFPData en respuesta')
        return []
    arr_key = next((k for k in data if isinstance(data[k], list)), None)
    return data[arr_key] if arr_key else []


def main():
    password = os.environ.get('SETUP_API_PASSWORD', '').strip()
    if not password:
        _log('[FATAL] SETUP_API_PASSWORD env var vacia')
        sys.exit(1)
    token = login(password)

    hoy = date.today()
    _log(f'\n[probe] Hoy (server): {hoy.isoformat()}')
    _log(f'[probe] Chequeando 3 ventanas de 7 dias cada una')

    for offset_weeks in range(3):
        hasta = hoy - timedelta(days=offset_weeks * 7)
        desde = hoy - timedelta(days=offset_weeks * 7 + 7)
        _log(f'\n[ventana {offset_weeks}] {desde.isoformat()} → {hasta.isoformat()}')
        rows = fetch_window(token, desde.isoformat(), hasta.isoformat())
        _log(f'  Lineas devueltas: {len(rows)}')
        if rows:
            # Max/min fecha
            fechas = [str(r.get('fecha', ''))[:10] for r in rows if r.get('fecha')]
            fechas = [f for f in fechas if f]
            if fechas:
                _log(f'  Rango de fechas en respuesta: {min(fechas)} → {max(fechas)}')
            # Sample de los 3 mas recientes
            rows_sorted = sorted(rows, key=lambda r: str(r.get('fecha', '')), reverse=True)
            _log('  Sample top 3 mas recientes:')
            for r in rows_sorted[:3]:
                _log(f'    {r.get("fecha", "")} {r.get("comprobante", "")} '
                     f'{r.get("destinatario", "")[:30]} #{r.get("id_nota_de_venta", "")}')


if __name__ == '__main__':
    main()
