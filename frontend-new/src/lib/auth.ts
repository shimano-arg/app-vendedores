/**
 * Helper de auth para el piloto (ADR-013).
 *
 * Devuelve el IDToken con force refresh (§25 CLAUDE.md: evita race de cache cuando el
 * token está cerca del expiration). Si no hay user logueado, tira — el ErrorBoundary
 * del piloto captura y muestra un mensaje "iniciá sesión en /" (el app1 hace el login).
 */

import { getCurrentUser } from './firebase.js';

export class NotAuthenticatedError extends Error {
  constructor() {
    super('No hay sesión activa. Iniciá sesión en la app principal (/) y volvé a /app2.');
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Devuelve el IDToken Firebase con `forceRefresh=true` (§25).
 * Costo: ~150 ms por invocación. Ok para piloto read-only (TanStack cachea 30 s).
 */
export async function getIdTokenForced(): Promise<string> {
  const user = getCurrentUser();
  if (!user) throw new NotAuthenticatedError();
  return user.getIdToken(true);
}
