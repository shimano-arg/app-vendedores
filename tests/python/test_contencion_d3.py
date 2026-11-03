"""Contención C9-D3 (2026-11-03): tests sin red ni credenciales.

1. snapshot_avgprice_sl.ensure_sqlquery_exists: en --dry-run NO crea el
   SQLQuery en SAP (antes el dry-run hacía POST /SQLQueries).
2. sync_invoices_only.py: nunca llega al WRITE_TRUNCATE de sap_invoices_raw.
   Lectura incompleta -> exit 3; completa -> exit 0 sin escribir; --apply -> exit 2.

Correr con:
  python tests/python/test_contencion_d3.py
"""
import json
import os
import runpy
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCRIPTS = os.path.join(ROOT, 'scripts')


def _stub_modules():
    """Stubs de firebase_admin / google.cloud / google.oauth2 / requests."""
    mods = {}
    fa = types.ModuleType('firebase_admin')
    fa._apps = {}
    fa.initialize_app = lambda *a, **k: None
    cred = types.ModuleType('firebase_admin.credentials')
    cred.Certificate = lambda x: x
    fs = types.ModuleType('firebase_admin.firestore')
    fa.credentials, fa.firestore = cred, fs
    mods.update({'firebase_admin': fa, 'firebase_admin.credentials': cred, 'firebase_admin.firestore': fs})
    g = types.ModuleType('google')
    gc = types.ModuleType('google.cloud')
    bq = types.ModuleType('google.cloud.bigquery')
    bq.Client = object  # anotaciones de tipo del script
    go = types.ModuleType('google.oauth2')
    sa = types.ModuleType('google.oauth2.service_account')
    sa.Credentials = types.SimpleNamespace(from_service_account_info=lambda x: x)
    g.cloud, g.oauth2, gc.bigquery, go.service_account = gc, go, bq, sa
    mods.update({'google': g, 'google.cloud': gc, 'google.cloud.bigquery': bq,
                 'google.oauth2': go, 'google.oauth2.service_account': sa})
    req = types.ModuleType('requests')
    req.Session = object
    mods['requests'] = req
    return mods, fs, bq, req


class Resp:
    def __init__(self, status, body=None):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


class SnapshotDryRunTest(unittest.TestCase):
    def _load(self):
        mods, *_ = _stub_modules()
        with mock.patch.dict(sys.modules, mods):
            return runpy.run_path(os.path.join(SCRIPTS, 'snapshot_avgprice_sl.py'), run_name='snapshot_test')

    def test_dry_run_no_crea_sqlquery(self):
        ns = self._load()
        sess = mock.Mock()
        sess.get.return_value = Resp(404)
        ok = ns['ensure_sqlquery_exists'](sess, 'https://sl.invalid', dry_run=True)
        self.assertFalse(ok)
        sess.post.assert_not_called()

    def test_real_crea_si_falta(self):
        ns = self._load()
        sess = mock.Mock()
        sess.get.return_value = Resp(404)
        sess.post.return_value = Resp(201)
        self.assertTrue(ns['ensure_sqlquery_exists'](sess, 'https://sl.invalid', dry_run=False))
        self.assertEqual(sess.post.call_count, 1)

    def test_existe_no_postea_en_ningun_modo(self):
        ns = self._load()
        for dry in (True, False):
            sess = mock.Mock()
            sess.get.return_value = Resp(200, {'SqlCode': 'AVGPRICE_BQ'})
            self.assertTrue(ns['ensure_sqlquery_exists'](sess, 'https://sl.invalid', dry_run=dry))
            sess.post.assert_not_called()


class SyncInvoicesOnlyTest(unittest.TestCase):
    def _run(self, pages, argv=()):
        """Corre el script con SAP/Firestore/BQ falsos. Devuelve (exit_code, bq)."""
        mods, fs, bq, req = _stub_modules()
        doc = mock.Mock()
        doc.to_dict.return_value = {'serviceLayer': {
            'url': 'https://sl.invalid', 'companyDB': 'TEST', 'username': 'u', 'password': 'p'}}
        fs.client = lambda: mock.Mock(**{'collection.return_value.document.return_value.get.return_value': doc})
        bq_client = mock.Mock()
        bq.Client = mock.Mock(return_value=bq_client)
        bq.SchemaField = mock.Mock()
        bq.LoadJobConfig = mock.Mock()
        bq.WriteDisposition = types.SimpleNamespace(WRITE_TRUNCATE='WRITE_TRUNCATE')
        bq.SourceFormat = types.SimpleNamespace(NEWLINE_DELIMITED_JSON='NDJSON')
        sess = mock.Mock()
        sess.post.return_value = Resp(200)
        sess.get.side_effect = pages
        req.Session = lambda: sess
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, 'Desktop'))
            with open(os.path.join(home, 'Desktop', 'sa-key.json'), 'w') as fh:
                json.dump({'type': 'service_account', 'project_id': 'x'}, fh)
            with mock.patch.dict(sys.modules, mods), mock.patch.dict(os.environ, {'HOME': home}), \
                    mock.patch.object(sys, 'argv', ['sync_invoices_only.py', *argv]):
                with self.assertRaises(SystemExit) as cm:
                    runpy.run_path(os.path.join(SCRIPTS, 'sync_invoices_only.py'), run_name='__main__')
        return cm.exception.code, bq_client

    def test_lectura_incompleta_aborta_sin_escribir(self):
        pages = [Resp(200, {'value': [{'DocEntry': 1}], 'odata.nextLink': 'Invoices?$skip=20'}), Resp(500)]
        code, bq_client = self._run(pages)
        self.assertEqual(code, 3)
        bq_client.load_table_from_file.assert_not_called()

    def test_lectura_completa_no_escribe(self):
        code, bq_client = self._run([Resp(200, {'value': [{'DocEntry': 1}, {'DocEntry': 2}]})])
        self.assertEqual(code, 0)
        bq_client.load_table_from_file.assert_not_called()

    def test_apply_bloqueado(self):
        code, bq_client = self._run([Resp(200, {'value': [{'DocEntry': 1}]})], argv=['--apply'])
        self.assertEqual(code, 2)
        bq_client.load_table_from_file.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
