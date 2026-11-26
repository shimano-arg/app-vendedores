/**
 * Config Firebase para el piloto (ADR-013).
 *
 * El app1 (index.html) ya inicializa Firebase vía `firebase-app-compat`. Cuando `/app2/`
 * se sirve desde el mismo origin, el user ya está autenticado y `window.firebase` existe.
 * Este módulo expone helpers tipados sin re-inicializar Firebase.
 *
 * El `API_BASE_URL` es constante (ADR-013 prohíbe env vars en el piloto).
 */

// ADR-013: API base del backend-new. Localhost para dev local. Cuando backend-new
// deploye a Cloud Run (futuro), reemplazar por la URL productiva en un PR dedicado.
export const API_BASE_URL = 'http://localhost:8080';

/** Minimal shape que usamos de firebase.auth().currentUser para getIdToken. */
interface FirebaseUserMinimal {
  getIdToken(forceRefresh?: boolean): Promise<string>;
  uid: string;
  email: string | null;
}

interface FirebaseAuthMinimal {
  currentUser: FirebaseUserMinimal | null;
}

interface FirebaseGlobal {
  auth(): FirebaseAuthMinimal;
}

declare global {
  interface Window {
    firebase?: FirebaseGlobal;
  }
}

/**
 * Lee `firebase.auth().currentUser` del app1 (compat SDK).
 * Devuelve null si Firebase no está inicializado (ej. abrir `/app2/` sin pasar por login).
 */
export function getCurrentUser(): FirebaseUserMinimal | null {
  const fb = typeof window !== 'undefined' ? window.firebase : undefined;
  if (!fb || typeof fb.auth !== 'function') return null;
  try {
    return fb.auth().currentUser;
  } catch {
    return null;
  }
}
