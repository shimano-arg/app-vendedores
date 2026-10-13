// v1259 (2026-10-13): tipos de reclamo + labels centralizados.
// Si agregas/renombras un tipo:
//   1. Migration nueva con alter constraint claims_claim_type_check
//   2. Actualizar este archivo
//   3. Regenerar types con `npm run gen:types` (opcional pero recomendado)

export const CLAIM_TYPES = [
  { key: 'transporte_rotura', label: 'Reclamo de transporte (rotura)' },
  { key: 'faltante',          label: 'Reclamo de faltante' },
  { key: 'error_armado',      label: 'Error de armado' },
  { key: 'sobrante',          label: 'Reclamo por sobrante' },
  { key: 'producto_erroneo',  label: 'Producto erróneo' },
] as const;

export type ClaimType = typeof CLAIM_TYPES[number]['key'];
export const CLAIM_TYPE_KEYS = CLAIM_TYPES.map((t) => t.key) as ClaimType[];
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = Object.fromEntries(
  CLAIM_TYPES.map((t) => [t.key, t.label]),
) as Record<ClaimType, string>;
