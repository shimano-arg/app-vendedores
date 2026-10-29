"""Tests de sync_backorder_dashboard_tables (Dashboard de Ventas, back order materializado).

La vista v_backorder_dashboard tarda minutos; el sync la guarda en tablas para
que el CF lea en segundos. Cliente BigQuery mockeado, sin red.

Correr con:
  python tests/python/test_backorder_dashboard_tables.py
"""
import os
import unittest
from datetime import datetime, timedelta, timezone

ART = timezone(timedelta(hours=-3))


class _FakeJob:
    def result(self):
        return []


class _FakeClient:
    def __init__(self, reconstruido_existe=True):
        self.sqls = []
        self._existe = reconstruido_existe

    def query(self, sql, job_config=None):
        self.sqls.append(sql)
        return _FakeJob()

    def get_table(self, ref):
        if not self._existe:
            raise Exception('Not found: ' + ref)
        return object()


def _load_fn():
    path = os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'sync_sap_to_bigquery.py')
    with open(path, encoding='utf-8') as f:
        source = f.read()
    start = source.index('def sync_backorder_dashboard_tables(')
    rest = source[start:]
    end = rest.index('\ndef ', 10)
    ns = {
        'bigquery': type('bq', (), {'Client': object}),
        'datetime': datetime,
        'timedelta': timedelta,
        'timezone': timezone,
        'BQ_PROJECT': 'app-vendedores-shimano',
        'BQ_DATASET': 'shimano_app',
        'log': lambda *_a, **_k: None,
    }
    exec(rest[:end], ns)
    return ns['sync_backorder_dashboard_tables']


class TestBackorderDashboardTables(unittest.TestCase):
    def test_actual_se_refresca_en_cada_corrida(self):
        fn = _load_fn()
        c = _FakeClient()
        r = fn(c, now=datetime(2026, 10, 29, 15, 0, tzinfo=ART))
        self.assertTrue(r['actual'])
        self.assertFalse(r['reconstruido'])
        self.assertEqual(len(c.sqls), 1)
        self.assertIn('backorder_dashboard_actual', c.sqls[0])
        self.assertIn('v_backorder_dashboard', c.sqls[0])

    def test_reconstruido_solo_de_noche(self):
        fn = _load_fn()
        c = _FakeClient()
        r = fn(c, now=datetime(2026, 10, 29, 23, 10, tzinfo=ART))
        self.assertTrue(r['reconstruido'])
        self.assertIn('backorder_reconstruido_mensual', c.sqls[1])

    def test_reconstruido_si_no_existe_aunque_sea_de_dia(self):
        fn = _load_fn()
        c = _FakeClient(reconstruido_existe=False)
        r = fn(c, now=datetime(2026, 10, 29, 10, 0, tzinfo=ART))
        self.assertTrue(r['reconstruido'])

    def test_dry_run_no_toca_bq(self):
        fn = _load_fn()
        c = _FakeClient()
        r = fn(c, dry_run=True, now=datetime(2026, 10, 29, 23, 30, tzinfo=ART))
        self.assertEqual(c.sqls, [])
        self.assertFalse(r['actual'])


class TestSnapshotLeeTabla(unittest.TestCase):
    def test_foto_diaria_copia_la_tabla_materializada(self):
        path = os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'sync_sap_to_bigquery.py')
        with open(path, encoding='utf-8') as f:
            src = f.read()
        start = src.index('def sync_backorder_daily_snapshot(')
        body = src[start:start + src[start:].index('\ndef ', 10)]
        self.assertIn('backorder_dashboard_actual', body)
        self.assertNotIn('.v_backorder_dashboard`', body)


if __name__ == '__main__':
    unittest.main()
