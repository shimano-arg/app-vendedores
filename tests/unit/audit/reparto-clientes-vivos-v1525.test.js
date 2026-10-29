// v1525 (2026-10-29) — el modal Reparto muestra solo los clientes que todavia
// esperan stock, y traduce los rechazos del servidor a mensajes simples (§68).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

function extraer(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  expect(i).toBeGreaterThan(0);
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}' && --depth === 0) return html.slice(i, j + 1);
  }
  throw new Error('no cierra ' + nombre);
}

function cargar(globalPedidos) {
  const src = [
    extraer('_repartoClienteEsReparteable'),
    extraer('_repartoFiltrarClientesVivos'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('globalPedidos', src + '\nreturn _repartoFiltrarClientesVivos;')(
    globalPedidos
  );
}

describe('_repartoFiltrarClientesVivos', () => {
  const snap = [
    { pedidoId: 'p1', lineIndex: 0, clientName: 'A', qtyBackorder: 3 },
    { pedidoId: 'p2', lineIndex: 0, clientName: 'B', qtyBackorder: 2 },
    { pedidoId: 'p3', lineIndex: 1, clientName: 'C', qtyBackorder: 1 },
  ];

  it('saca los que ya tienen asignado y usa la cantidad pendiente de hoy', () => {
    const filtrar = cargar([
      { _fsId: 'p1', lines: [{ code: 'X', state: 'BO', qtyOpen: 1 }] },
      { _fsId: 'p2', lines: [{ code: 'X', state: 'ASIG', qtyOpen: 2 }] },
      { _fsId: 'p3', lines: [{}, { code: 'X', state: 'BO', qtyOpen: 0 }] },
    ]);
    const r = filtrar(snap);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pedidoId: 'p1', qtyBackorder: 1 });
  });

  it('sin pedidos cargados deja el snapshot como está', () => {
    expect(cargar([])(snap)).toBe(snap);
  });

  it('pedido no encontrado se deja (el servidor valida)', () => {
    const r = cargar([{ _fsId: 'otro', lines: [] }])(snap);
    expect(r).toHaveLength(3);
  });
});

describe('mensajes del reparto', () => {
  const fn = new Function(extraer('_repartoMensajeError') + '\nreturn _repartoMensajeError;')();

  it('traduce los rechazos conocidos sin jerga', () => {
    for (const err of [
      'nada para aplicar: esos clientes ya no esperan stock',
      'ingreso ya aplicado o cancelado (status=done)',
      'E5 stock físico bajó durante aplicación (10 → 4) SKU=X',
    ]) {
      const m = fn([err]);
      for (const w of ['ASIG', 'status', 'E5', 'qtyOpen', 'SKU']) expect(m).not.toContain(w);
    }
  });

  it('el modal usa el mensaje y avisa los clientes salteados', () => {
    expect(html).toContain('alert(_repartoMensajeError(r.errors || []));');
    expect(html).toContain('ya tenían asignado (no se duplicó)');
  });
});
