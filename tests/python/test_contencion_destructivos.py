"""C9 contencion: tests de los 5 scripts Python destructivos con el guard.

Sin red y sin SDKs reales: firebase_admin, google.cloud.bigquery,
google.oauth2 y requests.Session se reemplazan por dobles que registran
cada llamada. Correr desde la raiz del repo:

    python3 -I tests/python/test_contencion_destructivos.py
"""
import contextlib
import importlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

FAKE_HOST = 'https://sl.example.invalid:50000'
PROD = 'app-vendedores-shimano'
STG = 'app-vendedores-shimano-stg'


def sa_json(project=PROD):
    return json.dumps({'type': 'service_account', 'client_email': f'bot@{project}.iam.gserviceaccount.com',
                       'project_id': project, 'private_key': 'x'})


# ---------------------------------------------------------------- dobles
class Calls(list):
    pass


CALLS = Calls()


class FakeSnap:
    def __init__(self, doc_id, data, ref=None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None
        self.reference = ref or ('ref', doc_id)

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class FakeDocRef:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def get(self):
        return FakeSnap(self.id, self.db.data.get(self.coll, {}).get(self.id))


class FakeQuery:
    def __init__(self, db, coll, field, val):
        self.db, self.coll, self.field, self.val = db, coll, field, val

    def stream(self):
        out = []
        for k, v in self.db.data.get(self.coll, {}).items():
            if v.get(self.field) == self.val:
                out.append(FakeSnap(k, v, ref=(self.coll, k)))
        return out


class FakeColl:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def document(self, doc_id):
        return FakeDocRef(self.db, self.name, doc_id)

    def where(self, field, op, val):
        return FakeQuery(self.db, self.name, field, val)


class FakeBatch:
    def __init__(self, db):
        self.db, self.ops = db, []

    def delete(self, ref):
        self.ops.append(ref)

    def commit(self):
        CALLS.append(('fs.batch.commit.delete', list(self.ops)))


class FakeFirestore:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        return FakeColl(self, name)

    def batch(self):
        return FakeBatch(self)


FS = {'db': FakeFirestore({})}


class FakeJob:
    num_dml_affected_rows = 7

    def __init__(self, sql=None):
        self.sql = sql

    def result(self):
        if self.sql and 'costo_snapshot_semanal' in self.sql:
            return []  # lectura de comparacion de test_sl_sqlqueries: sin filas
        return [types.SimpleNamespace(total=1, n_with_paid=1, n_with_lines=1, saldo_total=0.0,
                                      fecha_min='x', fecha_max='y', n_monedas=1, monedas='USD')]


class FakeBQClient:
    def __init__(self, project=None, credentials=None, location=None):
        CALLS.append(('bq.client', project))
        self.project = project

    def query(self, sql):
        CALLS.append(('bq.query', sql))
        return FakeJob(sql)

    def load_table_from_file(self, buf, table, location=None, job_config=None):
        CALLS.append(('bq.load_file', table))
        return FakeJob()

    def load_table_from_json(self, rows, table, job_config=None):
        CALLS.append(('bq.load_json', table, len(rows)))
        return FakeJob()

    def get_table(self, table):
        CALLS.append(('bq.get_table', table))
        return object()

    def create_table(self, table):
        CALLS.append(('bq.create_table', table))

    def delete_table(self, table):
        CALLS.append(('bq.delete_table', table))


def install_stubs():
    fa = types.ModuleType('firebase_admin')
    fa._apps = {}

    def initialize_app(cred=None, options=None):
        CALLS.append(('fa.init', (options or {}).get('projectId')))
        fa._apps['[DEFAULT]'] = True
    fa.initialize_app = initialize_app
    cr = types.ModuleType('firebase_admin.credentials')
    cr.Certificate = lambda d: ('cert', d.get('project_id') if isinstance(d, dict) else d)
    cr.ApplicationDefault = lambda: ('adc',)
    fsm = types.ModuleType('firebase_admin.firestore')
    fsm.client = lambda: FS['db']
    fsm.Client = FakeFirestore
    fa.credentials, fa.firestore = cr, fsm
    google = sys.modules.get('google') or types.ModuleType('google')
    gc = types.ModuleType('google.cloud')
    bq = types.ModuleType('google.cloud.bigquery')
    bq.Client = FakeBQClient
    bq.SchemaField = lambda *a, **k: ('field', a)
    bq.LoadJobConfig = lambda **k: ('cfg', k)
    bq.WriteDisposition = types.SimpleNamespace(WRITE_TRUNCATE='WRITE_TRUNCATE')
    bq.SourceFormat = types.SimpleNamespace(NEWLINE_DELIMITED_JSON='NDJSON')
    bq.Table = lambda name, schema=None: ('table', name)
    gc.bigquery = bq
    go = types.ModuleType('google.oauth2')
    sa = types.ModuleType('google.oauth2.service_account')
    sa.Credentials = types.SimpleNamespace(from_service_account_info=lambda d: ('sacreds', d.get('project_id')))
    go.service_account = sa
    google.cloud, google.oauth2 = gc, go
    sys.modules.update({
        'firebase_admin': fa, 'firebase_admin.credentials': cr, 'firebase_admin.firestore': fsm,
        'google': google, 'google.cloud': gc, 'google.cloud.bigquery': bq,
        'google.oauth2': go, 'google.oauth2.service_account': sa,
    })
    return fa


class FakeResp:
    def __init__(self, status=200, body=None, text=''):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body
        self.text = text or (json.dumps(body) if body is not None else '')
        self.headers = {'Set-Cookie': 'B1SESSION=secret-cookie'}
        self.encoding = None

    def json(self):
        if self._body is None:
            raise ValueError('no json')
        return self._body


class FakeSession:
    """Registra todo request. `routes`: lista de (metodo, substring, respuesta)."""
    routes = []

    def __init__(self):
        self.headers = {}

    def _handle(self, method, url, json=None, **kw):
        CALLS.append(('http', method.upper(), url, json))
        for m, sub, resp in FakeSession.routes:
            if m == method.upper() and sub in url:
                return resp() if callable(resp) else resp
        return FakeResp(200, {})

    def request(self, method, url, json=None, **kw):
        return self._handle(method, url, json, **kw)

    def post(self, url, json=None, **kw):
        return self._handle('POST', url, json, **kw)

    def get(self, url, **kw):
        return self._handle('GET', url, None, **kw)


def http_writes():
    """POST/PATCH/DELETE que NO son Login/Logout ni lecturas conocidas."""
    reads = ('/Login', '/Logout', 'SBOBobService_GetCurrencyRate', "/List")
    return [c for c in CALLS if c[0] == 'http' and c[1] in ('POST', 'PATCH', 'DELETE', 'PUT')
            and not any(r in c[2] for r in reads)]


def bq_writes():
    keys = ('ALTER', 'UPDATE', 'DROP', 'MERGE', 'CREATE OR REPLACE', 'DELETE')
    return [c for c in CALLS if c[0] in ('bq.load_file', 'bq.load_json', 'bq.create_table', 'bq.delete_table')
            or (c[0] == 'bq.query' and any(k in c[1].upper() for k in keys))]


class Base(unittest.TestCase):
    MODULE = None

    def setUp(self):
        CALLS.clear()
        install_stubs()
        import requests
        self._orig_session = requests.Session
        requests.Session = FakeSession
        FakeSession.routes = []
        FS['db'] = FakeFirestore({'app_config': {'sap_integration': {'serviceLayer': {
            'enabled': True, 'url': FAKE_HOST, 'companyDB': 'DB_TEST', 'username': 'u'}}}})
        self._env = dict(os.environ)
        for k in ('GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT',
                  'CLOUDSDK_CORE_PROJECT', 'FIREBASE_SERVICE_ACCOUNT', 'SAP_SL_PASSWORD', 'DRY_RUN'):
            os.environ.pop(k, None)
        self.tmp = tempfile.mkdtemp()
        os.environ['HOME'] = self.tmp  # sin ADC real del desarrollador
        os.environ.pop('CLOUDSDK_CONFIG', None)
        os.environ.pop('APPDATA', None)
        for m in list(sys.modules):
            if m in ('probe_sap_discount', 'test_sl_sqlqueries', 'patch_paid_to_date', 'backfill_sap_ortt',
                     'cleanup_bad_bp_sync', 'sync_sap_to_bigquery'):
                del sys.modules[m]

    def tearDown(self):
        import requests
        requests.Session = self._orig_session
        os.environ.clear()
        os.environ.update(self._env)

    def run_main(self, module, argv):
        mod = importlib.import_module(module)
        out, err = io.StringIO(), io.StringIO()
        code = None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = mod.main(argv)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue() + err.getvalue(), mod


# ---------------------------------------------------------------- probe_sap_discount
class TestProbeSapDiscount(Base):
    def setUp(self):
        super().setUp()
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json()
        os.environ['SAP_SL_PASSWORD'] = 'pw-test'
        FS['db'].data['pedidos'] = {'VCTStbCkQpp2YnO5Isww': {
            'clientName': 'X', 'discountPct': 4, 'lines': [{'code': 'A', 'qty': 1}, {'code': 'B', 'qty': 2}]}}
        FakeSession.routes = [('POST', '/Quotations(', FakeResp(204)),
                              ('POST', '/b1s/v1/Quotations', FakeResp(201, {'DocEntry': 99}))]

    def test_sin_project_bloquea_sin_tocar_nada(self):
        code, out, _ = self.run_main('probe_sap_discount', [])
        self.assertEqual(code, 2)
        self.assertIn('E_NO_PROJECT', out)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [])

    def test_dry_run_por_defecto_no_hace_ningun_request_y_enmascara_host(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD])
        self.assertEqual(code, 0)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [], 'ni Login en dry-run')
        self.assertIn('[DRY-RUN] haría: POST <SAP_SL>/b1s/v1/Quotations [Quotations]', out)
        self.assertNotIn('sl.example.invalid', out)
        self.assertIn('"DiscountPercent": 4', out)

    def test_apply_sin_confirm_project_bloquea(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD, '--apply'])
        self.assertEqual(code, 2)
        self.assertIn('E_CONFIRMATION_REQUIRED', out)
        self.assertEqual(http_writes(), [])

    def test_apply_sin_sap_allow_bloquea(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--confirm-sap-company=DB_TEST'])
        self.assertEqual(code, 2)
        self.assertIn('E_SAP_ENTITY_NOT_ALLOWED', out)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [])

    def test_apply_con_entidad_extra_bloquea(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--sap-allow=Quotations,Orders',
                                                            '--confirm-sap-company=DB_TEST'])
        self.assertEqual(code, 2)
        self.assertIn('Orders', out)

    def test_apply_company_incorrecta_bloquea(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--sap-allow=Quotations,Quotations/Cancel',
                                                            '--confirm-sap-company=OTRA'])
        self.assertEqual(code, 2)
        self.assertIn('E_SAP_COMPANY_CONFIRMATION', out)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [])

    def test_apply_completo_crea_cancela_y_logout_sin_loguear_cookie(self):
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--sap-allow=Quotations,Quotations/Cancel',
                                                            '--confirm-sap-company=DB_TEST'])
        self.assertEqual(code, 0, out)
        urls = [c[2] for c in CALLS if c[0] == 'http']
        self.assertTrue(urls[0].endswith('/Login'))
        self.assertTrue(any(u.endswith('/Quotations') for u in urls))
        self.assertTrue(any(u.endswith('/Quotations(99)/Cancel') for u in urls))
        self.assertTrue(urls[-1].endswith('/Logout'))
        self.assertNotIn('secret-cookie', out)
        self.assertNotIn('sl.example.invalid', out)

    def test_sa_de_otro_proyecto_bloquea_incluso_en_dry_run(self):
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json(STG)
        code, out, _ = self.run_main('probe_sap_discount', ['--project', PROD])
        self.assertEqual(code, 2)
        self.assertIn('E_CREDENTIAL_PROJECT_MISMATCH', out)


