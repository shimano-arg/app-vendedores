import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
import { initVitals } from './lib/vitals';

import './styles/tokens.css';
import './styles/global.css';

// React Query config — valores conservadores para vendedores en 4G.
// stock/pedidos son datos "casi en vivo" pero no de tiempo real; 30s baja refetch
// y deja respiro al CF backend.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

function mount(): void {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    // No logramos montar — dejamos el skeleton visible y warneamos.
    // Un error boundary no cubre esto porque todavia no hay React.
    console.error('[frontend-new] #root no encontrado — abort mount');
    return;
  }

  // Ocultar skeleton inline del index.html — zero CLS porque el Shell real
  // tiene el mismo alto de header que el skeleton.
  const skeleton = document.getElementById('root-skeleton');
  if (skeleton) skeleton.setAttribute('data-hidden', '1');

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {/*
            basename debe matchear `base` de vite.config.ts.
            Sin esto, react-router-dom asume '/' y los Links generan URLs
            mal servidas por Pages bajo /app2/.
          */}
          <BrowserRouter basename="/app2">
            <Suspense fallback={<Loading />}>
              <App />
            </Suspense>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  );

  // ADR-015: medimos CWV post-mount. Por ahora log a console; cuando este
  // disponible el endpoint de operations_log del backend-new, routeamos los
  // eventos ahi (ver src/lib/vitals.ts TODO).
  initVitals();
}

mount();
