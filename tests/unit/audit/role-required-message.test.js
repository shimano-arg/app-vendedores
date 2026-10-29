// @ts-check
/**
 * D8 (2026-10-29): cuando commitPedidoCF rechaza por rol (SEC-02,
 * details.errorCode='ROLE_REQUIRED') el vendedor ve un mensaje propio, no el
 * genérico PERMISSION_DENIED ("cerrá sesión y volvé a entrar", que no aplica).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatMensajeConCodigo,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
} from '../../../src/pure/mensajes-vendedor.js';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('D8 — ROLE_REQUIRED', () => {
  it('M1: existe el mensaje, dice qué hacer y no menciona cerrar sesión', () => {
    const t = MENSAJES_VENDEDOR.ROLE_REQUIRED.texto;
    expect(t).toMatch(/Mariano/);
    expect(t).not.toMatch(/cerr[aá] sesi[oó]n/i);
  });
  it('M2: el código crudo no aparece en el texto (regla §68)', () => {
    expect(PALABRAS_PROHIBIDAS).toContain('ROLE_REQUIRED');
    expect(MENSAJES_VENDEDOR.ROLE_REQUIRED.texto).not.toContain('ROLE_REQUIRED');
    expect(formatMensajeConCodigo('ROLE_REQUIRED')).toContain('ROLE_REQUIRED');
  });
  it('M3: _tryCommitPedidoCF mapea details.errorCode=ROLE_REQUIRED antes que permission-denied', () => {
    const i = html.indexOf("_detailsCode === 'ROLE_REQUIRED' ? 'ROLE_REQUIRED'");
    const j = html.indexOf("code === 'functions/permission-denied' ? 'PERMISSION_DENIED'");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});
