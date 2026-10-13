'use client';
import { useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { moveClaim } from './actions';
import { CLAIM_COLUMNS, COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';

export function NextColumnButton({
  claimId,
  currentColumn,
  currentAssigneeId,
  nextColumnDefaultAssigneeId,
}: {
  claimId: number;
  currentColumn: ClaimColumn;
  currentAssigneeId: string;
  nextColumnDefaultAssigneeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const idx = CLAIM_COLUMNS.findIndex((c) => c.key === currentColumn);
  const next = CLAIM_COLUMNS[idx + 1];
  if (!next) return null;
  const nextKey = next.key as ClaimColumn;

  function onClick() {
    startTransition(async () => {
      const res = await moveClaim({
        claimId,
        toColumn: nextKey,
        newAssigneeId: nextColumnDefaultAssigneeId ?? currentAssigneeId,
      });
      if (!res.ok) {
        alert(res.error ?? 'Error al mover');
        return;
      }
      window.location.reload();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-blue)] px-4 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-[#0077ED] active:scale-[0.97] transition-all disabled:opacity-50"
    >
      {pending ? 'Moviendo…' : `Pasar a ${COLUMN_LABEL[nextKey]}`}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}
