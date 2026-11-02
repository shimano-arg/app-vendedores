// v1534 (2026-11-02) — alcance por rol de las exportaciones (auditoría 46, Etapa 1).
// "Los clientes de un vendedor" = el master ACTUAL (POINTS + vendor_overrides +
// approvedAltas, §46/§50), no el vendedor guardado en el pedido.
import { describe, expect, it } from 'vitest';
import {
  buildExportScope,
  normVendorKey,
  resolvePedidoVendorKey,
  vendorColumnForPedido,
} from '../../src/pure/export-scope.js';

// Master de prueba: cardCode → vendorKey actual.
const MASTER = {
  C_PACHI_1: 'PACHI',
  C_PACHI_2: 'pachi', // master con minúsculas: se normaliza
  C_GONZA_1: 'GONZALO DE LA ROSA',
  C_FEDE_1: 'FEDERICO CASTELANELLI',
  C_MAURI_1: 'MAURICIO GIL',
};
/** @param {string} cardCode */
const resolveVendorForClient = (cardCode) =>
  /** @type {Record<string,string>} */ (MASTER)[cardCode] || '';

const UID_PACHI = 'uid-pachi';
const UID_GONZA = 'uid-gonza';

const pedidos = [
  // Propio: master PACHI + assignedVendorUid PACHI.
  { _fsId: 'P1', clientCardCode: 'C_PACHI_1', assignedVendorUid: UID_PACHI, ownerVendor: 'X' },
  // Ajeno con UID desactualizado: el master dice Gonzalo, pero tiene el UID de PACHI.
  {
    _fsId: 'P2',
    clientCardCode: 'C_GONZA_1',
    assignedVendorUid: UID_PACHI,
    vendorAssigned: 'PACHI',
  },
  // Propio por master pero con UID de otro (no lo trae la consulta; defensa).
  { _fsId: 'P3', clientCardCode: 'C_PACHI_2', assignedVendorUid: UID_GONZA },
  // Prospecto sin CardCode SAP: cae a vendorAssigned del pedido.
  {
    _fsId: 'P4',
    clientCardCode: '',
    clientName: 'PROSPECTO NUEVO',
    assignedVendorUid: UID_PACHI,
    vendorAssigned: 'PACHI',
  },
  { _fsId: 'P5', clientCardCode: 'C_FEDE_1', assignedVendorUid: 'uid-fede' },
  { _fsId: 'P6', clientCardCode: 'C_MAURI_1', assignedVendorUid: 'uid-mauri' },
];

/** @param {any[]} arr */
const ids = (arr) => arr.map((p) => p._fsId);

describe('normVendorKey', () => {
  it('trim + mayúsculas; vacío para null', () => {
    expect(normVendorKey('  pachi ')).toBe('PACHI');
    expect(normVendorKey(null)).toBe('');
  });
});

describe('resolvePedidoVendorKey / vendorColumnForPedido', () => {
  it('el master gana sobre lo guardado en el pedido', () => {
    expect(resolvePedidoVendorKey(pedidos[1], resolveVendorForClient)).toBe('GONZALO DE LA ROSA');
  });
  it('sin master cae a vendorAssigned', () => {
    expect(resolvePedidoVendorKey(pedidos[3], resolveVendorForClient)).toBe('PACHI');
  });
  it('columna Vendedor: master > vendorAssigned > ownerVendor', () => {
    expect(vendorColumnForPedido(pedidos[0], resolveVendorForClient)).toBe('PACHI');
    expect(
      vendorColumnForPedido({ clientCardCode: 'C_NUEVO', ownerVendor: 'IOANNIS' }, () => '')
    ).toBe('IOANNIS');
    expect(
      vendorColumnForPedido(
        { clientCardCode: 'C_NUEVO', vendorAssigned: 'PACHI', ownerVendor: 'IOANNIS' },
        () => ''
      )
    ).toBe('PACHI');
  });
  it('resolver que tira error no rompe: cae a lo guardado', () => {
    const boom = () => {
      throw new Error('x');
    };
    expect(vendorColumnForPedido({ vendorAssigned: 'PACHI' }, boom)).toBe('PACHI');
  });
});

