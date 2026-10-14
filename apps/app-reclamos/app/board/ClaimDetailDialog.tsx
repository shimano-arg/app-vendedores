'use client';
import { Check, Link2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CLAIM_TYPE_LABEL, type ClaimType } from '@/lib/claim-types';
import { COLUMN_LABEL, type ClaimColumn } from '@/lib/columns';
import type { Database } from '@/lib/supabase/types';

type Claim = Database['public']['Tables']['claims']['Row'];
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'email'>;

export function ClaimDetailDialog({
  claim,
  profiles,
  children,
  sideContent,
}: {
  claim: Claim;
  profiles: Profile[];
  children?: React.ReactNode;
  sideContent?: React.ReactNode;
}) {
  const router = useRouter();
  const assignee = profiles.find((p) => p.id === claim.assignee_id);
  const [copied, setCopied] = useState(false);
  function close() {
    router.push('/board');
  }
  // v1262: Esc cierra el modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // biome-ignore lint/correctness/useExhaustiveDependencies: close es estable (router.push)
  }, []);
  // v1262: copiar deep-link al reclamo. El modal ya se abre con ?claim=X,
  // así que window.location.href es el link canónico. Fallback silent si
  // navigator.clipboard no está disponible (ej. http sin tls).
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: nada. En desktop sobre https siempre funciona.
    }
  }
  return (
    <div
      className="sheet-backdrop flex items-start justify-center z-40 p-6 pt-24"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-panel w-full max-w-5xl my-6 flex flex-col max-h-[calc(100vh-3rem)]"
      >
        <header className="flex items-start justify-between px-7 pt-7 pb-5 border-b border-[color:var(--hairline)] shrink-0">
          <div>
            <p className="eyebrow mb-1">Reclamo #{claim.id}</p>
            <h2 className="display text-xl">Remito {claim.remito_number}</h2>
            <div className="flex items-center gap-2 mt-2.5 text-[13px] text-[color:var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-blue)]" />
                {COLUMN_LABEL[claim.current_column as ClaimColumn]}
              </span>
              <span className="text-[color:var(--text-tertiary)]">·</span>
              <span>{assignee?.display_name ?? 'Sin asignar'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={copyLink}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all ${copied ? 'bg-[color:var(--color-success-bg,#e8f5e9)] text-[color:var(--color-success,#1a7f37)]' : 'text-[color:var(--text-secondary)] hover:bg-[rgba(0,0,0,0.04)]'}`}
              aria-label="Copiar link del reclamo"
              title="Copiar link del reclamo"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Link2 className="h-3.5 w-3.5" />
                  <span>Copiar link</span>
                </>
              )}
            </button>
            <button
              onClick={close}
              className="p-1.5 rounded-full text-[color:var(--text-tertiary)] hover:bg-[rgba(0,0,0,0.04)] transition-colors"
              aria-label="Cerrar (Esc)"
              title="Cerrar (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="px-7 py-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
          <div className="space-y-6 min-w-0">
            {(claim.invoice_number || claim.client_name || claim.fantasy_name || claim.claim_type) && (
              <section>
                <p className="eyebrow mb-2">Datos</p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                  {claim.claim_type && (
                    <div>
                      <dt className="text-[color:var(--text-tertiary)] text-[11px] uppercase tracking-wide">
                        Tipo
                      </dt>
                      <dd className="text-[color:var(--text-primary)]">
                        {CLAIM_TYPE_LABEL[claim.claim_type as ClaimType] ?? claim.claim_type}
                      </dd>
                    </div>
                  )}
                  {claim.invoice_number && (
                    <div>
                      <dt className="text-[color:var(--text-tertiary)] text-[11px] uppercase tracking-wide">
                        Factura
                      </dt>
                      <dd className="text-[color:var(--text-primary)]">{claim.invoice_number}</dd>
                    </div>
                  )}
                  {claim.client_name && (
                    <div>
                      <dt className="text-[color:var(--text-tertiary)] text-[11px] uppercase tracking-wide">
                        Cliente
                      </dt>
                      <dd className="text-[color:var(--text-primary)]">{claim.client_name}</dd>
                    </div>
                  )}
                  {claim.fantasy_name && (
                    <div>
                      <dt className="text-[color:var(--text-tertiary)] text-[11px] uppercase tracking-wide">
                        Nombre fantasía
                      </dt>
                      <dd className="text-[color:var(--text-primary)]">{claim.fantasy_name}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
            <section>
              <p className="eyebrow mb-2">Observaciones</p>
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-[color:var(--text-primary)] break-words">
                {claim.observations}
              </p>
            </section>
            {children}
          </div>
          {sideContent && <div className="space-y-6 min-w-0">{sideContent}</div>}
        </div>
      </div>
    </div>
  );
}
