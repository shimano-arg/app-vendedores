/**
 * Wrapper del Firebase Admin SDK para lecturas Firestore durante la transicion
 * (ADR-008 doble-escritura: Firestore sigue siendo la fuente primaria mientras
 * PG shadowea; algunas CFs del backend-new todavia necesitan leer de Firestore
 * para datos no migrados — ej. `roles/{uid}`, `app_config/*`).
 *
 * Patron:
 *   - Lazy init: `initializeApp()` corre al primer `getFs()`, no al import.
 *   - Permite inyectar un `App` custom en tests (emulator o mock).
 *   - Expone solo `Firestore` + helpers; nunca expone `Auth` desde aca
 *     (eso va en otro wrapper si/cuando se necesite).
 */

import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let _appSingleton: App | null = null;
let _fsSingleton: Firestore | null = null;

/**
 * Inicializa el Admin SDK si aun no esta inicializado. En Cloud Functions
 * hereda credenciales via Application Default Credentials; en local
 * requiere `GOOGLE_APPLICATION_CREDENTIALS` apuntando a un SA JSON.
 *
 * NO llamar en test unit — usar `setFirestoreForTesting(mockFs)` en su lugar.
 */
function initAdmin(): App {
  if (_appSingleton) return _appSingleton;
  const existing = getApps();
  if (existing.length > 0 && existing[0]) {
    _appSingleton = existing[0];
    return _appSingleton;
  }
  _appSingleton = initializeApp();
  return _appSingleton;
}

/**
 * Devuelve el Firestore singleton. Inicializa Admin SDK lazy.
 */
export function getFs(): Firestore {
  if (_fsSingleton) return _fsSingleton;
  const app = initAdmin();
  _fsSingleton = getFirestore(app);
  return _fsSingleton;
}

/**
 * Inyecta una instancia Firestore mock/emulator para tests. Resetea al
 * llamar con `null`.
 *
 * Ejemplo (test unit):
 *   setFirestoreForTesting(new MockFirestore());
 *   const uidRole = await readUserRole('uid-123');
 *   setFirestoreForTesting(null);
 */
export function setFirestoreForTesting(fs: Firestore | null): void {
  _fsSingleton = fs;
}

// ---------------------------------------------------------------------------
// Lectores helpers tipicos (readonly, patron §89: servidor resuelve)
// ---------------------------------------------------------------------------

export interface UserRoleDoc {
  role: 'admin' | 'gerente' | 'vendedor' | 'interno' | string;
  vendor?: string;
  email?: string;
  internalPartnerUid?: string;
}

/**
 * Lee `roles/{uid}` de Firestore. Fuente de auth durante la transicion
 * (los roles aun viven en Firestore). CLAUDE.md §89 + §108.1.
 *
 * Fail-closed: devuelve null si el doc no existe o la lectura falla.
 */
export async function readUserRole(uid: string): Promise<UserRoleDoc | null> {
  const fs = getFs();
  try {
    const snap = await fs.collection('roles').doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    const role = typeof d['role'] === 'string' ? (d['role'] as string) : null;
    if (!role) return null;
    return {
      role,
      vendor: typeof d['vendor'] === 'string' ? (d['vendor'] as string) : undefined,
      email: typeof d['email'] === 'string' ? (d['email'] as string) : undefined,
      internalPartnerUid:
        typeof d['internalPartnerUid'] === 'string'
          ? (d['internalPartnerUid'] as string)
          : undefined,
    };
  } catch {
    // Firestore unreachable — caller decide fail-closed vs fail-open.
    return null;
  }
}
