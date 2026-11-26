/**
 * firebase.ts — inicializacion del SDK Firebase.
 *
 * P1.5: todavia no conectamos al Firebase real. En P1.6 este modulo:
 * 1. Importa firebase/app + firebase/auth + firebase/firestore (modular v9+).
 * 2. Reusa la MISMA config publica que `index.html` legacy (es publica, va
 *    hardcodeada — no son secretos; rules + AppCheck son la autorizacion real).
 * 3. Expone `getFirebaseApp()` + `getFirestore()` + `getAuth()` singletons.
 *
 * Config publica legacy (del root index.html):
 *   apiKey:            AIza... (publica)
 *   authDomain:        app-vendedores-shimano.firebaseapp.com
 *   projectId:         app-vendedores-shimano
 *   storageBucket:     app-vendedores-shimano.appspot.com
 *   messagingSenderId: ...
 *   appId:             ...
 *
 * Reglas:
 * - NO duplicar la config aca manualmente; en P1.6 la leemos de un modulo
 *   compartido con el bundle legacy (via `scripts/shared/firebase-config.js`)
 *   para que un cambio de proyecto se propague a ambos frontends.
 * - NO exponer admin credentials (eso vive solo en functions/).
 */

export interface FirebaseConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

/**
 * Placeholder hasta P1.6. Devuelve null para que el resto del codigo detecte
 * "no auth yet" sin crashear.
 */
export function getFirebaseApp(): unknown {
  return null;
}

/**
 * Placeholder hasta P1.6.
 */
export function getFirestore(): unknown {
  return null;
}

/**
 * Placeholder hasta P1.6.
 */
export function getAuth(): unknown {
  return null;
}
