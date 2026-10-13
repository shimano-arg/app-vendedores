import { describe, it, expect } from 'vitest';
import { CreateClaimSchema, MoveClaimSchema } from '@/lib/validators';

const UUID = '00000000-0000-0000-0000-000000000000';

describe('CreateClaimSchema', () => {
  it('acepta input valido', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1',
      observations: 'obs',
      claimType: 'faltante',
      assigneeId: UUID,
    });
    expect(r.success).toBe(true);
  });
  it('rechaza remito vacio', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: '',
      observations: 'obs',
      claimType: 'faltante',
      assigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
  it('rechaza uuid invalido', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1',
      observations: 'obs',
      claimType: 'faltante',
      assigneeId: 'not-uuid',
    });
    expect(r.success).toBe(false);
  });
  it('rechaza remito muy largo (>50 chars)', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-'.padEnd(60, 'X'),
      observations: 'obs',
      claimType: 'faltante',
      assigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
  // v1259: claimType es required
  it('rechaza sin claimType', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1',
      observations: 'obs',
      assigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
  it('rechaza claimType invalido', () => {
    const r = CreateClaimSchema.safeParse({
      remitoNumber: 'R-1',
      observations: 'obs',
      claimType: 'otra_cosa',
      assigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
});

describe('MoveClaimSchema', () => {
  it('acepta columna valida', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: 1,
      toColumn: 'deposito_revisa',
      newAssigneeId: UUID,
    });
    expect(r.success).toBe(true);
  });
  it('acepta claimId como string numerica (coerce)', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: '42',
      toColumn: 'nuevo',
      newAssigneeId: UUID,
    });
    expect(r.success).toBe(true);
  });
  it('rechaza columna invalida', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: 1,
      toColumn: 'foo',
      newAssigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
  it('rechaza claimId negativo', () => {
    const r = MoveClaimSchema.safeParse({
      claimId: -1,
      toColumn: 'nuevo',
      newAssigneeId: UUID,
    });
    expect(r.success).toBe(false);
  });
});
