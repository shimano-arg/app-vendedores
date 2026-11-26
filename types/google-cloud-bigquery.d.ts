// Minimal shim for @google-cloud/bigquery.
// Only covers symbols used in functions/index.js (D3 2026-11-25).

declare module '@google-cloud/bigquery' {
  export class BigQuery {
    constructor(options?: any);
    dataset(id: string, options?: any): any;
    query(options: any): Promise<any>;
    createQueryJob(options: any): Promise<any>;
    [key: string]: any;
  }
}
