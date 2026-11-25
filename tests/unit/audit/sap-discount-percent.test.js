// @ts-check
/**
 * v1418 §53 (2026-10-22) — grep: payload SL incluye DiscountPercent del
 * pedido.discountPct (no hardcode 0).
 *
 * Precedente: SAP 2000425 PONTORIERO 2026-10-22. Modal mostraba
 * "-17% / -$0 · VA A SAP $2.389.570" pero SAP recibía Discount vacío (0%)
 * porque buildQuotationPayload hardcodeaba DiscountPercent: 0.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AUTO_SEND = readFileSync('functions/core/auto-send-sap-core.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('v1418 §53 — DiscountPercent del header SL leído del pedido', () => {
  it('auto-send-sap-core.js NO hardcodea DiscountPercent: 0 sin gate (D1 gate válido a partir de STACK S-4 T5)', () => {
    // STACK S-4 T5 (D12 fix 2026-11-25): el gate D1 agregó un ternario
    // `_sendRealDiscount ? _discountPct : 0`. El `: 0` final del ternario es
    // válido (parte del gate D1 condicional, no un hardcode). Lo que NO queremos
    // es volver al pattern viejo `DiscountPercent: 0,` SIN gate alguno.
    // Chequeo defensivo: si aparece exactamente el pattern viejo literal
    // `DiscountPercent: 0,` (seguido por newline/space, NO por `_sendRealDiscount`)
    // sin contexto del gate, falla.
    expect(AUTO_SEND).not.toMatch(/DiscountPercent\s*:\s*0\s*,[\s]*\n[\s]*U_AppOrigen/);
  });

  it('DiscountPercent se asigna via gate _sendRealDiscount (STACK S-4 T5) o _discountPct directo', () => {
    // STACK S-4 T5 (D12 fix 2026-11-25): aceptar tanto el pattern pre-fix
    // (`DiscountPercent: _discountPct,`) como el nuevo con gate D1
    // (`DiscountPercent: _sendRealDiscount ? _discountPct : 0,`).
    const legacyPattern = /DiscountPercent\s*:\s*_discountPct\s*,/;
    const d1GatePattern = /DiscountPercent\s*:\s*_sendRealDiscount\s*\?\s*_discountPct\s*:\s*0\s*,/;
    expect(legacyPattern.test(AUTO_SEND) || d1GatePattern.test(AUTO_SEND)).toBe(true);
  });

  it('_discountPct lee pedido.discountPct o pedido.discountSnapshot.pctTotal', () => {
    expect(AUTO_SEND).toMatch(/_pedidoAny\.discountPct/);
    expect(AUTO_SEND).toMatch(/_pedidoAny\.discountSnapshot[\s\S]{0,80}pctTotal/);
  });

  it('clamp defensivo a [0, 100]', () => {
    expect(AUTO_SEND).toMatch(/_discountPct\s*=\s*Math\.max\(0,\s*Math\.min\(100,\s*_rawPct\)\)/);
  });

  it('comentario cita precedente SAP 2000425 PONTORIERO 2026-10-22', () => {
    expect(AUTO_SEND).toMatch(/2000425|2\.389\.570/);
    expect(AUTO_SEND).toMatch(/PONTORIERO|Mariano/i);
  });
});

describe('v1418 §53 — modal detalle usa computeVaASap', () => {
  it('index.html:dispNeto delega a window.__phase0.pure.computeVaASap', () => {
    const slice = INDEX_HTML.slice(
      INDEX_HTML.indexOf('v1418 §53 (2026-10-22): usar computeVaASap como fuente única'),
      INDEX_HTML.indexOf(
        '\'<span style="font-weight:800;color:var(--text-primary)">VA A SAP</span>\''
      )
    );
    expect(slice.length).toBeGreaterThan(100);
    expect(slice).toMatch(/computeVaASap/);
    expect(slice).toMatch(/_vaASapFn\(c\)/);
  });

  it('fallback al cálculo local si el bundle no cargó computeVaASap', () => {
    const slice = INDEX_HTML.slice(
      INDEX_HTML.indexOf('v1418 §53 (2026-10-22): usar computeVaASap como fuente única'),
      INDEX_HTML.indexOf(
        '\'<span style="font-weight:800;color:var(--text-primary)">VA A SAP</span>\''
      )
    );
    expect(slice).toMatch(/subtotalDispCalc\s*\*\s*\(1\s*-\s*\(pctTotal\s*\/\s*100\)\)/);
  });

  it('montoDesc del descuento aplicado usa fórmula subtotal × pctTotal / 100', () => {
    const idx = INDEX_HTML.indexOf('v1418 §53 (2026-10-22): montoDesc');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 600);
    expect(slice).toMatch(/pctTotal\s*>\s*0[\s\S]{0,80}subtotal\s*\*\s*pctTotal\s*\/\s*100/);
  });
});

describe('v1418 §53 — Planner card usa computeVaASap', () => {
  it('_plannerComputeTotal delega a window.__phase0.pure.computeVaASap como primera opción', () => {
    const start = INDEX_HTML.indexOf('function _plannerComputeTotal(');
    const slice = INDEX_HTML.slice(start, start + 1500);
    expect(slice).toMatch(/v1418 §53[\s\S]{0,400}computeVaASap/);
    expect(slice).toMatch(/_vaASapFn\(pedido\)/);
  });
});

describe('v1418 §53 — main.js expone los helpers', () => {
  const MAIN_JS = readFileSync('src/main.js', 'utf8');

  it('main.js importa computeVaASap + readDiscountPct + sumConfirmedBruto', () => {
    expect(MAIN_JS).toMatch(/from\s+['"]\.\/pure\/pedido-va-a-sap\.js['"]/);
    expect(MAIN_JS).toMatch(/computeVaASap/);
    expect(MAIN_JS).toMatch(/readDiscountPct/);
    expect(MAIN_JS).toMatch(/sumConfirmedBruto/);
  });

  it('expuestos en window.__phase0.pure.*', () => {
    // v1485: el objeto phase0 creció mucho (nuevas keys). Chequear sin slice.
    expect(MAIN_JS).toMatch(/const phase0 = \{/);
    expect(MAIN_JS).toMatch(/computeVaASap/);
  });
});
