// @ts-check
/**
 * v1501 §93 (2026-10-28) — tests del fix PACHI Ficha Cliente.
 *
 * Reporte prod Mariano: el usuario PACHI (role=vendedor) no podía completar
 * la Ficha Cliente — al cambiar un select del modal #ficha-cliente-modal
 * (Fidelidad, Preferencia de contacto, Tamaño, etc.), el status mostraba
 * "Error guardando: Missing or insufficient permissions" y el valor
 * revertía al anterior. Causa raíz: la rule firestore `client_master.update`
 * para `isReader()` (que incluye `isVendor`) sólo permitía `hasOnly(['defaultDelivery'])`
 * y el autosave del modal escribe `cliTipo`, `fidelidad`, `prefContacto`,
 * `tamano`, `especializacion`, `tipoLocal`.
 *
 * Fix: extender `isFichaClienteEditor()` para incluir los 2 UIDs de PACHI
 * (real + user de prueba Playwright) via helper `isPachiUid()`. PACHI real
 * (role=vendedor) ahora puede guardar la Ficha como si fuera admin/gerente,
 * sin tocar el permiso del resto de VDEs.
 *
 * Fuente única de UIDs: src/pure/pachi-restrictions.js. Las rules no pueden
 * importar JS, por lo que los UIDs están hardcoded en `firestore.rules` con
 * nota explícita; cualquier cambio futuro requiere actualizar ambos.
 *
 * Ortogonalidad con §93 PACHI restricciones negativas: Ficha Cliente NO
 * está en PACHI_BLOCKED_OPEN_FNS ni en PACHI_HIDDEN_SIDEBAR_LEFT_BTN_IDS.
 * El perfilado comercial es una tarea legítima para PACHI (iter 4 v1493:
 * PACHI opera como cualquier VDE para carga de pedidos y Ficha).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACHI_UIDS } from '../../../src/pure/pachi-restrictions.js';

const RULES = readFileSync('firestore.rules', 'utf8');

describe('v1501 §93 — firestore.rules helper isPachiUid()', () => {
  it('declara function isPachiUid()', () => {
    expect(RULES).toMatch(/function\s+isPachiUid\s*\(\s*\)\s*\{/);
  });

  it('isPachiUid() chequea los 2 UIDs de PACHI_UIDS', () => {
    const start = RULES.indexOf('function isPachiUid()');
    expect(start).toBeGreaterThan(0);
    const slice = RULES.slice(start, start + 500);
    for (const uid of PACHI_UIDS) {
      expect(slice).toContain(uid);
    }
  });

  it('isPachiUid() exige request.auth != null', () => {
    const start = RULES.indexOf('function isPachiUid()');
    const slice = RULES.slice(start, start + 500);
    expect(slice).toMatch(/request\.auth\s*!=\s*null/);
  });
});

describe('v1501 §93 — isFichaClienteEditor() integra isPachiUid()', () => {
  it('isFichaClienteEditor() devuelve true si isPachiUid() OR flag', () => {
    const start = RULES.indexOf('function isFichaClienteEditor()');
    expect(start).toBeGreaterThan(0);
    const slice = RULES.slice(start, start + 600);
    expect(slice).toMatch(/isPachiUid\(\)/);
    expect(slice).toMatch(/fichaClienteEditorFull\s*==\s*true/);
  });

  it('preserva el path original de interno-opt-in (Ioannis + Santiago)', () => {
    const start = RULES.indexOf('function isFichaClienteEditor()');
    const slice = RULES.slice(start, start + 600);
    expect(slice).toMatch(
      /exists\(\/databases\/\$\(database\)\/documents\/roles\/\$\(request\.auth\.uid\)\)/
    );
    expect(slice).toMatch(
      /get\(\/databases\/\$\(database\)\/documents\/roles\/\$\(request\.auth\.uid\)\)\.data\.fichaClienteEditorFull/
    );
  });

  it('comentario documenta el motivo (v1501 §93 + reporte prod)', () => {
    const start = RULES.indexOf('function isFichaClienteEditor()');
    // El comentario está antes del helper isPachiUid() + función.
    const commentStart = RULES.lastIndexOf('v1501 §93', start);
    expect(commentStart).toBeGreaterThan(0);
    const commentSlice = RULES.slice(commentStart, start);
    expect(commentSlice).toMatch(/PACHI/i);
    expect(commentSlice).toMatch(/vendedor/i);
    expect(commentSlice).toMatch(/pachi-restrictions\.js/);
  });
});

describe('v1501 §93 — client_master.update acepta PACHI via isFichaClienteEditor', () => {
  it('match /client_master allow update sigue invocando isFichaClienteEditor()', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    expect(start).toBeGreaterThan(0);
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    const updateBlock = slice.slice(slice.indexOf('allow update:'));
    expect(updateBlock).toMatch(/isAdminOrGerente\(\)\s*\|\|\s*isFichaClienteEditor\(\)/);
  });

  it('match /client_master allow create sigue invocando isFichaClienteEditor()', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    const createBlock = slice.slice(slice.indexOf('allow create:'), slice.indexOf('allow update:'));
    expect(createBlock).toMatch(/isAdminOrGerente\(\)\s*\|\|\s*isFichaClienteEditor\(\)/);
  });

  it('defaultDelivery compat path se preserva (readers sin flag siguen pudiendo setear solo defaultDelivery)', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    expect(slice).toMatch(/request\.resource\.data\.keys\(\)\.hasOnly\(\['defaultDelivery'\]\)/);
  });
});

describe('v1501 §93 — matriz de permisos conceptual', () => {
  const PACHI_REAL_UID = 'LaBFi1xkSLObzLEdRoP8fonZ06r2';
  const PACHI_TEST_UID = 'tUJHiLDyLHWvbkpWgCQXWJcucfV2';
  const OTRO_VDE_UID = 'uid-mauricio-xyz';

  // Replica la lógica de isFichaClienteEditor + isAdminOrGerente.
  const canUpdateFichaFields = ({ uid, role, fichaEditorFlag }) => {
    const isAdminOrGerente = role === 'admin' || role === 'gerente';
    const isPachi = uid === PACHI_REAL_UID || uid === PACHI_TEST_UID;
    const isFichaEditor = isPachi || fichaEditorFlag === true;
    return isAdminOrGerente || isFichaEditor;
  };

  it('PACHI real (role=vendedor) puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: PACHI_REAL_UID, role: 'vendedor', fichaEditorFlag: false })
    ).toBe(true);
  });

  it('PACHI test user Playwright (role=vendedor) puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: PACHI_TEST_UID, role: 'vendedor', fichaEditorFlag: false })
    ).toBe(true);
  });

  it('OTRO VDE (role=vendedor, no en PACHI_UIDS) NO puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: OTRO_VDE_UID, role: 'vendedor', fichaEditorFlag: false })
    ).toBe(false);
  });

  it('admin sin flag puede update Ficha (vía isAdminOrGerente)', () => {
    expect(canUpdateFichaFields({ uid: 'uid-admin', role: 'admin', fichaEditorFlag: false })).toBe(
      true
    );
  });

  it('gerente sin flag puede update Ficha (vía isAdminOrGerente)', () => {
    expect(
      canUpdateFichaFields({ uid: 'uid-gerente', role: 'gerente', fichaEditorFlag: false })
    ).toBe(true);
  });

  it('interno con fichaClienteEditorFull=true (Ioannis + Santiago) puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: 'uid-ioannis', role: 'interno', fichaEditorFlag: true })
    ).toBe(true);
  });

  it('interno sin flag NO puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: 'uid-interno-random', role: 'interno', fichaEditorFlag: false })
    ).toBe(false);
  });

  it('viewer sin flag NO puede update Ficha', () => {
    expect(
      canUpdateFichaFields({ uid: 'uid-viewer', role: 'viewer', fichaEditorFlag: false })
    ).toBe(false);
  });
});

describe('v1501 §93 — PACHI_UIDS fuente única sigue consistente', () => {
  it('PACHI_UIDS exporta 2 UIDs (real + test)', () => {
    expect(PACHI_UIDS.length).toBe(2);
  });

  it('UIDs del helper isPachiUid() en rules matchean los exportados por pachi-restrictions.js', () => {
    const start = RULES.indexOf('function isPachiUid()');
    const slice = RULES.slice(start, start + 500);
    for (const uid of PACHI_UIDS) {
      expect(slice.includes(uid)).toBe(true);
    }
  });
});
