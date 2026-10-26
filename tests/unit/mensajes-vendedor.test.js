// @ts-check
/**
 * v1471 §68 (2026-10-26) — unit tests mensajes-vendedor.
 *
 * Regla CLAUDE.md §68: mensajes humanos sin jerga técnica. Código técnico
 * va al final en línea aparte.
 */
import { describe, expect, it } from 'vitest';
import {
  formatMensajeConCodigo,
  getMensajeParaErrorCode,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
} from '../../src/pure/mensajes-vendedor.js';

describe('v1471 §68 — MENSAJES_VENDEDOR cumple regla CLAUDE.md', () => {
  it('T1 cada mensaje tiene campo `texto` string no-vacío', () => {
    for (const [code, m] of Object.entries(MENSAJES_VENDEDOR)) {
      expect(typeof m.texto, `${code}.texto no es string`).toBe('string');
      expect(m.texto.length, `${code}.texto vacío`).toBeGreaterThan(10);
    }
  });

  it('T2 ningún texto principal contiene palabras prohibidas (case-insensitive para jerga)', () => {
    // Separar: códigos crudos (case-sensitive, uppercase) vs jerga (case-insensitive).
    const codigosCrudos = PALABRAS_PROHIBIDAS.filter((p) => /^[A-Z_]+$/.test(p));
    const jergaTecnica = PALABRAS_PROHIBIDAS.filter((p) => !/^[A-Z_]+$/.test(p));
    for (const [code, m] of Object.entries(MENSAJES_VENDEDOR)) {
      const t = m.texto;
      const tLower = t.toLowerCase();
      for (const w of codigosCrudos) {
        expect(t.includes(w), `${code} texto contiene código crudo "${w}": "${t}"`).toBe(false);
      }
      for (const w of jergaTecnica) {
        expect(
          tLower.includes(w.toLowerCase()),
          `${code} texto contiene jerga "${w}": "${t}"`
        ).toBe(false);
      }
    }
  });

  it('T3 cada mensaje tiene estructura "qué pasó + qué hacer" (al menos un punto final)', () => {
    for (const [code, m] of Object.entries(MENSAJES_VENDEDOR)) {
      expect(m.texto.includes('.'), `${code} debe tener al menos un punto final`).toBe(true);
    }
  });

  it('T4 getMensajeParaErrorCode devuelve el mapeado o UNKNOWN', () => {
    expect(getMensajeParaErrorCode('STOCK_CHANGED').texto).toContain('stock cambió');
    expect(getMensajeParaErrorCode('CODIGO_INVENTADO_QUE_NO_EXISTE')).toBe(
      MENSAJES_VENDEDOR.UNKNOWN
    );
    expect(getMensajeParaErrorCode('')).toBe(MENSAJES_VENDEDOR.UNKNOWN);
    expect(getMensajeParaErrorCode(null)).toBe(MENSAJES_VENDEDOR.UNKNOWN);
    expect(getMensajeParaErrorCode(undefined)).toBe(MENSAJES_VENDEDOR.UNKNOWN);
  });

  it('T5 getMensajeParaErrorCode trim + uppercase (acepta variantes)', () => {
    expect(getMensajeParaErrorCode('stock_changed').texto).toContain('stock cambió');
    expect(getMensajeParaErrorCode(' STOCK_CHANGED ').texto).toContain('stock cambió');
  });

  it('T6 formatMensajeConCodigo pone código técnico al final', () => {
    const result = formatMensajeConCodigo('STOCK_CHANGED');
    expect(result).toMatch(/stock cambió/);
    expect(result).toMatch(/Código técnico: STOCK_CHANGED$/);
  });

  it('T7 formatMensajeConCodigo con opts.incluirCodigoTecnico=false NO lo agrega', () => {
    const result = formatMensajeConCodigo('STOCK_CHANGED', { incluirCodigoTecnico: false });
    expect(result).not.toMatch(/Código técnico/);
    expect(result).toBe(MENSAJES_VENDEDOR.STOCK_CHANGED.texto);
  });

  it('T8 código técnico uppercase incluso si vino lowercase', () => {
    const result = formatMensajeConCodigo('stock_changed');
    expect(result).toMatch(/Código técnico: STOCK_CHANGED$/);
  });

  it('T9 código técnico UNKNOWN si vino vacío', () => {
    const result = formatMensajeConCodigo('');
    expect(result).toMatch(/Código técnico: UNKNOWN$/);
  });

  it('T10 todos los errorCodes de commitPedidoCF están mapeados', () => {
    const esperados = [
      'STOCK_CHANGED',
      'CONTENTION_RETRY_EXHAUSTED_REAL',
      'CONTENTION_RETRY_EXHAUSTED_OTRO',
      'UNRESOLVED_BO_ENTRY_ROWS',
      'CLIENT_HAS_OPEN_WAITLIST',
      'SNAPSHOT_TOO_OLD',
      'VERSION_OLD',
      'VALIDATION_ERROR',
      'PERMISSION_DENIED',
      'SAP_UNAVAILABLE',
      'INTERNAL',
      'UNKNOWN',
    ];
    for (const code of esperados) {
      expect(MENSAJES_VENDEDOR[code], `falta mapeo para ${code}`).toBeDefined();
    }
  });

  it('T11 todos los errorCodes de releaseAsigCF están mapeados', () => {
    const esperados = [
      'RELEASE_PERMISSION_DENIED',
      'RELEASE_WAITLIST_NOT_FOUND',
      'RELEASE_INVALID_ACTION',
      'RELEASE_FAILED',
    ];
    for (const code of esperados) {
      expect(MENSAJES_VENDEDOR[code], `falta mapeo para ${code}`).toBeDefined();
    }
  });

  it('T12 SAVE_WAITLIST_FAILED mapeado (TAREA 1 Federico)', () => {
    expect(MENSAJES_VENDEDOR.SAVE_WAITLIST_FAILED).toBeDefined();
    expect(MENSAJES_VENDEDOR.SAVE_WAITLIST_FAILED.texto).toContain('guardar');
  });

  it('T13 ejemplos literales del pedido Mariano están en el mapeo', () => {
    expect(MENSAJES_VENDEDOR.STOCK_CHANGED.texto).toBe(
      'No pudimos confirmar el pedido porque el stock cambió mientras lo revisabas. Tocá Aceptar para confirmarlo igual; lo que no haya queda esperando stock.'
    );
    expect(MENSAJES_VENDEDOR.SAVE_WAITLIST_FAILED.texto).toBe(
      'No pudimos guardar los cambios. Volvé a intentar; si sigue pasando, avisale a Mariano.'
    );
    expect(MENSAJES_VENDEDOR.CONTENTION_RETRY_EXHAUSTED_REAL.texto).toBe(
      'Este pedido quedó trabado por un intento anterior. Esperá 10 segundos y volvé a tocar Pasar a Pendientes.'
    );
  });

  it('T14 MENSAJES_VENDEDOR está frozen (inmutable)', () => {
    expect(Object.isFrozen(MENSAJES_VENDEDOR)).toBe(true);
    expect(Object.isFrozen(PALABRAS_PROHIBIDAS)).toBe(true);
  });

  it('T15 CONTENTION sub-codes tienen textos distintos (no son el mismo)', () => {
    expect(MENSAJES_VENDEDOR.CONTENTION_RETRY_EXHAUSTED_REAL.texto).not.toBe(
      MENSAJES_VENDEDOR.CONTENTION_RETRY_EXHAUSTED_OTRO.texto
    );
  });
});

