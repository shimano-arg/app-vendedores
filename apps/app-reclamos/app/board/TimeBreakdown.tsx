import { CLAIM_COLUMNS, COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import { formatLong, getColumnBreakdown } from '@/lib/timeInColumn';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Event = Database['public']['Tables']['claim_events']['Row'];

export function TimeBreakdown({ claim, events }: { claim: Claim; events: Event[] }) {
  const now = new Date();
  const columnOrder = CLAIM_COLUMNS.map((c) => c.key);
  const { total, perColumn } = getColumnBreakdown(claim, events, columnOrder, now);
  const isClosed = claim.current_column === 'cerrado';
  const currentColumn = claim.current_column as ClaimColumn;
  const maxMs = Math.max(1, ...perColumn.map((p) => p.ms));

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <p className="eyebrow">Tiempos</p>
        <span className="text-[11px] text-[color:var(--text-tertiary)]">
          {isClosed ? `cerrado en ${formatLong(total)}` : `abierto hace ${formatLong(total)}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {perColumn.map(({ column, ms }) => {
          const isCurrent = !isClosed && column === currentColumn;
          const pct = Math.round((ms / maxMs) * 100);
          const showBar = ms > 0;
          return (
            <li key={column} className="text-[12px]">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span
                  className={
                    isCurrent
                      ? 'text-[color:var(--text-primary)] font-medium'
                      : 'text-[color:var(--text-secondary)]'
                  }
                >
                  {COLUMN_LABEL[column]}
                  {isCurrent && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent-blue)] align-middle" />
                  )}
                </span>
                <span
                  className={
                    ms === 0
                      ? 'text-[color:var(--text-tertiary)] tabular-nums'
                      : 'text-[color:var(--text-secondary)] tabular-nums'
                  }
                >
                  {ms === 0 ? '—' : formatLong(ms)}
                </span>
              </div>
              {showBar && (
                <div className="h-1 rounded-full bg-[rgba(0,0,0,0.06)] overflow-hidden">
                  <div
                    className={
                      isCurrent
                        ? 'h-full bg-[color:var(--accent-blue)]'
                        : 'h-full bg-[color:var(--text-tertiary)]'
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
