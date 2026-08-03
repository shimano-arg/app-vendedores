import { describe, expect, it, vi } from 'vitest';
import { formatBackupTimestamp, runDailyBackup } from '../../functions/core/backup-core.js';

const FIXED_NOW = new Date('2026-07-24T05:00:00Z'); // 02:00 AR = 05:00 UTC

/** @param {Partial<Parameters<typeof runDailyBackup>[0]>} over */
function makeDeps(over = {}) {
  return {
    projectId: 'app-vendedores-shimano',
    bucketName: 'app-vendedores-shimano-backups',
    now: () => FIXED_NOW,
    exportDocuments: vi.fn(async () => ({
      name: 'projects/app-vendedores-shimano/databases/(default)/operations/op-1',
    })),
    log: vi.fn(),
    ...over,
  };
}

describe('formatBackupTimestamp', () => {
  it('UTC: 2026-07-24 → "2026-07-24"', () => {
    expect(formatBackupTimestamp(new Date('2026-07-24T05:00:00Z'))).toBe('2026-07-24');
  });
  it('cerca de medianoche AR (03:00 UTC = 00:00 AR) da la fecha UTC (evita ambigüedad)', () => {
    // AR 25 julio 00:00 = UTC 25 julio 03:00. Elegimos la fecha UTC para
    // que dos runs cercanos a medianoche no colisionen en la misma carpeta.
    expect(formatBackupTimestamp(new Date('2026-07-25T03:00:00Z'))).toBe('2026-07-25');
  });
  it('formato zero-padded para meses/días de 1 dígito', () => {
    expect(formatBackupTimestamp(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});

describe('runDailyBackup — request wiring', () => {
  it('happy: llama exportDocuments con name, outputUriPrefix y collectionIds vacío', async () => {
    const deps = makeDeps();
    const result = await runDailyBackup(deps);

    expect(deps.exportDocuments).toHaveBeenCalledTimes(1);
    const req = deps.exportDocuments.mock.calls[0][0];
    expect(req.name).toBe('projects/app-vendedores-shimano/databases/(default)');
    expect(req.outputUriPrefix).toBe('gs://app-vendedores-shimano-backups/firestore/2026-07-24/');
    expect(req.collectionIds).toEqual([]); // export todas

    expect(result.outputUriPrefix).toBe(
      'gs://app-vendedores-shimano-backups/firestore/2026-07-24/'
    );
    expect(result.operationName).toBe(
      'projects/app-vendedores-shimano/databases/(default)/operations/op-1'
    );
    expect(result.timestamp).toBe('2026-07-24');
  });

  it('bucket distinto: outputUriPrefix respeta el bucketName inyectado', async () => {
    const deps = makeDeps({ bucketName: 'otro-bucket' });
    await runDailyBackup(deps);
    const req = deps.exportDocuments.mock.calls[0][0];
    expect(req.outputUriPrefix).toBe('gs://otro-bucket/firestore/2026-07-24/');
  });

  it('projectId distinto: name respeta el projectId inyectado', async () => {
    const deps = makeDeps({ projectId: 'otro-proyecto' });
    await runDailyBackup(deps);
    const req = deps.exportDocuments.mock.calls[0][0];
    expect(req.name).toBe('projects/otro-proyecto/databases/(default)');
  });

  it('operación sin name: result.operationName queda undefined pero no falla', async () => {
    const deps = makeDeps({ exportDocuments: vi.fn(async () => ({})) });
    const result = await runDailyBackup(deps);
    expect(result.operationName).toBeUndefined();
    expect(result.outputUriPrefix).toBeTruthy();
  });
});

describe('runDailyBackup — errores', () => {
  it('projectId vacío → throw', async () => {
    const deps = makeDeps({ projectId: '' });
    await expect(runDailyBackup(deps)).rejects.toThrow(/projectId y bucketName/);
  });

  it('bucketName vacío → throw', async () => {
    const deps = makeDeps({ bucketName: '' });
    await expect(runDailyBackup(deps)).rejects.toThrow(/projectId y bucketName/);
  });

  it('exportDocuments falla → re-throw (cloud logging captura)', async () => {
    const deps = makeDeps({
      exportDocuments: vi.fn(async () => {
        throw new Error('PERMISSION_DENIED: needs datastore.importExportAdmin');
      }),
    });
    await expect(runDailyBackup(deps)).rejects.toThrow(/PERMISSION_DENIED/);
  });
});

describe('runDailyBackup — logging', () => {
  it('loguea start, éxito con outputUriPrefix + operationName', async () => {
    const logs = [];
    const deps = makeDeps({ log: (msg, extra) => logs.push({ msg, extra }) });
    await runDailyBackup(deps);

    const startLog = logs.find((l) => l.msg === 'dailyFirestoreBackup starting');
    const okLog = logs.find((l) => l.msg === 'dailyFirestoreBackup started operation');
    expect(startLog).toBeTruthy();
    expect(okLog).toBeTruthy();
    expect(okLog.extra.operationName).toBe(
      'projects/app-vendedores-shimano/databases/(default)/operations/op-1'
    );
  });

  it('loguea "dailyFirestoreBackup failed" antes de re-throw (para alerta)', async () => {
    const logs = [];
    const deps = makeDeps({
      log: (msg, extra) => logs.push({ msg, extra }),
      exportDocuments: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(runDailyBackup(deps)).rejects.toThrow();
    const failLog = logs.find((l) => l.msg === 'dailyFirestoreBackup failed');
    expect(failLog).toBeTruthy();
    expect(failLog.extra.error).toContain('boom');
  });
});
