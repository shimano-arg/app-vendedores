'use client';
import { useState, useTransition } from 'react';
import { Paperclip, X } from 'lucide-react';
import { CLAIM_TYPES } from '@/lib/claim-types';
import { createClient } from '@/lib/supabase/client';
import { createClaim, uploadAttachmentMetadata } from './actions';

export function NewClaimDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [videoArmado, setVideoArmado] = useState(false);
  const [videoCliente, setVideoCliente] = useState(false);
  const supabase = createClient();

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...picked]);
    e.target.value = '';
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setError(null);
    setFiles([]);
    setVideoArmado(false);
    setVideoCliente(false);
  }

  function onSubmit(fd: FormData) {
    setError(null);
    const input = {
      remitoNumber: fd.get('remito_number'),
      observations: fd.get('observations'),
      claimType: fd.get('claim_type'),
      invoiceNumber: fd.get('invoice_number'),
      clientName: fd.get('client_name'),
      fantasyName: fd.get('fantasy_name'),
      videoArmadoReviewed: videoArmado,
      videoClienteReviewed: videoCliente,
    };
    const filesSnapshot = files;
    startTransition(async () => {
      const res = await createClaim(input);
      if (!res.ok || !res.claimId) {
        setError(res.error ?? 'Error');
        return;
      }
      for (const file of filesSnapshot) {
        const path = `${res.claimId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from('claim-attachments')
          .upload(path, file);
        if (upErr) {
          setError(`Reclamo creado, pero falló subida de "${file.name}": ${upErr.message}`);
          continue;
        }
        await uploadAttachmentMetadata({
          claimId: res.claimId,
          storagePath: path,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        });
      }
      setOpen(false);
      reset();
      window.location.reload();
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="pill-primary">
        <span className="text-base leading-none">+</span>
        <span>Nuevo reclamo</span>
      </button>
      {open && (
        <div
          className="sheet-backdrop flex items-start justify-center z-50 p-6 pt-24 overflow-y-auto"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          <form
            action={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="sheet-panel w-full max-w-md p-5 space-y-3 my-3"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow mb-1">Reclamo</p>
                <h2 className="display text-xl">Nuevo</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="p-1.5 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.04)] transition-colors"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                  Nº Remito
                </span>
                <input
                  name="remito_number"
                  required
                  autoFocus
                  className="field mt-1.5"
                  placeholder="R-1234"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                  Nº Factura
                </span>
                <input
                  name="invoice_number"
                  className="field mt-1.5"
                  placeholder="A-0001-00012345"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                  Cliente
                </span>
                <input
                  name="client_name"
                  className="field mt-1.5"
                  placeholder="Razón social"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                  Nombre fantasía
                </span>
                <input
                  name="fantasy_name"
                  className="field mt-1.5"
                  placeholder="Pesca del Sur"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                Tipo de reclamo
              </span>
              <select
                name="claim_type"
                required
                defaultValue=""
                className="field mt-1.5"
              >
                <option value="" disabled>
                  Elegí un tipo…
                </option>
                {CLAIM_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                Observaciones
              </span>
              <textarea
                name="observations"
                required
                rows={3}
                className="field mt-1.5 resize-none"
                placeholder="Describí qué pasó con el remito…"
              />
            </label>

            <div>
              <span className="text-xs font-medium text-[color:var(--text-secondary)] block mb-1.5">
                Checklist de revisión
              </span>
              <div className="flex gap-5">
                <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[color:var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={videoArmado}
                    onChange={(e) => setVideoArmado(e.target.checked)}
                    className="h-4 w-4 accent-[color:var(--accent-blue)] cursor-pointer"
                  />
                  Video armado
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[color:var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={videoCliente}
                    onChange={(e) => setVideoCliente(e.target.checked)}
                    className="h-4 w-4 accent-[color:var(--accent-blue)] cursor-pointer"
                  />
                  Video cliente
                </label>
              </div>
            </div>

            <div>
              <span className="text-xs font-medium text-[color:var(--text-secondary)] block mb-2">
                Adjuntos
              </span>
              {files.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between gap-2 text-[13px] text-[color:var(--text-primary)] bg-[rgba(0,0,0,0.03)] rounded-[8px] px-2.5 py-1.5"
                    >
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <Paperclip className="h-3.5 w-3.5 text-[color:var(--text-tertiary)] shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-[11px] text-[color:var(--text-tertiary)] tabular-nums shrink-0">
                          {Math.round(f.size / 1024)} KB
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="p-0.5 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.06)]"
                        aria-label="Quitar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="pill-outline cursor-pointer inline-flex">
                <Paperclip className="h-3.5 w-3.5" />
                <span>Adjuntar archivos</span>
                <input
                  type="file"
                  multiple
                  onChange={onFilesChange}
                  className="hidden"
                />
              </label>
            </div>

            {error && (
              <p className="text-sm text-[#C7301B] bg-[#FFF0F0] rounded-[10px] px-3.5 py-2.5">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="pill-outline"
              >
                Cancelar
              </button>
              <button type="submit" disabled={pending} className="pill-primary">
                {pending ? 'Creando…' : 'Crear reclamo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
