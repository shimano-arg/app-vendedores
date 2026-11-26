/**
 * ErrorBoundary genérico mobile-first. Mensajes humanos sin jerga (§68).
 */

import { Component, type ReactNode } from 'react';
import { ApiError, ApiValidationError, NetworkError } from '../lib/api.js';
import { NotAuthenticatedError } from '../lib/auth.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { title, message, hint } = humanize(error);

    return (
      <div
        role="alert"
        style={{
          padding: 'var(--space-lg)',
          maxWidth: '560px',
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <h2 style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-md)' }}>{title}</h2>
        <p style={{ marginBottom: 'var(--space-sm)' }}>{message}</p>
        {hint && <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9em' }}>{hint}</p>}
        <button
          type="button"
          onClick={this.reset}
          style={{
            marginTop: 'var(--space-lg)',
            minHeight: '44px',
            padding: '0 var(--space-lg)',
            borderRadius: '999px',
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            fontSize: '1em',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}

function humanize(error: Error): { title: string; message: string; hint?: string } {
  if (error instanceof NotAuthenticatedError) {
    return {
      title: 'Iniciá sesión',
      message: error.message,
    };
  }
  if (error instanceof NetworkError) {
    return {
      title: 'Sin conexión',
      message: 'No pudimos conectar con el servidor. Revisá tu red y volvé a intentar.',
      hint: `Endpoint: ${error.endpoint}`,
    };
  }
  if (error instanceof ApiError) {
    return {
      title: 'No se pudo cargar',
      message: error.message,
      hint: `Código técnico: ${error.errorCode}`,
    };
  }
  if (error instanceof ApiValidationError) {
    return {
      title: 'Respuesta inesperada',
      message: 'El servidor devolvió datos que no reconocemos. Avisale a Mariano.',
      hint: `Endpoint: ${error.endpoint}`,
    };
  }
  return {
    title: 'Algo salió mal',
    message: 'Hubo un error inesperado. Volvé a intentar en un minuto.',
    hint: error.message,
  };
}
