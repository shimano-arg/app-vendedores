// @ts-check
/**
 * v1507 iter 8 (2026-10-28) — PACHI oculta botón "PEDIDOS EN ESPERA" global
 * del header-top del mapa.
 *
 * Mariano reportó post-v1501: el botón violeta "PEDIDOS EN ESPERA" (con
 * contador cross-vendor, hoy "11") de la barra superior del mapa sigue
 * visible para PACHI. Ese botón abre la vista global de todas las órdenes
 * abiertas, lo que NO corresponde al scope de PACHI.
 *
 * La lista propia "Pedidos en espera" del panel IZQUIERDO (sidebar-left,
 * filtrada por su UID vía §59) PACHI SÍ la ve y SIGUE visible.
 *
 * Fix v1507:
 *   - pure fn `PACHI_HIDDEN_HEADER_BTN_IDS = ['waitlist-btn']`.
 *   - helper `isHeaderBtnHiddenForPachi(id)`.
 *   - CSS gate `body.is-pachi-restricted #waitlist-btn{display:none !important}`.
 *
 * El listener `ensureRevisionWaitlistListener` queda ACTIVO (alimenta la
 * lista del sidebar-left que PACHI SÍ ve). Solo el botón del header queda
 * oculto por CSS — no desactivamos el listener.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isHeaderBtnHiddenForPachi,
  PACHI_HIDDEN_HEADER_BTN_IDS,
} from '../../../src/pure/pachi-restrictions.js';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1507 iter 8 — PACHI_HIDDEN_HEADER_BTN_IDS pure fn', () => {
  it('T100 PACHI_HIDDEN_HEADER_BTN_IDS incluye el botón "Pedidos en espera" global', () => {
    expect(PACHI_HIDDEN_HEADER_BTN_IDS).toBeDefined();
    expect(Array.isArray(PACHI_HIDDEN_HEADER_BTN_IDS)).toBe(true);
    expect(PACHI_HIDDEN_HEADER_BTN_IDS).toContain('waitlist-btn');
  });

  it('T101 isHeaderBtnHiddenForPachi devuelve true solo para IDs ocultos', () => {
    expect(isHeaderBtnHiddenForPachi('waitlist-btn')).toBe(true);
    // IDs del header que PACHI SÍ puede ver no están en la lista.
    expect(isHeaderBtnHiddenForPachi('planner-header-btn')).toBe(false);
    expect(isHeaderBtnHiddenForPachi('revision-btn')).toBe(false);
    expect(isHeaderBtnHiddenForPachi('')).toBe(false);
    expect(isHeaderBtnHiddenForPachi(null)).toBe(false);
    expect(isHeaderBtnHiddenForPachi(undefined)).toBe(false);
  });

  it('T102 PACHI_HIDDEN_HEADER_BTN_IDS es frozen (inmutable)', () => {
    expect(Object.isFrozen(PACHI_HIDDEN_HEADER_BTN_IDS)).toBe(true);
  });

  it('T103 helper acepta IDs con espacios al borde (trim defensivo)', () => {
    expect(isHeaderBtnHiddenForPachi('  waitlist-btn  ')).toBe(true);
  });
});

describe('v1507 iter 8 — contrato index.html', () => {
  it('T110 el CSS incluye regla body.is-pachi-restricted #waitlist-btn display:none !important', () => {
    // Match tolera espacios/newlines variados.
    const re =
      /body\.is-pachi-restricted\s+#waitlist-btn\s*\{[^}]*display\s*:\s*none[^}]*!important[^}]*\}/i;
    expect(INDEX_HTML).toMatch(re);
  });

  it('T111 el botón #waitlist-btn del header-top sigue presente en el DOM (no removido, solo oculto)', () => {
    // El botón existe con onclick + contador — es responsabilidad del CSS gate ocultarlo.
    expect(INDEX_HTML).toMatch(/<button[^>]*id="waitlist-btn"[^>]*>/);
    expect(INDEX_HTML).toMatch(/id="waitlist-btn-count"/);
  });

  it('T112 lista propia PACHI del sidebar-left (sidebar-left-waitlist) sigue sin estar oculta', () => {
    // Anti-regresión: PACHI SÍ ve su lista propia (2 tarjetas NOVILLO + SANDOVAL
    // hoy). Si en el futuro se agrega una regla que oculte sidebar-left-waitlist
    // para PACHI, este test falla y hay que revisar.
    const re =
      /body\.is-pachi-restricted[^{]*#sidebar-left-waitlist[^{]*\{[^}]*display\s*:\s*none/i;
    expect(INDEX_HTML).not.toMatch(re);
  });
});

describe('v1507 iter 8 — exposición en __phase0.pure.pachiRestrictions', () => {
  it('T120 main.js exporta PACHI_HIDDEN_HEADER_BTN_IDS en pachiRestrictions', () => {
    expect(MAIN_JS).toMatch(/PACHI_HIDDEN_HEADER_BTN_IDS/);
    expect(MAIN_JS).toMatch(/isHeaderBtnHiddenForPachi/);
  });
});
