'use client';
import { useState, useTransition, useEffect } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useRouter } from 'next/navigation';
import { CLAIM_COLUMNS, type ClaimColumn, COLUMN_KEYS } from '@/lib/columns';
import type { DurationBadge } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { AssigneePopover } from './AssigneePopover';
import { ClaimCardOverlay } from './ClaimCard';
import { Column } from './Column';
import { ColumnDefaultsDialog } from './ColumnDefaultsDialog';
import { NewClaimDialog } from './NewClaimDialog';
import { moveClaim } from './actions';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

type PendingMove = {
  claimId: number;
  toColumn: ClaimColumn;
  defaultAssigneeId: string | null;
  x: number;
  y: number;
};

function greetingByHour(name: string): string {
  const h = new Date().getHours();
  const salute =
    h >= 5 && h < 12 ? 'Buen día' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches';
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
  const router = useRouter();
  const [grouped, setGrouped] = useState(initialGrouped);
  const [activeClaimId, setActiveClaimId] = useState<number | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activeClaim =
    activeClaimId != null
      ? (Object.values(grouped).flat().find((c) => c.id === activeClaimId) ?? null)
      : null;

  // v1260: en vez de window.location.reload() en cada postgres_change,
  // llamamos router.refresh() — invalida el Server Component cache sin
  // perder scroll ni modales abiertos. Para INSERTs/UPDATEs del propio user
  // ya actualizamos el state optimista; el refresh trae la verdad del server
  // en background sin flashear la UI.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('claims-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  // Mantener grouped sincronizado si cambia initialGrouped (post router.refresh).
  useEffect(() => {
    setGrouped(initialGrouped);
  }, [initialGrouped]);

  function onDragStart(e: DragStartEvent) {
    setActiveClaimId(Number(e.active.id));
  }

  function onDragCancel() {
    setActiveClaimId(null);
  }

  function commitMove(claimId: number, toColumn: ClaimColumn, newAssigneeId: string) {
    const claim = Object.values(grouped).flat().find((c) => c.id === claimId);
    if (!claim) return;

    setGrouped((prev) => {
      const clone: Record<ClaimColumn, Claim[]> = Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, [...v]]),
      ) as Record<ClaimColumn, Claim[]>;
      const fromCol = claim.current_column as ClaimColumn;
      clone[fromCol] = clone[fromCol].filter((c) => c.id !== claimId);
      clone[toColumn] = [
        { ...claim, current_column: toColumn, assignee_id: newAssigneeId },
        ...clone[toColumn],
      ];
      return clone;
    });

    startTransition(async () => {
      const res = await moveClaim({ claimId, toColumn, newAssigneeId });
      if (!res.ok) {
        alert(res.error);
        setGrouped(initialGrouped);
      }
    });
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

    // v1260: si hay default + el user NO mantiene shift, asignar silent y commit.
    // Si no hay default O el user mantiene shift (quiere elegir), abrir popover.
    const activatorEvent = (e.activatorEvent as PointerEvent | undefined) ?? null;
    const wantsPicker = activatorEvent?.shiftKey === true;

    if (defaultAssigneeId && !wantsPicker) {
      commitMove(claimId, toColumn, defaultAssigneeId);
      return;
    }

    // Posicionar popover cerca del drop point.
    const x = activatorEvent?.clientX ?? window.innerWidth / 2 - 130;
    const y = activatorEvent?.clientY ?? window.innerHeight / 2 - 160;
    setPendingMove({ claimId, toColumn, defaultAssigneeId, x, y });
  }

  function onPickAssignee(assigneeId: string) {
    if (!pendingMove) return;
    commitMove(pendingMove.claimId, pendingMove.toColumn, assigneeId);
    setPendingMove(null);
  }

  function onCancelAssignee() {
    setPendingMove(null);
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
            <p className="eyebrow mb-1 text-[color:var(--text-primary)]">Reclamos abiertos</p>
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
      {pendingMove && (
        <AssigneePopover
          profiles={profiles}
          defaultAssigneeId={pendingMove.defaultAssigneeId}
          x={pendingMove.x}
          y={pendingMove.y}
          onPick={onPickAssignee}
          onCancel={onCancelAssignee}
        />
      )}
    </DndContext>
  );
}
