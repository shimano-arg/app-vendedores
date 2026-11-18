#!/usr/bin/env python3
"""
Test unitario para scripts/sync_sales_plan_to_bigquery.py

Cubre la expansión de long format y los edge cases. No requiere
Firestore ni BigQuery — testea las pure functions del script.

Correr:
    python tests/python/test_sync_sales_plan_to_bigquery.py
"""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

# Importa desde scripts/
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from sync_sales_plan_to_bigquery import (  # noqa: E402
    expand_cache_to_rows,
    normalize_month_key,
    parse_firestore_date,
)


class TestNormalizeMonthKey(unittest.TestCase):
    def test_valid_month(self):
        self.assertEqual(normalize_month_key('2026-11'), date(2026, 11, 1))
        self.assertEqual(normalize_month_key('2027-01'), date(2027, 1, 1))

    def test_invalid_shape(self):
        for bad in ['', '2026', '2026-1', '202611', 'YYYY-MM', None, 42, ['2026-11']]:
            self.assertIsNone(normalize_month_key(bad), f'should reject {bad!r}')

    def test_invalid_month(self):
        self.assertIsNone(normalize_month_key('2026-13'))
        self.assertIsNone(normalize_month_key('2026-00'))

    def test_year_out_of_range(self):
        self.assertIsNone(normalize_month_key('1999-01'))
        self.assertIsNone(normalize_month_key('2101-01'))


class TestParseFirestoreDate(unittest.TestCase):
    def test_none(self):
        self.assertIsNone(parse_firestore_date(None))

    def test_empty_string(self):
        self.assertIsNone(parse_firestore_date(''))

    def test_iso_string(self):
        self.assertEqual(parse_firestore_date('2026-11-18T10:00:00Z'), '2026-11-18T10:00:00Z')

    def test_datetime_like(self):
        class FakeTs:
            def isoformat(self):
                return '2026-11-18T10:00:00+00:00'
        self.assertEqual(parse_firestore_date(FakeTs()), '2026-11-18T10:00:00+00:00')


class TestExpandCacheToRows(unittest.TestCase):
    LOADED = '2026-11-18T00:17:00Z'

    def test_fixture_ROD_CUDC201HG(self):
        """
        Fixture matcheando la captura de Mariano 2026-11-18:
        CUDC201HG en Rods con 2 u planeadas para los meses futuros.
        """
        cache = {
            'yearMonth': '2026-10',
            'sourceFilename': 'SUR 2026 1H Rods Sales Plan - Oct 26.xlsx',
            'uploadedBy': 'mariano.erbino@shimano.com.ar',
            'parsedAt': '2026-10-19T13:51:00Z',
            'rows': [
                {
                    'sku': 'CUDC201HG',
                    'description': '22 CURADO DC 201HG',
                    'moq': 10,
                    'months': {
                        '2023-05': 3,
                        '2024-03': 1,
                        '2026-11': 1,
                        '2026-12': 1,
                    },
                },
            ],
        }
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(len(rows), 4, 'cada mes con cantidad > 0 debe aparecer')

        # Chequeo del primer registro completo.
        r = next(r for r in rows if r['mes'] == '2026-11-01')
        self.assertEqual(r['familia'], 'rods')
        self.assertEqual(r['sku'], 'CUDC201HG')
        self.assertEqual(r['description'], '22 CURADO DC 201HG')
        self.assertEqual(r['moq'], 10)
        self.assertEqual(r['cantidad'], 1)
        self.assertEqual(r['source_year_month'], '2026-10')
        self.assertEqual(r['source_filename'], 'SUR 2026 1H Rods Sales Plan - Oct 26.xlsx')
        self.assertEqual(r['uploaded_by'], 'mariano.erbino@shimano.com.ar')
        self.assertEqual(r['snapshot_at'], '2026-10-19T13:51:00Z')
        self.assertEqual(r['loaded_at'], self.LOADED)

    def test_duplicate_sku_rod_reel(self):
        """
        Mismo SKU en Rods y Reels (caso típico de la captura). El export
        a long format produce registros independientes por familia; la
        vista `v_plan_futuro_por_sku` decide cómo colapsarlos.
        """
        rods_cache = {'rows': [{'sku': 'SLX151XGA', 'moq': 5, 'months': {'2026-11': 10}}]}
        reels_cache = {'rows': [{'sku': 'SLX151XGA', 'moq': 5, 'months': {'2026-11': 10}}]}
        rod_rows = expand_cache_to_rows('rods', rods_cache, self.LOADED)
        reel_rows = expand_cache_to_rows('reels', reels_cache, self.LOADED)
        self.assertEqual(len(rod_rows), 1)
        self.assertEqual(len(reel_rows), 1)
        self.assertEqual(rod_rows[0]['familia'], 'rods')
        self.assertEqual(reel_rows[0]['familia'], 'reels')

    def test_zero_or_negative_qty_skipped(self):
        cache = {'rows': [{'sku': 'X', 'months': {'2026-11': 0, '2026-12': -5, '2027-01': 3}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['mes'], '2027-01-01')
        self.assertEqual(rows[0]['cantidad'], 3)

    def test_invalid_month_key_skipped(self):
        cache = {'rows': [{'sku': 'X', 'months': {'bad-key': 10, '2026-11': 5}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['mes'], '2026-11-01')

    def test_no_sku_skipped(self):
        cache = {'rows': [{'sku': '', 'months': {'2026-11': 10}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(rows, [])

    def test_no_months_dict_skipped(self):
        cache = {'rows': [{'sku': 'X', 'months': None}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(rows, [])

    def test_empty_cache(self):
        self.assertEqual(expand_cache_to_rows('rods', {}, self.LOADED), [])
        self.assertEqual(expand_cache_to_rows('rods', {'rows': []}, self.LOADED), [])
        self.assertEqual(expand_cache_to_rows('rods', None, self.LOADED), [])  # type: ignore

    def test_qty_not_numeric_skipped(self):
        cache = {'rows': [{'sku': 'X', 'months': {'2026-11': 'abc', '2026-12': 5}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['cantidad'], 5)

    def test_moq_not_numeric_defaults_zero(self):
        cache = {'rows': [{'sku': 'X', 'moq': 'abc', 'months': {'2026-11': 5}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(rows[0]['moq'], 0)

    def test_snapshot_at_falls_back_when_parsedAt_missing(self):
        cache = {'rows': [{'sku': 'X', 'months': {'2026-11': 5}}]}
        rows = expand_cache_to_rows('rods', cache, self.LOADED)
        self.assertEqual(rows[0]['snapshot_at'], self.LOADED)


if __name__ == '__main__':
    unittest.main(verbosity=2)
