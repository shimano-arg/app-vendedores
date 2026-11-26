import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// CLAUDE.md §9: usar fileURLToPath, nunca import.meta.url.pathname.slice(1)
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Montado como sub-app bajo /app2/. El root index.html del repo legacy sigue en /.
  base: '/app2/',
  plugins: [react()],
  build: {
    // Output directo a app2-dist/ en la raiz del repo, listo para git add + Pages.
    // No pisa el app.bundle.js legacy del root.
    outDir: resolve(__dirname, '../app2-dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: true,
    // ADR-011: budget formal. El build NO falla por size; el workflow CI lo hace.
    // Aca solo advertimos si un chunk se va por encima de 400 KB raw.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // Named chunks mas estables para auditar size entre builds.
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: {
          // Shell core: React runtime + Router.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Data layer separado — permite cachear mejor entre deploys.
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
  esbuild: {
    legalComments: 'none',
  },
});
