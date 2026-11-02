// @ts-check
/**
 * v1535 (APP-02) — contrato UI del boton "Sincronizar con SAP" en el Master
 * de Clientes (al lado de "Reasignar Zonas").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const mc = readFileSync(join(ROOT, 'src/domains/master-clientes.js'), 'utf8');
const css = readFileSync(join(ROOT, 'styles/apple-design.css'), 'utf8');
const textos = readFileSync(join(ROOT, 'src/pure/sync-clientes-sap-mensajes.js'), 'utf8');

const btnTag = (html.match(/<button id="mc-sync-sap-btn"[^>]*>[\s\S]*?<\/button>/) || [''])[0];

describe('v1535 APP-02 — boton Sincronizar con SAP', () => {
  it('U1 el boton existe en el toolbar del Master de Clientes', () => {
    expect(btnTag).not.toBe('');
    expect(btnTag).toContain('Sincronizar con SAP');
  });

  it('U2 queda inmediatamente despues de "Reasignar Zonas" (misma linea)', () => {
    const iZonas = html.indexOf('<button id="mc-reasignar-zonas-btn"');
    const iSync = html.indexOf('<button id="mc-sync-sap-btn"');
    expect(iZonas).toBeGreaterThan(0);
    expect(iSync).toBeGreaterThan(iZonas);
    const between = html.slice(iZonas, iSync);
    // Entre ambos solo esta el cierre del boton Reasignar Zonas (sin otro boton).
    expect((between.match(/<button/g) || []).length).toBe(1);
    expect(between).not.toMatch(/<\/div>/);
  });

  it('U3 "Reasignar Zonas" no cambio', () => {
    expect(html).toContain(
      '<button id="mc-reasignar-zonas-btn" class="mc-prov-btn" onclick="closeMasterClientesPanel();openZonasModal();" style="background:var(--color-accent-violet);box-shadow:0 1px 3px rgba(124,58,237,.3)" title="Reasignar tiendas / localidades / provincias a otro vendedor. Abre el panel Zonas con las 4 pestanas (Por tienda, Por localidad, Por provincia, Historial).">Reasignar Zonas</button>'
    );
  });

  it('U4 mismo estilo base (mc-prov-btn), icono SVG de refresco, oculto por default', () => {
    expect(btnTag).toContain('class="mc-prov-btn"');
    expect(btnTag).toContain('<svg');
    expect(btnTag).toContain('mc-sync-sap-icon');
    expect(btnTag).toMatch(/style="display:none"/);
    expect(btnTag).toContain('onclick="syncClientesSap()"');
  });

  it('U5 solo admin/gerente lo ven (vendedor y otros: oculto)', () => {
    const fn = mc.slice(mc.indexOf('function updateMcSyncSapBtnVisibility'));
    expect(fn).toContain("userRole === 'admin' || userRole === 'gerente'");
    expect(fn).toMatch(/style\.display\s*=\s*_puede\s*\?\s*''\s*:\s*'none'/);
    // Se evalua al abrir el panel.
    const open = mc.slice(mc.indexOf('window.openMasterClientesPanel'));
    expect(open.slice(0, 600)).toContain('updateMcSyncSapBtnVisibility()');
  });

  it('U6 llama al callable syncClientesSapCF en southamerica-east1', () => {
    expect(mc).toMatch(/httpsCallable\('syncClientesSapCF'[,)]/);
    expect(mc).toContain("functions('southamerica-east1')");
  });

  it('U7 textos exactos para el usuario', () => {
    expect(textos).toContain("'Sincronizando…'");
    expect(textos).toContain("'Se incorporaron ' + n + ' clientes nuevos'");
    expect(textos).toContain("'Sincronización terminada: no hay clientes nuevos'");
    expect(textos).toContain("'Ya hay una sincronización en curso, probá en un minuto'");
  });

  it('U8 mientras corre: deshabilitado + clase is-syncing; al terminar se rehabilita (finally)', () => {
    const fn = mc.slice(mc.indexOf('window.syncClientesSap'));
    expect(fn).toContain('btn.disabled = true');
    expect(fn).toContain("classList.add('is-syncing')");
    expect(fn).toContain('finally');
    expect(fn).toContain('btn.disabled = false');
    expect(fn).toContain("classList.remove('is-syncing')");
  });

  it('U9 despues de terminar re-renderiza la lista del master', () => {
    const fn = mc.slice(mc.indexOf('window.syncClientesSap'));
    expect(fn).toContain('renderMasterClientesTable()');
  });

  it('U10 CSS: pill blanca, borde fino, active scale(.97) 100ms, spinner y reduced-motion', () => {
    expect(css).toContain('#master-cli-modal #mc-sync-sap-btn');
    expect(css).toMatch(/#mc-sync-sap-btn\.is-syncing \.mc-sync-sap-icon\s*\{[^}]*animation/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*#mc-sync-sap-btn/);
  });

  it('U11 CSS mantiene finales de linea CRLF', () => {
    const lf = (css.match(/(?<!\r)\n/g) || []).length;
    expect(lf).toBe(0);
  });
  it('U12 deshabilitado no escala en :active (pisa el :active base de .mc-prov-btn)', () => {
    expect(css).toMatch(
      /#master-cli-modal #mc-sync-sap-btn:disabled:active\s*\{[^}]*transform:\s*none/
    );
  });
});
