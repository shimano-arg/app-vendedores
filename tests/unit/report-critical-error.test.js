import { describe, expect, it, vi } from 'vitest';
import { reportCriticalErrorPure } from '../../src/pure/report-critical-error.js';

function makeDeps(overrides = {}) {
  return {
    console: { error: vi.fn() },
    sentry: { captureException: vi.fn() },
    showErrorToast: vi.fn(),
    appVersion: 'v805',
    userEmail: 'test@shimano.com.ar',
    ...overrides,
  };
}

describe('reportCriticalErrorPure', () => {
  it('llama a console.error con el prefix [op] + err + extra', () => {
    const deps = makeDeps();
    const err = new Error('firestore permission denied');
    reportCriticalErrorPure(err, { op: 'waitlist-delete', extra: { docId: 'abc123' } }, deps);
    expect(deps.console.error).toHaveBeenCalledWith('[waitlist-delete]', err, { docId: 'abc123' });
  });

  it('llama a Sentry.captureException con tags op + source + extra enriquecido', () => {
    const deps = makeDeps();
    const err = new Error('boom');
    reportCriticalErrorPure(err, { op: 'save-default-delivery', extra: { cliDocId: 'X|Y|Z' } }, deps);
    expect(deps.sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { op: 'save-default-delivery', source: 'reportCriticalError' },
      extra: {
        cliDocId: 'X|Y|Z',
        appVersion: 'v805',
        userEmail: 'test@shimano.com.ar',
      },
    });
  });

  it('muestra toast al usuario con userMsg default si no se provee', () => {
    const deps = makeDeps();
    reportCriticalErrorPure(new Error('x'), { op: 'notif-vde-partner' }, deps);
    expect(deps.showErrorToast).toHaveBeenCalledWith(
      'No pude notif vde partner. Reintentá en un momento.',
    );
  });

  it('respeta userMsg custom si se provee', () => {
    const deps = makeDeps();
    reportCriticalErrorPure(
      new Error('x'),
      { op: 'auto-confirm-100bo', userMsg: 'Mensaje custom' },
      deps,
    );
    expect(deps.showErrorToast).toHaveBeenCalledWith('Mensaje custom');
  });

  it('silent=true NO muestra toast pero SÍ captura a Sentry + console.error', () => {
    const deps = makeDeps();
    reportCriticalErrorPure(new Error('x'), { op: 'theme-sync', silent: true }, deps);
    expect(deps.showErrorToast).not.toHaveBeenCalled();
    expect(deps.sentry.captureException).toHaveBeenCalledTimes(1);
    expect(deps.console.error).toHaveBeenCalledTimes(1);
  });

  it('sentry null (loader no cargó) NO rompe el flow — console + toast siguen', () => {
    const deps = makeDeps({ sentry: null });
    expect(() =>
      reportCriticalErrorPure(new Error('x'), { op: 'dm-announcement-persist' }, deps),
    ).not.toThrow();
    expect(deps.console.error).toHaveBeenCalledTimes(1);
    expect(deps.showErrorToast).toHaveBeenCalledTimes(1);
  });

  it('Sentry.captureException throwea → NO rompe el flow (best-effort)', () => {
    const deps = makeDeps({
      sentry: {
        captureException: vi.fn(() => {
          throw new Error('sentry internal error');
        }),
      },
    });
    expect(() =>
      reportCriticalErrorPure(new Error('x'), { op: 'waitlist-update-skipped' }, deps),
    ).not.toThrow();
    // Toast igual se muestra.
    expect(deps.showErrorToast).toHaveBeenCalledTimes(1);
  });

  it('showErrorToast throwea → NO rompe el flow (edge case bootstrap)', () => {
    const deps = makeDeps({
      showErrorToast: vi.fn(() => {
        throw new Error('DOM not ready');
      }),
    });
    expect(() =>
      reportCriticalErrorPure(new Error('x'), { op: 'notif-vde-partner' }, deps),
    ).not.toThrow();
    // Console + Sentry igual se llamaron.
    expect(deps.console.error).toHaveBeenCalledTimes(1);
    expect(deps.sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('op vacío → default a "unknown"', () => {
    const deps = makeDeps();
    reportCriticalErrorPure(new Error('x'), {}, deps);
    expect(deps.console.error).toHaveBeenCalledWith('[unknown]', expect.any(Error), {});
    expect(deps.sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ op: 'unknown' }) }),
    );
  });

  it('userEmail null (user logout) → extra queda con userEmail: null', () => {
    const deps = makeDeps({ userEmail: null });
    reportCriticalErrorPure(new Error('x'), { op: 'waitlist-delete' }, deps);
    expect(deps.sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ userEmail: null }),
      }),
    );
  });

  it('op con guiones se transforma a espacios en el userMsg default', () => {
    const deps = makeDeps();
    reportCriticalErrorPure(new Error('x'), { op: 'save-default-delivery-waitlist' }, deps);
    expect(deps.showErrorToast).toHaveBeenCalledWith(
      'No pude save default delivery waitlist. Reintentá en un momento.',
    );
  });
});
