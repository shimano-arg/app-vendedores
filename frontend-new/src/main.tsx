/**
 * Entry point del piloto (ADR-013 P1.6).
 *
 * BrowserRouter con basename="/app2" (ADR-004). TanStack Query v5 con config fija
 * del piloto. Zero writes, zero mutations.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { initVitals } from './lib/vitals.js';
import './styles/tokens.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

initVitals('boot');

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root no existe en index.html — chequeá el scaffold.');
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename="/app2">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
