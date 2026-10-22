// @ts-check
/**
 * v1420 §54 (2026-10-22) — grep tests del flag fichaClienteEditorFull.
 *
 * Autorización: Mariano 2026-10-22. Ioannis Palkoudakis + Santiago Esteban
 * (role=interno) habilitados a editar cualquier campo de la Ficha Cliente para
 * cualquier cliente. Admin/gerente ya tenían el permiso.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RULES = readFileSync('firestore.rules', 'utf8');
const MASTER_CLIENTES = readFileSync('src/domains/master-clientes.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1420 §54 — firestore.rules helper isFichaClienteEditor', () => {
  it('declara function isFichaClienteEditor()', () => {
    expect(RULES).toMatch(/function\s+isFichaClienteEditor\s*\(\s*\)\s*\{/);
  });

  it('lee roles/{request.auth.uid}.fichaClienteEditorFull == true', () => {
    const start = RULES.indexOf('function isFichaClienteEditor()');
    const slice = RULES.slice(start, start + 400);
    expect(slice).toMatch(
      /exists\(\/databases\/\$\(database\)\/documents\/roles\/\$\(request\.auth\.uid\)\)/
    );
    expect(slice).toMatch(
      /get\(\/databases\/\$\(database\)\/documents\/roles\/\$\(request\.auth\.uid\)\)\.data\.fichaClienteEditorFull\s*==\s*true/
    );
  });

  it('comment menciona Ioannis + Santiago', () => {
    const start = RULES.indexOf('v1420 §54');
    const slice = RULES.slice(start, start + 600);
    expect(slice).toMatch(/Ioannis/i);
    expect(slice).toMatch(/Santiago Esteban/i);
  });
});

describe('v1420 §54 — rules client_master acepta isFichaClienteEditor', () => {
  it('match /client_master allow create incluye isFichaClienteEditor()', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    const createBlock = slice.slice(slice.indexOf('allow create:'), slice.indexOf('allow update:'));
    expect(createBlock).toMatch(/isAdminOrGerente\(\)\s*\|\|\s*isFichaClienteEditor\(\)/);
  });

  it('match /client_master allow update incluye isFichaClienteEditor()', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    const updateBlock = slice.slice(slice.indexOf('allow update:'));
    expect(updateBlock).toMatch(/isAdminOrGerente\(\)\s*\|\|\s*isFichaClienteEditor\(\)/);
  });

  it('defaultDelivery compat path preserved (readers pueden escribir solo defaultDelivery)', () => {
    const start = RULES.indexOf('match /client_master/{docId}');
    const slice = RULES.slice(start, RULES.indexOf('allow delete:', start) + 100);
    expect(slice).toMatch(/request\.resource\.data\.keys\(\)\.hasOnly\(\['defaultDelivery'\]\)/);
  });
});

describe('v1420 §54 — client-side helpers + gates', () => {
  it('src/domains/master-clientes.js:saveClientCategoriaFromModal usa _canEditFichaCliente', () => {
    const start = MASTER_CLIENTES.indexOf('window.saveClientCategoriaFromModal');
    const slice = MASTER_CLIENTES.slice(start, start + 800);
    expect(slice).toMatch(/_canEditFichaCliente/);
    expect(slice).toMatch(/window\.currentUserFichaEditor\s*===\s*true/);
  });

  it('src/domains/master-clientes.js:saveClientCreditoChequeFromModal usa _canEditFichaCliente', () => {
    const start = MASTER_CLIENTES.indexOf('window.saveClientCreditoChequeFromModal');
    const slice = MASTER_CLIENTES.slice(start, start + 800);
    expect(slice).toMatch(/_canEditFichaCliente/);
    expect(slice).toMatch(/window\.currentUserFichaEditor\s*===\s*true/);
  });

  it('auditoría: ambos save* escriben updatedByUid + updatedByFichaEditor', () => {
    const cat = MASTER_CLIENTES.slice(
      MASTER_CLIENTES.indexOf('window.saveClientCategoriaFromModal'),
      MASTER_CLIENTES.indexOf('window.saveClientCreditoChequeFromModal')
    );
    const cheque = MASTER_CLIENTES.slice(
      MASTER_CLIENTES.indexOf('window.saveClientCreditoChequeFromModal'),
      MASTER_CLIENTES.indexOf('window.saveClientCreditoChequeFromModal') + 3000
    );
    expect(cat).toMatch(/updatedByUid:\s*currentUser\.uid/);
    expect(cat).toMatch(/updatedByFichaEditor/);
    expect(cheque).toMatch(/updatedByUid:\s*currentUser\.uid/);
    expect(cheque).toMatch(/updatedByFichaEditor/);
  });

  it('index.html fetchAndApplyRole setea window.currentUserFichaEditor', () => {
    expect(INDEX_HTML).toMatch(
      /window\.currentUserFichaEditor\s*=\s*data\.fichaClienteEditorFull\s*===\s*true/
    );
  });

  it('index.html credito cheque bloque: isAdminLikeFc acepta currentUserFichaEditor', () => {
    const idx = INDEX_HTML.indexOf('var isAdminLikeFc');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 400);
    expect(slice).toMatch(/currentUserFichaEditor\s*===\s*true/);
  });
});

describe('v1420 §54 — matriz de permisos (lógica)', () => {
  const canEditFicha = (role, fichaEditor) => {
    // Replica la lógica de _canEditFichaCliente + Rules isFichaClienteEditor()
    // || isAdminOrGerente().
    const canWrite = ['admin', 'vendedor', 'gerente'].includes(role);
    return canWrite || fichaEditor === true;
  };

  it('admin sin flag: puede editar', () => {
    expect(canEditFicha('admin', false)).toBe(true);
  });

  it('gerente sin flag: puede editar', () => {
    expect(canEditFicha('gerente', false)).toBe(true);
  });

  it('vendedor sin flag: puede editar (como antes)', () => {
    expect(canEditFicha('vendedor', false)).toBe(true);
  });

  it('interno sin flag: NO puede editar', () => {
    expect(canEditFicha('interno', false)).toBe(false);
  });

  it('interno con flag fichaClienteEditorFull=true (Ioannis + Santiago): puede editar', () => {
    expect(canEditFicha('interno', true)).toBe(true);
  });

  it('viewer sin flag: NO puede editar', () => {
    expect(canEditFicha('viewer', false)).toBe(false);
  });

  it('unassigned sin flag: NO puede editar', () => {
    expect(canEditFicha('unassigned', false)).toBe(false);
  });
});
