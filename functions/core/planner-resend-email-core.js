// @ts-check
/**
 * planner-resend-email-core.js (Planner Kanban, 2026-09-22)
 *
 * Pure core logic for callable `resendPlannerEmail`. No firebase-admin imports.
 * All side-effect dependencies are injected via `deps` (CLAUDE.md §7).
 *
 * Mariano-only callable that clears `plannerEmails.{column}.sentAt` then
 * invokes the same stage handler used by the Firestore trigger, so the email
 * re-sends idempotently.
 */

const VALID_COLUMNS = new Set([
  'lista_espera',
  'oferta',
  'ordenes',
  'confirmado',
  'facturar',
  'cobrado',
]);
const MARIANO_EMAILS = new Set(['erbinomariano@gmail.com', 'mariano.erbino@shimano.com.ar']);

/**
 * @param {{pedidoId: string, column: string}} data
 * @param {{uid: string, token: {email?: string, role?: string}} | null} auth
 * @param {{db: any, stageHandler: (event: any) => Promise<any>, log: {info: (m: string) => void, warn: (m: string) => void, error: (m: string) => void}}} deps
 * @returns {Promise<{ok: true, result: any}>}
 */
export async function handleResendPlannerEmail(data, auth, deps) {
  if (!auth?.uid) throw { code: 'unauthenticated', message: 'Login required' };
  const email = auth.token?.email;
  if (!email || !MARIANO_EMAILS.has(email))
    throw { code: 'permission-denied', message: 'Not authorized to resend' };
  if (!data?.pedidoId || !VALID_COLUMNS.has(data?.column))
    throw { code: 'invalid-argument', message: 'pedidoId + valid column required' };

  const snap = await deps.db.doc(`pedidos/${data.pedidoId}`).get();
  if (!snap.exists) throw { code: 'not-found', message: `Pedido ${data.pedidoId} not found` };

  // Clear idempotency flag.
  await snap.ref.update({ [`plannerEmails.${data.column}`]: null });
  deps.log.info(`Resend requested: pedido=${data.pedidoId} column=${data.column}`);

  // Synthesize event so the stage handler treats this as a fresh transition into `column`.
  const currentData = {
    ...snap.data(),
    plannerEmails: { ...(snap.data().plannerEmails || {}), [data.column]: null },
  };
  const event = {
    data: {
      before: { data: () => ({}) },
      after: {
        data: () => currentData,
        ref: snap.ref,
      },
    },
  };
  const result = await deps.stageHandler(event);
  return { ok: true, result };
}
