// @ts-check
/**
 * v1490 §88 (2026-10-27) — listeners pedidos VDE: filtrar por assignedVendorUid.
 *
 * Reporte Mariano: Gonzalo (VDE) no veía la ORDEN 516 BROBRO SA cargada por
 * Mariano (admin) desde Stock Asignado el 23/10. Firestore tenía el pedido
 * con `assignedVendorUid=Gonzalo.uid` correctamente (§44 aplica en CPST +
 * commitPedidoCF), pero los 2 listeners del cliente `pedidos_own` y
 * `pedidos_all` filtraban por `ownerUid` (quien cargó = Mariano) en vez de
 * `assignedVendorUid` (vendedor del cliente master).
 *
 * El Planner (`_subscribePlannerPedidos`) ya tenía el fix §44 desde v1406.
 * Los 2 listeners de Confirmados + globalPedidos quedaron atrás hasta v1490.
 *
 * Fix: migrar ambos a `where('assignedVendorUid', '==', uid)` para VDE.
 * Rules firestore.rules:121-122 ya permiten OR ownerUid/assignedVendorUid.
 *
 * Pedidos legacy con `assignedVendorUid` vacío + `ownerUid=VDE` requieren
 * backfill §80 (script AP v1490).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1490 §88 — listeners pedidos para VDE usan assignedVendorUid', () => {
  it('T1 listener pedidos_own filtra VDE por assignedVendorUid', () => {
    const idx = INDEX_HTML.indexOf("ensureListenerWithFallback(\n    'pedidos_own'");
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1200);
    expect(slice).toMatch(/where\(['"]assignedVendorUid['"], ?['"]==['"], ?currentUser\.uid\)/);
    // Ya no debería filtrar por ownerUid.
    expect(slice).not.toMatch(/where\(['"]ownerUid['"], ?['"]==['"], ?currentUser\.uid\)/);
  });

  it('T2 listener pedidos_all filtra VDE por assignedVendorUid', () => {
    const idx = INDEX_HTML.indexOf("ensureListenerWithFallback(\n    'pedidos_all'");
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/userRole === ['"]vendedor['"]/);
    expect(slice).toMatch(/where\(['"]assignedVendorUid['"], ?['"]==['"], ?currentUser\.uid\)/);
    expect(slice).not.toMatch(/where\(['"]ownerUid['"], ?['"]==['"], ?currentUser\.uid\)/);
  });

  it('T3 listener Planner (_subscribePlannerPedidos) mantiene assignedVendorUid (§44)', () => {
    const idx = INDEX_HTML.indexOf('function _subscribePlannerPedidos()');
    const slice = INDEX_HTML.slice(idx, idx + 400);
    expect(slice).toMatch(/where\(['"]assignedVendorUid['"], ?['"]==['"], ?currentUser\.uid\)/);
  });

  it('T4 admin/gerente/interno/viewer siguen SIN filtro (ven todos los pedidos)', () => {
    const idx = INDEX_HTML.indexOf("ensureListenerWithFallback(\n    'pedidos_own'");
    const slice = INDEX_HTML.slice(idx, idx + 1200);
    expect(slice).toMatch(/userRole === ['"]admin['"]/);
    expect(slice).toMatch(/userRole === ['"]gerente['"]/);
    expect(slice).toMatch(/userRole === ['"]interno['"]/);
    expect(slice).toMatch(/userRole === ['"]viewer['"]/);
  });

  it('T5 referencia al bug precedente (ORDEN 516) en comment', () => {
    const idx = INDEX_HTML.indexOf("ensureListenerWithFallback(\n    'pedidos_own'");
    // El comment v1490 §88 debería estar justo antes del ensureListenerWithFallback.
    const commentSlice = INDEX_HTML.slice(Math.max(0, idx - 1500), idx);
    expect(commentSlice).toMatch(/v1490.*§88|§88.*v1490/);
    expect(commentSlice).toContain('assignedVendorUid');
  });
});

describe('v1490 — bump versión', () => {
  it('T40 APP_VERSION ≥ v1490 + sync SW', () => {
    const html = readFileSync('index.html', 'utf8');
    const sw = readFileSync('sw.js', 'utf8');
    const appMatch = html.match(/const APP_VERSION = 'v(\d+)'/);
    const swMatch = sw.match(/const CACHE_VERSION = 'v(\d+)'/);
    expect(appMatch).not.toBeNull();
    expect(swMatch).not.toBeNull();
    // @ts-expect-error — matched above
    expect(Number(appMatch[1])).toBeGreaterThanOrEqual(1490);
    // @ts-expect-error — matched above
    expect(appMatch[1]).toBe(swMatch[1]);
  });
});
