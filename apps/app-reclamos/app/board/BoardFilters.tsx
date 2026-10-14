'use client';
import { Search, X } from 'lucide-react';
import { CLAIM_TYPES, type ClaimType } from '@/lib/claim-types';
import type { Database } from '@/lib/supabase/types';

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

// v1261 (2026-10-13): barra de búsqueda + chips de filtro.
// Search filtra client-side por remito, cliente, factura, fantasía, observaciones.
// Chips por tipo de reclamo + por assignee. Toggle inclusivo (OR dentro de la
// misma categoria, AND entre categorias). Pedido Mariano: encontrar reclamo
// en <3s sin recorrer el board.
export function BoardFilters({
  searchQuery,
  onSearchChange,
  selectedTypes,
  onToggleType,
  selectedAssignees,
  onToggleAssignee,
  profiles,
  totalMatches,
  totalClaims,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedTypes: ClaimType[];
  onToggleType: (t: ClaimType) => void;
  selectedAssignees: string[];
  onToggleAssignee: (id: string) => void;
  profiles: Profile[];
  totalMatches: number;
  totalClaims: number;
}) {
  const anyFilterActive = searchQuery.length > 0 || selectedTypes.length > 0 || selectedAssignees.length > 0;

  function clearAll() {
    onSearchChange('');
    selectedTypes.forEach(onToggleType);
    selectedAssignees.forEach(onToggleAssignee);
  }

  return (
    <div className="mb-5 flex flex-col gap-2.5">
      {/* Search bar */}
      <div className="relative max-w-md">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--text-tertiary)] pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por remito, cliente, factura…"
          className="field pl-9 pr-9 w-full"
          aria-label="Buscar reclamo"
          id="board-search"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.06)]"
            aria-label="Limpiar búsqueda"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {CLAIM_TYPES.map((t) => {
          const active = selectedTypes.includes(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onToggleType(t.key)}
              className={`
                px-2.5 py-1 rounded-full text-[11px] font-medium transition-all
                active:scale-[0.97]
                ${
                  active
                    ? 'bg-[color:var(--accent-blue)] text-white shadow-[0_1px_3px_rgba(0,113,227,0.3)]'
                    : 'bg-white/70 text-[color:var(--text-secondary)] border border-[color:var(--hairline)] hover:bg-white'
                }
              `}
            >
              {t.label}
            </button>
          );
        })}
        {profiles.length > 0 && (
          <span className="h-5 w-px bg-[color:var(--hairline)] mx-1" aria-hidden="true" />
        )}
        {profiles.map((p) => {
          const active = selectedAssignees.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggleAssignee(p.id)}
              className={`
                px-2.5 py-1 rounded-full text-[11px] font-medium transition-all
                active:scale-[0.97] inline-flex items-center gap-1.5
                ${
                  active
                    ? 'bg-[color:var(--text-primary)] text-white'
                    : 'bg-white/70 text-[color:var(--text-secondary)] border border-[color:var(--hairline)] hover:bg-white'
                }
              `}
              title={p.email}
            >
              <span
                className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-semibold ${active ? 'bg-white/20 text-white' : 'bg-[color:var(--accent-blue)] text-white'}`}
              >
                {(p.display_name || p.email || '?').slice(0, 2).toUpperCase()}
              </span>
              <span>{p.display_name || p.email.split('@')[0]}</span>
            </button>
          );
        })}
        {anyFilterActive && (
          <>
            <span className="h-5 w-px bg-[color:var(--hairline)] mx-1" aria-hidden="true" />
            <button
              type="button"
              onClick={clearAll}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium text-[color:var(--text-secondary)] hover:bg-[rgba(0,0,0,0.04)]"
            >
              Limpiar filtros
            </button>
            <span className="text-[11px] text-[color:var(--text-tertiary)] ml-1 tabular-nums">
              {totalMatches} de {totalClaims}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
