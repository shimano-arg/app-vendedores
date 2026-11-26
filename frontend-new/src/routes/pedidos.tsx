/**
 * Pantalla Pedidos — placeholder P1.5.
 *
 * En P1.6 (ADR-013 piloto solo-lectura):
 * - useQuery(['pedidos', cardCode], () => apiGet(`/api/pedidos?cardCode=X`))
 * - Lista agrupada por estado (ASIG / BO / confirmed / invoiced).
 * - Card con cliente + total + ultima fecha.
 * - Filtros: por vendedor (admin/gerente), por fecha, por estado.
 */
export function PedidosRoute(): JSX.Element {
  return (
    <section className="route route--pedidos">
      <header className="route__header">
        <h2 className="route__title">Pedidos</h2>
      </header>
      <div className="route__body">
        <p className="route__placeholder">
          Pantalla pedidos — proxima entrega. Aca vas a ver tus pedidos en curso.
        </p>
      </div>
    </section>
  );
}

export default PedidosRoute;
