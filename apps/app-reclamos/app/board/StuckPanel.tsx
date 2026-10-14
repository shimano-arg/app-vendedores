'use client';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

// v1263 (2026-10-13): panel colapsable de reclamos stuck > 72hs sin actividad.
// Alta inmediata (siempre visible si hay stuck). Click row navega a /board?claim=X.
// Si no hay stuck, no renderiza nada.
export function StuckPanel({
  stuckClaims,
  profiles,
}: {
  stuckClaims: Claim[];
  profiles: Profile[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (stuckClaims.length === 0) return null;

  // Ordenar por antigüedad desc (más viejo primero).
  const sorted = [...stuckClaims].sort(
    (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  );

  return (
    <div className="mb-4 rounded-2xl border border-[#F4C7C7] bg-[#FEF2F2] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#FEE5E5] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <AlertCircle className="h-4 w-4 text-[#C7301B]" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-[#8B1D14]">
            {stuckClaims.length} {stuckClaims.length === 1 ? 'reclamo stuck' : 'reclamos stuck'}
          </span>
          <span className="text-[11px] text-[#A14239]">sin movimiento hace más de 72hs</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-[#8B1D14]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[#8B1D14]" />
        )}
      </button>
      {expanded && (
        <div className="px-2 pb-2">
          <ul className="space-y-1">
            {sorted.map((cl) => {
              const assignee = profiles.find((p) => p.id === cl.assignee_id);
              const hours = Math.floor(
                (Date.now() - new Date(cl.updated_at).getTime()) / (1000 * 60 * 60),
              );
              const days = Math.floor(hours / 24);
              const ago = days > 0 ? `${days}d` : `${hours}h`;
              return (
                <li key={cl.id}>
                  <a
                    href={`/board?claim=${cl.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-white transition-colors"
                  >
                    <span className="text-[11px] font-semibold text-[#C7301B] tabular-nums shrink-0 w-10 text-right">
                      {ago}
                    </span>
                    <span className="text-[13px] font-medium text-[color:var(--text-primary)] truncate">
                      {cl.remito_number}
                    </span>
                    {cl.client_name && (
                      <span className="text-[12px] text-[color:var(--text-secondary)] truncate">
                        · {cl.client_name}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-[color:var(--text-tertiary)] shrink-0">
                      {COLUMN_LABEL[cl.current_column as ClaimColumn]}
                    </span>
                    <span className="text-[11px] text-[color:var(--text-secondary)] shrink-0">
                      {assignee?.display_name?.split(' ')[0] ?? ''}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