# ---------------------------------------------------------------- test_sl_sqlqueries
class TestSlSqlQueries(Base):
    def setUp(self):
        super().setUp()
        os.environ['SAP_SL_PASSWORD'] = 'pw-test'

    def test_dry_run_no_crea_sqlquery_y_corta_si_no_existe(self):
        FakeSession.routes = [('GET', "SQLQueries('AVGPRICE_BQ')", FakeResp(404, {'error': {}}))]
        code, out, _ = self.run_main('test_sl_sqlqueries', ['--project', PROD])
        self.assertIn(code, (None, 0))
        self.assertEqual(http_writes(), [])
        self.assertIn('[DRY-RUN] haría: POST <SAP_SL>/b1s/v1/SQLQueries [SQLQueries]', out)
        self.assertNotIn('sl.example.invalid', out)

    def test_apply_con_adc_de_usuario_en_prod_bloquea(self):
        gdir = os.path.join(self.tmp, '.config', 'gcloud')
        os.makedirs(gdir)
        with open(os.path.join(gdir, 'application_default_credentials.json'), 'w') as fh:
            json.dump({'type': 'authorized_user'}, fh)
        code, out, _ = self.run_main('test_sl_sqlqueries', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--sap-allow=SQLQueries', '--confirm-sap-company=DB_TEST'])
        self.assertEqual(code, 2)
        self.assertIn('E_USER_ADC_ON_PROD', out)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [])

    def test_apply_completo_con_sa_crea_la_sqlquery(self):
        sa_path = os.path.join(self.tmp, 'sa.json')
        with open(sa_path, 'w') as fh:
            fh.write(sa_json())
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = sa_path
        FakeSession.routes = [('POST', '/b1s/v1/SQLQueries', FakeResp(201, {})),
                              ('GET', '/List', FakeResp(200, {'value': [{'ItemCode': 'A', 'AvgPrice': 1}]}))]
        code, out, _ = self.run_main('test_sl_sqlqueries', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                            '--sap-allow=SQLQueries', '--confirm-sap-company=DB_TEST'])
        self.assertEqual([c[2] for c in http_writes()], [f'{FAKE_HOST}/b1s/v1/SQLQueries'])


