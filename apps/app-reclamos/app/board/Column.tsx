'use client';
import { useDroppable } from '@dnd-kit/core';
import {
  CheckCircle2,
  CirclePlus,
  ClipboardCheck,
  Clock,
  type LucideIcon,
  PackageSearch,
  ShieldCheck,
} from 'lucide-react';
import type { ClaimColumn } from '@/lib/columns';
import type { Database } from '@/lib/supabase/types';
import type { DurationBadge } from '@/lib/timeInColumn';
import { ClaimCard } from './ClaimCard';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

// v1262: mapa iconName (string) → LucideIcon component. Permite declarar
// iconos en lib/columns.ts como data pura sin imports de react-icons.
const ICONS: Record<string, LucideIcon> = {
  CirclePlus,
  PackageSearch,
  ClipboardCheck,
  ShieldCheck,
  Clock,
  CheckCircle2,
};

export function Column({
  column,
  claims,
  profiles,
  cardDurations,
  stuckSet,
}: {
  column: {
    key: ClaimColumn;
    label: string;
    tint: string;
    iconName?: string;
    emptyLabel?: string;
  };
  claims: Claim[];
  profiles: Profile[];
  cardDurations: Record<number, DurationBadge>;
  stuckSet?: Set<number>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const Icon = column.iconName ? ICONS[column.iconName] : null;
  return (
    <section
      ref={setNodeRef}
      style={{ backgroundColor: column.tint }}
      className={`
        w-[280px] shrink-0 lg:w-auto lg:min-w-0 rounded-2xl p-4
        backdrop-blur-xl backdrop-saturate-150 border border-white/40
        transition-shadow duration-200
        ${isOver ? 'shadow-[0_0_0_2px_var(--accent-blue),0_16px_32px_rgba(0,113,227,0.22)]' : 'shadow-[0_2px_8px_rgba(0,0,0,0.08)]'}
      `}
    >
      <header className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-sm font-semibold tracking-tight text-[color:var(--text-primary)] inline-flex items-center gap-1.5">
          {Icon && (
            <Icon
              className="h-3.5 w-3.5 text-[color:var(--text-secondary)]"
              aria-hidden="true"
              strokeWidth={2.25}
            />
          )}
          <span>{column.label}</span>
        </h2>
        <span className="count-badge">{claims.length}</span>
      </header>
      <div className="flex flex-col gap-2.5 min-h-[48px] min-w-0">
        {claims.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 px-2 opacity-60 text-center">
            {Icon && (
              <Icon
                className="h-7 w-7 text-[color:var(--text-tertiary)] mb-2"
                aria-hidden="true"
                strokeWidth={1.5}
              />
            )}
            <p className="text-[11px] text-[color:var(--text-tertiary)]">
              {column.emptyLabel ?? 'Vacío'}
            </p>
          </div>
        ) : (
          claims.map((c) => (
            <ClaimCard
              key={c.id}
              claim={c}
              profiles={profiles}
              duration={cardDurations[c.id]}
              stuck={stuckSet?.has(c.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
