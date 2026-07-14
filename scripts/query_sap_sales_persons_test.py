"""Repite /SalesPersons contra SHIMANO_TST_06 por si los SlpCodes 49-55
que menciona el user viven en TEST (donde SEIDOR/Santiago hicieron pruebas)."""
import json
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
import requests

SA_KEY_PATH = Path.home() / 'Desktop' / 'sa-key.json'
sa_data = json.loads(SA_KEY_PATH.read_text())
cred = credentials.Certificate(sa_data)
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

snap = db.collection('app_config').document('sap_integration').get()
sl = (snap.to_dict() or {}).get('serviceLayer') or {}

# Override CompanyDB para probar TEST
cfg = {
    'url': sl['url'].rstrip('/'),
    'companyDB': 'SHIMANO_TST_06',  # TEST db
    'username': sl['username'],
    'password': sl['password'],
}
print(f'SL URL: {cfg["url"]}')
print(f'CompanyDB: {cfg["companyDB"]}  (TEST)')

session = requests.Session()
resp = session.post(
    f"{cfg['url']}/b1s/v1/Login",
    json={'CompanyDB': cfg['companyDB'], 'UserName': cfg['username'], 'Password': cfg['password']},
    timeout=30,
)
if not resp.ok:
    print(f'LOGIN FALLO: {resp.status_code} {resp.text[:400]}')
    raise SystemExit(1)
print('LOGIN OK')

resp = session.get(
    f"{cfg['url']}/b1s/v1/SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName,Active&$top=200",
    timeout=30,
)
if not resp.ok:
    print(f'FAIL: {resp.status_code} {resp.text[:400]}')
    raise SystemExit(1)

data = resp.json().get('value', [])
print(f'\nTotal SalesPersons en {cfg["companyDB"]}: {len(data)}\n')
print(f'{"SlpCode":>8}  {"Active":<6}  Name')
print('-' * 60)
for sp in sorted(data, key=lambda x: x.get('SalesEmployeeCode', 0)):
    code = sp.get('SalesEmployeeCode')
    name = sp.get('SalesEmployeeName', '')
    active = sp.get('Active', '?')
    tag = ''
    if code in (49, 50, 51, 52, 53, 54, 55):
        tag = '  <-- rango app'
    print(f'{code:>8}  {active:<6}  {name}{tag}')

session.post(f"{cfg['url']}/b1s/v1/Logout")
