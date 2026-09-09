// @ts-check
/**
 * Tests para el detector de duplicados de rendiciones.
 * Los 7 casos reales del audit agosto/septiembre 2026 son fixtures.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizarTicket,
  parseCuitDeObservaciones,
  clavesDeDuplicado,
  chequearMatchDuplicado,
} from '../../src/pure/rendicion-duplicate.js';

// ============================================================
// normalizarTicket
// ============================================================
describe('normalizarTicket', () => {
  it('normaliza ceros a la izquierda por segmento', () => {
    expect(normalizarTicket('00011-00001442')).toBe('11-1442');
    expect(normalizarTicket('00017-00006675')).toBe('17-6675');
  });

  it('mismo canonico para distinta cantidad de ceros', () => {
    // Caso real del audit: 0015-00000115 vs 00015-00000115.
    expect(normalizarTicket('0015-00000115')).toBe('15-115');
    expect(normalizarTicket('00015-00000115')).toBe('15-115');
    expect(normalizarTicket('0015-00000115')).toBe(normalizarTicket('00015-00000115'));
  });

  it('trim + uppercase', () => {
    expect(normalizarTicket('  0015-115  ')).toBe('15-115');
    expect(normalizarTicket('a1b-002')).toBe('A1B-2');
  });

  it('normaliza separadores (espacio, /, \\) a guion', () => {
    expect(normalizarTicket('0015 / 00000115')).toBe('15-115');
    expect(normalizarTicket('0015\\115')).toBe('15-115');
    expect(normalizarTicket('0015 115')).toBe('15-115');
  });

  it('sin guiones no adivina donde partir', () => {
    // Regla explicita: si no viene con separador, dejamos como 1 solo segmento.
    // "0015115" NO debe interpretarse como "15-115" — eso sería inventar.
    expect(normalizarTicket('0015115')).toBe('15115');
  });

  it('preserva un segmento de puro ceros como "0"', () => {
    expect(normalizarTicket('000-115')).toBe('0-115');
    expect(normalizarTicket('115-000')).toBe('115-0');
  });

  it('vacio, null, undefined → null', () => {
    expect(normalizarTicket('')).toBe(null);
    expect(normalizarTicket('   ')).toBe(null);
    expect(normalizarTicket(null)).toBe(null);
    expect(normalizarTicket(undefined)).toBe(null);
    expect(normalizarTicket('-')).toBe(null);
    expect(normalizarTicket(' - - ')).toBe(null);
  });

  it('multiples guiones consecutivos se colapsan', () => {
    expect(normalizarTicket('0015---115')).toBe('15-115');
  });
});

// ============================================================
// parseCuitDeObservaciones
// ============================================================
describe('parseCuitDeObservaciones', () => {
  it('extrae CUIT con guiones estilo AFIP', () => {
    expect(parseCuitDeObservaciones('CUIT proveedor: 30-71234567-8')).toBe('30712345678');
    expect(parseCuitDeObservaciones('CUIT del proveedor: 30-71234567-8')).toBe('30712345678');
  });

  it('extrae CUIT sin guiones', () => {
    expect(parseCuitDeObservaciones('CUIT proveedor: 30712345678')).toBe('30712345678');
    expect(parseCuitDeObservaciones('CUIT: 30712345678')).toBe('30712345678');
  });

  it('case insensitive', () => {
    expect(parseCuitDeObservaciones('cuit proveedor: 30-71234567-8')).toBe('30712345678');
    expect(parseCuitDeObservaciones('Cuit del Proveedor: 30712345678')).toBe('30712345678');
  });

  it('tolera separadores mixtos', () => {
    expect(parseCuitDeObservaciones('cuit prov: 30-71234567/8')).toBe('30712345678');
    expect(parseCuitDeObservaciones('CUIT: 30 71234567 8')).toBe('30712345678');
  });

  it('extrae de un contexto mas grande', () => {
    const obs = 'Ticket cargado. Total $6600. CUIT proveedor: 30-71234567-8. Fecha 2026-08-20.';
    expect(parseCuitDeObservaciones(obs)).toBe('30712345678');
  });

  it('retorna null si no encuentra CUIT', () => {
    expect(parseCuitDeObservaciones('total: $6600, sin cuit info')).toBe(null);
    expect(parseCuitDeObservaciones('COMBUSTIBLE YPF - 30/07')).toBe(null);
    expect(parseCuitDeObservaciones('')).toBe(null);
    expect(parseCuitDeObservaciones(null)).toBe(null);
    expect(parseCuitDeObservaciones(undefined)).toBe(null);
  });

  it('retorna null si CUIT no tiene exactamente 11 digitos', () => {
    expect(parseCuitDeObservaciones('CUIT: 3071234567')).toBe(null); // 10
    expect(parseCuitDeObservaciones('CUIT: 307123456789')).toBe(null); // 12
  });
});

// ============================================================
// clavesDeDuplicado — casos reales del audit
// ============================================================
describe('clavesDeDuplicado — casos reales agosto/septiembre 2026', () => {
  /**
   * CASO 1: doble-pago Ticket 00011-00001442 mauricio $6.600 aprobado 2x.
   * Fue aprobado el 20/08 y de nuevo el 31/08 (fechas de carga distintas).
   * DEBE matchear FUERTE.
   */
  it('Caso 1: doble-pago 00011-00001442 $6.600 → match FUERTE', () => {
    const primera = {
      numeroTicket: '00011-00001442',
      importe: 6600,
      observaciones: 'Comida. CUIT proveedor: 30-71234567-8',
      fechaTicket: '2026-08-19',
    };
    const segunda = {
      numeroTicket: '00011-00001442',
      importe: 6600,
      observaciones: 'Almuerzo. CUIT proveedor: 30712345678', // mismo cuit distinto formato
      fechaTicket: '2026-08-19',
    };
    const match = chequearMatchDuplicado(primera, segunda);
    expect(match).not.toBeNull();
    expect(match?.strength).toBe('strong');
  });

  /**
   * CASO 2: doble-pago Ticket 00017-00006675 mauricio $22.000, aprobado
   * como CORPORATIVA y despues como RECARGABLE (modo pago distinto).
   */
  it('Caso 2: doble-pago 00017-00006675 $22.000 (modo pago distinto) → match FUERTE', () => {
    const corporativa = {
      numeroTicket: '00017-00006675',
      importe: 22000,
      modoPago: 'CORPORATIVA',
      observaciones: 'CUIT: 30-71234567-8',
    };
    const recargable = {
      numeroTicket: '00017-00006675',
      importe: 22000,
      modoPago: 'RECARGABLE',
      observaciones: 'CUIT: 30-71234567-8',
    };
    const match = chequearMatchDuplicado(corporativa, recargable);
    expect(match?.strength).toBe('strong');
  });

  /**
   * CASO 3: mismo ticket con distinta cantidad de ceros (patron real).
   */
  it('Caso 3: 0015-115 vs 00015-115 mismo importe → match FUERTE', () => {
    const a = { numeroTicket: '0015-00000115', importe: 5000, observaciones: '' };
    const b = { numeroTicket: '00015-00000115', importe: 5000, observaciones: '' };
    const match = chequearMatchDuplicado(a, b);
    expect(match?.strength).toBe('strong');
  });

  /**
   * CASO 4: mismo comprobante con conceptos DISTINTOS (COMIDA vs COMBUSTIBLE).
   * El concepto NO forma parte de la clave, asi que debe matchear.
   */
  it('Caso 4: mismo ticket con conceptos distintos → match FUERTE', () => {
    const comida = {
      numeroTicket: '00011-00001442',
      importe: 6600,
      descripcion: 'COMIDA',
      observaciones: 'CUIT: 30-71234567-8',
    };
    const combustible = {
      numeroTicket: '00011-00001442',
      importe: 6600,
      descripcion: 'COMBUSTIBLE',
      observaciones: 'CUIT: 30-71234567-8',
    };
    const match = chequearMatchDuplicado(comida, combustible);
    expect(match?.strength).toBe('strong');
  });

  /**
   * CASO 5-8: 4 peajes de $2.800 el mismo dia, mauricio, cada uno con
   * ticket DISTINTO. Son legitimos y NO deben bloquearse.
   * (a) y (b) no matchean porque los tickets son distintos.
   * (c) DEBIL podria matchear por importe + fecha + CUIT, pero solo advierte,
   * no bloquea.
   */
  it('Caso 5-8: 4 peajes $2.800 mismo dia con tickets distintos → NO match FUERTE', () => {
    const peaje1 = {
      numeroTicket: '00001-00000001',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    const peaje2 = {
      numeroTicket: '00001-00000002',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    const peaje3 = {
      numeroTicket: '00001-00000003',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    const peaje4 = {
      numeroTicket: '00001-00000004',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    // Ninguna combinacion debe dar match FUERTE.
    const pairs = [
      [peaje1, peaje2],
      [peaje1, peaje3],
      [peaje1, peaje4],
      [peaje2, peaje3],
      [peaje2, peaje4],
      [peaje3, peaje4],
    ];
    for (const [a, b] of pairs) {
      const m = chequearMatchDuplicado(a, b);
      // Puede haber match DEBIL (cuit+importe+fecha), pero NO FUERTE.
      expect(m?.strength).not.toBe('strong');
    }
  });

  it('Caso 5-8 bis: los 4 peajes DAN match DEBIL — solo advertir', () => {
    // Confirmamos que la regla (c) SI dispara aunque no bloquee.
    const peaje1 = {
      numeroTicket: '00001-00000001',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    const peaje2 = {
      numeroTicket: '00001-00000002',
      importe: 2800,
      observaciones: 'Peaje. CUIT: 30-70000001-1',
      fechaTicket: '2026-08-15',
    };
    const m = chequearMatchDuplicado(peaje1, peaje2);
    expect(m?.strength).toBe('weak');
  });

  it('Caso 5-8 ter: si los peajes NO tienen CUIT en obs, tampoco match DEBIL', () => {
    // Sin CUIT no aplica la regla (c) — silencio total.
    const peaje1 = {
      numeroTicket: '00001-00000001',
      importe: 2800,
      observaciones: 'Peaje autopista',
      fechaTicket: '2026-08-15',
    };
    const peaje2 = {
      numeroTicket: '00001-00000002',
      importe: 2800,
      observaciones: 'Peaje autopista',
      fechaTicket: '2026-08-15',
    };
    const m = chequearMatchDuplicado(peaje1, peaje2);
    expect(m).toBeNull();
  });
});

// ============================================================
// clavesDeDuplicado — edge cases y estructura de salida
// ============================================================
describe('clavesDeDuplicado — edge cases', () => {
  it('rendicion sin numeroTicket → no genera claves fuertes', () => {
    const r = {
      importe: 5000,
      observaciones: 'CUIT: 30-71234567-8',
      fechaTicket: '2026-08-20',
    };
    const claves = clavesDeDuplicado(r);
    expect(claves.fuertes).toHaveLength(0);
    // (c) DEBIL puede aplicar si hay cuit + importe + fecha.
    expect(claves.debiles).toHaveLength(1);
    expect(claves.debiles[0]).toMatch(/^weak:cuit-importe-fecha:/);
  });

  it('rendicion sin CUIT + sin ticket → sin claves (nada que chequear)', () => {
    const r = { importe: 5000, observaciones: '', fechaTicket: '2026-08-20' };
    const claves = clavesDeDuplicado(r);
    expect(claves.fuertes).toHaveLength(0);
    expect(claves.debiles).toHaveLength(0);
  });

  it('rendicion con ticket + importe sin CUIT → solo clave (b) fuerte', () => {
    const r = {
      numeroTicket: '00011-1442',
      importe: 6600,
      observaciones: 'Sin cuit info',
    };
    const claves = clavesDeDuplicado(r);
    expect(claves.fuertes).toHaveLength(1);
    expect(claves.fuertes[0]).toMatch(/^strong:ticket-importe:11-1442\|6600$/);
    expect(claves.debiles).toHaveLength(0);
  });

  it('importe redondeado a entero (evita ruido decimal OCR)', () => {
    const a = { numeroTicket: '00011-1442', importe: 6600.4 };
    const b = { numeroTicket: '00011-1442', importe: 6600 };
    const m = chequearMatchDuplicado(a, b);
    expect(m?.strength).toBe('strong');
  });

  it('importe 0 o negativo → clave no aplica', () => {
    const r0 = { numeroTicket: '00011-1442', importe: 0 };
    const rneg = { numeroTicket: '00011-1442', importe: -100 };
    const rnull = { numeroTicket: '00011-1442', importe: null };
    expect(clavesDeDuplicado(r0).fuertes).toHaveLength(0);
    expect(clavesDeDuplicado(rneg).fuertes).toHaveLength(0);
    expect(clavesDeDuplicado(rnull).fuertes).toHaveLength(0);
  });

  it('fechaTicket vs fecha — acepta ambos campos', () => {
    const a = {
      importe: 2800,
      observaciones: 'CUIT: 30-71234567-8',
      fechaTicket: '2026-08-15',
    };
    const b = {
      importe: 2800,
      observaciones: 'CUIT: 30-71234567-8',
      fecha: '2026-08-15', // campo alternativo (docs viejos)
    };
    const m = chequearMatchDuplicado(a, b);
    expect(m?.strength).toBe('weak');
  });

  it('shape del retorno es {fuertes, debiles} siempre arrays', () => {
    const claves = clavesDeDuplicado({});
    expect(claves).toEqual({ fuertes: [], debiles: [] });
    expect(Array.isArray(claves.fuertes)).toBe(true);
    expect(Array.isArray(claves.debiles)).toBe(true);
  });

  it('null / undefined como input no crashea', () => {
    // @ts-expect-error test defensive
    expect(clavesDeDuplicado(null)).toEqual({ fuertes: [], debiles: [] });
    // @ts-expect-error test defensive
    expect(clavesDeDuplicado(undefined)).toEqual({ fuertes: [], debiles: [] });
  });
});
