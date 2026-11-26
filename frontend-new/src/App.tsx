/**
 * Rutas del piloto (ADR-013 P1.6).
 * Zero writes. Dos rutas visibles + fallback 404.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Loading } from './components/Loading.js';
import { Shell } from './components/Shell.js';

const StockRoute = lazy(() => import('./routes/stock.js'));
const PedidosRoute = lazy(() => import('./routes/pedidos.js'));

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/stock" replace />} />
        <Route
          path="stock"
          element={
            <ErrorBoundary>
              <Suspense fallback={<Loading label="Preparando stock…" />}>
                <StockRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="pedidos"
          element={
            <ErrorBoundary>
              <Suspense fallback={<Loading label="Preparando pedidos…" />}>
                <PedidosRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route path="*" element={<Navigate to="/stock" replace />} />
      </Route>
    </Routes>
  );
}
