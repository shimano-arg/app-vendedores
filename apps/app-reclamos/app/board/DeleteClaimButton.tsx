'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteClaim } from './actions';

export function DeleteClaimButton({
  claimId,
  remitoNumber,
}: {
  claimId: number;
  remitoNumber: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    const ok = window.confirm(
      `¿Eliminar el reclamo del remito ${remitoNumber}?\n\nSe borran también los comentarios, adjuntos y timeline. Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteClaim({ claimId });
      if (!res.ok) {
        alert(res.error ?? 'Error al eliminar');
        return;
      }
      router.push('/board');
      window.location.reload();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full border border-[#F4B5AE] bg-[#FFF5F3] px-4 py-2 text-sm font-medium text-[#C7301B] hover:bg-[#FFE9E4] hover:border-[#E88376] active:scale-[0.97] transition-all disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
      {pending ? 'Eliminando…' : 'Eliminar reclamo'}
    </button>
  );
}