describe('v1471 §68 — contrato index.html usa mensajesVendedor', () => {
  it('T20 handler commitCf errorCode usa window.__phase0.pure.mensajesVendedor', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('_commitCfResult && _commitCfResult.ok === false');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 4500);
    expect(slice).toMatch(/mensajesVendedor/);
    expect(slice).toMatch(/getMensajeParaErrorCode|formatMensajeConCodigo/);
    // El handler viejo con "Hay mucha concurrencia sobre este SKU" ya no debería estar.
    expect(slice).not.toMatch(/Hay mucha concurrencia sobre este SKU/);
    // Y los mensajes crudos con "payload", "snapshot", etc. tampoco.
    expect(slice).not.toMatch(/'[^']*El payload tiene algo mal[^']*'/);
  });

  it('T21 revisionDejarRecalculando catch usa el pure', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('revisionDejarRecalculando');
    expect(idx).toBeGreaterThan(0);
    // Buscar el catch dentro del contexto de la función (hasta +15k chars).
    const slice = html.slice(idx, idx + 15000);
    // El alert viejo 'Error guardando en espera: ' + (e.message || e) debe
    // haber desaparecido o ser reemplazado por el pure.
    const hasOldPattern = slice.match(/alert\('Error guardando en espera: '/);
    expect(hasOldPattern, 'el handler viejo todavía existe').toBeNull();
  });

  it('T22 reviewDejarEnEspera catch usa el pure', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const idx = html.indexOf('reviewDejarEnEspera');
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 15000);
    const hasOldPattern = slice.match(/alert\('Error guardando en Espera: '/);
    expect(hasOldPattern, 'el handler viejo todavía existe').toBeNull();
  });
});
