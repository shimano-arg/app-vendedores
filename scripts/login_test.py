# -*- coding: utf-8 -*-
"""Test rapido de login a SAP Service Layer.

Uso:
    $env:SAP_SL_PASSWORD = "..."
    python scripts\\login_test.py

Exit 0 si login OK, exit 1 si falla.
"""
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
SA_KEY = Path.home() / 'Desktop' / 'sa-key.json'
if SA_KEY.exists():
    os.environ['FIREBASE_SERVICE_ACCOUNT'] = SA_KEY.read_text()

import requests  # noqa: E402
from sync_sap_to_bigquery import init_firestore, parse_sa_json  # noqa: E402
from sync_sap_to_firestore import get_sl_config, sl_login  # noqa: E402

if not os.environ.get('SAP_SL_PASSWORD'):
    print('[FAIL] $env:SAP_SL_PASSWORD no seteado')
    sys.exit(1)

try:
    session = requests.Session()
    cfg = get_sl_config(init_firestore(parse_sa_json()))
    sl_login(cfg, session)
    print('LOGIN OK')
    sys.exit(0)
except SystemExit:
    raise
except Exception as e:
    print(f'[FAIL] {type(e).__name__}: {e}')
    sys.exit(1)
