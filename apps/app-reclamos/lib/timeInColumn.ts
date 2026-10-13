import type { ClaimColumn } from './columns';

type MinimalClaim = {
  id: number;
  current_column: string;
  created_at: string;
};

type MinimalEvent = {
  event_type: string;
  from_column: string | null;
  to_column: string | null;
  created_at: string;
};

export type DurationBadge = {
  text: string;
  tone: 'neutral' | 'warning' | 'danger' | 'closed';
};

export function formatCompact(ms: number): string {
  if (ms < 60_000) return 'recién';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatLong(ms: number): string {
  if (ms < 60_000) return 'menos de 1 min';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) return days === 1 ? '1 día' : `${days} días`;
  return `${days}d ${remainingHours}h`;
}

function toneForCurrentColumn(ms: number): DurationBadge['tone'] {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) return 'neutral';
  if (hours < 72) return 'warning';
  return 'danger';
}

export function getCardDurationBadge(
  claim: MinimalClaim,
  events: MinimalEvent[],
  now: Date = new Date(),
): DurationBadge {
  if (claim.current_column === 'cerrado') {
    const closedEvent = events
      .filter((e) => e.event_type === 'moved' && e.to_column === 'cerrado')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .pop();
    const closedAt = closedEvent
      ? new Date(closedEvent.created_at).getTime()
      : now.getTime();
    const ms = closedAt - new Date(claim.created_at).getTime();
    return { text: formatCompact(ms), tone: 'closed' };
  }
  const moves = events
    .filter((e) => e.event_type === 'moved' && e.to_column === claim.current_column)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const last = moves[moves.length - 1];
  const enteredAt = last ? new Date(last.created_at).getTime() : new Date(claim.created_at).getTime();
  const ms = now.getTime() - enteredAt;
  return { text: formatCompact(ms), tone: toneForCurrentColumn(ms) };
}

export type ColumnBreakdown = {
  column: ClaimColumn;
  ms: number;
};

export function getColumnBreakdown(
  claim: MinimalClaim,
  events: MinimalEvent[],
  columnOrder: ClaimColumn[],
  now: Date = new Date(),
): { total: number; perColumn: ColumnBreakdown[] } {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const transitions: { at: number; column: string }[] = [
    { at: new Date(claim.created_at).getTime(), column: 'nuevo' },
  ];
  for (const e of sorted) {
    if (e.event_type === 'moved' && e.to_column) {
      transitions.push({ at: new Date(e.created_at).getTime(), column: e.to_column });
    }
  }

  const isClosed = claim.current_column === 'cerrado';
  const closeEvent = isClosed
    ? sorted.filter((e) => e.event_type === 'moved' && e.to_column === 'cerrado').pop()
    : null;
  const endTs = closeEvent ? new Date(closeEvent.created_at).getTime() : now.getTime();

  const perColumnMs: Record<string, number> = {};
  for (let i = 0; i < transitions.length; i++) {
    const startMs = transitions[i].at;
    const nextMs = i + 1 < transitions.length ? transitions[i + 1].at : endTs;
    const delta = Math.max(0, nextMs - startMs);
    perColumnMs[transitions[i].column] = (perColumnMs[transitions[i].column] ?? 0) + delta;
  }

  const perColumn: ColumnBreakdown[] = columnOrder.map((column) => ({
    column,
    ms: perColumnMs[column] ?? 0,
  }));

  const total = endTs - new Date(claim.created_at).getTime();
  return { total, perColumn };
}
