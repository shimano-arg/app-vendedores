'use client';
import { useDraggable } from '@dnd-kit/core';
import type { DurationBadge } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

const TONE_CLASSES: Record<DurationBadge['tone'], string> = {
  neutral: 'bg-[rgba(60,60,67,0.08)] text-[color:var(--text-secondary)]',
  warning: 'bg-[rgba(255,149,0,0.14)] text-[#B25A00]',
  danger: 'bg-[rgba(255,59,48,0.14)] text-[#B7261C]',
  closed: 'bg-[rgba(126,211,33,0.16)] text-[#3E7A0D]',
};

function DurationChip({ duration }: { duration: DurationBadge }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${TONE_CLASSES[duration.tone]}`}
      title={duration.tone === 'closed' ? 'Duración total del flujo' : 'Tiempo en esta columna'}
    >
      {duration.text}
    </span>
  );
}

function CardBody({
  claim,
  profiles,
  duration,
}: {
  claim: Claim;
  profiles: Profile[];
  duration?: DurationBadge;
}) {
  const assignee = profiles.find((p) => p.id === claim.assignee_id);
  return (
    <>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <span className="eyebrow text-[10px]">Remito</span>
        <div className="flex items-baseline gap-1.5">
          {duration && <DurationChip duration={duration} />}
          <span className="text-[10px] font-medium text-[color:var(--text-tertiary)] tabular-nums">
            #{claim.id}
          </span>
        </div>
      </div>
      <div className="text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)] leading-tight break-words">
        {claim.remito_number}
      </div>
      <p className="text-[13px] text-[color:var(--text-secondary)] mt-1.5 line-clamp-2 leading-snug break-words">
        {claim.observations}
      </p>
      <div className="mt-3 flex items-center gap-2 pt-2.5 border-t border-[color:var(--hairline)]">
        <div className="h-5 w-5 rounded-full bg-[color:var(--accent-blue)]/12 flex items-center justify-center text-[10px] font-semibold text-[color:var(--accent-blue)]">
          {assignee ? assignee.display_name.charAt(0).toUpperCase() : '?'}
        </div>
        <span className="text-[12px] text-[color:var(--text-secondary)] truncate">
          {assignee ? assignee.display_name : 'Sin asignar'}
        </span>
      </div>
    </>
  );
}

export function ClaimCard({
  claim,
  profiles,
  duration,
}: {
  claim: Claim;
  profiles: Profile[];
  duration?: DurationBadge;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(claim.id),
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      suppressHydrationWarning
      className={`card-elevated p-3.5 cursor-grab w-full min-w-0 ${isDragging ? 'opacity-40' : ''}`}
    >
      <a
        href={`/board?claim=${claim.id}`}
        className="block"
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
      >
        <CardBody claim={claim} profiles={profiles} duration={duration} />
      </a>
    </div>
  );
}

export function ClaimCardOverlay({
  claim,
  profiles,
  duration,
}: {
  claim: Claim;
  profiles: Profile[];
  duration?: DurationBadge;
}) {
  return (
    <div className="card-elevated card-dragging p-3.5 cursor-grabbing w-full min-w-0">
      <CardBody claim={claim} profiles={profiles} duration={duration} />
    </div>
  );
}
