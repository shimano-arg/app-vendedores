// v1552 (2026-11-03): «Pedidos del mes» para interno (VDI) + «Eliminar» con
// estilo Apple en provisorios/leads de Master Clientes, visible para todos los
// vendedores (clientes SAP siguen solo admin/gerente).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync('index.html', 'utf8');
const MC = readFileSync('src/domains/master-clientes.js', 'utf8');
const CSS = readFileSync('styles/apple-design.css', 'utf8');
const PDM = readFileSync('src/domains/pedidos-del-mes.js', 'utf8');
const FN = readFileSync('functions/index.js', 'utf8');

describe('v1552 — Pedidos del mes para interno', () => {
  it('el botón se habilita para interno', () => {
    expect(HTML).toMatch(/_pdmOk = [^;]*userRole === 'interno';/);
  });
  it('el wrapper resuelve las parejas del interno por internalPartnerUid', () => {
    expect(FN).toMatch(/where\('internalPartnerUid', '==', uid\)/);
    expect(FN).toMatch(/return \{ role: d\.role, vendor: d\.vendor, partnerVendors \};/);
  });
  it('la etiqueta de alcance distingue zona + parejas', () => {
    expect(PDM).toContain("'Tu zona y tus parejas'");
  });
});

describe('v1552 — Eliminar en provisorios/leads', () => {
  it('los dos botones Eliminar usan la clase pill mc-del-btn (sin estilo inline rojo)', () => {
    expect((MC.match(/class="mc-del-btn/g) || []).length).toBe(2);
    expect(MC).not.toMatch(
      /text-transform:uppercase;letter-spacing:\.3px" title="Eliminar tienda"/
    );
  });
  it('provisorios llevan mc-del-prov (tabla Provisorios siempre; tabla principal si isProvisorio)', () => {
    expect(MC).toContain('class="mc-del-btn mc-del-prov"');
    expect(MC).toMatch(/\(isProvisorio \? ' mc-del-prov' : ''\)/);
  });
  it('en solo lectura se oculta Eliminar salvo en provisorios', () => {
    expect(HTML).toContain(
      '#master-cli-modal.mc-solo-lectura #mc-body button[onclick^="deleteMcEntry"]:not(.mc-del-prov)'
    );
  });
  it('deleteMcEntry deja borrar a vendedor/interno solo altas sin CardCode SAP', () => {
    const j = MC.indexOf('window.deleteMcEntry = async function');
    const body = MC.slice(j, j + 1400);
    expect(body).toMatch(/_esProvisorio = !!\(_altaRO && !_altaRO\.cardCodeSap\)/);
    expect(body).toMatch(/if \(!_esProvisorio\)/);
  });
  it('estilo Apple del botón en apple-design.css (§106): rojo, pill, sin mayúsculas', () => {
    const sel = '#master-cli-modal button[onclick*="deleteMcEntry"] {';
    const i = CSS.indexOf(sel);
    expect(i).toBeGreaterThan(0);
    const b = CSS.slice(i, CSS.indexOf('}', i));
    expect(b).toMatch(/color: #ff3b30 !important/);
    expect(b).toMatch(/border-radius: 999px !important/);
    expect(b).toMatch(/text-transform: none !important/);
    expect(CSS).toMatch(
      /button\[onclick\*="deleteMcEntry"\]:active \{\s*transform: scale\(0\.97\)/
    );
    expect(CSS.includes('\r\n')).toBe(true);
  });
  it('versión >= v1552 en sync con el SW', () => {
    const m = HTML.match(/const APP_VERSION = 'v(\d+)'/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(1552);
    expect(readFileSync('sw.js', 'utf8').match(/const CACHE_VERSION = 'v(\d+)'/)[1]).toBe(m[1]);
  });
});