# ---------------------------------------------------------------- patch_paid_to_date
class TestPatchPaidToDate(Base):
    def setUp(self):
        super().setUp()
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json()
        os.environ['SAP_SL_PASSWORD'] = 'pw-test'
        FakeSession.routes = [('GET', '/Invoices', FakeResp(200, {'value': [{'DocEntry': 1, 'PaidToDate': 5.0}]}))]

    def test_importar_no_ejecuta_nada(self):
        importlib.import_module('patch_paid_to_date')
        self.assertEqual(CALLS, [])

    def test_dry_run_por_defecto_no_escribe_bq(self):
        code, out, _ = self.run_main('patch_paid_to_date', ['--project', PROD])
        self.assertEqual(code, 0, out)
        self.assertEqual(bq_writes(), [])
        self.assertIn('[DRY-RUN] haría: ALTER TABLE', out)
        self.assertIn('[DRY-RUN] haría: DROP TABLE IF EXISTS', out)

    def test_lectura_sap_incompleta_aborta_antes_de_bq_aun_con_apply(self):
        FakeSession.routes = [('GET', '/Invoices', FakeResp(500, None, 'boom'))]
        code, out, _ = self.run_main('patch_paid_to_date', ['--project', PROD, '--apply', f'--confirm-project={PROD}'])
        self.assertEqual(code, 1)
        self.assertEqual(bq_writes(), [])

    def test_apply_ejecuta_alter_load_update_drop_en_orden_contra_el_project(self):
        code, out, _ = self.run_main('patch_paid_to_date', ['--project', PROD, '--apply', f'--confirm-project={PROD}'])
        self.assertEqual(code, 0, out)
        kinds = [(c[0], c[1].split()[0] if c[0] == 'bq.query' else c[1]) for c in bq_writes()]
        self.assertEqual([k[1] if k[0] == 'bq.query' else k[0] for k in kinds],
                         ['ALTER', 'bq.load_file', 'UPDATE', 'DROP'])
        self.assertTrue(all(PROD in (c[1]) for c in bq_writes()))


