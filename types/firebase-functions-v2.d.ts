// Minimal shim for firebase-functions/v2/*.
// Only covers the symbols used in functions/index.js (D3 2026-11-25).

declare module 'firebase-functions/v2/firestore' {
  export function onDocumentCreated(options: any, handler: (event: any) => any): any;
  export function onDocumentWritten(options: any, handler: (event: any) => any): any;
  export function onDocumentUpdated(options: any, handler: (event: any) => any): any;
  export function onDocumentDeleted(options: any, handler: (event: any) => any): any;
}

declare module 'firebase-functions/v2/https' {
  export class HttpsError extends Error {
    constructor(code: string, message: string, details?: any);
    code: string;
    details?: any;
  }
  export function onCall(options: any, handler?: (request: any) => any): any;
  export function onRequest(options: any, handler?: (req: any, res: any) => any): any;
}

declare module 'firebase-functions/v2/scheduler' {
  export function onSchedule(options: any, handler: (event: any) => any): any;
}
