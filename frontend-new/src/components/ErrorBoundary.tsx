import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — captura errores de render de descendientes y muestra
 * mensaje humano (CLAUDE.md §68: una oracion que dice QUE PASO, otra que dice
 * QUE HACER, codigo tecnico al final).
 *
 * No captura:
 * - Errores en event handlers (usar try/catch inline).
 * - Errores en codigo async (usar React Query + onError).
 * - Errores en SSR (no aplica — somos SPA).
 *
 * En produccion, el `componentDidCatch` deberia routear el error a Sentry o
 * al operations_log del backend-new. Por ahora solo logueamos a console.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log al operations_log del backend-new (via /api/... — TODO P1.6).
    // Por ahora, consola — en prod Sentry recoge igual via window.onerror.
    console.error('[frontend-new] ErrorBoundary capturo error:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    // Reload completo como escape hatch — equivalente al "Recargar limpio" de la
    // app legacy pero sin tocar IndexedDB/SW (todavia no los usa el frontend-new).
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const errCode = this.state.error?.name || 'UNKNOWN';
      return (
        <div className="error-boundary" role="alert">
          <h2 className="error-boundary__title">Algo salio mal</h2>
          <p className="error-boundary__text">
            No pudimos mostrar esta pantalla. Tocá "Reintentar" para refrescar la app.
          </p>
          <button
            type="button"
            className="btn-zonas error-boundary__btn"
            onClick={this.handleReset}
          >
            Reintentar
          </button>
          <p className="error-boundary__code">Codigo tecnico: {errCode}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
