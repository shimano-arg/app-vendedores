"""Test directo al SL con distintos $top para ver si el server los respeta."""
import json
from pathlib import Path

import requests
import firebase_admin
from firebase_admin import credentials, firestore

sa = json.loads((Path.home() / 'Desktop' / 'sa-key.json').read_text())
firebase_admin.initialize_app(credentials.Certificate(sa))
db = firestore.client()
sl = db.collection('app_config').document('sap_integration').get().to_dict().get('serviceLayer')

session = requests.Session()
resp = session.post(f"{sl['url']}/b1s/v1/Login",
                    json={'CompanyDB': sl['companyDB'],
                          'UserName': sl['username'],
                          'Password': sl['password']}, timeout=30)
print(f'Login: HTTP {resp.status_code}')
assert resp.ok

# Test 1: BP con $top=200 explicito y $inlinecount
url = f"{sl['url']}/b1s/v1/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode&$top=200&$inlinecount=allpages"
r = session.get(url, timeout=60)
body = r.json()
print(f'\nBP $top=200: HTTP {r.status_code}')
print(f'  rows returned: {len(body.get("value", []))}')
print(f'  @odata.count (total): {body.get("@odata.count") or body.get("odata.count")}')
print(f'  nextLink: {body.get("@odata.nextLink") or body.get("odata.nextLink")}')

# Test 2: sin $top, ver default
url = f"{sl['url']}/b1s/v1/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode"
r = session.get(url, timeout=60)
body = r.json()
print(f'\nBP sin $top: HTTP {r.status_code}')
print(f'  rows returned: {len(body.get("value", []))}')
print(f'  nextLink: {body.get("@odata.nextLink") or body.get("odata.nextLink")}')

# Test 3: header Prefer maxpagesize
url = f"{sl['url']}/b1s/v1/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode"
r = session.get(url, timeout=60, headers={'Prefer': 'odata.maxpagesize=500'})
body = r.json()
print(f'\nBP con Prefer maxpagesize=500: HTTP {r.status_code}')
print(f'  rows returned: {len(body.get("value", []))}')
print(f'  nextLink: {body.get("@odata.nextLink") or body.get("odata.nextLink")}')

# Test 4: Items PESCA count total
url = f"{sl['url']}/b1s/v1/ItemGroups?$filter=GroupName eq 'PESCA'&$select=Number"
r = session.get(url, timeout=30)
pesca_num = r.json()['value'][0]['Number']
print(f'\nPESCA group code: {pesca_num}')

url = f"{sl['url']}/b1s/v1/Items?$filter=ItemsGroupCode eq {pesca_num}&$select=ItemCode&$inlinecount=allpages&$top=1"
r = session.get(url, timeout=60)
body = r.json()
print(f'Items PESCA count total: {body.get("@odata.count") or body.get("odata.count")}')
