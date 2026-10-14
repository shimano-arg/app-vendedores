'use client';
import { useEffect, useRef } from 'react';
import type { Database } from '@/lib/supabase/types';

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name' | 'role'>;

// v1260 (2026-10-13): popover inline para elegir responsable post-drop.
// Reemplaza el window.prompt() nativo que mataba el feel de la app.
// Diseño Apple: sheet-panel estilo iOS con lista de avatars + nombres.
// Posicionado near drop point via x/y props.
// Confirmar con click en una row (sin botones de accion).
export function AssigneePopover({
  profiles,
  defaultAssigneeId,
  x,
  y,
  onPick,
  onCancel,
}: {
  profiles: Profile[];
  defaultAssigneeId: string | null;
  x: number;
  y: number;
  onPick: (assigneeId: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onCancel]);

  // Clamp posicion al viewport para que no se corte.
  const PANEL_W = 260;
  const PANEL_H_MAX = 320;
  const padding = 12;
  const clampedX = Math.min(Math.max(x, padding), window.innerWidth - PANEL_W - padding);
  const clampedY = Math.min(Math.max(y, padding), window.innerHeight - PANEL_H_MAX - padding);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Elegir responsable"
      className="fixed z-[100] sheet-panel p-2"
      style={{ left: clampedX, top: clampedY, width: PANEL_W, maxHeight: PANEL_H_MAX, overflowY: 'auto' }}
    >
      <div className="eyebrow px-2 pt-1 pb-2">Asignar a</div>
      {profiles.map((p) => {
        const isDefault = p.id === defaultAssigneeId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-[10px] text-left hover:bg-[rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
            autoFocus={isDefault}
          >
            <div className="h-7 w-7 rounded-full bg-[color:var(--accent-blue)] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
              {(p.display_name || p.email || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[color:var(--text-primary)] truncate">
                {p.display_name || p.email}
              </div>
              <div className="text-[11px] text-[color:var(--text-tertiary)] truncate">
                {p.email}
              </div>
            </div>
            {isDefault && (
              <span className="text-[10px] font-semibold text-[color:var(--accent-blue)] uppercase tracking-wide shrink-0">
                default
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
