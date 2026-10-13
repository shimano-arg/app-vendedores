import type { Database } from './supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function isAdmin(profile: Pick<Profile, 'role'> | null | undefined): boolean {
  return profile?.role === 'admin';
}

export function canMoveClaim(
  userId: string,
  claim: { assignee_id: string },
  profile: Pick<Profile, 'role'> | null,
): boolean {
  return claim.assignee_id === userId || isAdmin(profile);
}
