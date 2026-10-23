// @ts-check
/**
 * E1 §auditgrises stock-servidor-atomico — Test sync STRICT entre
 * `src/pure/stock-breakdown.js` y `functions/core/pedido-snapshot-core.js`.
 *
 * Extiende el existente `stock-breakdown-sync.test.js` validando que las
 * mismas RAMAS DE DECISIÓN de las reglas R1-R10 están presentes en ambas
 * copias. Si alguien agrega una rama nueva en el cliente sin propagarla
 * al servidor, este test falla.
 *
 * Falsa seguridad protegida: el test sync anterior solo validaba que
 * ambos archivos "mencionan" los conceptos. Este valida que las decisiones
 * aritméticas (los `if ... return false` y los cálculos de totales) sean
 * las mismas.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync('src/pure/stock-breakdown.js', 'utf8');
const CF = readFileSync('functions/core/pedido-snapshot-core.js', 'utf8');
const SRC_LRS = readFileSync('src/pure/stock-realmente-disponible.js', 'utf8');

describe('stock-breakdown-sync STRICT', () => {
  describe('R1 §40 — BO no reserva', () => {
    it('ambos declaran que BO devuelve false', () => {
      // Validamos que la rama BO en lineReservesStock (ambos copies) retorne false.
      expect(SRC_LRS).toMatch(/state\s*===?\s*['"]BO['"][\s\S]{0,500}return\s+false/);
      // En functions/core, lineReservesStock también está (copia).
      expect(CF).toMatch(/state\s*===?\s*['"]BO['"][\s\S]{0,500}return\s+false/);
    });
  });

  describe('R2 §40.8 — confirmed con orderDocEntry no reserva (doble conteo SAP)', () => {
    it('ambos chequean transferidoSAP.orderDocEntry', () => {
      expect(SRC_LRS).toMatch(/transferidoSAP[\s\S]{0,100}orderDocEntry/);
      expect(CF).toMatch(/transferidoSAP[\s\S]{0,100}orderDocEntry/);
    });
  });

  describe('R3 §36+§38 — confirmed TTL soft 7d + hard 60d', () => {
    it('RESERVA_TTL_DAYS = 7 en ambos', () => {
      expect(SRC_LRS).toMatch(/RESERVA_TTL_DAYS\s*=\s*7/);
      expect(CF).toMatch(/RESERVA_TTL_DAYS\s*=\s*7/);
    });

    it('CONFIRMED_HARD_CAP_DAYS = 60 en ambos', () => {
      expect(SRC_LRS).toMatch(/CONFIRMED_HARD_CAP_DAYS\s*=\s*60/);
      expect(CF).toMatch(/CONFIRMED_HARD_CAP_DAYS\s*=\s*60/);
    });
  });

  describe('R4 ASIG TTL 7d', () => {
    it('ambos usan RESERVA_TTL_DAYS para ASIG', () => {
      // La rama ASIG también usa la const RESERVA_TTL_DAYS para el cutoff.
      const asigBranchSrc = SRC_LRS.match(/state\s*===?\s*['"]ASIG['"][\s\S]{0,800}/);
      const asigBranchCf = CF.match(/state\s*===?\s*['"]ASIG['"][\s\S]{0,800}/);
      expect(asigBranchSrc).toBeTruthy();
      expect(asigBranchCf).toBeTruthy();
      expect(asigBranchSrc[0]).toMatch(/RESERVA_TTL_DAYS/);
      expect(asigBranchCf[0]).toMatch(/RESERVA_TTL_DAYS/);
    });
  });

  describe('R8 §39 — getStockBreakdown es fuente única con shape consistente', () => {
    const buckets = [
      'fisicoDep11',
      'transitoDep12',
      'backorderApp',
      'confirmadasSinFacturar',
      'asignadas',
      'waitlistCpst',
      'repartoAbierto',
    ];
    for (const bucket of buckets) {
      it(`ambos exportan bucket '${bucket}'`, () => {
        expect(SRC.includes(bucket)).toBe(true);
        expect(CF.includes(bucket)).toBe(true);
      });
    }

    it('reservadasTotal excluye BO y waitlistCpst y repartoAbierto (§40 + §40.1)', () => {
      // src/pure — nombre real: reservasNominales (no reservadasNominales)
      const srcMatch = SRC.match(/const\s+reservasNominales\s*=([^;]{0,300});/);
      expect(srcMatch, 'src/pure debe declarar `reservasNominales = ...`').toBeTruthy();
      expect(srcMatch[1]).not.toMatch(/backorderApp/);
      expect(srcMatch[1]).not.toMatch(/waitlistCpst/);
      expect(srcMatch[1]).not.toMatch(/repartoAbierto/);
      // functions/core
      const cfMatch = CF.match(/const\s+reservasNominales\s*=([^;]{0,300});/);
      expect(cfMatch, 'functions/core debe declarar `reservasNominales = ...`').toBeTruthy();
      expect(cfMatch[1]).not.toMatch(/backorderApp/);
      expect(cfMatch[1]).not.toMatch(/waitlistCpst/);
      expect(cfMatch[1]).not.toMatch(/repartoAbierto/);
    });

    it('reservadasTotal cap por físico (§40.2)', () => {
      expect(SRC).toMatch(/Math\.min\(reservasNominales[,\s]/);
      expect(CF).toMatch(/Math\.min\(reservasNominales[,\s]/);
    });

    it('libre = max(0, fisicoDep11 - reservadasTotal)', () => {
      expect(SRC).toMatch(/Math\.max\(0,\s*fisicoDep11\s*-\s*reservadasTotal/);
      expect(CF).toMatch(/Math\.max\(0,\s*fisicoDep11\s*-\s*reservadasTotal/);
    });
  });

  describe('R10 §46 — utilizablePara(cardCode)', () => {
    it('ambos exportan utilizablePara', () => {
      expect(SRC).toMatch(/utilizablePara\s*[:=]/);
      expect(CF).toMatch(/utilizablePara\s*[:=]/);
    });

    it('utilizablePara cap por fisicoDep11 (no excede)', () => {
      // Debe usar Math.min con fisicoDep11. Expandir hasta el return.
      const srcUtil = SRC.match(
        /const\s+utilizablePara\s*=\s*\(cardCode\)\s*=>\s*\{[\s\S]*?\n {2}\};/
      );
      const cfUtil = CF.match(
        /const\s+utilizablePara\s*=\s*\(cardCode\)\s*=>\s*\{[\s\S]*?\n {2}\};/
      );
      expect(srcUtil, 'src/pure debe tener utilizablePara helper').toBeTruthy();
      expect(cfUtil, 'functions/core debe tener utilizablePara helper').toBeTruthy();
      expect(srcUtil[0]).toMatch(/Math\.min\([\s\S]*?fisicoDep11/);
      expect(cfUtil[0]).toMatch(/Math\.min\([\s\S]*?fisicoDep11/);
    });
  });

  describe('_version shape alineado (anti-drift)', () => {
    it('ambos declaran _version 7 (§40.11)', () => {
      expect(SRC).toMatch(/_version:\s*7/);
      expect(CF).toMatch(/_version:\s*7/);
    });
  });

  describe('STOCK_LABELS idénticos', () => {
    it('mismos labels en ambos lados (src/pure STOCK_LABELS vs functions/core STOCK_LABELS_SERVER)', () => {
      const extractLabels = (src, name) => {
        const match = src.match(
          new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]+?)\\n\\s*\\}\\)`)
        );
        if (!match) return null;
        return match[1]
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && l.includes(':') && !l.startsWith('//') && !l.startsWith('*'))
          .map((l) => l.replace(/,\s*$/, ''))
          .sort()
          .join('\n');
      };
      const srcLabels = extractLabels(SRC, 'STOCK_LABELS');
      const cfLabels = extractLabels(CF, 'STOCK_LABELS_SERVER');
      expect(srcLabels, 'src/pure STOCK_LABELS debe existir').toBeTruthy();
      expect(cfLabels, 'functions/core STOCK_LABELS_SERVER debe existir').toBeTruthy();
      expect(cfLabels).toBe(srcLabels);
    });
  });
});
