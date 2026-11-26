import { useEffect, useState } from 'react';

/**
 * useFirebaseAuth — hook que expone el estado de auth del usuario.
 *
 * P1.5: stub. Devuelve siempre `{user: null, loading: false}` para que los
 * componentes consumidores (Shell, rutas) no crasheen antes de P1.6.
 *
 * En P1.6:
 * 1. `onAuthStateChanged(getAuth(), setUser)` con cleanup en el useEffect.
 * 2. `getIdToken(true)` cuando el componente necesita un token fresh (ver
 *    CLAUDE.md §25 force refresh pre-callable en batch).
 * 3. Exponer displayName + uid + email para que Shell pueda mostrar el header.
 */
export interface AuthUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface UseFirebaseAuthResult {
  readonly user: AuthUser | null;
  readonly loading: boolean;
}

export function useFirebaseAuth(): UseFirebaseAuthResult {
  const [state] = useState<UseFirebaseAuthResult>({
    user: null,
    loading: false,
  });

  useEffect(() => {
    // P1.6: subscribe a onAuthStateChanged aqui.
    // Por ahora no hacemos nada — state queda en {user:null, loading:false}.
  }, []);

  return state;
}
