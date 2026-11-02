// @ts-check
/** Script de apoyo scripts/audit/BQ_dashboard_fase2_queries.cjs: SQL pegable en BigQuery. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildScript,
  renderQuery,
} = require('../../../scripts/audit/BQ_dashboard_fase2_queries.cjs');

const NOW = Date.parse('2026-10-29T15:00:00Z');

/** Divide el script en bloques por la línea separadora. */
function bloques(script) {
  return script.split(/^-- ===== /m).slice(1);
}

describe('BQ_dashboard_fase2_queries', () => {
  it('no deja ningún "@" y declara cada variable antes de usarla', async () => {
    const script = await buildScript(NOW);
    expect(script).not.toContain('@');
    const bs = bloques(script);
    // 5 + 5 + 3 + 1 consultas por cada uno de los 2 filtros de muestra.
    expect(bs.length).toBe(28);
    for (const b of bs) {
      const declared = [...b.matchAll(/^DECLARE (p_\w+) /gm)].map((m) => m[1]);
      const idxUltimoDeclare = b.lastIndexOf('DECLARE ');
      const cuerpo = b.slice(b.indexOf('\n', idxUltimoDeclare >= 0 ? idxUltimoDeclare : 0));
      const usados = new Set(b.replace(/^DECLARE .*$/gm, '').match(/\bp_\w+/g) || []);
      for (const u of usados) expect(declared, u).toContain(u);
      // Todo DECLARE va antes del primer uso.
      const primerUso = cuerpo.search(/\bp_\w+/);
      if (declared.length && primerUso >= 0) {
        expect(b.indexOf('DECLARE ')).toBeLessThan(b.indexOf(cuerpo) + primerUso);
      }
    }
  });

  it('tipa arrays, enteros y strings y escapa comillas', () => {
    const out = renderQuery('x', 'f', {
      query: 'SELECT @a, @b, @c',
      params: { a: ["O'Neil"], b: 7, c: '2026-09-01' },
      types: { a: ['STRING'], b: 'INT64', c: 'STRING' },
    });
    expect(out).toContain("DECLARE p_a ARRAY<STRING> DEFAULT ['O\\'Neil'];");
    expect(out).toContain('DECLARE p_b INT64 DEFAULT 7;');
    expect(out).toContain("DECLARE p_c STRING DEFAULT '2026-09-01';");
    expect(out).toContain('SELECT p_a, p_b, p_c;');
    expect(() => renderQuery('x', 'f', { query: 'SELECT @z', params: {}, types: {} })).toThrow();
  });
});
