import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loading } from './components/Loading';
import { Shell } from './components/Shell';

// Rutas lazy — cada pantalla genera su chunk separado (ADR-011 por-ruta ≤50 KB
// gzipped). Esto deja el shell inicial ~chico y las pantallas pesadas no
// bloquean el primer paint.
const StockRoute = lazy(() => import('./routes/stock'));
const PedidosRoute = lazy(() => import('./routes/pedidos'));
const NotFoundRoute = lazy(() => import('./routes/_404'));

/**
 * App — top-level. Montado sobre BrowserRouter con basename="/app2" en main.tsx.
 *
 * Shell envuelve todas las rutas para mantener el header + nav persistentes entre
 * navegaciones (no re-mount al cambiar de ruta → mejor INP + menos work por nav).
 */
export function App(): JSX.Element {
  return (
    <Shell>
      <Routes>
        {/* Home redirect → Stock (pantalla por default del piloto). */}
        <Route index element={<StockRoute />} />
        <Route path="stock" element={<StockRoute />} />
        <Route path="pedidos" element={<PedidosRoute />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </Shell>
  );
}

// Export default por si algun consumer hace `import App from '...'`.
export default App;

// Re-export util para debug — permite inspeccionar desde devtools.
// Nunca usar en codigo de produccion.
export { Loading as __DebugLoading };
