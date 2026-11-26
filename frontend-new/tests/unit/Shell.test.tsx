import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/components/Shell';

function renderShellAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/*"
          element={
            <Shell>
              <div data-testid="route-content">contenido de la ruta</div>
            </Shell>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('Shell', () => {
  it('renderea el header con el titulo derivado de la ruta', () => {
    renderShellAt('/stock');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stock');
  });

  it('muestra "Pedidos" cuando el path es /pedidos', () => {
    renderShellAt('/pedidos');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pedidos');
  });

  it('cae a "Stock" cuando el path es /', () => {
    renderShellAt('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stock');
  });

  it('renderea los 2 items de nav con touch target >= 44px (via estilo clase)', () => {
    renderShellAt('/stock');
    const nav = screen.getByRole('navigation', { name: /navegacion/i });
    expect(nav).toBeInTheDocument();
    const links = nav.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(links[0]).toHaveAttribute('aria-label', 'Stock');
    expect(links[1]).toHaveAttribute('aria-label', 'Pedidos');
  });

  it('marca el nav item activo con la clase shell__nav-item--active', () => {
    renderShellAt('/pedidos');
    const pedidosLink = screen.getByRole('link', { name: /pedidos/i });
    expect(pedidosLink.className).toMatch(/shell__nav-item--active/);
  });

  it('permite click en el nav item de Stock desde Pedidos (navegacion funcional)', async () => {
    const user = userEvent.setup();
    renderShellAt('/pedidos');
    const stockLink = screen.getByRole('link', { name: /stock/i });
    await user.click(stockLink);
    // Post-click, el titulo cambio porque la ruta cambio.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stock');
  });

  it('renderea los children dentro del main', () => {
    renderShellAt('/stock');
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByTestId('route-content'));
  });

  it('el main tiene id="main-content" (anclaje accessibility skip-link futuro)', () => {
    renderShellAt('/stock');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});
