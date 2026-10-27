"""v1487 §85 (2026-10-27) — tests parse_firestore_date (Python).

Fix bug sync BQ: `AttributeError: 'str' object has no attribute 'isoformat'`
en sync_waitlist_from_firestore. Causa raíz: PR #1185 §57 (2026-10-23)
`commit-pedido-core.js:1157` escribe `updatedAt: nowIso` string ISO en
waitlist consumed. El script Python asumía Timestamp.

Correr con:
  python tests/python/test_parse_firestore_date.py
"""
import datetime
import os
import sys
import unittest
import importlib.util


def _load_parse_firestore_date():
    """Carga parse_firestore_date del script sin ejecutar su main()."""
    script_path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'scripts', 'sync_sap_to_bigquery.py'
    )
    with open(script_path, encoding='utf-8') as f:
        source = f.read()
    start = source.index('def parse_firestore_date(v):')
    rest = source[start:]
    end = rest.index('\ndef ', 10)
    fn_src = rest[:end]
    namespace = {}
    exec(fn_src, namespace)
    return namespace['parse_firestore_date']


parse_firestore_date = _load_parse_firestore_date()


class FakeFirestoreTimestamp:
    """Simula DatetimeWithNanoseconds del admin SDK Firestore."""
    def __init__(self, dt):
        self._dt = dt

    def isoformat(self):
        return self._dt.isoformat()


class ParseFirestoreDateTest(unittest.TestCase):
    """4 tipos de entrada que acepta la fuente única + edge cases."""

    def test_t1_firestore_timestamp_returns_iso(self):
        """Timestamp con .isoformat() -> string ISO."""
        ts = FakeFirestoreTimestamp(
            datetime.datetime(2026, 10, 23, 12, 36, 1, tzinfo=datetime.timezone.utc)
        )
        result = parse_firestore_date(ts)
        self.assertEqual(result, '2026-10-23T12:36:01+00:00')

    def test_t2_datetime_native_returns_iso(self):
        """datetime nativo -> string ISO (hasattr isoformat)."""
        dt = datetime.datetime(2026, 10, 26, 0, 5, 0, tzinfo=datetime.timezone.utc)
        result = parse_firestore_date(dt)
        self.assertEqual(result, '2026-10-26T00:05:00+00:00')

    def test_t3_string_iso_returns_same(self):
        """string ISO -> devuelve tal cual (CASO QUE ROMPIA EL SCRIPT)."""
        s = '2026-10-26T15:14:08.550Z'
        result = parse_firestore_date(s)
        self.assertEqual(result, s)

    def test_t4_none_returns_none(self):
        """None -> None (sin crash)."""
        self.assertIsNone(parse_firestore_date(None))

    def test_t5_empty_string_returns_none(self):
        """String vacio -> None (consistente con 'sin fecha')."""
        self.assertIsNone(parse_firestore_date(''))

    def test_t6_number_returns_none(self):
        """Numero crudo (epoch) -> None (no soportado, mejor fail-safe)."""
        self.assertIsNone(parse_firestore_date(1793107200))

    def test_t7_dict_without_isoformat_returns_none(self):
        """Dict sin isoformat (ej. {seconds, nanoseconds} crudo) -> None."""
        self.assertIsNone(
            parse_firestore_date({'seconds': 1793107200, 'nanoseconds': 0})
        )

    def test_t8_bug_repro_from_prod(self):
        """REPRO del bug sync BQ 26/10 00:05 UTC.

        Doc revision_waitlist/xsruGpl7vUTjlomBj9du tenia:
          updatedAt: "2026-10-26T21:30:55.541Z" (string ISO, no Timestamp)
        El script hacia updated_at.isoformat() -> AttributeError.
        Con el fix, parse_firestore_date lo devuelve tal cual.
        """
        updated_at = '2026-10-26T21:30:55.541Z'
        try:
            result = parse_firestore_date(updated_at)
        except AttributeError as e:
            self.fail(
                f'parse_firestore_date no debe tirar AttributeError: {e}'
            )
        self.assertEqual(result, '2026-10-26T21:30:55.541Z')


if __name__ == '__main__':
    unittest.main()
