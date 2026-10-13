'use client';
import { useDroppable } from '@dnd-kit/core';
import { ClaimCard } from './ClaimCard';
import type { ClaimColumn } from '@/lib/columns';
import type { DurationBadge } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

export function Column({
  column,
  claims,
  profiles,
  cardDurations,
}: {
  column: { key: ClaimColumn; label: string; tint: string };
  claims: Claim[];
  profiles: Profile[];
  cardDurations: Record<number, DurationBadge>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
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
      <header className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-sm font-semibold tracking-tight text-[color:var(--text-primary)]">
          {column.label}
        </h2>
        <span className="count-badge">{claims.length}</span>
      </header>
      <div className="flex flex-col gap-2.5 min-h-[48px] min-w-0">
        {claims.map((c) => (
          <ClaimCard
            key={c.id}
            claim={c}
            profiles={profiles}
            duration={cardDurations[c.id]}
          />
        ))}
      </div>
    </section>
  );
}
