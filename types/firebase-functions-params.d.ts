// Minimal shim for firebase-functions/params.
// Only covers symbols used in functions/index.js (D3 2026-11-25).

declare module 'firebase-functions/params' {
  export interface SecretParam {
    value(): string;
    name: string;
  }
  export function defineSecret(name: string): SecretParam;
  export function defineString(name: string, options?: any): { value(): string };
  export function defineInt(name: string, options?: any): { value(): number };
  export function defineBoolean(name: string, options?: any): { value(): boolean };
}
