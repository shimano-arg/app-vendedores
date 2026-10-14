import { createClient } from '@/lib/supabase/server';
import { CLAIM_COLUMNS, type ClaimColumn } from '@/lib/columns';
import { Board } from './Board';
import { ClaimDetailDialog } from './ClaimDetailDialog';
import { Timeline } from './Timeline';
import { TimeBreakdown } from './TimeBreakdown';
import { CommentBox } from './CommentBox';
import { Attachments } from './Attachments';
import { DeleteClaimButton } from './DeleteClaimButton';
import { NextColumnButton } from './NextColumnButton';
import { VideoReviewToggle } from './VideoReviewToggle';
import { getCardDurationBadge, type DurationBadge } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const { claim: claimParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: claims }, { data: profiles }, { data: defaultsRows }] = await Promise.all([
    supabase.from('claims').select('*').order('updated_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('active', true),
    supabase.from('column_defaults').select('column_key, default_assignee_id'),
  ]);

  type BoardEvent = {
    claim_id: number;
    event_type: string;
    from_column: string | null;
    to_column: string | null;
    created_at: string;
  };
  const claimIds = (claims ?? []).map((c) => c.id);
  let boardEvents: BoardEvent[] = [];
  if (claimIds.length) {
    const { data } = await supabase
      .from('claim_events')
      .select('claim_id, event_type, from_column, to_column, created_at')
      .in('claim_id', claimIds)
      .in('event_type', ['moved', 'created', 'commented']);
    boardEvents = (data ?? []) as BoardEvent[];
  }
  const eventsByClaim = new Map<number, BoardEvent[]>();
  for (const e of boardEvents) {
    const list = eventsByClaim.get(e.claim_id) ?? [];
    list.push(e);
    eventsByClaim.set(e.claim_id, list);
  }
  const now = new Date();
  const cardDurations: Record<number, DurationBadge> = {};
  (claims ?? []).forEach((cl) => {
    cardDurations[cl.id] = getCardDurationBadge(cl, eventsByClaim.get(cl.id) ?? [], now);
  });

  // v1263: calcular stuck claims = abiertos sin actividad (move/comment/create) > 72h.
  // Fuente: max(claim.updated_at, max(events.created_at del claim)).
  const STUCK_HOURS = 72;
  const stuckThresholdMs = STUCK_HOURS * 60 * 60 * 1000;
  const stuckClaimIds: number[] = [];
  (claims ?? []).forEach((cl) => {
    if (cl.current_column === 'resuelto' || cl.current_column === 'cerrado') return;
    const evTimes = (eventsByClaim.get(cl.id) ?? []).map((e) =>
      new Date(e.created_at).getTime(),
    );
    const updatedTime = new Date(cl.updated_at).getTime();
    const lastActivity = Math.max(updatedTime, ...(evTimes.length ? evTimes : [0]));
    if (now.getTime() - lastActivity > stuckThresholdMs) stuckClaimIds.push(cl.id);
  });
  const currentProfile = (profiles ?? []).find((p) => p.id === user?.id);
  const currentUserName = currentProfile?.display_name?.split(' ')[0] ?? '';
  const isAdmin = currentProfile?.role === 'admin';
  const columnDefaults = Object.fromEntries(
    CLAIM_COLUMNS.map((c) => [c.key, null as string | null]),
  ) as Record<ClaimColumn, string | null>;
  (defaultsRows ?? []).forEach((r) => {
    columnDefaults[r.column_key as ClaimColumn] = r.default_assignee_id;
  });

  const grouped = Object.fromEntries(
    CLAIM_COLUMNS.map((c) => [c.key, [] as Claim[]]),
  ) as unknown as Record<ClaimColumn, Claim[]>;
  (claims ?? []).forEach((cl) => {
    grouped[cl.current_column as ClaimColumn].push(cl);
  });

  let detail: React.ReactNode = null;
  if (claimParam) {
    const claimId = Number(claimParam);
    const claim = (claims ?? []).find((c) => c.id === claimId);
    if (claim) {
      const [{ data: events }, { data: atts }] = await Promise.all([
        supabase
          .from('claim_events')
          .select('*')
          .eq('claim_id', claimId)
          .order('created_at', { ascending: true }),
        supabase
          .from('attachments')
          .select('*')
          .eq('claim_id', claimId)
          .order('created_at', { ascending: true }),
      ]);
      const currentIdx = CLAIM_COLUMNS.findIndex(
        (c) => c.key === claim.current_column,
      );
      const nextKey = CLAIM_COLUMNS[currentIdx + 1]?.key as ClaimColumn | undefined;
      const nextDefaultAssignee = nextKey ? columnDefaults[nextKey] : null;
      detail = (
        <ClaimDetailDialog
          claim={claim}
          profiles={profiles ?? []}
          sideContent={
            <>
              <Timeline events={events ?? []} profiles={profiles ?? []} />
              <CommentBox claimId={claim.id} />
            </>
          }
        >
          <TimeBreakdown claim={claim} events={events ?? []} />
          <VideoReviewToggle
            claimId={claim.id}
            initialArmado={claim.video_armado_reviewed}
            initialCliente={claim.video_cliente_reviewed}
          />
          <Attachments claimId={claim.id} initial={atts ?? []} />
          <div className="pt-4 mt-4 border-t border-[color:var(--hairline)] flex items-center justify-between gap-3">
            <DeleteClaimButton claimId={claim.id} remitoNumber={claim.remito_number} />
            <NextColumnButton
              claimId={claim.id}
              currentColumn={claim.current_column as ClaimColumn}
              currentAssigneeId={claim.assignee_id}
              nextColumnDefaultAssigneeId={nextDefaultAssignee}
            />
          </div>
        </ClaimDetailDialog>
      );
    }
  }

  return (
    <>
      <Board
        initialGrouped={grouped}
        profiles={profiles ?? []}
        columnDefaults={columnDefaults}
        currentUserName={currentUserName}
        cardDurations={cardDurations}
        stuckClaimIds={stuckClaimIds}
        isAdmin={isAdmin}
      />
      {detail}
    </>
  );
}
