// @ts-check
/**
 * v1408 §46 — tests del fix "vendedor via zona".
 * Casos reales reportados: COLLI RAMON ROBERTO (C20116066670, Z5=Mauricio)
 * y S.A. ANGEL BARALDO CIA. (orden 476).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  enrichPayloadWithClientVendor,
  formatAssignedVendorReason,
  resolveClientVendorFromMaster,
} from '../../../src/pure/resolve-client-vendor.js';

// VDE_VENDOR_KEYS reales de prod (index.html:31890).
const VDE_KEYS = ['MAURICIO GIL', 'PACHI', 'GONZALO DE LA ROSA', 'FEDERICO CASTELANELLI'];

const MAURICIO_UID = 'uid-mauricio';
const FEDE_UID = 'uid-federico';
const PABLO_UID = 'uid-pablo';

const USERS = [
  // VDEs (role='vendedor' en roles)
  {
    uid: MAURICIO_UID,
    email: 'mauricio.gil@shimano.com.ar',
    vendorKey: 'MAURICIO GIL',
    role: 'vendedor',
  },
  {
    uid: FEDE_UID,
    email: 'federico@shimano.com.ar',
    vendorKey: 'FEDERICO CASTELANELLI',
    role: 'vendedor',
  },
  // Gerente (Pablo)
  { uid: PABLO_UID, email: 'pablo@shimano.com.ar', vendorKey: 'GERENTE_pablo', role: 'gerente' },
];

const POINTS = [
  {
    province: 'CORDOBA',
    name: 'CORDOBA',
    vendor: 'MAURICIO GIL',
    clients: ['COLLI RAMON ROBERTO'],
  },
  {
    province: 'BUENOS AIRES',
    name: 'VICENTE LOPEZ',
    vendor: '__DISTRIBUTOR__',
    clients: ['S.A. ANGEL BARALDO CIA.'],
  },
  {
    province: 'BUENOS AIRES',
    name: 'LA PLATA',
    vendor: 'FEDERICO CASTELANELLI',
    clients: ['ALBERTO PONTORIERO'],
  },
];

const CARD_CODE_MAP = {
  'COLLI RAMON ROBERTO': 'C20116066670',
  'S.A. ANGEL BARALDO CIA.': 'C20225344561',
  'ALBERTO PONTORIERO': 'C20175569635',
};

const deps = {
  points: POINTS,
  users: USERS,
  getEffectiveVendorForClient: (p) => p.vendor || '',
  sapGetClienteCode: (n) => CARD_CODE_MAP[n] || '',
};

describe('v1408 §46 — casos reales reportados', () => {
  it('COLLI RAMON ROBERTO (orden 384, C20116066670) → MAURICIO GIL con UID', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: 'COLLI RAMON ROBERTO',
      ...deps,
    });
    expect(r.resolved).toBe(true);
    expect(r.vendorKey).toBe('MAURICIO GIL');
    expect(r.vendorUid).toBe(MAURICIO_UID);
    expect(r.vendorEmail).toBe('mauricio.gil@shimano.com.ar');
    expect(r.reason).toBe('ok');
  });

  it('S.A. ANGEL BARALDO CIA. (orden 476, __DISTRIBUTOR__) → sin vendedor: zona sin vendedor', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20225344561',
      clientName: 'S.A. ANGEL BARALDO CIA.',
      ...deps,
    });
    expect(r.resolved).toBe(false);
    expect(r.reason).toBe('zona_sin_vendedor');
    expect(formatAssignedVendorReason(r.reason)).toBe('zona sin vendedor');
  });

  it('cliente de Federico (ALBERTO PONTORIERO) → UID Federico', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20175569635',
      clientName: 'ALBERTO PONTORIERO',
      ...deps,
    });
    expect(r.vendorUid).toBe(FEDE_UID);
    expect(r.vendorKey).toBe('FEDERICO CASTELANELLI');
  });
});

describe('v1408 §46 — motivos "sin vendedor" diferenciados', () => {
  it('cliente sin zona (no en POINTS) → cliente_no_en_master', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C99999999999',
      clientName: 'DESCONOCIDO',
      ...deps,
    });
    expect(r.reason).toBe('cliente_no_en_master');
    expect(formatAssignedVendorReason(r.reason)).toBe('cliente sin zona');
  });

  it('zona sin vendedor (point.vendor vacío) → zona_sin_vendedor', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C00000000001',
      clientName: 'XYZ',
      ...deps,
      points: [{ province: 'X', name: 'Y', vendor: '', clients: ['XYZ'] }],
      sapGetClienteCode: () => 'C00000000001',
    });
    expect(r.reason).toBe('zona_sin_vendedor');
    expect(formatAssignedVendorReason(r.reason)).toBe('zona sin vendedor');
  });
});

describe('v1408 §46 — cardCode normalización', () => {
  const casos = [
    { label: 'con espacios', cardCode: '  C20116066670  ' },
    { label: 'minúsculas', cardCode: 'c20116066670' },
    { label: 'mixed case + newline', cardCode: 'C20116066670\n' },
  ];
  for (const c of casos) {
    it('cardCode "' + c.label + '" resuelve a MAURICIO GIL igual que canónico', () => {
      const r = resolveClientVendorFromMaster({
        cardCode: c.cardCode,
        clientName: '',
        ...deps,
      });
      expect(r.vendorKey).toBe('MAURICIO GIL');
      expect(r.vendorUid).toBe(MAURICIO_UID);
    });
  }

  it('getCardCode del master devuelve con espacios → match igual (normaliza ambos lados)', () => {
    const r = resolveClientVendorFromMaster({
      cardCode: 'C20116066670',
      clientName: '',
      ...deps,
      sapGetClienteCode: (n) => (n === 'COLLI RAMON ROBERTO' ? '  c20116066670  ' : ''),
    });
    expect(r.vendorKey).toBe('MAURICIO GIL');
  });
});

describe('v1408 §46 — card Planner NO renderiza "Cargado por"', () => {
  // Lee el bloque renderPlannerCard del index.html y confirma que no incluye
  // literal "Cargado por" como parte del HTML de la card.
  const INDEX_HTML = readFileSync('index.html', 'utf8');

  it('renderPlannerCard no genera HTML con "Cargado por"', () => {
    // Buscamos el inicio y fin de la función.
    const start = INDEX_HTML.indexOf('function renderPlannerCard');
    expect(start).toBeGreaterThan(0);
    // El final: la próxima función top-level.
    const nextFn = INDEX_HTML.indexOf('\nfunction ', start + 1);
    const chunk = INDEX_HTML.slice(start, nextFn > 0 ? nextFn : start + 8000);
    // Debe aparecer en el comentario / tooltip pero NO en una línea de output HTML
    // como "'<div class=\"planner-card-cargado\"'...".
    expect(chunk).not.toMatch(/planner-card-cargado/);
    expect(chunk).not.toMatch(/Cargado por:\s*' \+ escapeHtml/);
    // Doble safety: el string "Cargado por:" no se concatena al HTML.
    expect(chunk).not.toMatch(/'<div[^']*Cargado por/);
  });

  it('renderPlannerCard sigue teniendo línea del vendor + fecha', () => {
    const start = INDEX_HTML.indexOf('function renderPlannerCard');
    const chunk = INDEX_HTML.slice(start, start + 8000);
    expect(chunk).toMatch(/planner-card-meta/);
    expect(chunk).toMatch(/escapeHtml\(fecha\)/);
  });
});

describe('v1408 §46 — payload enriquecido incluye assignedVendorReason', () => {
  it('COLLI → payload.assignedVendorReason=ok', () => {
    const payload = {
      clientName: 'COLLI RAMON ROBERTO',
      clientCardCode: 'C20116066670',
      ownerUid: PABLO_UID,
      ownerEmail: 'pablo@shimano.com.ar',
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      ...deps,
    });
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.assignedVendorReason).toBe('ok');
    expect(payload.assignedVendorUid).toBe(MAURICIO_UID);
  });

  it('BARALDO → payload.assignedVendorReason=zona_sin_vendedor', () => {
    const payload = {
      clientName: 'S.A. ANGEL BARALDO CIA.',
      clientCardCode: 'C20225344561',
      ownerUid: PABLO_UID,
    };
    const res = resolveClientVendorFromMaster({
      cardCode: payload.clientCardCode,
      clientName: payload.clientName,
      ...deps,
    });
    enrichPayloadWithClientVendor(payload, res);
    expect(payload.assignedVendorReason).toBe('zona_sin_vendedor');
    expect(payload.vendorAssigned).toBe('');
  });
});
