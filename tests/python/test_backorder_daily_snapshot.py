"""Tests de sync_backorder_daily_snapshot (Dashboard de Ventas, foto diaria del back order).

El cliente BigQuery se mockea: no hay red ni credenciales.

Correr con:
  python tests/python/test_backorder_daily_snapshot.py
"""
import os
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone

ART = timezone(timedelta(hours=-3))  # Argentina no tiene DST


class _FakeParam:
    def __init__(self, name, type_, value):
        self.name, self.type_, self.value = name, type_, value


class _FakeJobConfig:
    def __init__(self, query_parameters=None):
        self.query_parameters = query_parameters or []


class _FakeBigquery:
    ScalarQueryParameter = _FakeParam
    QueryJobConfig = _FakeJobConfig
    Client = object


class _FakeJob:
    def __init__(self, rows=0):
        self.num_dml_affected_rows = rows

    def result(self):
        return []


class _FakeClient:
    def __init__(self, inserted=7):
        self.calls = []  # (sql, job_config)
        self._inserted = inserted

    def query(self, sql, job_config=None):
        self.calls.append((sql, job_config))
        return _FakeJob(self._inserted if 'INSERT' in sql.upper() else 0)


def _load_fn():
    """Carga sync_backorder_daily_snapshot del script sin ejecutar su main()."""
    script_path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'scripts', 'sync_sap_to_bigquery.py'
    )
    with open(script_path, encoding='utf-8') as f:
        source = f.read()
    start = source.index('def sync_backorder_daily_snapshot(')
    rest = source[start:]
    end = rest.index('\ndef ', 10)
    namespace = {
        'bigquery': _FakeBigquery,
        'datetime': datetime,
        'timedelta': timedelta,
        'timezone': timezone,
        'BQ_PROJECT': 'app-vendedores-shimano',
        'BQ_DATASET': 'shimano_app',
        'BQ_LOCATION': 'southamerica-east1',
        'log': lambda *_a, **_k: None,
    }
    exec(rest[:end], namespace)
    return namespace['sync_backorder_daily_snapshot']


class TestBackorderDailySnapshot(unittest.TestCase):
    def test_skip_before_23h_art(self):
        fn = _load_fn()
        client = _FakeClient()
        now = datetime(2026, 10, 29, 15, 0, tzinfo=ART)
        self.assertEqual(fn(client, now=now), 0)
        self.assertEqual(client.calls, [])

    def test_idempotent_same_day(self):
        fn = _load_fn()
        client = _FakeClient(inserted=7)
        now = datetime(2026, 10, 29, 23, 30, tzinfo=ART)
        self.assertEqual(fn(client, now=now), 7)
        sqls = [c[0].upper() for c in client.calls]
        i_del = next(i for i, s in enumerate(sqls) if 'DELETE' in s)
        i_ins = next(i for i, s in enumerate(sqls) if 'INSERT' in s)
        self.assertLess(i_del, i_ins)
        self.assertIn('WHERE SNAPSHOT_DATE = @D', sqls[i_del])
        # la fecha viaja parametrizada y es la fecha ART del dia
        cfg = client.calls[i_del][1]
        self.assertEqual(cfg.query_parameters[0].name, 'd')
        self.assertEqual(str(cfg.query_parameters[0].value), '2026-10-29')

    def test_dry_run_no_escribe(self):
        fn = _load_fn()
        client = _FakeClient()
        now = datetime(2026, 10, 29, 23, 30, tzinfo=ART)
        self.assertEqual(fn(client, dry_run=True, now=now), 0)
        self.assertEqual(client.calls, [])

    def test_hora_utc_se_convierte_a_art(self):
        # 01:30 UTC del 30/10 = 22:30 ART del 29/10 -> todavia no corresponde
        fn = _load_fn()
        client = _FakeClient()
        now = datetime(2026, 10, 30, 1, 30, tzinfo=timezone.utc)
        self.assertEqual(fn(client, now=now), 0)
        self.assertEqual(client.calls, [])


if __name__ == '__main__':
    unittest.main()
