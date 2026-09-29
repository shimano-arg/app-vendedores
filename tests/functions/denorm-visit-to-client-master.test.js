// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  clientLocId,
  denormVisitToClientMaster,
  extractLastVisitPayload,
  isNewerOrEqual,
} from '../../functions/core/denorm-visit-to-client-master-core.js';

const FieldValue = {
  serverTimestamp: () => ({ __ts: 'serverTimestamp' }),
};

function makeDbStub({ existing = {} } = {}) {
  const store = { docs: { ...existing }, writes: [] };
  return {
    _store: store,
    collection(name) {
      if (name !== 'client_master') throw new Error('unexpected collection: ' + name);
      return {
        doc(docId) {
          return {
            async get() {
              const d = store.docs[docId];
              return { exists: !!d, data: () => d };
            },
            async set(payload, opts) {
              store.writes.push({ docId, payload, opts });
              store.docs[docId] = { ...(store.docs[docId] || {}), ...payload };
            },
          };
        },
      };
    },
  };
}

describe('clientLocId', () => {
  it('normaliza tildes y no-alphanumeric', () => {
    expect(clientLocId('Buenos Aires', 'San Isidro', 'PescaPlay')).toBe(
      'buenos_aires__san_isidro__pescaplay'
    );
    expect(clientLocId('CÓRDOBA', 'Villa María', 'El Pez Gordo')).toBe(
      'cordoba__villa_maria__el_pez_gordo'
    );
  });
  it('acepta vacíos', () => {
    expect(clientLocId('', '', '')).toBe('____');
  });
});

describe('extractLastVisitPayload', () => {
  it('devuelve null si no hay atributos comerciales', () => {
    const p = extractLastVisitPayload({ fecha: '2026-09-24' }, 'v1');
    expect(p).toBeNull();
  });
  it('extrae subset relevante', () => {
    const p = extractLastVisitPayload(
      {
        fidelidad: 'ALTA',
        tamanos: ['GRANDE', 'MULTIRUBRO'],
        especializaciones: ['PREMIUM'],
        canalCompra: 'PRESENCIAL',
        tipoVenta: 'MOSTRADO',
        fecha: '2026-09-24',
        createdByUid: 'uid1',
        createdByDisplayName: 'Gonzalo',
        createdByEmail: 'gonza@shimano.com',
      },
      'v42'
    );
    expect(p).toEqual({
      fidelidad: 'ALTA',
      tamanos: ['GRANDE', 'MULTIRUBRO'],
      especializaciones: ['PREMIUM'],
      canalCompra: 'PRESENCIAL',
      tipoVenta: 'MOSTRADO',
      fecha: '2026-09-24',
      byUid: 'uid1',
      byDisplayName: 'Gonzalo',
      visitId: 'v42',
    });
  });
  it('fallback legacy: tamano string → tamanos[] cuando no hay array (v1057)', () => {
    const p = extractLastVisitPayload(
      {
        fidelidad: 'ALTA',
        tamano: 'GRANDE, MULTIRUBRO',
        especializacion: 'PREMIUM, AGUA DULCE',
        fecha: '2026-07-01',
      },
      'v-legacy'
    );
    expect(p.tamanos).toEqual(['GRANDE', 'MULTIRUBRO']);
    expect(p.especializaciones).toEqual(['PREMIUM', 'AGUA DULCE']);
  });
  it('prioriza array nuevo sobre legacy string', () => {
    const p = extractLastVisitPayload(
      {
        fidelidad: 'ALTA',
        tamanos: ['CHICA'],
        tamano: 'GRANDE, MULTIRUBRO',
        fecha: '2026-09-01',
      },
      'v-mix'
    );
    expect(p.tamanos).toEqual(['CHICA']);
  });
  it('legacy string vacio o whitespace-only no genera arrays', () => {
    const p = extractLastVisitPayload(
      { fidelidad: 'ALTA', tamano: '', especializacion: '   ', fecha: '2026-07-01' },
      'v-empty'
    );
    expect(p.tamanos).toBeUndefined();
    expect(p.especializaciones).toBeUndefined();
  });
  it('incluye ponderaciones solo si tipoVenta=AMBOS', () => {
    const solo = extractLastVisitPayload(
      {
        fidelidad: 'MEDIA',
        tipoVenta: 'MOSTRADO',
        ponderacionMostrado: 80,
        ponderacionEcommerce: 20,
      },
      'v1'
    );
    expect(solo.ponderacionMostrado).toBeUndefined();
    const ambos = extractLastVisitPayload(
      { fidelidad: 'MEDIA', tipoVenta: 'AMBOS', ponderacionMostrado: 60, ponderacionEcommerce: 40 },
      'v1'
    );
    expect(ambos.ponderacionMostrado).toBe(60);
    expect(ambos.ponderacionEcommerce).toBe(40);
  });
});

describe('isNewerOrEqual', () => {
  it('true si no había prev', () => {
    expect(isNewerOrEqual('2026-09-24', null)).toBe(true);
    expect(isNewerOrEqual('2026-09-24', {})).toBe(true);
  });
  it('true si nueva >= prev', () => {
    expect(isNewerOrEqual('2026-09-24', { fecha: '2026-09-01' })).toBe(true);
    expect(isNewerOrEqual('2026-09-24', { fecha: '2026-09-24' })).toBe(true);
  });
  it('false si nueva < prev', () => {
    expect(isNewerOrEqual('2026-09-01', { fecha: '2026-09-24' })).toBe(false);
  });
});

