import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();
  const { error } = await supabase.from('profiles').select('id').limit(1);
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
