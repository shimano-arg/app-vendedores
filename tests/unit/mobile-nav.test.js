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
    expect(HTML).toMatch(/@media[^{]*max-width:\s*768px[^{]*\{[^}]*#main-tabs[\s\S]*?display:\s*none/);
    expect(HTML).toMatch(/@media[^{]*min-width:\s*769px[^{]*\{[^}]*#mobile-bottom-nav[\s\S]*?display:\s*none/);
  });
});

describe('Bottom-nav handlers simples', () => {
  it('slot home invoca setTab(\'locs\')', () => {
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
});
