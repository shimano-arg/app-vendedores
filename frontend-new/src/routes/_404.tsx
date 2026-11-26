import { Link } from 'react-router-dom';

export function NotFoundRoute(): JSX.Element {
  return (
    <section className="route route--404">
      <header className="route__header">
        <h2 className="route__title">Pagina no encontrada</h2>
      </header>
      <div className="route__body">
        <p className="route__placeholder">
          Esta URL no existe en el CRM. Volve a Stock o Pedidos desde el menu de abajo.
        </p>
        <Link to="/stock" className="btn-zonas route__cta">
          Ir a Stock
        </Link>
      </div>
    </section>
  );
}

export default NotFoundRoute;
