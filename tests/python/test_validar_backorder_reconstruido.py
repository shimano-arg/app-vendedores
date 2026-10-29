"""Tests de la logica pura del validador de back order reconstruido.

Importa solo las funciones puras de
scripts/audit/BQ_validar_backorder_reconstruido.py (las librerias de Google se
importan recien dentro de main(), asi que no hacen falta para estos tests).

Correr con:
  python tests/python/test_validar_backorder_reconstruido.py
"""
import importlib.util
import os
import unittest
from datetime import date


def _load_module():
    path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'scripts', 'audit',
        'BQ_validar_backorder_reconstruido.py',
    )
    spec = importlib.util.spec_from_file_location('bq_validar_bo', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


M = _load_module()


class TestComputeDesvio(unittest.TestCase):
    def test_igual_da_cero(self):
        self.assertEqual(M.compute_desvio(100.0, 100.0), 0.0)

    def test_reconstruido_mayor(self):
        self.assertAlmostEqual(M.compute_desvio(110.0, 100.0), 0.10)

    def test_reconstruido_menor_es_valor_absoluto(self):
        self.assertAlmostEqual(M.compute_desvio(80.0, 100.0), 0.20)

    def test_reconstruido_cero(self):
        self.assertAlmostEqual(M.compute_desvio(0.0, 50.0), 1.0)

    def test_real_cero_o_negativo_es_error(self):
        with self.assertRaises(ValueError):
            M.compute_desvio(10.0, 0.0)
        with self.assertRaises(ValueError):
            M.compute_desvio(10.0, -5.0)


class TestVeredicto(unittest.TestCase):
    def test_dentro_del_umbral(self):
        self.assertEqual(M.veredicto(0.10), 0)

    def test_justo_en_el_umbral_pasa(self):
        self.assertEqual(M.veredicto(0.15), 0)

    def test_fuera_del_umbral(self):
        self.assertEqual(M.veredicto(0.1501), 2)

    def test_umbral_custom(self):
        self.assertEqual(M.veredicto(0.20, umbral=0.25), 0)
        self.assertEqual(M.veredicto(0.30, umbral=0.25), 2)


class TestMesFin(unittest.TestCase):
    def test_mes_de_30(self):
        self.assertEqual(M.mes_fin('2026-09'), date(2026, 9, 30))

    def test_diciembre(self):
        self.assertEqual(M.mes_fin('2025-12'), date(2025, 12, 31))

    def test_febrero_bisiesto(self):
        self.assertEqual(M.mes_fin('2024-02'), date(2024, 2, 29))

    def test_formato_invalido(self):
        for bad in ('2026-13', '2026/09', '26-09', '', '2026-9x'):
            with self.assertRaises(ValueError):
                M.mes_fin(bad)


if __name__ == '__main__':
    unittest.main(verbosity=2)
