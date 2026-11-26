/**
 * Pantalla Stock — placeholder P1.5.
 *
 * En P1.6 (ADR-013 piloto solo-lectura):
 * - useQuery(['stock', sku], () => apiGet(`/api/stock/${sku}`))
 * - Lista filtrable + card con breakdown (fisico / reservadas / libre).
 * - Mobile-first: cards no tablas.
 * - Virtualizacion si >200 items (react-window o similar — evaluar).
 */
export function StockRoute(): JSX.Element {
  return (
    <section className="route route--stock">
      <header className="route__header">
        <h2 className="route__title">Stock</h2>
      </header>
      <div className="route__body">
        <p className="route__placeholder">
          Pantalla stock — proxima entrega. Aca vas a ver el detalle de cada SKU en vivo.
        </p>
      </div>
    </section>
  );
}

export default StockRoute;
