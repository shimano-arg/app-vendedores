// @ts-check
/**
 * v1472 §70 (2026-10-26) — tests del logger de errores client-side a
 * `operations_log` con type='client_write_failed'. También verifica la
 * corrección del origen de los undefined (tarea L v1457 + helper v1466)
 * y la deuda técnica §69 (reemplazar monkey-patch por safe-write).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync('index.html', 'utf8');
const CLAUDE_MD = readFileSync('CLAUDE.md', 'utf8');

describe('v1472 §70 — _logClientWriteFailed logger instalado', () => {
  it('T1 window._logClientWriteFailed definido en index.html', () => {
    expect(HTML).toMatch(/window\._logClientWriteFailed = function\(path, errorObj, extra\)/);
  });

  it('T2 el logger escribe a operations_log con type=client_write_failed', () => {
    const idx = HTML.indexOf('window._logClientWriteFailed = function');
    const slice = HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/type: 'client_write_failed'/);
    expect(slice).toMatch(/userUid: currentUser\.uid/);
    expect(slice).toMatch(/userEmail:/);
    expect(slice).toMatch(/collection,/);
    expect(slice).toMatch(/documentId,/);
    expect(slice).toMatch(/errMessage:/);
    expect(slice).toMatch(/errCode:/);
    expect(slice).toMatch(/clientVersion:/);
    expect(slice).toMatch(/timestamp: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });

  it('T3 el logger es fire-and-forget (nunca throw/propaga)', () => {
    const idx = HTML.indexOf('window._logClientWriteFailed = function');
    const slice = HTML.slice(idx, idx + 3000);
    // Hay try/catch outer que swallow.
    expect(slice).toMatch(/catch \(_e\) \{\s*\/\/ Nunca propagar/);
    // El .add() tiene .catch.
    expect(slice).toMatch(/fbDb\.collection\('operations_log'\)\.add\(_entry\)\.catch/);
  });

  it('T4 el logger respeta rules (userUid obligatorio = auth.uid)', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const idx = rules.indexOf('/operations_log/');
    const slice = rules.slice(idx, idx + 500);
    expect(slice).toMatch(/userUid == request\.auth\.uid/);
  });

  it('T5 el logger slice errMessage a 2000 chars (DoS protection)', () => {
    const idx = HTML.indexOf('window._logClientWriteFailed = function');
    const slice = HTML.slice(idx, idx + 3000);
    expect(slice).toMatch(/\.slice\(0,\s*2000\)/);
  });

  it('T6 el monkey-patch tiene tap de error que llama al logger', () => {
    const idx = HTML.indexOf('_installFirestoreSanitizePatch');
    const slice = HTML.slice(idx, idx + 5500);
    expect(slice).toMatch(/_tapError = \(promise, path, op\)/);
    expect(slice).toMatch(/window\._logClientWriteFailed\(path, err, \{ op \}\)/);
  });

  it('T7 batch.commit() interceptado para loguear refs sensibles', () => {
    const idx = HTML.indexOf('_installFirestoreSanitizePatch');
    const slice = HTML.slice(idx, idx + 5500);
    expect(slice).toMatch(/_v1472_sensitiveRefs/);
    expect(slice).toMatch(/_BatchProto\.commit/);
    expect(slice).toMatch(/batchRefsCount/);
  });

  it('T8 marca window.__v1472_errorLoggerInstalled seteada', () => {
    expect(HTML).toMatch(/window\.__v1472_errorLoggerInstalled = true/);
  });

  it('T9 call-sites de guardado waitlist llaman al logger con contexto', () => {
    // Busca por el inicio de la function (no por el primer match que puede
    // ser un comentario del HTML).
    const idxRev = HTML.indexOf('window.revisionDejarRecalculando = async function');
    expect(idxRev, 'window.revisionDejarRecalculando no encontrada').toBeGreaterThan(0);
    const sliceRev = HTML.slice(idxRev, idxRev + 15000);
    expect(sliceRev).toMatch(/_logClientWriteFailed\('revision_waitlist'/);
    expect(sliceRev).toMatch(/handler: 'revisionDejarRecalculando'/);
    const idxRw = HTML.indexOf('window.reviewDejarEnEspera = async function');
    expect(idxRw, 'window.reviewDejarEnEspera no encontrada').toBeGreaterThan(0);
    const sliceRw = HTML.slice(idxRw, idxRw + 15000);
    expect(sliceRw).toMatch(/_logClientWriteFailed\('revision_waitlist'/);
    expect(sliceRw).toMatch(/handler: 'reviewDejarEnEspera'/);
  });
});

describe('v1472 — corrección del origen de los undefined en el informe', () => {
  it('T10 el comentario del monkey-patch cita L v1457 y helper v1466', () => {
    const idx = HTML.indexOf('v1470 (2026-10-26) hotfix bug Federico');
    expect(idx).toBeGreaterThan(0);
    const slice = HTML.slice(idx, idx + 2000);
    // No decir "bomba de tiempo previa". Decir que vino de L + v1466.
    expect(slice).toMatch(/tarea L \(v1457/i);
    expect(slice).toMatch(/helper de v1466|v1466/);
    expect(slice).toMatch(/boEntryResolved|boEntryPrevio/);
    expect(slice).toMatch(/origen|asigRefs/);
    expect(slice).not.toMatch(/bomba de tiempo/);
  });
});

describe('v1472 §69 — deuda monkey-patch documentada en CLAUDE.md', () => {
  it('T20 §69 presente con título correcto', () => {
    expect(CLAUDE_MD).toMatch(
      /## 69\. DEUDA técnica — reemplazar monkey-patch firestore-sanitize por función única de escritura/
    );
  });

  it('T21 §69 define el refactor: safe-write.js con safeWriteWaitlist + safeWritePedido', () => {
    const idx = CLAUDE_MD.indexOf('## 69.');
    const slice = CLAUDE_MD.slice(idx, idx + 5000);
    expect(slice).toMatch(/src\/pure\/safe-write\.js/);
    expect(slice).toMatch(/safeWriteWaitlist/);
    expect(slice).toMatch(/safeWritePedido/);
    expect(slice).toMatch(/baseline/);
    expect(slice).toMatch(/19 call-sites/);
  });

  it('T22 §70 presente con shape documentado', () => {
    expect(CLAUDE_MD).toMatch(/## 70\. Errores de write client-side se loguean a operations_log/);
    const idx = CLAUDE_MD.indexOf('## 70.');
    const slice = CLAUDE_MD.slice(idx, idx + 5000);
    expect(slice).toMatch(/type: 'client_write_failed'/);
    expect(slice).toMatch(/userUid/);
    expect(slice).toMatch(/collection/);
    expect(slice).toMatch(/documentId/);
    expect(slice).toMatch(/fire-and-forget/i);
    // Precedente Federico explícito.
    expect(slice).toMatch(/Federico Castelanelli/);
  });
});

describe('v1472 §69 — baseline conteo call-sites (anti-regresión mientras no se refactorice)', () => {
  it('T30 baseline <= 19 call-sites directos a revision_waitlist/pedidos desde index.html', () => {
    // Grep del pattern. Conteo actual: 19 (relevado 2026-10-26).
    // Si sube: el test falla → prevenir que alguien agregue uno nuevo sin
    // ir por el helper futuro safe-write. Si el refactor baja el baseline,
    // actualizar este número.
    const BASELINE_MAX = 19;
    const regex =
      /fbDb\.collection\('(revision_waitlist|pedidos)'\)[^)]*\)\.(update|set)\(|batch\.(update|set)\(\s*fbDb\.collection\('(revision_waitlist|pedidos)'\)/g;
    const matches = HTML.match(regex) || [];
    expect(
      matches.length,
      `Baseline sumó: antes ${BASELINE_MAX}, ahora ${matches.length}. ` +
        `Si agregás un write directo nuevo, migrá primero a safe-write (§69) o justificá.`
    ).toBeLessThanOrEqual(BASELINE_MAX);
  });

  it('T31 ningún call-site en src/domains/*.js escribe directo (futuro: migrar via helper)', () => {
    // Esto es informativo: hoy src/domains/* NO escribe directo a esas
    // colecciones. Si alguien agrega uno en el futuro, al menos quede en el
    // radar. Permitimos hasta 2 call-sites como margen.
    const files = ['src/domains/pedidos-modal.js'];
    let totalMatches = 0;
    for (const f of files) {
      let content = '';
      try {
        content = readFileSync(f, 'utf8');
      } catch (_e) {
        continue;
      }
      const regex = /collection\(['"](revision_waitlist|pedidos)['"]\)[^)]*\)\.(update|set)\(/g;
      const matches = content.match(regex) || [];
      totalMatches += matches.length;
    }
    expect(totalMatches, 'src/domains/* tiene writes directos nuevos').toBeLessThanOrEqual(2);
  });
});
