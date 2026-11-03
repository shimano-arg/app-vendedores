// C9 contencion: repair-quotation-closure-race-victims.mjs con guard.
// Sin red: Firestore y SAP son dobles inyectados en runRepair().
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  BACKFILL_SLUG,
  buildRepairPatch,
  runRepair,
} from '../../../scripts/repair-quotation-closure-race-victims.mjs';

const require = createRequire(import.meta.url);
const { resolveTarget, SafeTargetError } = require('../../../scripts/_lib/safe-target.cjs');

const PROD = 'app-vendedores-shimano';
const SA = JSON.stringify({ type: 'service_account', client_email: 'bot@x', project_id: PROD });
const DEL = () => '__DELETE__';

function target(argv) {
  return resolveTarget({
    argv,
    env: { GOOGLE_APPLICATION_CREDENTIALS: '/sa.json' },
    readFile: () => SA,
  });
}

function fakeDb(docs) {
  const updates = [];
  return {
    updates,
    collection: () => ({
      where: () => ({
        get: async () => ({
          forEach: (cb) => docs.forEach((d) => cb({ id: d.id, data: () => d.data })),
        }),
      }),
    }),
    doc: (path) => ({ update: async (patch) => updates.push({ path, patch }) }),
  };
}

const DOCS = [
  {
    id: 'P1',
    data: {
      closedAt: '2026-09-29',
      closedReason: 'sap_manual_close',
      transferidoSAP: { closedManuallyInSap: true, docNum: 1 },
    },
  },
  { id: 'P2', data: { closedAt: '2026-09-29', transferidoSAP: { closedManuallyInSap: true } } },
  { id: 'P3', data: { closedAt: '2026-09-29', transferidoSAP: {} } },
];
const findSo = async (_s, id) => (id === 'P1' ? { docEntry: 20067, docNum: 20067 } : null);
const deps = (t, db) => ({
  t,
  fbDb: db,
  findSo,
  fieldDelete: DEL,
  login: async () => ({}),
  logout: async () => {},
  log: () => {},
  now: () => '2026-11-02T00:00:00Z',
});

describe('repair-quotation-closure-race-victims con guard C9', () => {
  it('sin --project bloquea antes de abrir nada', () => {
    expect(() => target([])).toThrow(SafeTargetError);
  });

  it('la invocacion vieja con --dry-run sin --project tambien bloquea', () => {
    try {
      target(['--dry-run']);
      throw new Error('no bloqueo');
    } catch (e) {
      expect(e.code).toBe('E_NO_PROJECT');
    }
  });

  it('dry-run por defecto: detecta victimas pero no escribe', async () => {
    const db = fakeDb(DOCS);
    const s = await runRepair(deps(target(['--project', PROD]), db));
    expect(s).toMatchObject({ salvaged: 1, confirmed: 1, errors: 0, candidates: 2 });
    expect(db.updates).toEqual([]);
  });

  it('apply: actualiza solo la victima y guarda previousValues (§55)', async () => {
    const db = fakeDb(DOCS);
    const t = target(['--project', PROD, '--apply', `--confirm-project=${PROD}`]);
    await runRepair(deps(t, db));
    expect(db.updates).toHaveLength(1);
    const { path, patch } = db.updates[0];
    expect(path).toBe('pedidos/P1');
    expect(patch.closedAt).toBe('__DELETE__');
    expect(patch.transferidoSAP).toMatchObject({ orderDocEntry: 20067, docNum: 1 });
    expect(patch.transferidoSAP.closedManuallyInSap).toBeUndefined();
    const bf = patch[`_backfill.${BACKFILL_SLUG}`];
    expect(bf.previousValues).toMatchObject({
      closedAt: '2026-09-29',
      closedReason: 'sap_manual_close',
      closedBy: null,
    });
    expect(bf.previousValues.transferidoSAP.closedManuallyInSap).toBe(true);
  });

  it('apply en prod sin --confirm-project no pasa el guard', async () => {
    const { confirmIfNeeded } = require('../../../scripts/_lib/safe-target.cjs');
    const t = target(['--project', PROD, '--apply']);
    await expect(confirmIfNeeded(t, null)).rejects.toMatchObject({
      code: 'E_CONFIRMATION_REQUIRED',
    });
  });

  it('SA de otro proyecto bloquea aunque sea dry-run', () => {
    expect(() =>
      resolveTarget({
        argv: ['--project', 'app-vendedores-shimano-stg'],
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/sa.json' },
        readFile: () => SA,
      })
    ).toThrow(/otro proyecto|proyecto/);
  });

  it('buildRepairPatch es puro (no muta el pedido)', () => {
    const data = { transferidoSAP: { closedManuallyInSap: true } };
    buildRepairPatch(data, { docEntry: 1, docNum: null }, 'now', DEL);
    expect(data.transferidoSAP.closedManuallyInSap).toBe(true);
  });
});
