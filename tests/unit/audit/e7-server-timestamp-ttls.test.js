// @ts-check
/**
 * E7 §stock-servidor-atomico — serverTimestamp en campos TTL-sensitivos.
 *
 * G1.G14 del audit grises: clock skew del dispositivo del VDE puede desfasar
 * confirmedAt / asigAt por horas, haciendo que lineReservesStock lea una
 * fecha incorrecta y decida mal.
 *
 * Fix: todos los flows cliente que escriben campos TTL-sensitivos
 * (confirmedAt, asigAt, createdAt para BO) deben usar
 * firebase.firestore.FieldValue.serverTimestamp() en vez de
 * new Date().toISOString().
 *
 * Nota: muchos flows ya pasan por commitPedidoCF (E3/E4) donde el servidor
 * usa admin.firestore.FieldValue.serverTimestamp(). Este E7 es defensivo
 * para el fallback legacy del cliente + flows no migrados.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('E7 — serverTimestamp en campos TTL del cliente', () => {
  it('confirmedAt en doConfirmPedido usa FieldValue.serverTimestamp (fallback legacy)', () => {
    // Buscar el write de confirmedAt en la zona de persistPendingEntry/doConfirmPedido.
    const start = INDEX_HTML.indexOf(
      'E7 §stock-servidor-atomico (v1433): confirmedAt usa serverTimestamp'
    );
    expect(start).toBeGreaterThan(0);
    const code = INDEX_HTML.slice(start, start + 600);
    expect(code).toMatch(/confirmedAt:\s*\([\s\S]{0,200}FieldValue\.serverTimestamp\(\)/);
  });

  it('confirmedAt tiene fallback a new Date() si firebase SDK no está (dev local)', () => {
    const start = INDEX_HTML.indexOf(
      'E7 §stock-servidor-atomico (v1433): confirmedAt usa serverTimestamp'
    );
    expect(start).toBeGreaterThan(0);
    const code = INDEX_HTML.slice(start, start + 600);
    expect(code).toMatch(
      /FieldValue\.serverTimestamp\(\)[\s\S]{0,100}:\s*new Date\(\)\.toISOString\(\)/
    );
  });

  it('createdAt del pedido ya usaba FieldValue.serverTimestamp (anti-regresión)', () => {
    expect(INDEX_HTML).toMatch(/createdAt:\s*firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });
});

describe('E7 — commitPedidoCF usa timestamp server-side (serverTimestamp O nowIso)', () => {
  const CORE = readFileSync('functions/core/commit-pedido-core.js', 'utf8');

  it('v1473: buildPedidoDocData usa nowIso (string ISO server-side)', () => {
    // v1473 (2026-10-26): cambio FieldValue.serverTimestamp() → nowIso string
    // porque la UI (tarjeta Pedidos > Confirmados) hace new Date(c.confirmedAt)
    // y con Timestamp Firestore devuelve "Invalid Date" (reportado Federico
    // ORDEN 530 SUSANA ANDRILI). nowIso = new Date(now).toISOString() donde
    // now = Date.now() del CF → también server-side authoritative, equivalente
    // a serverTimestamp() en términos anti-clock-skew. NO acepta campo del
    // payload cliente.
    expect(CORE).toMatch(/confirmedAt:\s*nowIso/);
    expect(CORE).toMatch(/createdAt:\s*nowIso/);
    // Anti-regresión: NO debe usar un campo del payload cliente.
    expect(CORE).not.toMatch(/confirmedAt:\s*payload\.confirmedAt/);
    expect(CORE).not.toMatch(/createdAt:\s*payload\.createdAt/);
  });
});
