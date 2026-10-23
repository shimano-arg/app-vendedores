// @ts-check
// v1435 (2026-10-23): tests para los textos autoexplicativos del modal
// "Sugerencias de productos" (leyenda, tooltips, etiqueta de match).
// 100% puro: no toca DOM, no monta ningun render; verifica el contenido
// textual que el UI despues inyecta tal cual.
import { describe, expect, it } from 'vitest';
import {
  explicarMatch,
  LEYENDA,
  TOOLTIP_ALTERNATIVAS,
  TOOLTIP_FALTAN,
} from '../../src/pure/sugerencias-explain.js';

describe('LEYENDA', () => {
  it('contiene las dos definiciones clave (estrictos + aproximados)', () => {
    expect(LEYENDA.toLowerCase()).toContain('estrictos');
    expect(LEYENDA.toLowerCase()).toContain('aproximados');
  });

  it('menciona unidades faltantes y sustitutos con stock', () => {
    expect(LEYENDA.toLowerCase()).toMatch(/falta/);
    expect(LEYENDA.toLowerCase()).toContain('sustitutos');
    expect(LEYENDA.toLowerCase()).toContain('stock');
  });

  it('es una sola linea de texto plano, sin markdown ni saltos', () => {
    expect(LEYENDA).not.toMatch(/[*_`#]/);
    expect(LEYENDA).not.toContain('\n');
  });

  it('explica que estrictos = misma familia y caracteristicas', () => {
    expect(LEYENDA.toLowerCase()).toContain('misma familia');
    expect(LEYENDA.toLowerCase()).toContain('caracteristicas');
  });
});

describe('TOOLTIP_FALTAN', () => {
  it('define faltan como "cantidad pedida menos stock libre"', () => {
    const low = TOOLTIP_FALTAN.toLowerCase();
    expect(low).toContain('cantidad pedida');
    expect(low).toContain('stock libre');
  });

  it('menciona el deposito 11 y los buckets que comprometen stock', () => {
    const low = TOOLTIP_FALTAN.toLowerCase();
    expect(low).toContain('deposito 11');
    expect(low).toContain('confirmado');
    expect(low).toContain('backorder');
    expect(low).toContain('asignado');
  });
});

describe('TOOLTIP_ALTERNATIVAS', () => {
  it('define estrictas para canas (tipo + tramos + libraje overlap >=50%)', () => {
    const low = TOOLTIP_ALTERNATIVAS.toLowerCase();
    expect(low).toContain('canas');
    expect(low).toMatch(/tipo/);
    expect(low).toContain('tramos');
    expect(low).toContain('libraje');
    expect(low).toContain('overlap');
    expect(low).toContain('50%');
  });

  it('define estrictas para reels (tipo + tamano + velocidad)', () => {
    const low = TOOLTIP_ALTERNATIVAS.toLowerCase();
    expect(low).toContain('reels');
    expect(low).toContain('tamano');
    expect(low).toContain('velocidad');
  });

  it('define estrictas para lineas (marca + hebras + libraje <=2 lb)', () => {
    const low = TOOLTIP_ALTERNATIVAS.toLowerCase();
    expect(low).toContain('lineas');
    expect(low).toContain('marca');
    expect(low).toContain('hebras');
    expect(low).toMatch(/<=\s*2\s*lb/);
  });

  it('define el fallback no-canas (mismo modelo con precio +-30%)', () => {
    const low = TOOLTIP_ALTERNATIVAS.toLowerCase();
    expect(low).toContain('modelo');
    expect(low).toMatch(/\+-\s*30%|30\s*%/);
  });

  it('explica aproximadas como aflojamiento progresivo', () => {
    const low = TOOLTIP_ALTERNATIVAS.toLowerCase();
    expect(low).toContain('aproximadas');
    expect(low).toContain('afloja');
    expect(low).toContain('mismo tipo');
  });
});

// -----------------------------------------------------------------------------
// explicarMatch: canas
// -----------------------------------------------------------------------------
describe('explicarMatch — canas', () => {
  const orig = {
    familia_motor: 'canas',
    tipo: 'Casting',
    tramos: 2,
    libraje_min: 12,
    libraje_max: 25,
  };

  it('badge ok: coincide tipo + tramos + libraje con overlap >=50%', () => {
    const cand = {
      familia_motor: 'canas',
      tipo: 'Casting',
      tramos: 2,
      libraje_min: 12,
      libraje_max: 25,
    };
    const r = explicarMatch({ mode: 'canas', badge: 'ok', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('estricto');
    expect(r.etiqueta.toLowerCase()).toContain('tipo');
    expect(r.etiqueta.toLowerCase()).toContain('tramos');
    expect(r.etiqueta.toLowerCase()).toContain('libraje');
    expect(r.etiqueta).toContain('>=50%');
    expect(r.difieren).toEqual([]);
    expect(r.coinciden.join(' ').toLowerCase()).toContain('casting');
  });

  it('badge warn1: tipo + tramos coinciden, libraje con overlap <50%', () => {
    const cand = {
      familia_motor: 'canas',
      tipo: 'Casting',
      tramos: 2,
      libraje_min: 20,
      libraje_max: 30,
    };
    const r = explicarMatch({ mode: 'canas', badge: 'warn1', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('aproximado');
    expect(r.difieren.join(' ').toLowerCase()).toContain('libraje');
    expect(r.difieren.join(' ').toLowerCase()).toContain('<50%');
  });

  it('badge warn2: tipo + tramos; se dejo de exigir libraje', () => {
    const cand = { familia_motor: 'canas', tipo: 'Casting', tramos: 2 };
    const r = explicarMatch({ mode: 'canas', badge: 'warn2', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('muy aproximado');
    expect(r.difieren.join(' ').toLowerCase()).toContain('libraje');
    expect(r.coinciden.join(' ').toLowerCase()).toContain('tramos');
  });

  it('badge warn3: solo mismo tipo', () => {
    const cand = { familia_motor: 'canas', tipo: 'Casting', tramos: 1 };
    const r = explicarMatch({ mode: 'canas', badge: 'warn3', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('solo mismo tipo');
    expect(r.difieren.join(' ').toLowerCase()).toContain('tramos');
    expect(r.difieren.join(' ').toLowerCase()).toContain('libraje');
  });
});

// -----------------------------------------------------------------------------
// explicarMatch: reels
// -----------------------------------------------------------------------------
describe('explicarMatch — reels', () => {
  const orig = { familia_motor: 'reels', tipo: 'Spinning', tamano: 4000, velocidad: 'HG' };

  it('badge ok: tipo + tamano + velocidad', () => {
    const cand = { familia_motor: 'reels', tipo: 'Spinning', tamano: 4000, velocidad: 'HG' };
    const r = explicarMatch({ mode: 'reels', badge: 'ok', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('estricto');
    expect(r.coinciden.join(' ').toLowerCase()).toContain('velocidad');
    expect(r.coinciden.join(' ').toLowerCase()).toContain('tamano');
    expect(r.difieren).toEqual([]);
  });

  it('badge warn1: tipo + tamano exacto; velocidad distinta', () => {
    const cand = { familia_motor: 'reels', tipo: 'Spinning', tamano: 4000, velocidad: 'XG' };
    const r = explicarMatch({ mode: 'reels', badge: 'warn1', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('aproximado');
    expect(r.difieren.join(' ').toLowerCase()).toContain('velocidad');
  });

  it('badge warn2: tamano cercano +-30%', () => {
    const cand = { familia_motor: 'reels', tipo: 'Spinning', tamano: 4500, velocidad: 'HG' };
    const r = explicarMatch({ mode: 'reels', badge: 'warn2', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('muy aproximado');
    expect(r.difieren.join(' ').toLowerCase()).toContain('tamano');
    expect(r.difieren.join(' ').toLowerCase()).toContain('30%');
  });

  it('badge warn3: solo mismo tipo', () => {
    const cand = { familia_motor: 'reels', tipo: 'Spinning', tamano: 1000 };
    const r = explicarMatch({ mode: 'reels', badge: 'warn3', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('solo mismo tipo');
    expect(r.difieren.join(' ').toLowerCase()).toContain('tamano');
    expect(r.difieren.join(' ').toLowerCase()).toContain('velocidad');
  });
});

// -----------------------------------------------------------------------------
// explicarMatch: lineas
// -----------------------------------------------------------------------------
describe('explicarMatch — lineas', () => {
  const orig = { familia_motor: 'lineas', marca: 'PowerPro', hebras: 8, libraje: 20 };

  it('badge ok: marca + hebras + libraje <=2 lb', () => {
    const cand = { familia_motor: 'lineas', marca: 'PowerPro', hebras: 8, libraje: 20 };
    const r = explicarMatch({ mode: 'lineas', badge: 'ok', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('estricto');
    expect(r.etiqueta.toLowerCase()).toContain('marca');
    expect(r.etiqueta.toLowerCase()).toContain('hebras');
    expect(r.etiqueta).toContain('<=2 lb');
  });

  it('badge warn1: libraje con diferencia <=5 lb', () => {
    const cand = { familia_motor: 'lineas', marca: 'PowerPro', hebras: 8, libraje: 25 };
    const r = explicarMatch({ mode: 'lineas', badge: 'warn1', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('aproximado');
    expect(r.difieren.join(' ')).toContain('<=5 lb');
  });

  it('badge warn2: marca + hebras, sin libraje', () => {
    const cand = { familia_motor: 'lineas', marca: 'PowerPro', hebras: 8 };
    const r = explicarMatch({ mode: 'lineas', badge: 'warn2', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('muy aproximado');
    expect(r.difieren.join(' ').toLowerCase()).toContain('libraje');
  });

  it('badge warn3: solo misma marca', () => {
    const cand = { familia_motor: 'lineas', marca: 'PowerPro', hebras: 4 };
    const r = explicarMatch({ mode: 'lineas', badge: 'warn3', origAttrs: orig, candAttrs: cand });
    expect(r.etiqueta.toLowerCase()).toContain('solo misma marca');
    expect(r.difieren.join(' ').toLowerCase()).toContain('hebras');
    expect(r.difieren.join(' ').toLowerCase()).toContain('libraje');
  });
});

// -----------------------------------------------------------------------------
// explicarMatch: fallback no-estructurado
// -----------------------------------------------------------------------------
describe('explicarMatch — fallback no-estructurado', () => {
  it('mode fallback_sub: mismo modelo + precio +-30%', () => {
    const r = explicarMatch({ mode: 'fallback_sub', badge: 'ok' });
    expect(r.etiqueta.toLowerCase()).toContain('estricto');
    expect(r.etiqueta.toLowerCase()).toContain('mismo modelo');
    expect(r.etiqueta).toContain('30%');
  });

  it('mode fallback_fam: misma familia, modelo distinto', () => {
    const r = explicarMatch({ mode: 'fallback_fam', badge: 'warn1' });
    expect(r.etiqueta.toLowerCase()).toContain('aproximado');
    expect(r.etiqueta.toLowerCase()).toContain('familia');
    expect(r.difieren.join(' ').toLowerCase()).toContain('modelo');
  });

  it('mode none: devuelve etiqueta vacia (no explica)', () => {
    const r = explicarMatch({ mode: 'none', badge: 'ok' });
    expect(r.etiqueta).toBe('');
    expect(r.coinciden).toEqual([]);
    expect(r.difieren).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Robustez: attrs faltantes no explotan
// -----------------------------------------------------------------------------
describe('explicarMatch — robustez', () => {
  it('canas sin attrs del candidato no explota', () => {
    const r = explicarMatch({ mode: 'canas', badge: 'ok' });
    expect(typeof r.etiqueta).toBe('string');
    expect(r.etiqueta.toLowerCase()).toContain('estricto');
  });

  it('reels sin orig ni cand devuelve etiqueta por nivel', () => {
    const r = explicarMatch({ mode: 'reels', badge: 'warn2' });
    expect(r.etiqueta.toLowerCase()).toContain('muy aproximado');
  });

  it('lineas con null attrs no explota', () => {
    const r = explicarMatch({ mode: 'lineas', badge: 'warn3', origAttrs: null, candAttrs: null });
    expect(r.etiqueta.toLowerCase()).toContain('solo misma marca');
  });
});
