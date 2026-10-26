// @ts-check
/**
 * v1446 §44/§46/§52 (2026-10-23) — guard de permisos del botón "Ficha
 * cliente" en el popup del mapa de clientes (`drawSapAltaPins`).
 *
 * Reglas (replican el filtro del listado Clientes):
 *   - Lead sin cardCodeSap → botón NO se muestra (openClientModal necesita
 *     tipo='C' + nombre válido; leads son prospectos no activados).
 *   - admin/gerente/interno → ven siempre (acceso cross-vendor).
 *   - vendor → solo si `effVendor` del cliente (via getEffectiveVendorForSapAlta,
 *     §46/§52) matchea `myVendor` del user (uppercase + trim).
 *   - cualquier otro rol → NO ve.
 *
 * Fixtures:
 *   MUNDO ESTURION S.R.L. — C33716739649, provincia BUENOS AIRES,
 *   localidad CAMPANA, effVendor "GONZALO DE LA ROSA" (vendedor master).
 *
 * El guard vive inline en el render del popup (`index.html` ~línea 10100).
 * Este test replica la lógica como pure fn para que un cambio de rule
 * dispare un fail.
 */
import { describe, expect, it } from 'vitest';

/**
 * Replica del guard del popup. Si lo cambiás en `index.html`, replicá acá.
 * @param {{cardCodeSap?: string|null}} alta
 * @param {string} userRole admin|gerente|interno|vendedor|...
 * @param {string} myVendor key del user (viene de currentUser.vendor)
 * @param {string|null} effVendor del alta (viene de getEffectiveVendorForSapAlta)
 */
function canSeeFichaFromPopup(alta, userRole, myVendor, effVendor) {
  if (!alta || !alta.cardCodeSap) return false; // leads no activados
  const isAdminGerIntern = userRole === 'admin' || userRole === 'gerente' || userRole === 'interno';
  if (isAdminGerIntern) return true;
  if (userRole !== 'vendedor') return false;
  const my = String(myVendor || '')
    .toUpperCase()
    .trim();
  const eff = String(effVendor || '')
    .toUpperCase()
    .trim();
  if (!my || !eff) return false;
  return my === eff;
}

const MUNDO_ESTURION = {
  cardCodeSap: 'C33716739649',
  provincia: 'BUENOS AIRES',
  localidad: 'CAMPANA',
  comercio: 'MUNDO ESTURION S.R.L.',
};
const EFF_VENDOR_ME = 'GONZALO DE LA ROSA';

const LEAD_SIN_CARDCODE = {
  cardCodeSap: null,
  provincia: 'BUENOS AIRES',
  localidad: 'CAMPANA',
  comercio: 'LEAD X SRL',
  manualSapPending: true,
};

describe('v1446 §52 — guard Ficha cliente en popup del mapa', () => {
  it('admin ve el botón para MUNDO ESTURION', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'admin', '', EFF_VENDOR_ME)).toBe(true);
  });

  it('gerente ve el botón', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'gerente', '', EFF_VENDOR_ME)).toBe(true);
  });

  it('interno (Pablo) ve el botón', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'interno', '', EFF_VENDOR_ME)).toBe(true);
  });

  it('VDE Gonzalo (match effVendor) ve el botón', () => {
    expect(
      canSeeFichaFromPopup(MUNDO_ESTURION, 'vendedor', 'GONZALO DE LA ROSA', EFF_VENDOR_ME)
    ).toBe(true);
  });

  it('VDE Gonzalo con case + whitespace mixto (tolerante) ve el botón', () => {
    expect(
      canSeeFichaFromPopup(MUNDO_ESTURION, 'vendedor', '  gonzalo de la rosa  ', EFF_VENDOR_ME)
    ).toBe(true);
  });

  it('VDE Mauricio (NO match effVendor) NO ve el botón', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'vendedor', 'MAURICIO GIL', EFF_VENDOR_ME)).toBe(
      false
    );
  });

  it('VDE sin vendorKey asignado NO ve el botón', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'vendedor', '', EFF_VENDOR_ME)).toBe(false);
  });

  it('Alta sin effVendor resuelto (zona huérfana) → VDE NO ve el botón', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'vendedor', 'GONZALO DE LA ROSA', null)).toBe(
      false
    );
  });

  it('Alta sin effVendor + admin → sí ve', () => {
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, 'admin', '', null)).toBe(true);
  });

  it('Lead sin cardCodeSap → NADIE ve el botón (ni admin)', () => {
    expect(canSeeFichaFromPopup(LEAD_SIN_CARDCODE, 'admin', '', EFF_VENDOR_ME)).toBe(false);
    expect(canSeeFichaFromPopup(LEAD_SIN_CARDCODE, 'gerente', '', EFF_VENDOR_ME)).toBe(false);
    expect(
      canSeeFichaFromPopup(LEAD_SIN_CARDCODE, 'vendedor', 'GONZALO DE LA ROSA', EFF_VENDOR_ME)
    ).toBe(false);
  });

  it('Alta null / undefined → false', () => {
    expect(canSeeFichaFromPopup(null, 'admin', '', '')).toBe(false);
    expect(canSeeFichaFromPopup(undefined, 'admin', '', '')).toBe(false);
  });

  it('userRole inválido ("viewer", "unassigned", "") → false aunque matchee', () => {
    expect(
      canSeeFichaFromPopup(MUNDO_ESTURION, 'viewer', 'GONZALO DE LA ROSA', EFF_VENDOR_ME)
    ).toBe(false);
    expect(
      canSeeFichaFromPopup(MUNDO_ESTURION, 'unassigned', 'GONZALO DE LA ROSA', EFF_VENDOR_ME)
    ).toBe(false);
    expect(canSeeFichaFromPopup(MUNDO_ESTURION, '', 'GONZALO DE LA ROSA', EFF_VENDOR_ME)).toBe(
      false
    );
  });

  it('Contrato con index.html: el guard inline usa los mismos checks', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    // Verifica que el bloque del popup contiene los 3 checks claves.
    const idx = html.indexOf('v1446 (2026-10-23): botón "Ficha cliente"');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 2000);
    // Guard: cardCodeSap presente.
    expect(slice).toMatch(/if\s*\(\s*a\.cardCodeSap\s*\)/);
    // Guard: admin|gerente|interno true.
    expect(slice).toMatch(/_isAdminGerIntern/);
    // Guard: vendedor && myVendor === effVendor (uppercase).
    expect(slice).toMatch(/_myVendor === _effVendorUp/);
    // v1464 (2026-10-26): el onclick ahora invoca openFichaClienteDirect
    // (ficha real directa, sin pasar por el modal de revisión). Reemplaza
    // openClientModal que era el patrón original de v1446.
    expect(slice).toMatch(/openFichaClienteDirect\(/);
    // El modal de revisión NO debe invocarse desde el popup del pin.
    expect(slice).not.toMatch(/openClientModal\(/);
    // CSS class para mobile layout.
    expect(html).toMatch(/\.map-popup-actions/);
  });
});