# ---------------------------------------------------------------- backfill_sap_ortt
class TestBackfillSapOrtt(Base):
    def setUp(self):
        super().setUp()
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json()
        os.environ['SAP_SL_PASSWORD'] = 'pw-test'
        FakeSession.routes = [
            ('GET', '/Currencies', FakeResp(200, {'value': [{'Code': 'USD', 'International': 'tYES'}]})),
            ('POST', 'SBOBobService_GetCurrencyRate', FakeResp(200, 1000.5)),
        ]
        self.today = datetime.now(timezone.utc).date().isoformat()

    def test_dry_run_por_defecto_no_escribe_bq(self):
        code, out, _ = self.run_main('backfill_sap_ortt', ['--project', PROD, f'--start-date={self.today}'])
        self.assertIn(code, (None, 0), out)
        self.assertEqual(bq_writes(), [])
        self.assertIn('[DRY RUN] 1 rows preparadas', out)

    def test_apply_hace_merge_y_view_en_el_project_indicado(self):
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json(STG)
        code, out, _ = self.run_main('backfill_sap_ortt', ['--project', STG, '--apply', f'--start-date={self.today}'])
        self.assertIn(code, (None, 0), out)
        w = bq_writes()
        self.assertTrue(any(c[0] == 'bq.query' and 'MERGE INTO' in c[1] and STG in c[1] for c in w))
        self.assertTrue(any(c[0] == 'bq.query' and 'dim_tipo_cambio' in c[1] and STG in c[1] for c in w))
        self.assertFalse(any(f'`{PROD}.' in str(c) for c in w), 'nada contra prod')

    def test_project_distinto_de_la_sa_bloquea(self):
        code, out, _ = self.run_main('backfill_sap_ortt', ['--project', STG, f'--start-date={self.today}'])
        self.assertEqual(code, 2)
        self.assertIn('E_CREDENTIAL_PROJECT_MISMATCH', out)
        self.assertEqual([c for c in CALLS if c[0] == 'http'], [])

    def test_invocacion_vieja_del_cron_sin_flags_ahora_falla_cerrado(self):
        code, out, _ = self.run_main('backfill_sap_ortt', [f'--start-date={self.today}'])
        self.assertEqual(code, 2)
        self.assertEqual(bq_writes(), [])


