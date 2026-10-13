'use client';
import { useState, useTransition } from 'react';
import { addComment } from './actions';

export function CommentBox({ claimId }: { claimId: number }) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!text.trim()) return;
    startTransition(async () => {
      const res = await addComment({ claimId, text });
      if (res.ok) {
        setText('');
        window.location.reload();
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <section>
      <p className="eyebrow mb-2">Agregar comentario</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Escribí una nota para el próximo responsable…"
        className="field resize-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={submit}
          disabled={pending || !text.trim()}
          className="pill-primary"
        >
          {pending ? 'Enviando…' : 'Comentar'}
        </button>
      </div>
    </section>
  );
}
