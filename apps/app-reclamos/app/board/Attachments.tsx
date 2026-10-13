'use client';
import { useState, useTransition } from 'react';
import { Paperclip } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadAttachmentMetadata } from './actions';
import type { Database } from '@/lib/supabase/types';

type Attachment = Database['public']['Tables']['attachments']['Row'];

export function Attachments({
  claimId,
  initial,
}: {
  claimId: number;
  initial: Attachment[];
}) {
  const [attachments] = useState<Attachment[]>(initial);
  const [pending, startTransition] = useTransition();
  const supabase = createClient();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const path = `${claimId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('claim-attachments')
        .upload(path, file);
      if (upErr) {
        alert('Falló subida: ' + upErr.message);
        return;
      }
      const res = await uploadAttachmentMetadata({
        claimId,
        storagePath: path,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });
      if (!res.ok) alert(res.error);
      else window.location.reload();
    });
  }

  async function download(a: Attachment) {
    const { data } = await supabase.storage
      .from('claim-attachments')
      .createSignedUrl(a.storage_path, 60 * 5);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  return (
    <section>
      <p className="eyebrow mb-2">Adjuntos</p>
      {attachments.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-tertiary)] mb-3">
          Sin archivos.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {attachments.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => download(a)}
                className="inline-flex items-center gap-2 text-[13px] text-[color:var(--accent-blue)] hover:underline"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="font-medium">{a.file_name}</span>
                {a.file_size ? (
                  <span className="text-[11px] text-[color:var(--text-tertiary)] tabular-nums">
                    {Math.round(a.file_size / 1024)} KB
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="pill-outline cursor-pointer inline-flex">
        <Paperclip className="h-3.5 w-3.5" />
        <span>{pending ? 'Subiendo…' : 'Adjuntar archivo'}</span>
        <input type="file" onChange={onFile} disabled={pending} className="hidden" />
      </label>
    </section>
  );
}
