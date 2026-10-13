import { z } from 'zod';
import { CLAIM_TYPE_KEYS } from './claim-types';
import { COLUMN_KEYS } from './columns';

export const MoveClaimSchema = z.object({
  claimId: z.coerce.number().int().positive(),
  toColumn: z.enum(COLUMN_KEYS as unknown as [string, ...string[]]),
  newAssigneeId: z.string().uuid(),
});
export type MoveClaimInput = z.infer<typeof MoveClaimSchema>;

export const CreateClaimSchema = z.object({
  remitoNumber: z.string().min(1).max(50),
  observations: z.string().min(1).max(2000),
  // v1259: claimType required al crear. 5 valores canonicos ver lib/claim-types.ts.
  claimType: z.enum(CLAIM_TYPE_KEYS as unknown as [string, ...string[]]),
  assigneeId: z.string().uuid().optional().nullable(),
  invoiceNumber: z.string().max(50).optional().nullable(),
  clientName: z.string().max(120).optional().nullable(),
  fantasyName: z.string().max(120).optional().nullable(),
  videoArmadoReviewed: z.boolean().optional().default(false),
  videoClienteReviewed: z.boolean().optional().default(false),
});
export type CreateClaimInput = z.infer<typeof CreateClaimSchema>;

export const ToggleVideoReviewSchema = z.object({
  claimId: z.coerce.number().int().positive(),
  field: z.enum(['armado', 'cliente']),
  value: z.boolean(),
});
