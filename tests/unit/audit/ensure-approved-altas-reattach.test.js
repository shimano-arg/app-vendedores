// @ts-check
/**
 * v1462 (2026-10-26) — ensureApprovedAltasListener re-attach cuando
 * assignedVendor llega después del primer read.
 *
 * El fix vive en index.html (ensureApprovedAltasListener + fetchAndApplyRole).
 * Este test parsea el HTML + verifica el contrato por grep:
 *   1. ensureApprovedAltasListener tiene variable `_approvedAltasListenerVendor`.
 *   2. Si assignedVendor cambió, hace unsubscribe + re-attach.
 *   3. fetchAndApplyRole invoca ensureApprovedAltasListener después de setear assignedVendor.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1462 §P2 — ensureApprovedAltasListener re-attach', () => {
  it('tracker _approvedAltasListenerVendor existe', () => {
    expect(INDEX_HTML).toMatch(/var\s+_approvedAltasListenerVendor\s*=\s*null/);
  });

  it('ensureApprovedAltasListener re-attach si assignedVendor cambió', () => {
    // Grep del patrón: dentro de ensureApprovedAltasListener, si unsubApprovedAltas
    // existe + _approvedAltasListenerVendor !== assignedVendor → unsubscribe.
    const fn = INDEX_HTML.slice(
      INDEX_HTML.indexOf('function ensureApprovedAltasListener'),
      INDEX_HTML.indexOf(
        'function',
        INDEX_HTML.indexOf('function ensureApprovedAltasListener') + 10
      )
    );
    expect(fn).toMatch(/_approvedAltasListenerVendor === assignedVendor/);
    expect(fn).toMatch(/unsubApprovedAltas\(\)/);
    expect(fn).toMatch(/_approvedAltasListenerVendor = assignedVendor/);
    // El early return viejo seguía: si !currentUser o !fbDb → return (sin tocar listener).
    expect(fn).toMatch(/if \(!currentUser \|\| !fbDb\) return/);
  });

  it('fetchAndApplyRole invoca ensureApprovedAltasListener después de setear assignedVendor', () => {
    const i = INDEX_HTML.indexOf('assignedVendor = data.vendor');
    expect(i).toBeGreaterThan(0);
    const window = INDEX_HTML.slice(i, i + 400);
    expect(window).toMatch(/ensureApprovedAltasListener\s*\(\s*\)/);
  });
});
