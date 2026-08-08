import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('Mobile bottom-nav skeleton', () => {
  it('existe <nav id="mobile-bottom-nav">', () => {
    expect(HTML).toMatch(/<nav[^>]*id="mobile-bottom-nav"/);
  });

  it('tiene 5 slots con data-mnav-slot correctos', () => {
    const slots = ['pedido', 'dashboard', 'home', 'cargar', 'productos'];
    for (const s of slots) {
      expect(HTML).toMatch(new RegExp(`data-mnav-slot="${s}"`));
    }
  });

  it('slot home es un FAB (.mnav-fab)', () => {
    expect(HTML).toMatch(/class="mnav-fab"[^>]*data-mnav-slot="home"/);
  });

  it('CSS del nav está presente', () => {
    expect(HTML).toContain('#mobile-bottom-nav');
    expect(HTML).toContain('.mnav-fab');
    expect(HTML).toContain('.mnav-btn');
  });

  it('media queries mobile/desktop están presentes', () => {
    expect(HTML).toMatch(
      /@media[^{]*max-width:\s*768px[^{]*\{[^}]*#main-tabs[\s\S]*?display:\s*none/
    );
    expect(HTML).toMatch(
      /@media[^{]*min-width:\s*769px[^{]*\{[^}]*#mobile-bottom-nav[\s\S]*?display:\s*none/
    );
  });
});

describe('Bottom-nav handlers simples', () => {
  it("slot home invoca setTab('locs')", () => {
    expect(HTML).toMatch(/data-mnav-slot="home"[^>]*onclick="[^"]*setTab\('locs'\)/);
  });
  it('slot dashboard invoca openDashboardModal', () => {
    expect(HTML).toMatch(/data-mnav-slot="dashboard"[^>]*onclick="openDashboardModal\(\)/);
  });
  it('slot productos invoca openProductMasterModal', () => {
    expect(HTML).toMatch(/data-mnav-slot="productos"[^>]*onclick="openProductMasterModal\(\)/);
  });
  it('función _updateHomeActiveState existe', () => {
    expect(HTML).toContain('function _updateHomeActiveState');
  });
});

describe('Slot CARGAR + sheet', () => {
  it('slot cargar invoca openCargarSheet', () => {
    expect(HTML).toMatch(/data-mnav-slot="cargar"[^>]*onclick="openCargarSheet\(\)"/);
  });
  it('sheet #cargar-sheet existe', () => {
    expect(HTML).toContain('id="cargar-sheet"');
  });
  it('sheet tiene 2 acciones (visita, contacto)', () => {
    expect(HTML).toMatch(/data-cargar-action="visita"/);
    expect(HTML).toMatch(/data-cargar-action="contacto"/);
  });
  it('handlers openCargarSheet/closeCargarSheet existen', () => {
    expect(HTML).toContain('function openCargarSheet');
    expect(HTML).toContain('function closeCargarSheet');
  });
});

describe('Slot PEDIDO + cliente picker', () => {
  it('slot pedido invoca openPedidoClientePicker', () => {
    expect(HTML).toMatch(/data-mnav-slot="pedido"[^>]*onclick="openPedidoClientePicker\(\)"/);
  });
  it('picker #pedido-cliente-picker existe', () => {
    expect(HTML).toContain('id="pedido-cliente-picker"');
  });
  it('picker tiene input search y lista', () => {
    expect(HTML).toContain('id="pcp-search"');
    expect(HTML).toContain('id="pcp-list"');
  });
  it('handlers openPedidoClientePicker/closePedidoClientePicker/_selectPedidoCliente existen', () => {
    expect(HTML).toContain('function openPedidoClientePicker');
    expect(HTML).toContain('function closePedidoClientePicker');
    expect(HTML).toContain('function _selectPedidoCliente');
  });
  it('v431: usa POINTS (bare) primero, window.POINTS como fallback', () => {
    // Chequea que existe el patrón de typeof POINTS antes que window.POINTS.
    expect(HTML).toMatch(/typeof POINTS !== 'undefined'/);
  });
});

describe('Hamburger unificado + drawer (v431)', () => {
  it('#header-hamburger-btn abre el drawer directo (no dropdown viejo)', () => {
    expect(HTML).toMatch(/id="header-hamburger-btn"[^>]*onclick="openMobileDrawer\(\)"/);
  });
  it('drawer #mobile-drawer existe', () => {
    expect(HTML).toContain('id="mobile-drawer"');
  });
  it('drawer tiene items básicos (rutas, altacli, notif, salir)', () => {
    const actions = ['rutas', 'altacli', 'notif', 'salir'];
    for (const a of actions) {
      expect(HTML).toMatch(new RegExp(`data-drawer-action="${a}"`));
    }
  });
  it('drawer tiene items admin gated por rol (productos, targets, campaigns, sap, mastercli, admin)', () => {
    const actions = ['productos', 'targets', 'campaigns', 'sap', 'mastercli', 'admin'];
    for (const a of actions) {
      expect(HTML).toMatch(new RegExp(`data-drawer-action="${a}"`));
    }
  });
  it('drawer NO tiene mas Herramientas item (revertido en v431)', () => {
    expect(HTML).not.toMatch(/data-drawer-action="herramientas"/);
  });
  it('handlers openMobileDrawer/closeMobileDrawer/_updateHamburgerBadge existen', () => {
    expect(HTML).toContain('function openMobileDrawer');
    expect(HTML).toContain('function closeMobileDrawer');
    expect(HTML).toContain('function _updateHamburgerBadge');
  });
});

describe('v431: revert Herramientas + botones individuales', () => {
  it('modal #herramientas-modal fue eliminado', () => {
    expect(HTML).not.toContain('id="herramientas-modal"');
  });
  it('funciones openHerramientasModal/closeHerramientasModal eliminadas', () => {
    expect(HTML).not.toContain('function openHerramientasModal');
    expect(HTML).not.toContain('function closeHerramientasModal');
  });
  it('botón .btn-mis-camps restaurado en top toolbar', () => {
    expect(HTML).toMatch(/<button[^>]*class="btn-mis-camps"[^>]*onclick="openMisCampsModal\(\)"/);
  });
  it('botón .btn-export restaurado en top toolbar', () => {
    expect(HTML).toMatch(
      /<button[^>]*class="btn-export"[^>]*onclick="_safeOpenExportFormatModal\(\)"/
    );
  });
  it('nuevo botón .btn-rendiciones-top con setTab(rendiciones)', () => {
    expect(HTML).toMatch(
      /<button[^>]*class="btn-rendiciones-top"[^>]*onclick="setTab\('rendiciones'\)"/
    );
  });
  it('nuevo botón .btn-clientes con setTab(clients)', () => {
    expect(HTML).toMatch(/<button[^>]*class="btn-clientes"[^>]*onclick="setTab\('clients'\)"/);
  });
  it('applyRolePermissions gate #mis-camps-btn (revert al comportamiento pre-v429)', () => {
    expect(HTML).toMatch(
      /getElementById\('mis-camps-btn'\)\.style\.display\s*=\s*\(userRole\s*!==\s*'unassigned'\)/
    );
  });
});
