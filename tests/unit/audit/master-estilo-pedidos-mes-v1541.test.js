// v1541: Master de Clientes con el estilo visual de "Pedidos del mes".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync('styles/apple-design.css', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const BLOCK = CSS.slice(
  CSS.indexOf('/* v1541 (2026-11-02): Master de Clientes con el estilo visual')
);

describe('v1541 — Master de Clientes con estilo Pedidos del mes', () => {
  it('el bloque existe y va después del tratamiento v656 (gana la cascada)', () => {
    expect(BLOCK.length).toBeGreaterThan(200);
    expect(CSS.indexOf('/* v1541')).toBeGreaterThan(
      CSS.indexOf('/* v656 (2026-08-26) apple-design')
    );
  });
  it('encabezado azul igual a Pedidos del mes, título blanco', () => {
    expect(BLOCK).toMatch(
      /#master-cli-modal \.modal-head \{\r?\n\s*background: linear-gradient\(135deg, #0f4c81, #1e6fb5\) !important;/
    );
    expect(BLOCK).toMatch(/#master-cli-modal \.modal-head h2 \{\r?\n\s*color: #ffffff !important;/);
    expect(INDEX).toMatch(
      /id="pedidos-mes-modal"[\s\S]{0,300}linear-gradient\(135deg,#0f4c81,#1e6fb5\)/
    );
  });
  it('tabla plana con encabezado subrayado y fila resaltada al pasar el mouse', () => {
    expect(BLOCK).toContain('border-bottom: 2px solid var(--border-strong, #cbd5e1) !important;');
    expect(BLOCK).toContain('#master-cli-modal .mc-table tbody tr:hover > td');
  });
  it('solo CSS: el archivo mantiene finales de línea CRLF', () => {
    expect(/(?<!\r)\n/.test(CSS)).toBe(false);
  });
});
