import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

/**
 * vitals.ts — inicializa web-vitals y rutea los eventos.
 *
 * ADR-015 metrics target (Moto G Power / 4G throttle):
 *  - LCP ≤ 2.5s
 *  - INP ≤ 200ms
 *  - CLS ≤ 0.1
 *
 * P1.5: log a console.log con prefijo estable `[CWV]` para que los runs locales
 *       (y el script `scripts/perf/measure-vitals-app2.js`) los detecten.
 *
 * P1.6: el backend-new expone POST /api/metrics/cwv que escribe a operations_log
 *       con shape {type:'cwv_metric', metric:'LCP', value:..., delta:..., id:...,
 *       route:..., userId:...}. Hacemos navigator.sendBeacon ahi (idempotente,
 *       sobrevive a tab close).
 */

interface VitalsEvent {
  readonly name: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
  readonly value: number;
  readonly delta: number;
  readonly id: string;
  readonly rating: 'good' | 'needs-improvement' | 'poor';
}

function report(metric: VitalsEvent): void {
  // Prefix estable para logs de CI y scripts de medicion.
  // eslint-disable-next-line no-console
  console.log(
    `[CWV] ${metric.name}=${metric.value.toFixed(2)} (${metric.rating}) delta=${metric.delta.toFixed(2)} id=${metric.id}`
  );

  // P1.6: navigator.sendBeacon('/api/metrics/cwv', JSON.stringify(metric))
  // envolver en try/catch — nunca romper por telemetria.
}

/**
 * Inicializa los listeners. Llamar una sola vez por page load.
 * Idempotente: `web-vitals` protege contra doble-subscription.
 */
export function initVitals(): void {
  if (typeof window === 'undefined') return;
  try {
    onCLS(report);
    onFCP(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
  } catch (err) {
    console.warn('[frontend-new] initVitals fallo:', err);
  }
}
