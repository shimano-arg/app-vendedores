// v1565 (2026-11-18): tests de contrato para el refactor del modal Reportes
// Excel. Valida que las 5 opciones eliminadas NO estén más en el modal, que los
// nombres renombrados (VISITAS, Master Clientes, BACKORDER, PEDIDOS DEL MES)
// estén presentes, y que los handlers de los 5 exports modificados declaren
// las columnas exactas que pidió Mariano.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const EXPORTS_CORE = readFileSync(resolve(ROOT, 'src/domains/exports-core.js'), 'utf8');

describe('v1565 §refactor exports — eliminaciones del modal', () => {
  // Slice acotado al <div class="export-options">...</div> para evitar que
  // otros modales/overlays con el mismo texto (ej. tooltips analíticos) hagan
  // falsos positivos.
  const OPTS_OPEN = INDEX_HTML.indexOf('<div class="export-options">');
  const OPTS_CLOSE = INDEX_HTML.indexOf('</div>', OPTS_OPEN + 10000); // suficiente para cerrar
  // Buscar el </div> balanceado: la ultima `</div>` antes del cierre del modal.
  const EXPORT_MODAL_END = INDEX_HTML.indexOf('id="export-month-modal"', OPTS_OPEN);
  const MODAL_SLICE = INDEX_HTML.slice(OPTS_OPEN, EXPORT_MODAL_END);
  void OPTS_CLOSE;

  it('modal NO tiene "Altas de clientes"', () => {
    expect(MODAL_SLICE).not.toMatch(/Altas de clientes/i);
    expect(MODAL_SLICE).not.toMatch(/data-exp-kind="ALTAS"/);
  });

  it('modal NO tiene "Pendiente de Asignación - Pablo"', () => {
    expect(MODAL_SLICE).not.toMatch(/Pendiente de Asignaci/i);
    expect(MODAL_SLICE).not.toMatch(/data-exp-kind="PENDIENTE_ASIG_PABLO"/);
  });

  it('modal NO tiene "Stock Asignado - lineas"', () => {
    expect(MODAL_SLICE).not.toMatch(/data-exp-kind="STOCK_ASIG"/);
    expect(MODAL_SLICE).not.toMatch(/Stock Asignado - l/i);
  });

  it('modal NO tiene "Ventas × artículo × cliente / vendedor"', () => {
    expect(MODAL_SLICE).not.toMatch(/data-exp-kind="VENTAS_ART_CLI"/);
    expect(MODAL_SLICE).not.toMatch(/art.culo.*cliente/i);
  });

  it('modal NO tiene "Infracciones MELI (MAP)"', () => {
    expect(MODAL_SLICE).not.toMatch(/data-exp-kind="INFRACCIONES_MELI"/);
    expect(MODAL_SLICE).not.toMatch(/Infracciones MELI/i);
  });
});

describe('v1565 §refactor exports — nombres renombrados en el modal', () => {
  // Slice acotado al <div class="export-options">...</div> para evitar que
  // otros modales/overlays con el mismo texto (ej. tooltips analíticos) hagan
  // falsos positivos.
  const OPTS_OPEN = INDEX_HTML.indexOf('<div class="export-options">');
  const OPTS_CLOSE = INDEX_HTML.indexOf('</div>', OPTS_OPEN + 10000); // suficiente para cerrar
  // Buscar el </div> balanceado: la ultima `</div>` antes del cierre del modal.
  const EXPORT_MODAL_END = INDEX_HTML.indexOf('id="export-month-modal"', OPTS_OPEN);
  const MODAL_SLICE = INDEX_HTML.slice(OPTS_OPEN, EXPORT_MODAL_END);
  void OPTS_CLOSE;

  it('contiene <h3>VISITAS</h3>', () => {
    expect(MODAL_SLICE).toMatch(/<h3>VISITAS<\/h3>/);
  });

  it('contiene <h3>Master Clientes</h3>', () => {
    expect(MODAL_SLICE).toMatch(/<h3>Master Clientes<\/h3>/);
  });

  it('contiene <h3>BACKORDER</h3>', () => {
    expect(MODAL_SLICE).toMatch(/<h3>BACKORDER<\/h3>/);
  });

  it('contiene <h3>PEDIDOS DEL MES</h3>', () => {
    expect(MODAL_SLICE).toMatch(/<h3>PEDIDOS DEL MES<\/h3>/);
  });

  it('contiene <h3>Rendiciones</h3> (sin renombre)', () => {
    expect(MODAL_SLICE).toMatch(/<h3>Rendiciones<\/h3>/);
  });

  it('contiene Lista de precios - disponible (sin cambio)', () => {
    expect(MODAL_SLICE).toMatch(/<h3>Lista de precios - disponible<\/h3>/);
  });
});