describe('buildExportScope — pedidos', () => {
  it('vendedor: solo clientes de su master aunque un pedido ajeno tenga su assignedVendorUid', () => {
    const s = buildExportScope({
      role: 'vendedor',
      myUid: UID_PACHI,
      myVendorKey: 'PACHI',
      resolveVendorForClient,
    });
    const out = ids(s.filterPedidos(pedidos));
    expect(out).toContain('P1');
    expect(out).not.toContain('P2'); // ajeno por master
    expect(out).toContain('P4'); // prospecto sin CardCode, vendorAssigned propio
  });
  it('vendedor: no ve un pedido cuyo assignedVendorUid es de otro (aunque el master sea suyo)', () => {
    const s = buildExportScope({
      role: 'vendedor',
      myUid: UID_PACHI,
      myVendorKey: 'PACHI',
      resolveVendorForClient,
    });
    expect(ids(s.filterPedidos(pedidos))).not.toContain('P3');
  });
  it('vendedor sin uid o sin vendorKey: no ve nada', () => {
    expect(
      buildExportScope({ role: 'vendedor', myUid: '', myVendorKey: 'PACHI' }).filterPedidos(pedidos)
    ).toEqual([]);
    expect(
      buildExportScope({ role: 'vendedor', myUid: UID_PACHI, myVendorKey: '' }).filterPedidos(
        pedidos
      )
    ).toEqual([]);
  });
  it('interno: solo clientes de sus parejas (master ∈ su set)', () => {
    const s = buildExportScope({
      role: 'interno',
      myUid: 'uid-ioannis',
      myVendorKey: 'IOANNIS PALKOUDAKIS',
      effectiveVendorSet: new Set([
        'IOANNIS PALKOUDAKIS',
        'FEDERICO CASTELANELLI',
        'gonzalo de la rosa',
      ]),
      resolveVendorForClient,
    });
    expect(ids(s.filterPedidos(pedidos)).sort()).toEqual(['P2', 'P5']);
  });
  it('interno sin set: no ve nada (falla cerrado)', () => {
    const s = buildExportScope({ role: 'interno', myUid: 'u', effectiveVendorSet: null });
    expect(s.filterPedidos(pedidos)).toEqual([]);
  });
  it('admin y gerente: todo, sin tocar', () => {
    for (const role of ['admin', 'gerente']) {
      const s = buildExportScope({ role, myUid: 'x', resolveVendorForClient });
      expect(s.isGlobal).toBe(true);
      expect(s.filterPedidos(pedidos)).toHaveLength(pedidos.length);
    }
  });
  it('ignora nulls del array', () => {
    const s = buildExportScope({ role: 'admin' });
    expect(s.filterPedidos([null, pedidos[0]])).toHaveLength(1);
  });
});

describe('buildExportScope — visitas', () => {
  const visits = [
    { id: 'V1', ownerUid: UID_PACHI, vendor: 'PACHI' },
    { id: 'V2', ownerUid: UID_GONZA, vendor: 'GONZALO DE LA ROSA' },
    { id: 'V3', ownerUid: 'uid-santi', vendor: 'SANTIAGO ESTEBAN', createdByUid: 'uid-santi' },
    // Cargada por Santiago en nombre de Mauricio (ownerUid = Mauricio).
    { id: 'V4', ownerUid: 'uid-mauri', vendor: 'MAURICIO GIL', createdByUid: 'uid-santi' },
    { id: 'V5', ownerUid: 'uid-fede', vendor: 'FEDERICO CASTELANELLI' },
  ];
  it('vendedor: solo las que cargó él (ownerUid)', () => {
    const s = buildExportScope({ role: 'vendedor', myUid: UID_PACHI, myVendorKey: 'PACHI' });
    expect(s.filterVisits(visits).map((v) => v.id)).toEqual(['V1']);
    expect(s.visitsQueryByOwnerUid).toBe(true);
  });
  it('interno: las suyas + las de sus parejas (por uid o por vendor key)', () => {
    const s = buildExportScope({
      role: 'interno',
      myUid: 'uid-santi',
      myVendorKey: 'SANTIAGO ESTEBAN',
      effectiveVendorSet: new Set(['SANTIAGO ESTEBAN', 'MAURICIO GIL', 'PACHI']),
      partnerUids: [UID_PACHI],
    });
    expect(
      s
        .filterVisits(visits)
        .map((v) => v.id)
        .sort()
    ).toEqual(['V1', 'V3', 'V4']);
    expect(s.visitsQueryByOwnerUid).toBe(false);
  });
  it('admin: todas', () => {
    const s = buildExportScope({ role: 'admin' });
    expect(s.filterVisits(visits)).toHaveLength(visits.length);
    expect(s.visitsQueryByOwnerUid).toBe(false);
  });
});

