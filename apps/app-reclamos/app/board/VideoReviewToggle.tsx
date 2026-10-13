'use client';
import { useState, useTransition } from 'react';
import { toggleVideoReviewed } from './actions';

export function VideoReviewToggle({
  claimId,
  initialArmado,
  initialCliente,
}: {
  claimId: number;
  initialArmado: boolean;
  initialCliente: boolean;
}) {
  const [armado, setArmado] = useState(initialArmado);
  const [cliente, setCliente] = useState(initialCliente);
  const [pending, startTransition] = useTransition();

  function toggle(field: 'armado' | 'cliente', value: boolean) {
    if (field === 'armado') setArmado(value);
    else setCliente(value);
    startTransition(async () => {
      const res = await toggleVideoReviewed({ claimId, field, value });
      if (!res.ok) {
        alert(res.error ?? 'Error al actualizar');
        if (field === 'armado') setArmado(!value);
        else setCliente(!value);
      }
    });
  }

  return (
    <section>
      <p className="eyebrow mb-2">Checklist de revisión</p>
      <fieldset className="rounded-[12px] border border-[color:var(--hairline)] px-3.5 py-2.5">
        <label className="flex items-center gap-2.5 py-1.5 cursor-pointer text-[13px] text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            checked={armado}
            disabled={pending}
            onChange={(e) => toggle('armado', e.target.checked)}
            className="h-4 w-4 accent-[color:var(--accent-blue)] cursor-pointer"
          />
          Video de armado revisado
        </label>
        <label className="flex items-center gap-2.5 py-1.5 cursor-pointer text-[13px] text-[color:var(--text-primary)]">
          <input
            type="checkbox"
            checked={cliente}
            disabled={pending}
            onChange={(e) => toggle('cliente', e.target.checked)}
            className="h-4 w-4 accent-[color:var(--accent-blue)] cursor-pointer"
          />
          Video del cliente revisado
        </label>
      </fieldset>
    </section>
  );
}
