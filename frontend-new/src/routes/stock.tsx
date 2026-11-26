/**
 * Ruta /app2/stock — SKU breakdown por cliente (ADR-013 P1.6).
 *
 * Muestra 10 campos del breakdown siguiendo §39/§103/§107 CLAUDE.md:
 *   1. Físico dep 11
 *   2. En tránsito dep 12 (informativo)
 *   3. Back order (app)
 *   4. Asignadas
 *   5. Confirmadas sin facturar
 *   6. Waitlist CPST (informativo)
 *   7. Reparto abierto (informativo)
 *   8. Reservadas total
 *   9. Libre para la venta
 *   10. Utilizable para este cliente
 *
 * Fórmula explícita visible: `físico − asignadas − confirmadas = libre`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loading, TableSkeleton } from '../components/Loading.js';
import { getStock } from '../lib/api.js';
import { initVitals } from '../lib/vitals.js';
import type { GetStockOutput } from '../contracts/get-stock.js';

interface Row {
  label: string;
  value: number;
  tone: 'physical' | 'bucket' | 'derived' | 'info';
}

function toRows(breakdown: GetStockOutput, cardCode: string): Row[] {
  return [
    { label: 'Físico (dep 11)', value: breakdown.fisicoDep11, tone: 'physical' },
    { label: 'En tránsito (dep 12)', value: breakdown.transitoDep12, tone: 'info' },
    { label: 'Back order (app)', value: breakdown.backorderApp.total, tone: 'bucket' },
    { label: 'Asignadas', value: breakdown.asignadas.total, tone: 'bucket' },
    {
      label: 'Confirmadas sin facturar',
      value: breakdown.confirmadasSinFacturar.total,
      tone: 'bucket',
    },
    { label: 'Waitlist CPST (informativo)', value: breakdown.waitlistCpst.total, tone: 'info' },
    { label: 'Reparto abierto', value: breakdown.repartoAbierto.qty, tone: 'info' },
    { label: 'Reservadas (total)', value: breakdown.reservadasTotal, tone: 'derived' },
    { label: 'Libre para la venta', value: breakdown.libre, tone: 'derived' },
    { label: `Utilizable para ${cardCode}`, value: breakdown.utilizablePara, tone: 'derived' },
  ];
}

function formulaLine(breakdown: GetStockOutput): string {
  const { fisicoDep11, asignadas, confirmadasSinFacturar, libre } = breakdown;
  return `Cuenta: ${fisicoDep11} físico − ${asignadas.total} asignadas − ${confirmadasSinFacturar.total} confirmadas = ${libre} libres`;
}

export default function StockRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCardCode = searchParams.get('cliente') ?? '';
  const initialSku = searchParams.get('sku') ?? '';

  const [cardCodeInput, setCardCodeInput] = useState(initialCardCode);
  const [skuInput, setSkuInput] = useState(initialSku);
  const [submitted, setSubmitted] = useState<{ cardCode: string; sku: string } | null>(
    initialCardCode && initialSku ? { cardCode: initialCardCode, sku: initialSku } : null,
  );

  useEffect(() => {
    initVitals('/app2/stock');
  }, []);

  const query = useQuery({
    queryKey: ['stock', submitted?.cardCode, submitted?.sku],
    queryFn: ({ signal }) =>
      getStock({ cardCode: submitted!.cardCode, sku: submitted!.sku, signal }),
    enabled: Boolean(submitted?.cardCode && submitted?.sku),
  });

  const rows = useMemo(
    () => (query.data ? toRows(query.data, submitted!.cardCode) : null),
    [query.data, submitted],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cardCode = cardCodeInput.trim().toUpperCase();
    const sku = skuInput.trim().toUpperCase();
    if (!cardCode || !sku) return;
    setSubmitted({ cardCode, sku });
    setSearchParams({ cliente: cardCode, sku });
  }

  return (
    <section aria-labelledby="stock-title">
      <h1 id="stock-title" style={{ fontSize: '1.4em', marginTop: 0 }}>
        Stock por cliente
      </h1>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
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
            inputMode="text"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: '0.85em', color: 'var(--color-text-secondary)' }}>SKU</span>
          <input
            className="app2-input"
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            placeholder="TRX301B"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
          />
        </label>

        <button type="submit" className="pill-btn" disabled={!cardCodeInput || !skuInput}>
          Ver stock
        </button>
      </form>

      {!submitted && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Ingresá un cliente y un SKU para ver el stock.
        </p>
      )}

      {submitted && query.isPending && <TableSkeleton rows={10} />}
      {submitted && query.isError && (
        // ErrorBoundary de la ruta captura — este path solo cubre error silencioso.
        <p role="alert">No se pudo cargar el stock. Reintentá.</p>
      )}

      {submitted && query.isSuccess && query.data && rows && (
        <article>
          <header style={{ marginBottom: 'var(--space-md)' }}>
            <p style={{ margin: 0 }}>
              <strong>{query.data.sku}</strong> · cliente {submitted.cardCode}
            </p>
            <p style={{ margin: 0, fontSize: '0.85em', color: 'var(--color-text-secondary)' }}>
              Breakdown v{query.data._version}
            </p>
          </header>

          <table
            aria-label="Breakdown de stock"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.95em',
            }}
          >
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <td style={{ padding: 'var(--space-sm) 0', color: toneColor(row.tone) }}>
                    {row.label}
                  </td>
                  <td
                    style={{
                      padding: 'var(--space-sm) 0',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: row.tone === 'derived' ? 700 : 400,
                    }}
                  >
                    {row.value.toLocaleString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p
            style={{
              marginTop: 'var(--space-lg)',
              padding: 'var(--space-md)',
              background: 'var(--color-bg-alt)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9em',
            }}
            data-testid="stock-formula"
          >
            {formulaLine(query.data)}
          </p>
        </article>
      )}
    </section>
  );
}

function toneColor(tone: Row['tone']): string {
  if (tone === 'derived') return 'var(--color-text)';
  if (tone === 'info') return 'var(--color-text-secondary)';
  return 'var(--color-text)';
}
