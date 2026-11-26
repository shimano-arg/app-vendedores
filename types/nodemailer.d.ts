// Minimal shim for nodemailer.
// Only covers symbols used in functions/index.js (D3 2026-11-25).

declare module 'nodemailer' {
  export interface Transporter {
    sendMail(options: any): Promise<any>;
    verify(callback?: (err: Error | null, success: boolean) => void): Promise<boolean>;
    close(): void;
  }
  export function createTransport(options: any, defaults?: any): Transporter;
  const _default: {
    createTransport: typeof createTransport;
  };
  export default _default;
}
