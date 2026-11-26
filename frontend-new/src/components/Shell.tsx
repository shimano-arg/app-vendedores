import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

interface ShellProps {
  children: ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/stock', label: 'Stock', icon: '◐' },
  { to: '/pedidos', label: 'Pedidos', icon: '◉' },
] as const;

/**
 * Shell — header fijo + content + nav inferior (mobile) / lateral (desktop).
 *
 * Mobile-first (CLAUDE.md §21):
 * - Header 56px alto, backdrop blur para continuidad visual al scroll.
 * - Bottom tabs con touch targets ≥ 44×44 px (§106 pill pattern).
 * - prefers-reduced-motion respetado (transitions solo opacity, no transform).
 * - Sin dark mode (v1580 §108 lo removio — no reintroducir).
 *
 * El layout usa CSS Grid con `--shell-header-h` + `--shell-nav-h` como tokens
 * (ver styles/tokens.css) para que cualquier cambio de alto sea coherente con
 * el skeleton inline del index.html → zero CLS.
 */
export function Shell({ children }: ShellProps): JSX.Element {
  const location = useLocation();
  const currentTitle = resolveTitle(location.pathname);

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-inner">
          <h1 className="shell__title">{currentTitle}</h1>
        </div>
      </header>

      <main className="shell__main" id="main-content">
        {children}
      </main>

      <nav className="shell__nav" aria-label="Navegacion principal">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `shell__nav-item btn-zonas${isActive ? ' shell__nav-item--active' : ''}`
            }
            aria-label={item.label}
          >
            <span className="shell__nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="shell__nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function resolveTitle(pathname: string): string {
  // Pathname ya es relativo al basename "/app2".
  if (pathname.startsWith('/pedidos')) return 'Pedidos';
  if (pathname.startsWith('/stock') || pathname === '/') return 'Stock';
  return 'Shimano CRM';
}
