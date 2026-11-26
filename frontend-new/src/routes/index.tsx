/**
 * routes/index.tsx — barrel para los lazy imports de rutas.
 *
 * Aca re-exportamos los chunks lazy para que un consumer externo (si alguna vez
 * aparece) pueda importarlos sin saber los paths internos. Las rutas en si
 * se definen directamente en App.tsx (ver react-router-dom v6).
 */

export { default as NotFoundRoute } from './_404';
export { default as PedidosRoute } from './pedidos';
export { default as StockRoute } from './stock';
