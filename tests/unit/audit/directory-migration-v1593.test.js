// S-7 P0-A Fase 2 (2026-11-25) — audit tests: los 3 consumidores client-side
// críticos ahora invocan getUsersDirectoryCF en vez de collection('roles').get()
// directo. Previene regresión cuando alguien edite estos bloques y vuelva al
// read directo (que post-#1445 devuelve snapshot vacío para VDE).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const MASTER_CLIENTES = readFileSync(resolve(ROOT, 'src', 'domains', 'master-clientes.js'), 'utf8');

/**
 * Extrae el cuerpo de una función `async function <name>(...)` o
 * `<name> = async function...` hasta el cierre de llaves balanceadas.
 */
function extractFnBody(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error('header no encontrado: ' + header);
  // Avanzar hasta la primera `{` después del header.
  let i = src.indexOf('{', start);
  if (i < 0) throw new Error('no se encontró `{` tras ' + header);
  let depth = 0;
  const bodyStart = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(bodyStart, i + 1);
      }
    }
  }
  throw new Error('no se cerró el bloque de ' + header);
}

describe('S-7 P0-A Fase 2 — consumidores migrados a getUsersDirectoryCF', () => {
  describe('loadVdiPartnerUsers (rama vendedor)', () => {
    const body = extractFnBody(INDEX_HTML, 'async function loadVdiPartnerUsers()');

    it('invoca getUsersDirectoryCF con filterRole="vendedor"', () => {
      // Busca la llamada específica dentro de la función. El bloque de la
      // rama vendedor viene DESPUÉS del comentario "v1408 §46".
      expect(body).toMatch(/getUsersDirectoryCF/);
      expect(body).toMatch(/filterRole:\s*['"]vendedor['"]/);
    });

    it('NO lee /roles directo con .where(role, "==", "vendedor") en la rama vendedor', () => {
      // La función carga admin/gerente/interno por .where() directo (admin ya
      // pasa #1445); la rama 'vendedor' NO puede seguir leyendo directo porque
      // post-#1445 devuelve vacío para VDE. Chequeamos que no haya
      // `.where('role', '==', 'vendedor')` seguido de `.get()`.
      //
      // Patrón prohibido antes del fix:
      //   const qsv = await fbDb.collection('roles').where('role', '==', 'vendedor').get();
      const prohibido =
        /collection\(['"]roles['"]\)\.where\(['"]role['"],\s*['"]==?['"],\s*['"]vendedor['"]\)\.get\(\)/;
      expect(body).not.toMatch(prohibido);
    });

    it('tiene fallback con warn cuando la callable falla (fail-closed)', () => {
      // El bloque tiene catch que logea warn; vdeUsers queda vacío → server
      // resuelve vendorUid vía resolveClientVendorServerSide (§89 v1491).
      expect(body).toMatch(/console\.warn\(.*getUsersDirectoryCF/);
    });

    it('invoca via firebase.app().functions() en region southamerica-east1', () => {
      // Pattern canónico del resto de callables en este archivo.
      expect(body).toMatch(/functions\(['"]southamerica-east1['"]\)/);
      expect(body).toMatch(/httpsCallable\(['"]getUsersDirectoryCF['"]\)/);
    });
  });

  describe('ensureVdeUsersLoaded', () => {
    const body = extractFnBody(INDEX_HTML, 'async function ensureVdeUsersLoaded()');

    it('invoca getUsersDirectoryCF con filterRole="vendedor"', () => {
      expect(body).toMatch(/getUsersDirectoryCF/);
      expect(body).toMatch(/filterRole:\s*['"]vendedor['"]/);
    });

    it('NO lee /roles directo con where(role, vendedor)', () => {
      const prohibido =
        /collection\(['"]roles['"]\)\.where\(['"]role['"],\s*['"]==?['"],\s*['"]vendedor['"]\)\.get\(\)/;
      expect(body).not.toMatch(prohibido);
    });

    it('tiene fallback con warn cuando la callable falla', () => {
      // En esta función el catch es genérico: `catch(e) { console.warn('ensureVdeUsersLoaded', e); }`
      expect(body).toMatch(/console\.warn\(['"]ensureVdeUsersLoaded['"]/);
    });

    it('usa region southamerica-east1', () => {
      expect(body).toMatch(/functions\(['"]southamerica-east1['"]\)/);
      expect(body).toMatch(/httpsCallable\(['"]getUsersDirectoryCF['"]\)/);
    });

    it('idempotente: si ya hay vdeUsers no vuelve a cargar', () => {
      expect(body).toMatch(/if\s*\(\s*vdeUsers\.length\s*>\s*0\s*\)\s*return/);
    });
  });

  describe('src/domains/master-clientes.js saveMcProvisorioVendor', () => {
    it('invoca getUsersDirectoryCF (admin-only, se alinea al patrón §89)', () => {
      expect(MASTER_CLIENTES).toMatch(/getUsersDirectoryCF/);
    });

    it('NO lee /roles directo con collection(roles).get() sin filtro (línea 1746 original)', () => {
      // Busca el patrón original dentro de saveMcProvisorioVendor
      // específicamente — hay otras lecturas de 'roles' en el archivo
      // (self-reads para role del usuario).
      const fnStart = MASTER_CLIENTES.indexOf('window.saveMcProvisorioVendor');
      expect(fnStart).toBeGreaterThan(-1);
      // Extraer hasta `window.saveMcClienteSapVendor` (siguiente función).
      const fnEnd = MASTER_CLIENTES.indexOf('window.saveMcClienteSapVendor', fnStart);
      const fnBody = MASTER_CLIENTES.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
      // Dentro de esa función específica, no debe haber collection('roles').get()
      // directo.
      expect(fnBody).not.toMatch(/collection\(['"]roles['"]\)\.get\(\)/);
    });

    it('fail-closed: si el callable falla, newOwnerUid queda null (best-effort)', () => {
      // El bloque tiene try/catch; el catch comentario /* best-effort */.
      const fnStart = MASTER_CLIENTES.indexOf('window.saveMcProvisorioVendor');
      const fnEnd = MASTER_CLIENTES.indexOf('window.saveMcClienteSapVendor', fnStart);
      const fnBody = MASTER_CLIENTES.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
      expect(fnBody).toMatch(/best-effort/);
      // El flow sigue si newOwnerUid es null (if (newOwnerUid) payload.ownerUid = ...)
      expect(fnBody).toMatch(/if\s*\(\s*newOwnerUid\s*\)/);
    });
  });

  describe('contrato: wrapper CF existe + exportado', () => {
    const functionsIndex = readFileSync(resolve(ROOT, 'functions', 'index.js'), 'utf8');

    it('functions/index.js exporta getUsersDirectoryCF', () => {
      expect(functionsIndex).toMatch(/export const getUsersDirectoryCF\s*=/);
    });

    it('wrapper CF valida auth + rol caller ∈ {admin,gerente,interno,vendedor}', () => {
      // Verifica el guard del role check.
      expect(functionsIndex).toMatch(
        /\[['"]admin['"],\s*['"]gerente['"],\s*['"]interno['"],\s*['"]vendedor['"]\]/
      );
    });

    it('wrapper CF usa rate limit RATE_LIMITS.getUsersDirectoryCF', () => {
      expect(functionsIndex).toMatch(/RATE_LIMITS\.getUsersDirectoryCF\.threshold/);
      expect(functionsIndex).toMatch(/RATE_LIMITS\.getUsersDirectoryCF\.windowMs/);
    });

    it('wrapper CF importa getUsersDirectoryCore de ./core/directory-core.js', () => {
      expect(functionsIndex).toMatch(
        /import\s+\{\s*getUsersDirectoryCore\s*\}\s+from\s+['"]\.\/core\/directory-core\.js['"]/
      );
    });

    it('rate-limit-core.js tiene preset getUsersDirectoryCF', () => {
      const rateLimitCore = readFileSync(
        resolve(ROOT, 'functions', 'core', 'rate-limit-core.js'),
        'utf8'
      );
      expect(rateLimitCore).toMatch(/getUsersDirectoryCF:\s*\{[^}]*threshold:\s*\d+/);
    });
  });
});
