// Minimal shim for firebase-admin/app.
// Only covers the symbols used in functions/index.js (D3 2026-11-25).
// Behavior: NONE. Types only.

declare module 'firebase-admin/app' {
  export interface App {
    name: string;
    [key: string]: any;
  }
  export function initializeApp(options?: any, name?: string): App;
  export function getApps(): App[];
  export function getApp(name?: string): App;
}
