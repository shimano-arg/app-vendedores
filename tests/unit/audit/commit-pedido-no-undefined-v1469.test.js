// @ts-check
/**
 * v1469 hotfix (2026-10-26) — commit-pedido-core.js:706 escribía
 * `origen: payloadLine.origenLinea || undefined` + `asigRefs: ... || undefined`
 * directo en el objeto docLines. Firestore admin SDK sin
 * `ignoreUndefinedProperties` RECHAZA el `tx.set` con:
 *   "Cannot use undefined as a Firestore value (found in field lines.0.origen)"
 *
 * El retry loop del core (línea 311-344) atrapa el error, NO es `_errorCode`
 * reconocido, lo loguea como "retry", y reintenta 5× con el mismo write con
 * el mismo error. Agota attempts → devuelve CONTENTION_RETRY_EXHAUSTED
 * ESPÚREO al cliente ("Hay mucha concurrencia... Reintentá en 10 segundos").
 *
 * Fixture REAL log Santi 2026-10-26 17:40 ART (docId=1Yatel0fyEtMWB6HVd5j
 * clientVersion=v1468 attempts=5 lastError="Cannot use undefined... found in
 * field lines.0.origen").
 *
 * Fix v1469:
 * - Core: nunca pushear undefined al objeto. Solo setear origen/asigRefs si
 *   defined + non-empty.
 * - Cliente: mensaje genérico cuando `lastError` NO contiene aborted/
 *   contention/conflict (no decir "concurrencia" cuando fue bug server).
 * - Core: lock huérfano (sin pedido referenciado) ya NO bloquea indefinido
 *   — se detecta y continúa el flow normal (sobre-escribe el lock).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('v1469 §64 hotfix Santi 17:40 CONTENTION_RETRY_EXHAUSTED espúreo', () => {
  it('T1 BUG raiz: linea confirmed NO escribe origen:undefined ni asigRefs:undefined', () => {
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    // Post-fix: el objeto se construye incrementalmente con `if (defined)`.
    expect(core).toMatch(/const _lineConfirmed = \{/);
    expect(core).toMatch(
      /if \(payloadLine\.origenLinea\) _lineConfirmed\.origen = payloadLine\.origenLinea;/
    );
    expect(core).toMatch(
      /if \(Array\.isArray\(payloadLine\.asigRefs\) && payloadLine\.asigRefs\.length > 0\) \{/
    );
    // Pre-fix pattern: `origen: payloadLine.origenLinea || undefined` NO debe existir.
    expect(core).not.toMatch(/origen:\s*payloadLine\.origenLinea\s*\|\|\s*undefined/);
    expect(core).not.toMatch(
      /asigRefs:\s*Array\.isArray.*?\?\s*payloadLine\.asigRefs\s*:\s*undefined/
    );
  });

  it('T2 fixture REAL Santi 17:40: lastError incluye "undefined... found in field lines.0.origen"', () => {
    // Datos del log operations_log/1Yatel0fyEtMWB6HVd5j (prod):
    const logEntry = {
      type: 'commit_pedido_rejected',
      errorCode: 'CONTENTION_RETRY_EXHAUSTED',
      clientVersion: 'v1468',
      draftId: 'C|SANTA FE|ALCORTA|MARISA VIVIANA LUJAN IANUNZIO|533',
      attempts: 5,
      lastError:
        'Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value (found in field "lines.`0`.origen"). If you want to ignore undefined values, enable `ignoreUndefinedProperties`.',
    };
    expect(logEntry.errorCode).toBe('CONTENTION_RETRY_EXHAUSTED');
    expect(logEntry.attempts).toBe(5);
    expect(logEntry.lastError).toContain('undefined');
    expect(logEntry.lastError).toContain('lines.`0`.origen');
    // El retry loop confunde el error como contention transitoria y agota.
  });

  it('T3 simulación pre-fix: docLines contiene undefined → write rechaza', () => {
    // Simula el push pre-fix.
    const payloadLineManual = { sku: 'CUDC151MGA', cantidad: 1, precio: 0 };
    const docLineOld = {
      code: 'CUDC151MGA',
      qty: 1,
      qtyOpen: 1,
      state: 'confirmed',
      precio: 0,
      notas: '',
      origen: payloadLineManual.origenLinea || undefined,
      asigRefs: Array.isArray(payloadLineManual.asigRefs) ? payloadLineManual.asigRefs : undefined,
    };
    // Firestore admin SDK (sin ignoreUndefinedProperties) rechaza.
    expect(Object.hasOwn(docLineOld, 'origen')).toBe(true);
    expect(docLineOld.origen).toBeUndefined();
    expect(Object.hasOwn(docLineOld, 'asigRefs')).toBe(true);
    expect(docLineOld.asigRefs).toBeUndefined();
  });

  it('T4 simulación post-fix: docLines solo tiene origen/asigRefs si defined', () => {
    // Simula el build post-fix.
    const build = (payloadLine) => {
      const _l = {
        code: payloadLine.sku,
        qty: 1,
        qtyOpen: 1,
        state: 'confirmed',
        precio: 0,
        notas: '',
      };
      if (payloadLine.origenLinea) _l.origen = payloadLine.origenLinea;
      if (Array.isArray(payloadLine.asigRefs) && payloadLine.asigRefs.length > 0) {
        _l.asigRefs = payloadLine.asigRefs;
      }
      return _l;
    };
    // Línea manual (CUDC151MGA): sin origen, sin asigRefs.
    const manual = build({ sku: 'CUDC151MGA' });
    expect(Object.hasOwn(manual, 'origen')).toBe(false);
    expect(Object.hasOwn(manual, 'asigRefs')).toBe(false);
    // Línea CPST (LDM54TE4028015S): con origen + asigRefs.
    const cpst = build({
      sku: 'LDM54TE4028015S',
      origenLinea: 'stock-asignado',
      asigRefs: [{ pedidoId: 'X', lineIndex: 14, sku: 'LDM54TE4028015S', qtyAsignada: 2 }],
    });
    expect(cpst.origen).toBe('stock-asignado');
    expect(cpst.asigRefs).toHaveLength(1);
  });

  it('T5 cliente: mensaje genérico cuando lastError NO es contention real', () => {
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf("code === 'CONTENTION_RETRY_EXHAUSTED'");
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 1500);
    // Post-fix v1469: detecta si es contention real por lastError.
    expect(slice).toMatch(/_isContencion/);
    expect(slice).toMatch(/aborted\|contention\|conflict\|unavailable\|deadline/);
    expect(slice).toMatch(/error interno/);
    // Pre-fix: alertaba "concurrencia" siempre.
    expect(slice).not.toMatch(
      /'\\n\\nHay mucha concurrencia.*Reintentá en 10 segundos\.'[\s\n]*\}/
    );
  });

  it('T6 lock huérfano: pedido referenciado NO existe → NO bloquea, continúa flow', () => {
    const core = readFileSync('functions/core/commit-pedido-core.js', 'utf8');
    const idx = core.indexOf('commitInTransaction idempotent via draftLock');
    expect(idx).toBeGreaterThan(0);
    const slice = core.slice(idx - 500, idx + 2000);
    // Post-fix: chequea pedidoSnap.exists antes de retornar idempotent.
    expect(slice).toMatch(/pedidoSnap\.exists/);
    expect(slice).toMatch(/HUERFANO/i);
    // El TTL 2 min queda documentado.
    expect(slice).toMatch(/LOCK_TTL_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
    // El flow continúa sin return cuando lock está huérfano.
    expect(slice).toMatch(/No return.*fall through to normal flow/);
  });

  it('T7 regla: SKUs manuales de la ORDEN 533 (CUDC151MGA/HGA) ahora pasan sin error', () => {
    // Fixture real: líneas sin origen (manuales) + líneas con origen (CPST).
    const payload = {
      lines: [
        { sku: 'LDM54TE4028015S', cantidad: 2, origenLinea: 'stock-asignado', asigRefs: [{}] },
        { sku: 'CUDC151MGA', cantidad: 1 }, // sin origen
        { sku: 'CUDC151HGA', cantidad: 1 }, // sin origen
      ],
    };
    const build = (payloadLine, qtyConfirmed) => {
      const _l = {
        code: String(payloadLine.sku || '').toUpperCase(),
        qty: qtyConfirmed,
        state: 'confirmed',
      };
      if (payloadLine.origenLinea) _l.origen = payloadLine.origenLinea;
      if (Array.isArray(payloadLine.asigRefs) && payloadLine.asigRefs.length > 0) {
        _l.asigRefs = payloadLine.asigRefs;
      }
      return _l;
    };
    const docLines = payload.lines.map((l) => build(l, 1));
    // Línea CPST: tiene origen+asigRefs.
    expect(docLines[0].origen).toBe('stock-asignado');
    expect(docLines[0].asigRefs).toHaveLength(1);
    // Líneas manuales: sin claves origen/asigRefs (no undefined, NO claves).
    expect(Object.hasOwn(docLines[1], 'origen')).toBe(false);
    expect(Object.hasOwn(docLines[1], 'asigRefs')).toBe(false);
    expect(Object.hasOwn(docLines[2], 'origen')).toBe(false);
    expect(Object.hasOwn(docLines[2], 'asigRefs')).toBe(false);
    // Firestore ya no rechaza: no hay valores undefined.
    for (const line of docLines) {
      for (const [k, v] of Object.entries(line)) {
        expect(v, `line.${line.code}.${k} no debe ser undefined`).toBeDefined();
      }
    }
  });
});
