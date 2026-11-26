/**
 * Ruta /app2/pedidos — últimos pedidos del cliente (ADR-013 P1.6).
 *
 * Input cardCode → keyset paginated list. Cards con fecha + cliente + ARS + N SKUs.
 * Click card → modal detalle líneas.
 */

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Loading.js';
import type { PedidoSlim } from '../contracts/get-pedidos.js';
import { getPedidos } from '../lib/api.js';
import { initVitals } from '../lib/vitals.js';

const ARS_FMT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PedidosRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCardCode = searchParams.get('cliente') ?? '';

  const [cardCodeInput, setCardCodeInput] = useState(initialCardCode);
  const [submittedCard, setSubmittedCard] = useState<string | null>(
    initialCardCode ? initialCardCode : null
  );
  const [selected, setSelected] = useState<PedidoSlim | null>(null);

  useEffect(() => {
    initVitals('/app2/pedidos');
  }, []);

  const query = useQuery({
    queryKey: ['pedidos', submittedCard],
    queryFn: ({ signal }) => getPedidos({ cardCode: submittedCard!, limit: 30, signal }),
    enabled: Boolean(submittedCard),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const card = cardCodeInput.trim().toUpperCase();
    if (!card) return;
    setSubmittedCard(card);
    setSearchParams({ cliente: card });
  }

  return (
    <section aria-labelledby="pedidos-title">
      <h1 id="pedidos-title" style={{ fontSize: '1.4em', marginTop: 0 }}>
        Pedidos del cliente
      </h1>

      <form
        onSubmit={onSubmit}
        style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}
      >
        <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: '0.85em', color: 'var(--color-text-secondary)' }}>
            Cliente (cardCode)
          </span>
          <input
            className="app2-input"
            value={cardCodeInput}
            onChange={(e) => setCardCodeInput(e.target.value)}
            placeholder="CXXXXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="pill-btn" disabled={!cardCodeInput}>
          Ver pedidos
        </button>
      </form>

      {!submittedCard && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Ingresá un cliente para ver sus últimos pedidos.
        </p>
      )}

      {submittedCard && query.isPending && <Loading label="Buscando pedidos…" />}
      {submittedCard && query.isSuccess && query.data && (
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }} data-testid="pedidos-list">
          {query.data.items.length === 0 && (
            <p>No encontramos pedidos abiertos para {submittedCard}.</p>
          )}
          {query.data.items.map((pedido) => (
            <button
              key={pedido.id}
              type="button"
              onClick={() => setSelected(pedido)}
              style={{
                textAlign: 'left',
                background: 'var(--color-bg-alt)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-md)',
                cursor: 'pointer',
                minHeight: '88px',
                color: 'var(--color-text)',
              }}
              data-testid={`pedido-card-${pedido.orderNumber}`}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' }}
              >
                <strong>ORDEN {pedido.orderNumber}</strong>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {pedido.netAmountArs !== null ? ARS_FMT.format(pedido.netAmountArs) : '—'}
                </span>
              </div>
              <p style={{ margin: '4px 0', fontSize: '0.9em' }}>{pedido.clientName}</p>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.8em',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {fmtDate(pedido.createdAt)} · {pedido.lines.length}{' '}
                {pedido.lines.length === 1 ? 'SKU' : 'SKUs'}
              </p>
            </button>
          ))}
          {query.data.pageInfo.hasMore && (
            <p style={{ fontSize: '0.85em', color: 'var(--color-text-secondary)' }}>
              Hay más pedidos. Paginación por cursor va a estar en la próxima iteración.
            </p>
          )}
        </div>
      )}

      {selected && <PedidoDetailModal pedido={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

interface PedidoDetailModalProps {
  pedido: PedidoSlim;
  onClose: () => void;
}

function PedidoDetailModal({ pedido, onClose }: PedidoDetailModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handler ya está wire via useEffect window.keydown (línea 164-169).
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pedido-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 20,
      }}
      onClick={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: 'var(--space-lg)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-md)',
          }}
        >
          <h2 id="pedido-modal-title" style={{ margin: 0 }}>
            ORDEN {pedido.orderNumber}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="pill-btn"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              padding: '0 var(--space-md)',
              background: 'var(--color-bg-alt)',
              color: 'var(--color-text)',
            }}
          >
            Cerrar
          </button>
        </header>

        <p style={{ marginTop: 0 }}>{pedido.clientName}</p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
          {fmtDate(pedido.createdAt)} · origen {pedido.origen}
        </p>

        <table
          aria-label="Líneas del pedido"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}
          data-testid="pedido-detail-lines"
        >
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th align="left">SKU</th>
              <th align="right">Qty</th>
              <th align="right">Abierto</th>
              <th align="left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedido.lines.map((line, idx) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: shape slim sin lineId
                key={`${line.sku}-${idx}`}
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <td style={{ padding: 'var(--space-xs) 0', fontFamily: 'var(--font-mono)' }}>
                  {line.sku}
                </td>
                <td align="right" style={{ padding: 'var(--space-xs) 0' }}>
                  {line.qty}
                </td>
                <td align="right" style={{ padding: 'var(--space-xs) 0' }}>
                  {line.qtyOpen}
                </td>
                <td style={{ padding: 'var(--space-xs) 0' }}>{line.state}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {pedido.netAmountArs !== null && (
          <p
            style={{
              marginTop: 'var(--space-md)',
              padding: 'var(--space-md)',
              background: 'var(--color-bg-alt)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'right',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
            }}
          >
            Total: {ARS_FMT.format(pedido.netAmountArs)}
          </p>
        )}
      </div>
    </div>
  );
}