describe('denormVisitToClientMaster', () => {
  it('skip si falta prov/loc/tienda', async () => {
    const db = makeDbStub();
    const r = await denormVisitToClientMaster(
      { visit: { fidelidad: 'ALTA' }, visitId: 'v1' },
      { db, FieldValue }
    );
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('missing_prov_loc_tienda');
    expect(db._store.writes.length).toBe(0);
  });

  it('skip si visita no trae atributos comerciales (contacto telefónico)', async () => {
    const db = makeDbStub();
    const r = await denormVisitToClientMaster(
      {
        visit: {
          provincia: 'BUENOS AIRES',
          localidad: 'Palermo',
          tienda: 'Pescaplay',
          tipo: 'CONTACTO',
          formaContacto: 'LLAMADA TELEFONICA',
        },
        visitId: 'v1',
      },
      { db, FieldValue }
    );
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no_attributes');
    expect(db._store.writes.length).toBe(0);
  });

  it('escribe lastVisit + metadatos en un doc nuevo', async () => {
    const db = makeDbStub();
    const r = await denormVisitToClientMaster(
      {
        visit: {
          provincia: 'BUENOS AIRES',
          localidad: 'Palermo',
          tienda: 'Pescaplay',
          fidelidad: 'ALTA',
          tamanos: ['GRANDE'],
          canalCompra: 'PRESENCIAL',
          tipoVenta: 'MOSTRADO',
          fecha: '2026-09-24',
          createdByUid: 'uid1',
          createdByEmail: 'gonza@shimano.com',
        },
        visitId: 'v1',
      },
      { db, FieldValue }
    );
    expect(r.status).toBe('ok');
    expect(r.docId).toBe('buenos_aires__palermo__pescaplay');
    expect(db._store.writes.length).toBe(1);
    const w = db._store.writes[0];
    expect(w.payload.lastVisit.fidelidad).toBe('ALTA');
    expect(w.payload.lastVisit.visitId).toBe('v1');
    expect(w.payload.provincia).toBe('BUENOS AIRES');
    expect(w.payload.clientName).toBe('Pescaplay');
    expect(w.payload.updatedBy).toBe('denormVisitToClientMaster');
    expect(w.opts).toEqual({ merge: true });
  });

  it('en doc existente pisa lastVisit pero NO toca vendor/prov/clientName ni updatedAt/By', async () => {
    const docId = 'buenos_aires__palermo__pescaplay';
    const db = makeDbStub({
      existing: {
        [docId]: {
          provincia: 'BUENOS AIRES',
          localidad: 'Palermo',
          clientName: 'Pescaplay',
          vendor: 'admin@shimano.com',
          creditoCheque: 500000,
          cliTipo: 'A',
          lastVisit: {
            fidelidad: 'BAJA',
            fecha: '2026-09-01',
          },
        },
      },
    });
    const r = await denormVisitToClientMaster(
      {
        visit: {
          provincia: 'BUENOS AIRES',
          localidad: 'Palermo',
          tienda: 'Pescaplay',
          fidelidad: 'ALTA',
          tamanos: ['MEDIANA'],
          canalCompra: 'AMBOS',
          tipoVenta: 'AMBOS',
          ponderacionMostrado: 70,
          ponderacionEcommerce: 30,
          fecha: '2026-09-24',
          createdByUid: 'uid2',
          createdByDisplayName: 'Mariano',
        },
        visitId: 'v99',
      },
      { db, FieldValue }
    );
    expect(r.status).toBe('ok');
    const w = db._store.writes[0];
    expect(w.payload.lastVisit.fidelidad).toBe('ALTA');
    expect(w.payload.lastVisit.tamanos).toEqual(['MEDIANA']);
    expect(w.payload.lastVisit.ponderacionMostrado).toBe(70);
    // NO debe pisar campos del admin
    expect(w.payload.provincia).toBeUndefined();
    expect(w.payload.vendor).toBeUndefined();
    expect(w.payload.updatedBy).toBeUndefined();
  });

  it('skip si la visita nueva es más vieja que la lastVisit ya guardada', async () => {
    const docId = 'buenos_aires__palermo__pescaplay';
    const db = makeDbStub({
      existing: {
        [docId]: {
          lastVisit: { fidelidad: 'ALTA', fecha: '2026-09-24' },
        },
      },
    });
    const r = await denormVisitToClientMaster(
      {
        visit: {
          provincia: 'BUENOS AIRES',
          localidad: 'Palermo',
          tienda: 'Pescaplay',
          fidelidad: 'BAJA',
          fecha: '2026-09-01', // más vieja
        },
        visitId: 'vOld',
      },
      { db, FieldValue }
    );
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('older_than_existing');
    expect(db._store.writes.length).toBe(0);
  });

  it('escenario Mariano: 3 visitas BAJA/BAJA/ALTA en orden → queda ALTA', async () => {
    const db = makeDbStub();
    const visits = [
      { fecha: '2026-09-01', fidelidad: 'BAJA', visitId: 'v1' },
      { fecha: '2026-09-10', fidelidad: 'BAJA', visitId: 'v2' },
      { fecha: '2026-09-24', fidelidad: 'ALTA', visitId: 'v3' },
    ];
    for (const v of visits) {
      await denormVisitToClientMaster(
        {
          visit: {
            provincia: 'BUENOS AIRES',
            localidad: 'Palermo',
            tienda: 'Mariano Pesca',
            fidelidad: v.fidelidad,
            fecha: v.fecha,
          },
          visitId: v.visitId,
        },
        { db, FieldValue }
      );
    }
    const docId = 'buenos_aires__palermo__mariano_pesca';
    const finalDoc = db._store.docs[docId];
    expect(finalDoc.lastVisit.fidelidad).toBe('ALTA');
    expect(finalDoc.lastVisit.visitId).toBe('v3');
    expect(finalDoc.lastVisit.fecha).toBe('2026-09-24');
  });
});
