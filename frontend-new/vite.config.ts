import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// ADR-013: piloto mobile-first bajo /app2/. BrowserRouter resuelve `basename="/app2"` desde `src/App.tsx`.
// Bundle target: shell < 150 KB gzipped + cada ruta < 50 KB gzipped (ADR-011 subset piloto).
export default defineConfig({
  plugins: [react()],
  base: '/app2/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks separados para cache estable cross-deploy.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-zod': ['zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
