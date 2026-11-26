/**
 * Shell mobile-first del piloto (ADR-013).
 *
 * Header con logo + navegación simple. Tap targets ≥ 44px (ADR-015).
 */

import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/stock', label: 'Stock' },
  { to: '/pedidos', label: 'Pedidos' },
];

export function Shell() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          padding: 'var(--space-sm) var(--space-md)',
          background: 'var(--color-primary)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <strong style={{ fontSize: '1.1em', letterSpacing: '-0.01em' }}>Shimano · app2</strong>
        <span
          aria-hidden="true"
          style={{
            fontSize: '0.75em',
            opacity: 0.7,
            padding: '2px 8px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.15)',
          }}
        >
          piloto solo-lectura
        </span>
      </header>

      <nav
        aria-label="Secciones"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
        }}
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              flex: 1,
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.95em',
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
              borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
              textDecoration: 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main style={{ flex: 1, padding: 'var(--space-md)' }}>
        <Outlet />
      </main>
    </div>
  );
}
