// @ts-check
/**
 * Playwright E2E v1505 §Reparto — export + import Excel.
 *
 * Precondición manual: usuario admin logueado + al menos 1 ingreso_reparto
 * pending visible en el modal "Reparto de ingresos".
 *
 * NOTA: este test se deja SKIPPED por default porque requiere:
 *   1. Chrome con --remote-debugging-port=9222 (patrón CLAUDE.md §8).
 *   2. User admin logueado al sitio.
 *   3. Ingresos pending en Firestore prod/dev (fixture inestable para CI).
 *
 * Para habilitarlo manualmente: `test.describe.only` o quitar el `test.skip`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe
  .skip('v1505 §Reparto — export + import Excel E2E', () => {
    test('export + edit + import + apply (admin, 1 fila)', async ({ page }) => {
      const baseUrl = process.env.APP_URL || 'http://localhost:8000';
      await page.goto(baseUrl);
      // Esperar login manual (si no hay cookies).
      await page.waitForSelector('#top-bar-user', { timeout: 60_000 });

      // Abrir modal Reparto.
      const btnReparto = page.locator('button:has-text("Reparto"), [data-reparto-trigger]');
      await btnReparto.first().click();
      const modal = page.locator('#reparto-modal');
      await expect(modal).toBeVisible();

      // Esperar que haya filas (ingresos pending).
      await page.waitForFunction(
        () => {
          const w = /** @type {any} */ (window);
          return Array.isArray(w._repartoIngresos) && w._repartoIngresos.length > 0;
        },
        { timeout: 15_000 }
      );

      // Clickear "Exportar Excel" (manual editable, v1505).
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button:has-text("Exportar Excel")').first().click(),
      ]);
      const downloadsDir = path.join(process.cwd(), 'test-results', 'downloads');
      fs.mkdirSync(downloadsDir, { recursive: true });
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/^Reparto_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
      const filePath = path.join(downloadsDir, filename);
      await download.saveAs(filePath);

      // TODO: parse xlsx with 'xlsx' lib + modify Asignado + Eliminar.
      // Luego subir vía input file + confirmar aplicación.
      // Verificar reparto_log tiene entry con origen='import'.
      //
      // Skip por ahora (fixture inestable). El test unit cubre la lógica pura.
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
