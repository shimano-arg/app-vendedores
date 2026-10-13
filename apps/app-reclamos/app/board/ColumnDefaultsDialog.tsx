'use client';
import { useState, useTransition } from 'react';
import { X, Users } from 'lucide-react';
import { CLAIM_COLUMNS, type ClaimColumn } from '@/lib/columns';
import { setColumnDefaults } from './actions';
import type { Database } from '@/lib/supabase/types';

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'display_name'>;

export function ColumnDefaultsDialog({
  profiles,
  currentDefaults,
}: {
  profiles: Profile[];
  currentDefaults: Record<ClaimColumn, string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<ClaimColumn, string>>(() =>
    Object.fromEntries(
      CLAIM_COLUMNS.map((c) => [c.key, currentDefaults[c.key] ?? '']),
    ) as Record<ClaimColumn, string>,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const payload = {
      defaults: CLAIM_COLUMNS.map((c) => ({
        columnKey: c.key,
        assigneeId: values[c.key] || null,
      })),
    };
    startTransition(async () => {
      const res = await setColumnDefaults(payload);
      if (!res.ok) setError(res.error ?? 'Error');
      else {
        setOpen(false);
        window.location.reload();
      }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="pill-outline">
        <Users className="h-4 w-4" />
        <span>Responsables</span>
      </button>
      {open && (
        <div
          className="sheet-backdrop flex items-start justify-center z-50 p-6 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="sheet-panel w-full max-w-md my-8 p-7 space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow mb-1">Configuración</p>
                <h2 className="display text-xl">Responsable por columna</h2>
                <p className="text-[13px] text-[color:var(--text-secondary)] mt-1.5 leading-snug">
                  Al mover una tarjeta a una columna, la persona elegida acá aparece pre-seleccionada. Podés cambiarla en el momento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.04)] transition-colors"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 pt-2">
              {CLAIM_COLUMNS.map((col) => (
                <label key={col.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[13px] font-medium text-[color:var(--text-primary)]">
                    {col.label}
                  </span>
                  <select
                    value={values[col.key]}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [col.key]: e.target.value }))
                    }
                    className="field !py-1.5 !text-[13px] min-w-[200px]"
                  >
                    <option value="">— sin default —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {error && (
              <p className="text-sm text-[#C7301B] bg-[#FFF0F0] rounded-[10px] px-3.5 py-2.5">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="pill-outline"
              >
                Cancelar
              </button>
              <button type="submit" disabled={pending} className="pill-primary">
                {pending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
