'use client';
import { useState, useTransition, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CLAIM_COLUMNS, type ClaimColumn, COLUMN_KEYS } from '@/lib/columns';
import { Column } from './Column';
import { ClaimCardOverlay } from './ClaimCard';
import { moveClaim } from './actions';
import { NewClaimDialog } from './NewClaimDialog';
import { ColumnDefaultsDialog } from './ColumnDefaultsDialog';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { DurationBadge } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

function greetingByHour(name: string): string {
  const h = new Date().getHours();
  const salute =
    h >= 5 && h < 12 ? 'Buen día'
    : h >= 12 && h < 19 ? 'Buenas tardes'
    : 'Buenas noches';
  return name ? `${salute}, ${name}` : salute;
}

export function Board({
  initialGrouped,
  profiles,
  columnDefaults,
  currentUserName,
  cardDurations,
}: {
  initialGrouped: Record<ClaimColumn, Claim[]>;
  profiles: Profile[];
  columnDefaults: Record<ClaimColumn, string | null>;
  currentUserName: string;
  cardDurations: Record<number, DurationBadge>;
}) {
  const [grouped, setGrouped] = useState(initialGrouped);
  const [activeClaimId, setActiveClaimId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const activeClaim =
    activeClaimId != null
      ? Object.values(grouped).flat().find((c) => c.id === activeClaimId) ?? null
      : null;

  // Realtime: recarga la página cuando cambia alguna fila de `claims`.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('claims-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, () => {
        window.location.reload();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function onDragStart(e: DragStartEvent) {
    setActiveClaimId(Number(e.active.id));
  }

  function onDragCancel() {
    setActiveClaimId(null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveClaimId(null);
    const overId = e.over?.id?.toString();
    const claimId = Number(e.active.id);
    if (!overId || !COLUMN_KEYS.includes(overId as ClaimColumn)) return;
    const toColumn = overId as ClaimColumn;

    const claim = Object.values(grouped).flat().find((c) => c.id === claimId);
    if (!claim || claim.current_column === toColumn) return;

    const defaultAssigneeId = columnDefaults[toColumn];
    const defaultEmail = defaultAssigneeId
      ? profiles.find((p) => p.id === defaultAssigneeId)?.email ?? ''
      : profiles[0]?.email ?? '';
    const emailPrompt = window.prompt(
      `¿Asignar a? (email exacto) para columna "${toColumn}":`,
      defaultEmail,
    );
    if (!emailPrompt) return;
    const newAssignee = profiles.find((p) => p.email === emailPrompt);
    if (!newAssignee) {
      alert('Email no encontrado entre los usuarios.');
      return;
    }

    setGrouped((prev) => {
      const clone: Record<ClaimColumn, Claim[]> = Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, [...v]]),
      ) as Record<ClaimColumn, Claim[]>;
      const fromCol = claim.current_column as ClaimColumn;
      clone[fromCol] = clone[fromCol].filter((c) => c.id !== claimId);
      clone[toColumn] = [
        { ...claim, current_column: toColumn, assignee_id: newAssignee.id },
        ...clone[toColumn],
      ];
      return clone;
    });

    startTransition(async () => {
      const res = await moveClaim({ claimId, toColumn, newAssigneeId: newAssignee.id });
      if (!res.ok) {
        alert(res.error);
        setGrouped(initialGrouped);
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <main className="page-bg page-bg-board min-h-[calc(100vh-56px)] px-6 py-6 lg:py-8">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div
            style={{
              textShadow: '0 1px 12px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.6)',
            }}
          >
            <p className="eyebrow mb-1 text-[color:var(--text-primary)]">
              Reclamos abiertos
            </p>
            <h1 className="display text-2xl">{greetingByHour(currentUserName)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ColumnDefaultsDialog profiles={profiles} currentDefaults={columnDefaults} />
            <NewClaimDialog />
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto -mx-6 px-6 pb-4 lg:grid lg:grid-cols-6 lg:overflow-x-visible lg:mx-0 lg:px-0">
          {CLAIM_COLUMNS.map((col) => (
            <Column
              key={col.key}
              column={col}
              claims={grouped[col.key]}
              profiles={profiles}
              cardDurations={cardDurations}
            />
          ))}
        </div>
      </main>
      <DragOverlay>
        {activeClaim ? (
          <ClaimCardOverlay
            claim={activeClaim}
            profiles={profiles}
            duration={cardDurations[activeClaim.id]}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
