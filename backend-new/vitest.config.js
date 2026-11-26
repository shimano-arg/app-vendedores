import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/tests/**/*.test.js'],
    testTimeout: 15_000,
    hookTimeout: 20_000,
    // Los tests comparten el pool PG; forzar un worker para evitar races
    // entre suites sobre tablas TRUNCATE-eadas.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['default'],
  },
});
