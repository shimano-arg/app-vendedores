// @ts-check
/**
 * v1421 §55 (2026-10-22) — grep tests de:
 *   1. Badge "PEDIDO ANTERIOR" removido del render del modal Pedido en Espera.
 *   2. Pedido Final: clase `.has-value` cuando pedidoFinal>0 (bg verde),
 *      sin color cuando =0.
 *   3. Lógica del aviso naranja usa el pure filter.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const MAIN_JS = readFileSync('src/main.js', 'utf8');

describe('v1421 §55 — badge PEDIDO ANTERIOR removido', () => {
  it('index.html NO contiene createElement badge con texto "PEDIDO ANTERIOR"', () => {
    expect(INDEX_HTML).not.toMatch(/badge\.textContent\s*=\s*['"]PEDIDO ANTERIOR['"]/);
  });

  it('badge-duplicado "PEDIDO ANTERIOR" ya no se crea; sí la clase repeat-sku', () => {
    const idx = INDEX_HTML.indexOf('v1421 §55 (2026-10-22): badge "PEDIDO ANTERIOR" REMOVIDO');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/tr\.classList\.add\(['"]repeat-sku['"]\)/);
    expect(slice).not.toMatch(/badge\.textContent\s*=\s*['"]PEDIDO ANTERIOR['"]/);
  });

  it('aviso naranja del encabezado tiene texto actualizado SIN "MARCADOS CON"', () => {
    const idx = INDEX_HTML.indexOf(
      'SKU(S) SIN RESERVA DE ESTE CLIENTE QUE YA ESTAN EN OTRO PEDIDO'
    );
    expect(idx).toBeGreaterThan(0);
    expect(INDEX_HTML).not.toMatch(/SKU\(S\) QUE ESTE CLIENTE YA TENIA EN PEDIDOS ANTERIORES/);
  });
});

describe('v1421 §55 — Pedido Final verde cuando > 0', () => {
  it('CSS: #wcard-rows tr td.pedido-final-col.has-value tiene background verde #dcfce7', () => {
    const re =
      /#wcard-rows\s+tr\s+td\.pedido-final-col\.has-value\s*\{[^}]*background\s*:\s*#dcfce7[^}]*\}/;
    expect(INDEX_HTML).toMatch(re);
  });

  it('CSS: #wcard-rows tr td.pedido-final-col.has-value color texto verde oscuro #166534', () => {
    const re =
      /#wcard-rows\s+tr\s+td\.pedido-final-col\.has-value\s*\{[^}]*color\s*:\s*#166534[^}]*\}/;
    expect(INDEX_HTML).toMatch(re);
  });

  it('CSS: td.pedido-final-col base NO tiene background (sin color default)', () => {
    const baseRe = /#wcard-rows\s+tr\s+td\.pedido-final-col\s*\{\s*\/\*[^*]*\*\/\s*\}/;
    expect(INDEX_HTML).toMatch(baseRe);
  });

  it('render inline agrega className "has-value" cuando pedidoFinal>0', () => {
    const idx = INDEX_HTML.indexOf('v1421 §55 (2026-10-22): clase `.has-value`');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/_hasPedidoFinal\s*=\s*r\.hasData\s*&&\s*pedidoFinal\s*>\s*0/);
    expect(slice).toMatch(
      /pedido-final-col['"]\s*\+\s*\(_hasPedidoFinal\s*\?\s*['"]\s*has-value['"]/
    );
  });

  it('render inline: color inline muted (#94a3b8) solo cuando NO has-value', () => {
    const idx = INDEX_HTML.indexOf('v1421 §55 (2026-10-22): clase `.has-value`');
    const slice = INDEX_HTML.slice(idx, idx + 1200);
    expect(slice).toMatch(
      /if\s*\(!_hasPedidoFinal\)\s*tdFinal\.style\.color\s*=\s*['"]#94a3b8['"]/
    );
  });
});

describe('v1421 §55 — flow aviso usa pure filter', () => {
  it('index.html loop pre-render usa buildExcludedPedidoIdsForRepetido + filterYaEnOtroPedidoForLine', () => {
    const idx = INDEX_HTML.indexOf('v1421 §55 (2026-10-22): excluir pedidos origen');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1500);
    expect(slice).toMatch(/buildExcludedPedidoIdsForRepetido/);
    expect(slice).toMatch(/filterYaEnOtroPedidoForLine/);
  });

  it('index.html render loop también usa el pure filter', () => {
    const idx = INDEX_HTML.indexOf('v1421 §55 (2026-10-22): excluir el propio waitlist');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 1200);
    expect(slice).toMatch(/_repetidoPureR[\s\S]{0,600}buildExcluded/);
    expect(slice).toMatch(/filterLine\(r/);
  });

  it('src/main.js importa + expone los 3 helpers', () => {
    expect(MAIN_JS).toMatch(/from\s+['"]\.\/pure\/waitlist-repetido-filter\.js['"]/);
    expect(MAIN_JS).toMatch(/buildExcludedPedidoIdsForRepetido/);
    expect(MAIN_JS).toMatch(/filterYaEnOtroPedidoForLine/);
    expect(MAIN_JS).toMatch(/lineCountsAsPedidoAnterior/);
  });
});
