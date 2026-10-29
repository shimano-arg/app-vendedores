// @ts-check
/**
 * Dashboard de Ventas (2026-10-29) — estado del módulo entre aperturas.
 *
 * El chunk no se recarga al cerrar sesión: su estado sobrevive. Reglas:
 *   - Al abrir SIEMPRE se llama a dashboardVentasCF (el servidor cachea 10 min).
 *   - Si el uid cambió, se descarta todo (datos, selección, opciones): nunca se
 *     muestran datos del usuario anterior.
 *   - Mismo uid: se conserva la selección aplicada.
 *   - "Ver más" no aplica filtros que no se tocaron con "Aplicar".
 *
 * Corre el source real en un contexto `vm` con un DOM mínimo (sin jsdom).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync('src/domains/dashboard-ventas.js', 'utf8');

function respuesta(tag) {
  return {
    kpis: {
      facturado: tag === 'admin' ? 999999 : 111,
      backorderArs: 0,
      pedidos: 1,
      pedidosUnicos: 1,
    },
    topUnidades: [{ sku: 'SKU-' + tag, desc: null, uds: 3, ars: 30 }],
    topDinero: [{ sku: 'SKU-' + tag, desc: 'd', uds: 3, ars: 30 }],
    serieVentas: [{ mes: '2026-10', valor: 10 }],
    serieBoUds: [],
    serieBoArs: [],
    opciones: {
      vendedores: [],
      clientes: [{ code: 'C1', name: 'Cliente 1' }],
      provincias: [],
      categorias: [],
      skus: [],
    },
    dataUpdatedAt: '2026-10-29T12:00:00Z',
  };
}

function setup() {
  const els = {};
  const checkboxes = [];
  let clickHandler = null;
  function Element() {}
  function HTMLInputElement() {}
  const mk = (id) => {
    if (!els[id]) {
      const cls = new Set();
      els[id] = {
        id,
        innerHTML: '',
        open: false,
        disabled: false,
        classList: {
          add: (c) => cls.add(c),
          remove: (c) => cls.delete(c),
          contains: (c) => cls.has(c),
        },
        addEventListener: (type, fn) => {
          if (type === 'click' && id === 'dashboard-ventas-body') clickHandler = fn;
        },
        querySelectorAll: (sel) => (sel.includes('data-filtro') ? checkboxes : []),
        querySelector: () => null,
      };
    }
    return els[id];
  };
  const calls = [];
  let pending = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    innerWidth: 1200,
    alert() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      getElementById: mk,
      createElement: () => ({}),
      head: { appendChild() {} },
      documentElement: {},
    },
    firebase: {
      app: () => ({
        functions: () => ({
          httpsCallable: () => (payload) => {
            calls.push(JSON.parse(JSON.stringify(payload)));
            return new Promise((resolve) => pending.push(resolve));
          },
        }),
      }),
    },
    Element,
    HTMLInputElement,
    setTimeout,
    userRole: 'admin',
    assignedVendor: null,
    currentUser: { uid: 'uid-admin' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const flush = async (tag) => {
    const p = pending;
    pending = [];
    for (const r of p) r({ data: respuesta(tag) });
    await new Promise((r) => setTimeout(r, 0));
  };
  const click = (attr, value) => {
    const target = Object.create(Element.prototype);
    target.closest = (sel) => (sel === '[' + attr + ']' ? { getAttribute: () => value } : null);
    clickHandler({ target });
  };
  const results = () => mk('dv-results').innerHTML;
  return { ctx, calls, flush, click, checkboxes, results };
}

describe('Dashboard de Ventas — estado entre aperturas y usuarios', () => {
  it('siempre llama a la CF al abrir, aunque ya haya datos', async () => {
    const t = setup();
    t.ctx.openDashboardVentas();
    await t.flush('admin');
    t.ctx.closeDashboardVentas();
    t.ctx.openDashboardVentas();
    expect(t.calls.length).toBe(2);
  });

  it('mismo uid: conserva la selección aplicada al reabrir', async () => {
    const t = setup();
    t.ctx.openDashboardVentas();
    await t.flush('admin');
    t.checkboxes.push({ checked: true, value: 'C1', getAttribute: () => 'clientes' });
    t.click('data-dv-action', 'aplicar');
    await t.flush('admin');
    expect(t.calls[1].clientes).toEqual(['C1']);
    t.ctx.closeDashboardVentas();
    t.ctx.openDashboardVentas();
    expect(t.calls[2].clientes).toEqual(['C1']);
  });

  it('otro uid: resetea selección y no muestra los datos del usuario anterior', async () => {
    const t = setup();
    t.ctx.openDashboardVentas();
    await t.flush('admin');
    t.checkboxes.push({ checked: true, value: 'C1', getAttribute: () => 'clientes' });
    t.click('data-dv-action', 'aplicar');
    await t.flush('admin');
    expect(t.results()).toContain('$999.999');

    // Logout del admin + login de un vendedor en la misma pestaña (sin recarga).
    t.ctx.closeDashboardVentas();
    t.ctx.currentUser = { uid: 'uid-vendedor' };
    t.ctx.userRole = 'vendedor';
    t.ctx.assignedVendor = 'GONZALO DE LA ROSA';
    t.checkboxes.length = 0;
    t.ctx.openDashboardVentas();

    const last = t.calls[t.calls.length - 1];
    expect(last.clientes).toEqual([]);
    expect(last.vendedores).toEqual([]);
    expect(t.results()).toContain('Cargando…');
    expect(t.results()).not.toContain('$999.999');
    expect(t.results()).not.toContain('SKU-admin');

    // Si la respuesta del admin llegara tarde, se descarta.
    await t.flush('vendedor');
    expect(t.results()).not.toContain('SKU-admin');
    expect(t.results()).toContain('$111');
  });

  it('"Ver más" no aplica filtros sin "Aplicar" ni vuelve a llamar a la CF', async () => {
    const t = setup();
    t.ctx.openDashboardVentas();
    await t.flush('admin');
    // El usuario marca un cliente pero NO toca Aplicar.
    t.checkboxes.push({ checked: true, value: 'C1', getAttribute: () => 'clientes' });
    t.click('data-vermas', 'unidades');
    expect(t.calls.length).toBe(1);
    expect(t.results()).toContain('aria-expanded="true"');
    t.ctx.closeDashboardVentas();
    t.ctx.openDashboardVentas();
    expect(t.calls[1].clientes).toEqual([]);
  });

  it('respuesta que llega con el modal cerrado no se muestra ni se dibuja', async () => {
    const t = setup();
    t.ctx.openDashboardVentas();
    t.ctx.closeDashboardVentas();
    await t.flush('admin');
    expect(t.results()).not.toContain('SKU-admin');
  });
});