# ---------------------------------------------------------------- cleanup_bad_bp_sync
class TestCleanupBadBpSync(Base):
    def setUp(self):
        super().setUp()
        os.environ['FIREBASE_SERVICE_ACCOUNT'] = sa_json()
        FS['db'].data['client_applications'] = {
            'nuevo1': {'source': 'sap_sync', 'createdAt': '2026-07-09T00:00:00Z', 'comercio': 'A'},
            'viejo1': {'source': 'sap_sync', 'createdAt': '2026-06-01T00:00:00Z'},
            'manual': {'source': 'vendedor', 'createdAt': '2026-07-10T00:00:00Z'},
            'sinfecha': {'source': 'sap_sync'},
        }

    def deletes(self):
        return [c for c in CALLS if c[0] == 'fs.batch.commit.delete']

    def test_invocacion_vieja_sin_project_ya_no_borra(self):
        code, out, _ = self.run_main('cleanup_bad_bp_sync', [])
        self.assertEqual(code, 2)
        self.assertEqual(self.deletes(), [])

    def test_dry_run_por_defecto_no_borra(self):
        code, out, _ = self.run_main('cleanup_bad_bp_sync', ['--project', PROD])
        self.assertEqual(self.deletes(), [])
        self.assertIn('[DRY-RUN] haría: borrar 1 docs', out)

    def test_dry_run_env_con_apply_es_ambiguo_y_bloquea(self):
        os.environ['DRY_RUN'] = 'true'
        code, out, _ = self.run_main('cleanup_bad_bp_sync', ['--project', PROD, '--apply', f'--confirm-project={PROD}'])
        self.assertEqual(code, 2)
        self.assertEqual(self.deletes(), [])

    def test_apply_respalda_antes_y_borra_solo_post_cutoff(self):
        code, out, _ = self.run_main('cleanup_bad_bp_sync', ['--project', PROD, '--apply', f'--confirm-project={PROD}',
                                                              f'--backup-dir={self.tmp}'])
        d = self.deletes()
        self.assertEqual(len(d), 1)
        self.assertEqual(d[0][1], [('client_applications', 'nuevo1')])
        backups = [f for f in os.listdir(self.tmp) if f.startswith('cleanup_bad_bp_sync_backup_')]
        self.assertEqual(len(backups), 1)
        with open(os.path.join(self.tmp, backups[0])) as fh:
            self.assertEqual(list(json.load(fh).keys()), ['nuevo1'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
