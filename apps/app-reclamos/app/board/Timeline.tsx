import type { Database } from '@/lib/supabase/types';
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';

type Event = Database['public']['Tables']['claim_events']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name'>;

function eventLine(ev: Event, actor: string): string {
  const md = (ev.metadata ?? {}) as Record<string, unknown>;
  switch (ev.event_type) {
    case 'created':
      return `${actor} creó el reclamo`;
    case 'moved':
      return `${actor} movió de "${COLUMN_LABEL[ev.from_column as ClaimColumn]}" a "${COLUMN_LABEL[ev.to_column as ClaimColumn]}"`;
    case 'assigned':
      return `${actor} reasignó`;
    case 'commented':
      return `${actor}: ${ev.comment_text ?? ''}`;
    case 'attached':
      return `${actor} adjuntó ${String(md.file_name ?? 'archivo')}`;
    case 'email_sent':
      return `Email enviado a ${String(md.email_to ?? '?')}`;
    case 'email_failed':
      return `Email falló a ${String(md.email_to ?? '?')} · ${String(md.error ?? 'error')}`;
    default:
      return `${actor} — ${ev.event_type}`;
  }
}

export function Timeline({
  events,
  profiles,
}: {
  events: Event[];
  profiles: Profile[];
}) {
  return (
    <section className="flex flex-col min-h-0">
      <p className="eyebrow mb-3 shrink-0">Actividad</p>
      {events.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">Sin eventos aún.</p>
      ) : (
        <ol className="space-y-2.5 max-h-[38vh] overflow-y-auto pr-2 -mr-2">
          {events.map((ev) => {
            const actor = profiles.find((p) => p.id === ev.actor_id)?.display_name ?? 'alguien';
            return (
              <li
                key={ev.id}
                className="flex gap-3 text-[13px] text-[color:var(--text-primary)] leading-relaxed"
              >
                <time className="text-[11px] text-[color:var(--text-tertiary)] tabular-nums w-24 shrink-0 pt-0.5">
                  {new Date(ev.created_at).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <span className="flex-1">{eventLine(ev, actor)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
