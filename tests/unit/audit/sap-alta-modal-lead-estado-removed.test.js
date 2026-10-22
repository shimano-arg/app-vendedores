// @ts-check
/**
 * v1424 §58 (2026-10-22) — modal "Alta SAP" para leads: bloque "Estado del
 * LEAD" removido (línea Actual + 3 botones). El campo persiste en Firestore
 * (`client_applications.leadEstado` + audits) y la BQ view sigue leyéndolo.
 *
 * Pedido Mariano: eliminar sólo la UI del modal. No borrar campo ni historial.
 *
 * Lugares que usan `leadEstado` (confirmado grep 2026-10-22):
 *   - index.html:openSapAltaInfoModal: SOLO lectura (curLeadEstado) sin render.
 *   - bigquery/views.sql:2081: `JSON_VALUE(data, '$.leadEstado')` para PowerBI.
 *   - firestore.rules:481+: permiso edición VDE propio.
 *   - tests/rules/rules.test.js: tests de rules.
 * NO se usa en: mapa pines, Target Altas, Planner, exports Excel del app.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const BQ_VIEWS = readFileSync('bigquery/views.sql', 'utf8');
const RULES = readFileSync('firestore.rules', 'utf8');

describe('v1424 §58 — bloque "Estado del LEAD" removido del modal Alta SAP', () => {
  it('modal NO renderiza el div "Estado del LEAD"', () => {
    expect(INDEX_HTML).not.toMatch(/>\s*Estado del LEAD\s*</);
  });

  it('modal NO contiene los 3 botones onclick="setLeadEstado(...)"', () => {
    const slice = INDEX_HTML.slice(
      INDEX_HTML.indexOf('function openSapAltaInfoModal'),
      INDEX_HTML.indexOf('v1262 (2026-10-14): boton Ficha Cliente dentro del modal SAP alta')
    );
    expect(slice.length).toBeGreaterThan(500);
    expect(slice).not.toMatch(/setLeadEstado\(\\?'[^']*',\\?'contactado_con_doc'/);
    expect(slice).not.toMatch(/setLeadEstado\(\\?'[^']*',\\?'contactado_sin_doc'/);
    expect(slice).not.toMatch(/setLeadEstado\(\\?'[^']*',\\?'eliminar'/);
  });

  it('modal NO renderiza "Actual:" con el label del leadEstado', () => {
    const slice = INDEX_HTML.slice(
      INDEX_HTML.indexOf('function openSapAltaInfoModal'),
      INDEX_HTML.indexOf('v1262 (2026-10-14): boton Ficha Cliente dentro del modal SAP alta')
    );
    expect(slice).not.toMatch(/>Actual:<\/[^>]+>/);
    expect(slice).not.toMatch(/'Actual:[\s\S]*?LEAD_ESTADO_LABELS/);
  });

  it('comment v1424 §58 explica que el campo persiste + BQ sigue leyéndolo', () => {
    const idx = INDEX_HTML.indexOf('v1424 §58 (2026-10-22): bloque "Estado del LEAD" REMOVIDO');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 800);
    expect(slice).toMatch(/leadEstado.*PERSISTEN|PERSISTEN.*leadEstado/is);
    expect(slice).toMatch(/BigQuery|BQ|PowerBI/);
  });
});

describe('v1424 §58 — campo + helpers preservados (backend intacto)', () => {
  it('función setLeadEstado sigue existiendo (compat futuro)', () => {
    expect(INDEX_HTML).toMatch(/window\.setLeadEstado\s*=\s*function/);
  });

  it('LEAD_ESTADO_LABELS sigue definido (3 estados)', () => {
    expect(INDEX_HTML).toMatch(/window\.LEAD_ESTADO_LABELS\s*=/);
    expect(INDEX_HTML).toMatch(/contactado_con_doc:\s*['"]/);
    expect(INDEX_HTML).toMatch(/contactado_sin_doc:\s*['"]/);
    expect(INDEX_HTML).toMatch(/eliminar:\s*['"]/);
  });

  it('LEAD_ESTADO_COLORS sigue definido', () => {
    expect(INDEX_HTML).toMatch(/window\.LEAD_ESTADO_COLORS\s*=/);
  });

  it('firestore.rules sigue permitiendo update leadEstado por VDE', () => {
    expect(RULES).toMatch(/leadEstado/);
    expect(RULES).toMatch(/leadEstadoBy/);
    expect(RULES).toMatch(/leadEstadoAt/);
  });

  it('BQ view sigue extrayendo $.leadEstado para PowerBI', () => {
    expect(BQ_VIEWS).toMatch(/JSON_VALUE\(data,\s*'\$\.leadEstado'\)/);
  });
});

describe('v1424 §58 — mapa + Target Altas NO dependen de leadEstado', () => {
  // Verifica que el render de pines del mapa + modal Target Altas NO
  // referencian leadEstado → un lead con "contactado_con_doc" se ve igual
  // post-v1424.

  it('render del mapa (drawMarkers / icono) NO usa leadEstado', () => {
    const drawMarkersIdx = INDEX_HTML.indexOf('function drawMarkers');
    if (drawMarkersIdx < 0) {
      // Fallback: buscar por donde se calcule color del marker.
      expect(INDEX_HTML).toMatch(/drawMarkers|updateMarkerColor|setMarkerIcon/);
    }
    // Buscar slice de drawMarkers (aprox 10k chars).
    const slice =
      drawMarkersIdx > 0 ? INDEX_HTML.slice(drawMarkersIdx, drawMarkersIdx + 15000) : '';
    expect(slice).not.toMatch(/leadEstado/);
  });

  it('modal Target Altas (openTargetAltasModal) NO usa leadEstado', () => {
    const idx = INDEX_HTML.indexOf('openTargetAltasModal');
    expect(idx).toBeGreaterThan(0);
    // Target Altas chunk vive en src/domains/cartera-vendor.js o inline — grep
    // amplio.
    const sliceStart = INDEX_HTML.indexOf('function openTargetAltasModal');
    if (sliceStart > 0) {
      const slice = INDEX_HTML.slice(sliceStart, sliceStart + 10000);
      expect(slice).not.toMatch(/leadEstado/);
    }
  });

  it('card del sidebar CLIENTES NO renderiza badge leadEstado (removido en v1266)', () => {
    const idx = INDEX_HTML.indexOf('v396 + v1266 (2026-10-14): badge "Estado del LEAD" REMOVIDO');
    expect(idx).toBeGreaterThan(0);
    const slice = INDEX_HTML.slice(idx, idx + 500);
    expect(slice).toMatch(/REMOVIDO/);
    expect(slice).not.toMatch(/cli-origen-inline[\s\S]{0,200}LEAD_ESTADO_LABELS/);
  });
});
