// Minimal shim for firebase-admin/firestore.
// Only covers the symbols used in functions/index.js (D3 2026-11-25).
// Behavior: NONE. Types only.

declare module 'firebase-admin/firestore' {
  export const FieldValue: {
    serverTimestamp(): any;
    delete(): any;
    arrayUnion(...elements: any[]): any;
    arrayRemove(...elements: any[]): any;
    increment(n: number): any;
  };
  export function getFirestore(app?: any): Firestore;
  export type DocumentData = { [key: string]: any };
  export class Firestore {
    collection(path: string): any;
    doc(path: string): any;
    runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
    batch(): any;
    [key: string]: any;
  }
  export class Timestamp {
    static now(): Timestamp;
    static fromDate(date: Date): Timestamp;
    static fromMillis(ms: number): Timestamp;
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
    toMillis(): number;
  }
}
