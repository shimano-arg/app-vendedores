export const CLAIM_COLUMNS = [
  { key: 'nuevo',              label: 'Nuevo',              tint: 'var(--col-nuevo)' },
  { key: 'deposito_revisa',    label: 'Depósito revisa',    tint: 'var(--col-deposito-revisa)' },
  { key: 'respuesta_deposito', label: 'Respuesta depósito', tint: 'var(--col-respuesta-deposito)' },
  { key: 'shimano_valida',     label: 'Shimano valida',     tint: 'var(--col-shimano-valida)' },
  { key: 'resuelto',           label: 'Resuelto',           tint: 'var(--col-resuelto)' },
  { key: 'cerrado',            label: 'Cerrado',            tint: 'var(--col-cerrado)' },
] as const;

export type ClaimColumn = typeof CLAIM_COLUMNS[number]['key'];
export const COLUMN_KEYS = CLAIM_COLUMNS.map(c => c.key) as ClaimColumn[];
export const COLUMN_LABEL: Record<ClaimColumn, string> =
  Object.fromEntries(CLAIM_COLUMNS.map(c => [c.key, c.label])) as Record<ClaimColumn, string>;
