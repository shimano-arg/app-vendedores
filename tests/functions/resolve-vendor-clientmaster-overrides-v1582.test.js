// @ts-check
/**
 * hotfix 2026-11-25 — `resolveClientVendorServerSide` lee `client_master` +
 * `vendor_overrides` ANTES del pure (approvedAltas). Precedencia §102:
 *   override SHOP > override LOC > override PROV > client_master.vendor >
 *   approvedAltas (fallthrough).
 *
 * Precedente: VDI reportó `INTERNO_CLIENTE_FUERA_DE_PAREJA` sobre pedidos
 * propios. Caso: Mariano reasignaba un cliente via "Reasignar Zonas" (modal
 * Zonas) → escribía `vendor_overrides` → el server leía solo `approvedAltas`
 * + `roles` → la reasignación no se reflejaba → vendorUid != pareja del VDI
 * → gate falso-positivo.
 */
import { describe, expect, it } from 'vitest';
import { resolveClientVendorServerSide } from '../../functions/core/resolve-client-vendor-core.js';

function makeMockDb({ roles, altas, clientMaster, overrides }) {
  return {
    collection(name) {
      return {
        where(field, _op, value) {
          return {
            limit(_n) {
              return this;
            },
            async get() {
              let docs = [];
              if (name === 'roles') {
                docs = (roles || []).filter((r) => r.role === value);
              } else if (name === 'client_applications') {
                docs = (altas || []).filter((a) => a.status === value);
              } else if (name === 'client_master') {
                docs = (clientMaster || []).filter((c) => c[field] === value);
              }
              return {
                empty: docs.length === 0,
                docs: docs.map((d) => ({
                  id: d.uid || d.sapCardCode || d.clientName,
                  data: () => d,
                })),
                forEach(cb) {
                  for (const d of docs)
                    cb({ id: d.uid || d.sapCardCode || d.clientName, data: () => d });
                },
                size: docs.length,
              };
            },
          };
        },
        async get() {
          const docs = name === 'vendor_overrides' ? overrides || [] : [];
          return {
            empty: docs.length === 0,
            forEach(cb) {
              for (const d of docs) cb({ id: d.docId || d.clientName || 'x', data: () => d });
            },
            size: docs.length,
          };
        },
      };
    },
  };
}

const USERS_4 = [
  { uid: 'uid-mauricio', role: 'vendedor', vendor: 'MAURICIO GIL', email: 'mauricio@x' },
  { uid: 'uid-pachi', role: 'vendedor', vendor: 'PACHI', email: 'pachi@x' },
  { uid: 'uid-gonzalo', role: 'vendedor', vendor: 'GONZALO DE LA ROSA', email: 'gonzalo@x' },
  { uid: 'uid-federico', role: 'vendedor', vendor: 'FEDERICO CASTELANELLI', email: 'federico@x' },
];

