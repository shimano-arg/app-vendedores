// Minimal shim for @google-cloud/firestore.
// Only covers symbols used in functions/index.js (D3 2026-11-25).

declare module '@google-cloud/firestore' {
  export class Firestore {
    constructor(options?: any);
    [key: string]: any;
  }
  export namespace v1 {
    export class FirestoreAdminClient {
      constructor(options?: any);
      databasePath(project: string, database: string): string;
      exportDocuments(request: any): Promise<any>;
      [key: string]: any;
    }
  }
}
