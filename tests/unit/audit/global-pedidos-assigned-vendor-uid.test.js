// v1536: la proyección de globalPedidos (listener pedidos_all) tiene que traer
// assignedVendorUid. El alcance de exportaciones v1534 (src/pure/export-scope.js)
// lo compara con el usuario logueado para el rol vendedor; sin el campo, PACHI
// exportaba Pedidos del mes vacío teniendo 33 pedidos en septiembre.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildExportScope } from '../../../src/pure/export-scope.js';

const html = readFileSync('index.html', 'utf8');

describe('globalPedidos incluye assignedVendorUid (v1536)', () => {
  it('la proyección del listener de pedidos copia assignedVendorUid', () => {
    const i = html.indexOf('globalPedidos.push({');
    expect(i).toBeGreaterThan(-1);
    const bloque = html.slice(i, html.indexOf('});', i));
    expect(bloque).toContain("assignedVendorUid: d.assignedVendorUid || ''");
  });

  it('un pedido proyectado sin assignedVendorUid queda afuera para el vendedor (por eso el campo es obligatorio)', () => {
    const scope = buildExportScope({
      role: 'vendedor',
      myUid: 'uid-pachi',
      myVendorKey: 'PACHI',
      resolveVendorForClient: () => ({ vendorKey: 'PACHI', reason: 'ok' }),
    });
    const sinCampo = { clientCardCode: 'C1', clientName: 'X' };
    const conCampo = { ...sinCampo, assignedVendorUid: 'uid-pachi' };
    expect(scope.filterPedidos([sinCampo])).toHaveLength(0);
    expect(scope.filterPedidos([conCampo])).toHaveLength(1);
  });
});
