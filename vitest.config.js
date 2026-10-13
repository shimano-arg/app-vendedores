// v1254 (2026-10-13): config vitest root para excluir apps/* del scan.
// Cada app hermana (apps/app-reclamos/) tiene su propio vitest config con
// deps y setup propios. El CI de app-vendedores NO debe correr esos tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**', 'functions/node_modules/**'],
  },
});
