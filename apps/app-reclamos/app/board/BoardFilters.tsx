'use client';
import { Search, X } from 'lucide-react';

// v1261 (2026-10-13): barra de busqueda. Chips removidos v1255-reclamos
// (2026-10-14) por pedido de Mariano: ruido visual en el header. El filtro
// por tipo o por asignee se puede escribir en la busqueda (match contra
// observations, cliente, remito, etc).
export function BoardFilters({
  searchQuery,
  onSearchChange,
  totalMatches,
  totalClaims,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalMatches: number;
  totalClaims: number;
}) {
  const hasSearch = searchQuery.length > 0;

  return (
    <div className="mb-5 flex flex-col gap-2.5">
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
        {hasSearch && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.06)]"
            aria-label="Limpiar busqueda"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {hasSearch && (
        <span className="text-[11px] text-[color:var(--text-tertiary)] tabular-nums">
          {totalMatches} de {totalClaims}
        </span>
      )}
    </div>
  );
}
