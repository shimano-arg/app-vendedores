"""BQ — Dashboard de Ventas (2026-10-29) — Valida el back order reconstruido.

Compara la reconstruccion estimada de la vista
`shimano_app.v_backorder_reconstruido_mensual` para un fin de mes contra un
valor real conocido que da Mariano (monto en ARS o unidades), e imprime el
desvio porcentual. Universo de la comparacion: pesca + vendedor asignado (lo
mismo que muestra el dashboard); el valor real tiene que ser de ese universo. Spec: docs/superpowers/specs/2026-10-29-dashboard-ventas-design.md §3.2.

SOLO LECTURA: hace un SELECT parametrizado, no escribe nada.

Uso:
  python scripts/audit/BQ_validar_backorder_reconstruido.py --mes 2026-09 --valor 45000000 --tipo ars
  python scripts/audit/BQ_validar_backorder_reconstruido.py --mes 2026-09 --valor 1200 --tipo uds

Credenciales: usa FIREBASE_SERVICE_ACCOUNT (JSON o base64, igual que
sync_sap_to_bigquery.py) si esta seteada; si no, Application Default
Credentials (`gcloud auth application-default login`).

Codigos de salida:
  0  desvio <= 15%  -> los meses estimados se pueden mostrar.
  2  desvio  > 15%  -> NO mostrar meses estimados (mostrarEstimados = false).
  1  no se pudo validar (mes fuera de la ventana, sin datos, error de BQ).
  (argparse tambien sale con 2 ante argumentos invalidos; en ese caso no se
   imprime ningun veredicto.)
"""

import argparse
import base64
import calendar
import json
import os
import re
import sys
from datetime import date

BQ_PROJECT = 'app-vendedores-shimano'
BQ_DATASET = 'shimano_app'
BQ_LOCATION = 'southamerica-east1'
VISTA = f'`{BQ_PROJECT}.{BQ_DATASET}.v_backorder_reconstruido_mensual`'
UMBRAL = 0.15

# Columna a sumar segun --tipo. Lista cerrada: nunca se concatena input del
# usuario en el SQL.
COLUMNA_POR_TIPO = {'ars': 'pendiente_ars', 'uds': 'pendiente_uds'}


# ------------------------------------------------------------------
# Logica pura (testeada en tests/python/test_validar_backorder_reconstruido.py)
# ------------------------------------------------------------------

def compute_desvio(reconstruido: float, real: float) -> float:
    """Desvio relativo |reconstruido - real| / real. `real` tiene que ser > 0."""
    if real is None or real <= 0:
        raise ValueError('el valor real tiene que ser mayor que 0')
    return abs(float(reconstruido) - float(real)) / float(real)


def veredicto(desvio: float, umbral: float = UMBRAL) -> int:
    """0 si el desvio esta dentro del umbral (inclusive), 2 si lo supera."""
    return 0 if desvio <= umbral else 2


def mes_fin(mes: str) -> date:
    """'AAAA-MM' -> ultimo dia de ese mes. ValueError si el formato es invalido."""
    m = re.fullmatch(r'(\d{4})-(\d{2})', mes or '')
    if not m:
        raise ValueError(f'mes invalido: {mes!r} (formato AAAA-MM)')
    anio, mes_num = int(m.group(1)), int(m.group(2))
    if not 1 <= mes_num <= 12:
        raise ValueError(f'mes invalido: {mes!r} (mes 01-12)')
    return date(anio, mes_num, calendar.monthrange(anio, mes_num)[1])


# ------------------------------------------------------------------
# BigQuery (solo lectura)
# ------------------------------------------------------------------

def _bq_client():
    """Cliente BQ. Import diferido para que los tests no necesiten google libs."""
    from google.cloud import bigquery
    sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT', '').strip()
    if not sa_json:
        return bigquery.Client(project=BQ_PROJECT, location=BQ_LOCATION)
    if not sa_json.startswith('{'):
        try:
            sa_json = base64.b64decode(sa_json).decode('utf-8')
        except Exception:
            pass
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_info(json.loads(sa_json))
    return bigquery.Client(project=BQ_PROJECT, credentials=creds, location=BQ_LOCATION)


def leer_reconstruido(client, fin: date, tipo: str):
    """Devuelve (suma_reconstruida | None si el mes no esta, lista de meses disponibles)."""
    from google.cloud import bigquery
    columna = COLUMNA_POR_TIPO[tipo]
    params = [bigquery.ScalarQueryParameter('mes_fin', 'DATE', fin)]
    job = client.query(
        f"""
        SELECT SUM({columna}) AS total, COUNT(*) AS filas
        FROM {VISTA}
        WHERE mes_fin = @mes_fin
        """,
        job_config=bigquery.QueryJobConfig(query_parameters=params),
    )
    row = list(job.result())[0]
    meses = [
        r.mes_fin for r in client.query(
            f'SELECT DISTINCT mes_fin FROM {VISTA} ORDER BY mes_fin'
        ).result()
    ]
    if not row.filas:
        return None, meses
    return float(row.total or 0), meses


def _fmt(valor: float, tipo: str) -> str:
    if tipo == 'ars':
        return f'$ {valor:,.0f}'.replace(',', '.')
    return f'{valor:,.0f} uds'.replace(',', '.')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Valida el back order reconstruido contra un valor real (universo: pesca + vendedor asignado).')
    ap.add_argument('--mes', required=True, help='mes a validar, AAAA-MM')
    ap.add_argument('--valor', required=True, type=float, help='valor real conocido (> 0), solo pesca + vendedor asignado')
    ap.add_argument('--tipo', required=True, choices=sorted(COLUMNA_POR_TIPO), help='ars o uds')
    args = ap.parse_args(argv)

    try:
        fin = mes_fin(args.mes)
    except ValueError as e:
        print(f'[ERROR] {e}')
        return 1
    if args.valor <= 0:
        print('[ERROR] --valor tiene que ser mayor que 0')
        return 1

    print('=' * 70)
    print('BQ - Validacion back order reconstruido (estimado) vs valor real')
    print('=' * 70)
    print(f'Mes: {args.mes} (fin de mes {fin.isoformat()})  Tipo: {args.tipo}')

    try:
        reconstruido, meses = leer_reconstruido(_bq_client(), fin, args.tipo)
    except Exception as e:  # noqa: BLE001 - reporte de auditoria
        print(f'[ERROR] no se pudo consultar BigQuery: {e}')
        return 1

    if reconstruido is None:
        print(f'[ERROR] la vista no tiene datos para {fin.isoformat()}.')
        print('Meses disponibles: ' + (', '.join(m.isoformat() for m in meses) or '(ninguno)'))
        return 1

    desvio = compute_desvio(reconstruido, args.valor)
    codigo = veredicto(desvio)
    print(f'Reconstruido: {_fmt(reconstruido, args.tipo)}')
    print(f'Real:         {_fmt(args.valor, args.tipo)}')
    print(f'Desvio:       {desvio * 100:.1f}% (umbral {UMBRAL * 100:.0f}%)')
    if codigo == 0:
        print('VEREDICTO: OK (exit 0) - se pueden mostrar los meses estimados.')
    else:
        print('VEREDICTO: FUERA DE UMBRAL (exit 2) - NO mostrar meses estimados '
              '(app_config/dashboard_ventas.mostrarEstimados = false).')
    return codigo


if __name__ == '__main__':
    sys.exit(main())
