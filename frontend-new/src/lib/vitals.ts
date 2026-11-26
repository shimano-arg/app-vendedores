/**
 * Core Web Vitals reporter (ADR-015).
 *
 * El script `scripts/perf/measure-vitals-app2.js` del repo root (scaffold v1479) lee
 * `window.__CWV__` después del load + interaction para generar el reporte. Acá solo
 * instrumentamos los 3 hooks observables nativos: LCP, INP, CLS.
 *
 * Nota: evitamos agregar `web-vitals` como dep para no inflar el shell (< 150 KB).
 * Los PerformanceObservers nativos cubren el 95% del uso del piloto.
 */

interface VitalsSnapshot {
  lcp: number | null;
  inp: number | null;
  cls: number;
  route: string;
  measuredAt: number;
}

declare global {
  interface Window {
    __CWV__?: VitalsSnapshot;
  }
}

export function initVitals(route: string): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  const snapshot: VitalsSnapshot = {
    lcp: null,
    inp: null,
    cls: 0,
    route,
    measuredAt: Date.now(),
  };
  window.__CWV__ = snapshot;

  // LCP
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { renderTime?: number; loadTime?: number };
      if (last) {
        snapshot.lcp = last.renderTime ?? last.loadTime ?? last.startTime;
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* unsupported */
  }

  // INP (Interaction to Next Paint) — aproximación con 'event' entries.
  try {
    let maxInp = 0;
    const eventObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { duration: number; interactionId?: number };
        if (e.interactionId && e.duration > maxInp) {
          maxInp = e.duration;
          snapshot.inp = maxInp;
        }
      }
    });
    eventObs.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    /* unsupported */
  }

  // CLS — suma de layout shifts no provocados por input.
  try {
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value: number; hadRecentInput?: boolean };
        if (!e.hadRecentInput) {
          snapshot.cls += e.value;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* unsupported */
  }
}