describe('v1565 §refactor exports — columnas exactas por export', () => {
  it('Rendiciones: headers nuevos exactos (FECHA_DE_RENDICION..ESTADO)', () => {
    const needles = [
      "header: 'FECHA_DE_RENDICION'",
      "header: 'TIPO'",
      "header: 'VENDEDOR'",
      "header: 'CONCEPTO'",
      "header: 'N° TICKET'",
      "header: 'TIPO_DE_GASTO'",
      "header: 'IMPORTE'",
      "header: 'OBSERVACIONES'",
      "header: 'FOTO_TICKET'",
      "header: 'ESTADO'",
    ];
    for (const n of needles) expect(EXPORTS_CORE).toContain(n);
  });

  it('VISITAS: headers nuevos (FECHA_DE_VISITAS..FOTO_FRENTE) + worksheet "VISITAS"', () => {
    const needles = [
      "header: 'FECHA_DE_VISITAS'",
      "header: 'VENDEDOR'",
      "header: 'INTERACCION'",
      "header: 'TIPO'",
      "header: 'LOCAL'",
      "header: 'TAMAÑO'",
      "header: 'FIDELIDAD'",
      "header: 'RELEVANCIA'",
      "header: 'POP'",
      "header: 'MAS_VENDIDO'",
      "header: 'MAS_PREGUNTAN'",
      "header: 'AYUDA_TIENDA'",
      "header: 'TIPO_DE_VENTA'",
      "header: 'PONDERACION_MOSTRADOR'",
      "header: 'PONDERACION_ECOMMERCE'",
      "header: 'FOTO_FRENTE'",
    ];
    for (const n of needles) expect(EXPORTS_CORE).toContain(n);
    expect(EXPORTS_CORE).toMatch(/addWorksheet\('VISITAS'/);
  });

  it('PEDIDOS DEL MES: shape de rows + nombre de archivo + worksheet', () => {
    expect(EXPORTS_CORE).toMatch(/FECHA_DE_PEDIDO:/);
    expect(EXPORTS_CORE).toMatch(/CLIENTE:/);
    expect(EXPORTS_CORE).toMatch(/ID_PEDIDO:/);
    expect(EXPORTS_CORE).toMatch(/NOMBRE_DEL_PRODUCTO:/);
    expect(EXPORTS_CORE).toMatch(/CANTIDAD:/);
    expect(EXPORTS_CORE).toMatch(/SUBTOTAL:/);
    expect(EXPORTS_CORE).toMatch(/LOCALIDAD:/);
    expect(EXPORTS_CORE).toContain("'PEDIDOS DEL MES_'");
    expect(EXPORTS_CORE).toContain("name: 'PEDIDOS DEL MES'");
  });

  it('BACKORDER: 2 hojas con nombres exactos', () => {
    expect(EXPORTS_CORE).toContain("name: 'Backorder_Clientes'");
    expect(EXPORTS_CORE).toContain("name: 'Backorder_SKU'");
    expect(EXPORTS_CORE).toContain("'BACKORDER_'");
  });

  it('BACKORDER Backorder_Clientes: columnas exactas', () => {
    // Las rows se construyen con el shape literal — grep.
    expect(EXPORTS_CORE).toMatch(/SKU:/);
    expect(EXPORTS_CORE).toMatch(/NOMBRE_DEL_PRODUCTO:/);
    expect(EXPORTS_CORE).toMatch(/CANTIDAD_BACKORDER:/);
    expect(EXPORTS_CORE).toMatch(/CLIENTE:/);
    expect(EXPORTS_CORE).toMatch(/ID_PEDIDO:/);
  });

  it('BACKORDER Backorder_SKU: PROMEDIO_VENTA_3M presente (vacío por diseño)', () => {
    expect(EXPORTS_CORE).toMatch(/PROMEDIO_VENTA_3M:/);
  });

  it('Master Clientes: 17 columnas exactas del remap', () => {
    const needles = [
      'CARDCODE_SAP:',
      'NOMBRE_TIENDA:',
      'TIPO_CLIENTE:',
      'PROVINCIA:',
      'LOCALIDAD:',
      'DIRECCION:',
      'TIPO_DE_CLIENTE:',
      "'TAMAÑO':",
      'ESPECIALIZACION:',
      'TIPO_DE_LOCAL:',
      'PREFERENCIAS_CONTACTO:',
      'CREDITO_CHEQUE:',
      'FACTURACION_ACUMULADA_12MESES:',
      "'FRECUENCIA_COMPRA(DIAS)':",
      'ULTIMA_COMPRA:',
      'VENDEDOR_ASIGNADO:',
      "'ULTIMA_VISITA/CONTACTO_FECHA':",
    ];
    for (const n of needles) expect(EXPORTS_CORE).toContain(n);
    expect(EXPORTS_CORE).toContain("name: 'Master Clientes'");
    expect(EXPORTS_CORE).toContain("'Master Clientes_'");
  });
});

describe('v1565 §refactor exports — dispatcher reducido', () => {
  it("showMonthPicker dispatcher NO tiene 'ALTAS'", () => {
    expect(EXPORTS_CORE).not.toMatch(/else if \(tipo === 'ALTAS'\)/);
  });

  it("dispatcher NO tiene 'VENTAS_ART_CLI'", () => {
    expect(EXPORTS_CORE).not.toMatch(/else if \(tipo === 'VENTAS_ART_CLI'\)/);
  });

  it("dispatcher NO tiene 'STOCK_ASIG'", () => {
    expect(EXPORTS_CORE).not.toMatch(/else if \(tipo === 'STOCK_ASIG'\)/);
  });

  it('dispatcher mantiene BACKORDER + PEDIDOS_MES + VISITAS + RENDICIONES', () => {
    expect(EXPORTS_CORE).toMatch(/tipo === 'BACKORDER'/);
    expect(EXPORTS_CORE).toMatch(/tipo === 'PEDIDOS_MES'/);
    expect(EXPORTS_CORE).toMatch(/tipo === 'VISITAS'/);
    expect(EXPORTS_CORE).toMatch(/tipo === 'RENDICIONES'/);
  });
});
