// Minimal shim for exceljs.
// Only covers symbols used in functions/index.js (D3 2026-11-25).

declare module 'exceljs' {
  export class Workbook {
    creator: string;
    created: Date;
    modified: Date;
    addWorksheet(name?: string, options?: any): Worksheet;
    getWorksheet(indexOrName: number | string): Worksheet;
    xlsx: {
      writeBuffer(): Promise<any>;
      writeFile(path: string): Promise<void>;
      load(buffer: any): Promise<Workbook>;
      readFile(path: string): Promise<Workbook>;
    };
    [key: string]: any;
  }
  export interface Worksheet {
    name: string;
    columns: any[];
    addRow(data: any): any;
    addRows(rows: any[]): any;
    getRow(row: number): any;
    getCell(address: string): any;
    mergeCells(range: string): void;
    [key: string]: any;
  }
  const _default: { Workbook: typeof Workbook };
  export default _default;
}
