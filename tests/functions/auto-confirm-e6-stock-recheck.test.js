// @ts-check
/**
 * E6 §stock-servidor-atomico — tests contractuales sobre autoConfirmPendingPedidos.
 *
 * G1.G09 (CF02+CF06 race) y G1.G16 (no re-chequea stock entre compute y tx)
 * ya están cerrados por v1198+ via:
 * 1. runTransaction con guard "stage !== 'pending'" (evita doble-tick).
 * 2. Pre-validación de stock con lineReservesStock + warehouseBreakdown + split
 *    dinámico (líneas quedan BO si no hay stock al momento del tick).
 *
 * Estos tests verifican que ambos guards siguen activos (anti-regresión).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE = readFileSync('functions/core/auto-confirm-pending-core.js', 'utf8');

describe('E6 — autoConfirmPendingPedidos guards', () => {
  describe('G1.G09 — doble tick race', () => {
    it('runTransaction wrapea el update de stage', () => {
      expect(CORE).toMatch(/fbDb\.runTransaction\(async/);
      expect(CORE).toMatch(/tx\.update\(pedidoRef/);
    });

    it('guard "stage !== pending" dentro del runTransaction', () => {
      const txMatch = CORE.match(/fbDb\.runTransaction\(async[\s\S]+?return true;[\s\S]+?\}\);/);
      expect(txMatch, 'runTransaction encontrada').toBeTruthy();
      const txBody = txMatch[0];
      expect(txBody).toMatch(/freshData\.stage\s*!==\s*['"]pending['"]/);
      expect(txBody).toMatch(/return false/);
    });

    it('guard "finalizedAt" existente dentro del runTransaction (defensa doble-tick)', () => {
      const txMatch = CORE.match(/fbDb\.runTransaction\(async[\s\S]+?return true;[\s\S]+?\}\);/);
      expect(txMatch[0]).toMatch(/freshData\.finalizedAt/);
    });

    it('guard "transferidoSAP.docNum" existente (ya en SAP)', () => {
      const txMatch = CORE.match(/fbDb\.runTransaction\(async[\s\S]+?return true;[\s\S]+?\}\);/);
      expect(txMatch[0]).toMatch(/transferidoSAP[\s\S]{0,50}docNum/);
    });
  });

  describe('G1.G16 — stock re-check pre-promoción', () => {
    it('stockCheckEnabled gate pre-batch', () => {
      expect(CORE).toMatch(/let stockCheckEnabled\s*=\s*false/);
      expect(CORE).toMatch(/stockCheckEnabled\s*=\s*true/);
    });

    it('warehouseBreakdown se parsea desde stock_snapshot', () => {
      expect(CORE).toMatch(/warehouseBreakdown\s*=\s*_parseWarehouseBreakdown/);
    });

    it('_loadOpenPedidos cargado para el breakdown live', () => {
      expect(CORE).toMatch(/_loadOpenPedidos\(fbDb\)/);
    });

    it('lineReservesStock se usa en la pre-validación (misma copia que breakdown cliente)', () => {
      expect(CORE).toContain('lineReservesStock');
      expect(CORE).toMatch(
        /import\s*\{\s*lineReservesStock[\s\S]{0,50}from\s*['"]\.\/pedido-snapshot-core\.js['"]/
      );
    });

    it('auto-split dinámico persiste nuevas lines + autoSplitByStock', () => {
      expect(CORE).toMatch(/autoSplitMetadata/);
      expect(CORE).toMatch(/updatePayload\.autoSplitByStock\s*=\s*autoSplitMetadata/);
    });
  });

  describe('contrato', () => {
    it('export autoConfirmPendingPedidos existe', () => {
      expect(CORE).toMatch(/export async function autoConfirmPendingPedidos/);
    });

    it('AUTO_CONFIRM_RESULT codes documentados', () => {
      expect(CORE).toMatch(/AUTO_CONFIRM_RESULT/);
    });
  });
});
