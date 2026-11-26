import { expect, test } from '@playwright/test';

/**
 * Smoke E2E — contra `npm run preview` (ver playwright.config.ts).
 *
 * Objetivo: validar que el shell monta sin errores en console + que las 2 rutas
 * placeholder cargan. Los budgets CWV de ADR-015 se miden con
 * `scripts/perf/measure-vitals-app2.js` en CI, no en este test.
 */

test.describe('frontend-new smoke', () => {
  test('/app2/stock carga sin errores en console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });

    await page.goto('/app2/stock');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Stock' })).toBeVisible();

    // No errors de console tolerables en placeholder.
    expect(errors).toEqual([]);
  });

  test('/app2/pedidos carga sin errores en console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });

    await page.goto('/app2/pedidos');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('nav funciona — click en Pedidos desde Stock cambia la ruta', async ({ page }) => {
    await page.goto('/app2/stock');
    await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();

    await page.getByRole('link', { name: 'Pedidos' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos' })).toBeVisible();
    expect(page.url()).toContain('/app2/pedidos');
  });

  test('404 renderea cuando la ruta no existe', async ({ page }) => {
    await page.goto('/app2/ruta-que-no-existe');
    await expect(page.getByRole('heading', { level: 2, name: /no encontrada/i })).toBeVisible();
  });
});