describe('resolveClientVendorServerSide — client_master + vendor_overrides (§102)', () => {
  it('T1: cliente en client_master sin overrides → usa client_master.vendor', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C001',
          clientName: 'TIENDA X',
          provincia: 'CORDOBA',
          localidad: 'CORDOBA CAPITAL',
          vendor: 'PACHI',
        },
      ],
      overrides: [],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C001' });
    expect(r.vendorKey).toBe('PACHI');
    expect(r.vendorUid).toBe('uid-pachi');
    expect(r.source).toBe('client_master');
  });

  it('T2: override scope=prov → gana sobre client_master.vendor', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C002',
          clientName: 'TIENDA Y',
          provincia: 'CORDOBA',
          localidad: 'VILLA CARLOS PAZ',
          vendor: 'PACHI',
        },
      ],
      overrides: [{ scope: 'prov', province: 'CORDOBA', newVendor: 'MAURICIO GIL' }],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C002' });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe('uid-mauricio');
    expect(r.source).toBe('override_prov');
  });

  it('T3: override scope=loc → gana sobre scope=prov', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C003',
          clientName: 'TIENDA Z',
          provincia: 'CORDOBA',
          localidad: 'VILLA CARLOS PAZ',
          vendor: 'PACHI',
        },
      ],
      overrides: [
        { scope: 'prov', province: 'CORDOBA', newVendor: 'MAURICIO GIL' },
        {
          scope: 'loc',
          province: 'CORDOBA',
          locName: 'VILLA CARLOS PAZ',
          newVendor: 'GONZALO DE LA ROSA',
        },
      ],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C003' });
    expect(r.vendorKey).toBe('GONZALO DE LA ROSA');
    expect(r.source).toBe('override_loc');
  });

  it('T4: override scope=shop → gana sobre loc y prov', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C004',
          clientName: 'TIENDA W',
          provincia: 'CORDOBA',
          localidad: 'VILLA CARLOS PAZ',
          vendor: 'PACHI',
        },
      ],
      overrides: [
        { scope: 'prov', province: 'CORDOBA', newVendor: 'MAURICIO GIL' },
        {
          scope: 'loc',
          province: 'CORDOBA',
          locName: 'VILLA CARLOS PAZ',
          newVendor: 'GONZALO DE LA ROSA',
        },
        { scope: 'shop', clientName: 'TIENDA W', newVendor: 'FEDERICO CASTELANELLI' },
      ],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C004' });
    expect(r.vendorKey).toBe('FEDERICO CASTELANELLI');
    expect(r.source).toBe('override_shop');
  });

  it('T5: cliente NO en client_master → fallthrough al pure (approvedAltas)', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [
        {
          status: 'approved',
          cardCodeSap: 'C005',
          comercio: 'TIENDA NUEVA',
          assignedVendor: 'PACHI',
        },
      ],
      clientMaster: [],
      overrides: [],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C005' });
    expect(r.vendorKey).toBe('PACHI');
    expect(r.vendorUid).toBe('uid-pachi');
  });

  it('T6: client_master con vendor vacío + sin overrides → fallthrough', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [
        {
          status: 'approved',
          cardCodeSap: 'C006',
          comercio: 'TIENDA SIN VENDOR',
          assignedVendor: 'GONZALO DE LA ROSA',
        },
      ],
      clientMaster: [
        {
          sapCardCode: 'C006',
          clientName: 'TIENDA SIN VENDOR',
          provincia: 'CABA',
          localidad: 'CABA',
          vendor: '',
        },
      ],
      overrides: [],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C006' });
    expect(r.vendorKey).toBe('GONZALO DE LA ROSA');
  });

  it('T7: override con newVendor __DISTRIBUTOR__ → zona_sin_vendedor', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C007',
          clientName: 'DISTRIBUIDOR X',
          provincia: 'MENDOZA',
          localidad: 'MENDOZA CAPITAL',
          vendor: 'PACHI',
        },
      ],
      overrides: [{ scope: 'prov', province: 'MENDOZA', newVendor: '__DISTRIBUTOR__' }],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C007' });
    expect(r.reason).toBe('zona_sin_vendedor');
    expect(r.vendorUid).toBe('');
  });

  it('T8: override con label "Z<N> - Nombre" → se normaliza', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          sapCardCode: 'C008',
          clientName: 'TIENDA L',
          provincia: 'CORDOBA',
          localidad: 'CORDOBA',
          vendor: 'PACHI',
        },
      ],
      overrides: [{ scope: 'prov', province: 'CORDOBA', newVendor: 'Z5 - Mauricio Gil' }],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C008' });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe('uid-mauricio');
  });

  it('T9: repro caso Mariano — VDI de Mauricio sobre cliente override_loc Mauricio', async () => {
    // Mariano reasignó la localidad del cliente a Mauricio via Zonas; el VDI
    // de Mauricio carga un pedido para ese cliente. Server resuelve a
    // Mauricio (via override_loc) → el gate `cliente_de_otra_pareja` NO
    // dispara cuando internalPartnerUid del VDI = uid-mauricio.
    const db = makeMockDb({
      roles: USERS_4,
      altas: [
        // Alta vieja decía Pachi.
        {
          status: 'approved',
          cardCodeSap: 'C009',
          comercio: 'CLIENTE VDI MAURI',
          assignedVendor: 'PACHI',
        },
      ],
      clientMaster: [
        // client_master cache sigue siendo el POINT original (Pachi).
        {
          sapCardCode: 'C009',
          clientName: 'CLIENTE VDI MAURI',
          provincia: 'CORDOBA',
          localidad: 'ALTA GRACIA',
          vendor: 'PACHI',
        },
      ],
      overrides: [
        // Override reciente vía "Reasignar Zonas".
        { scope: 'loc', province: 'CORDOBA', locName: 'ALTA GRACIA', newVendor: 'MAURICIO GIL' },
      ],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, cardCode: 'C009' });
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe('uid-mauricio');
    expect(r.source).toBe('override_loc');
  });

  it('T10: client_master por clientName (fallback cuando falta cardCode)', async () => {
    const db = makeMockDb({
      roles: USERS_4,
      altas: [],
      clientMaster: [
        {
          clientName: 'TIENDA SIN SAP CODE',
          provincia: 'CABA',
          localidad: 'CABA',
          vendor: 'FEDERICO CASTELANELLI',
        },
      ],
      overrides: [],
    });
    const r = await resolveClientVendorServerSide({ fbDb: db, clientName: 'TIENDA SIN SAP CODE' });
    expect(r.vendorKey).toBe('FEDERICO CASTELANELLI');
    expect(r.vendorUid).toBe('uid-federico');
  });
});
