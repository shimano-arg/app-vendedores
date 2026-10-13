import { describe, it, expect } from 'vitest';
import { isAdmin, canMoveClaim } from '@/lib/permissions';

describe('isAdmin', () => {
  it('true si role=admin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });
  it('false si role distinto', () => {
    expect(isAdmin({ role: 'shimano' })).toBe(false);
    expect(isAdmin({ role: 'deposito' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('canMoveClaim', () => {
  const claim = { assignee_id: 'user-1' };
  it('true si soy el assignee', () => {
    expect(canMoveClaim('user-1', claim, { role: 'shimano' })).toBe(true);
  });
  it('true si soy admin aunque no sea assignee', () => {
    expect(canMoveClaim('user-2', claim, { role: 'admin' })).toBe(true);
  });
  it('false si no soy assignee ni admin', () => {
    expect(canMoveClaim('user-2', claim, { role: 'shimano' })).toBe(false);
    expect(canMoveClaim('user-2', claim, { role: 'deposito' })).toBe(false);
  });
  it('false si profile null y no soy assignee', () => {
    expect(canMoveClaim('user-2', claim, null)).toBe(false);
  });
});
