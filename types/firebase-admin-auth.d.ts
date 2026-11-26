// Minimal shim for firebase-admin/auth.
// Only covers the symbols used in functions/index.js (B2-A 2026-11-26).
// Behavior: NONE. Types only.

declare module 'firebase-admin/auth' {
  export interface UserRecord {
    uid: string;
    email?: string;
    displayName?: string;
    [key: string]: any;
  }
  export interface Auth {
    getUserByEmail(email: string): Promise<UserRecord>;
    getUser(uid: string): Promise<UserRecord>;
    [key: string]: any;
  }
  export function getAuth(app?: any): Auth;
}
