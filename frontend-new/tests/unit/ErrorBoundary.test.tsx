import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

function ExplodeOnMount(): JSX.Element {
  throw new Error('boom en render');
}

describe('ErrorBoundary', () => {
  // React vuelca el error a stderr por default aunque ErrorBoundary lo capture.
  // Silenciamos durante este bloque para que el output del test quede limpio.
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('renderea los children cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">hola</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('muestra el fallback humano cuando un descendiente throwea', () => {
    render(
      <ErrorBoundary>
        <ExplodeOnMount />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/algo salio mal/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('expone el codigo tecnico al final (nombre del Error)', () => {
    render(
      <ErrorBoundary>
        <ExplodeOnMount />
      </ErrorBoundary>
    );
    // CLAUDE.md §68: codigo tecnico al final para que el vendedor lo mande por WA.
    expect(screen.getByText(/Codigo tecnico/i)).toBeInTheDocument();
    expect(screen.getByText(/Codigo tecnico.*Error/i)).toBeInTheDocument();
  });

  it('respeta el fallback custom si lo recibe por props', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom">custom fallback</div>}>
        <ExplodeOnMount />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('click en "Reintentar" llama a window.location.reload', async () => {
    // jsdom: location es overridable con defineProperty.
    const reloadMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });

    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <ExplodeOnMount />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(reloadMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
