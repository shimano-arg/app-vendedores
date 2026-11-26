/**
 * Loading skeleton mobile-first (ADR-015). Reserva altura explícita para
 * mantener CLS ≤ 0.1 mientras llega el fetch.
 */

interface LoadingProps {
  /** Mensaje visible (sin jerga, §68 CLAUDE.md). */
  label?: string;
}

export function Loading({ label = 'Cargando…' }: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 'var(--space-lg)',
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
        minHeight: '240px',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: '48px',
          height: '48px',
          margin: '0 auto var(--space-md)',
          borderRadius: '50%',
          border: '4px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          animation: 'app2-spin 1s linear infinite',
        }}
      />
      <style>{`@keyframes app2-spin { to { transform: rotate(360deg); } }`}</style>
      <p>{label}</p>
    </div>
  );
}

/** Skeleton de tabla (10 filas, reserva altura para evitar CLS). */
export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div aria-hidden="true" style={{ padding: 'var(--space-md)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton estático
          key={i}
          style={{
            height: '32px',
            marginBottom: 'var(--space-sm)',
            background: 'var(--color-skeleton)',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      ))}
    </div>
  );
}