// Fix ronda 1: el resolver devuelve {vendorKey, reason}. Solo los prospectos
// sin CardCode SAP caen al vendorAssigned del pedido; un CardCode que el
// master no resuelve queda afuera (falla cerrado).
describe('fallback a vendorAssigned acotado (fix ronda 1)', () => {
  /** @type {Record<string, {vendorKey: string, reason: string}>} */
  const R = {
    C_ALTA_PROPIA: { vendorKey: 'PACHI', reason: 'ok' },
    // Alta reasignada a otro vendedor: desaparece del approvedAltasList del VDE.
    C_ALTA_REASIG: { vendorKey: '', reason: 'cliente_no_en_master' },
    C_SIN_ZONA: { vendorKey: '', reason: 'zona_sin_vendedor' },
    C_DISTRIB: { vendorKey: '', reason: 'zona_sin_vendedor' }, // __DISTRIBUTOR__
  };
  /** @param {string} cc */
  const resolveObj = (cc) =>
    R[cc] || { vendorKey: '', reason: cc ? 'cliente_no_en_master' : 'input_vacio' };
  const vde = () =>
    buildExportScope({
      role: 'vendedor',
      myUid: UID_PACHI,
      myVendorKey: 'PACHI',
      resolveVendorForClient: resolveObj,
    });
  const base = { assignedVendorUid: UID_PACHI, vendorAssigned: 'PACHI' };

  it('alta reasignada + pedido con UID/vendorAssigned viejos → afuera; alta propia adentro', () => {
    const out = ids(
      vde().filterPedidos([
        { _fsId: 'A1', clientCardCode: 'C_ALTA_REASIG', ...base },
        { _fsId: 'A2', clientCardCode: 'C_ALTA_PROPIA', ...base },
      ])
    );
    expect(out).toEqual(['A2']);
  });
  it('prospecto sin CardCode cae al vendorAssigned', () => {
    expect(ids(vde().filterPedidos([{ _fsId: 'PR', clientName: 'NUEVO', ...base }]))).toEqual([
      'PR',
    ]);
  });
  it('zona sin vendedor (incluido distribuidor): afuera para vendedor e interno', () => {
    const peds = [
      { _fsId: 'Z1', clientCardCode: 'C_SIN_ZONA', ...base },
      { _fsId: 'Z2', clientCardCode: 'C_DISTRIB', ...base },
    ];
    expect(vde().filterPedidos(peds)).toEqual([]);
    const vdi = buildExportScope({
      role: 'interno',
      myUid: 'uid-santi',
      effectiveVendorSet: new Set(['PACHI', 'SANTIAGO ESTEBAN']),
      resolveVendorForClient: resolveObj,
    });
    expect(vdi.filterPedidos(peds)).toEqual([]);
    expect(vdi.filterPedidos([{ _fsId: 'A1', clientCardCode: 'C_ALTA_REASIG', ...base }])).toEqual(
      []
    );
  });
  it('columna Vendedor: zona sin vendedor queda vacía (no cae a lo guardado)', () => {
    expect(
      vendorColumnForPedido(
        { clientCardCode: 'C_SIN_ZONA', vendorAssigned: 'PACHI', ownerVendor: 'X' },
        resolveObj
      )
    ).toBe('');
  });
});

describe('rol desconocido o vacío: no exporta nada (fix ronda 1)', () => {
  for (const role of [null, undefined, '', 'unassigned', 'otro']) {
    it(String(role), () => {
      const s = buildExportScope({ role, myUid: 'x', resolveVendorForClient });
      expect(s.isGlobal).toBe(false);
      expect(s.filterPedidos(pedidos)).toEqual([]);
      expect(s.filterVisits([{ ownerUid: 'x' }])).toEqual([]);
    });
  }
  it('viewer sigue global', () => {
    expect(buildExportScope({ role: 'viewer' }).filterPedidos(pedidos)).toHaveLength(
      pedidos.length
    );
  });
});
