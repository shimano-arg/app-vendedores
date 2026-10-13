/**
 * Uso: npx tsx scripts/wipe-claims.ts
 * Borra TODOS los claims + eventos + attachments (DB + storage). NO toca profiles.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function count(table: string) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const before = {
    claims: await count('claims'),
    claim_events: await count('claim_events'),
    attachments: await count('attachments'),
  };
  console.log('BEFORE:', before);

  const { data: atts, error: attErr } = await sb.from('attachments').select('storage_path');
  if (attErr) throw new Error(`list attachments: ${attErr.message}`);
  const paths = (atts ?? []).map((a) => a.storage_path).filter(Boolean);
  if (paths.length > 0) {
    const { data: removed, error: rmErr } = await sb.storage.from('claim-attachments').remove(paths);
    if (rmErr) console.error('storage remove warn:', rmErr.message);
    else console.log(`storage: borrados ${removed?.length ?? 0} archivos`);
  } else {
    console.log('storage: sin archivos');
  }

  const { error: delErr, count: delCount } = await sb
    .from('claims')
    .delete({ count: 'exact' })
    .gt('id', 0);
  if (delErr) throw new Error(`delete claims: ${delErr.message}`);
  console.log(`DB: borrados ${delCount} claims (cascada eventos+attachments)`);

  const after = {
    claims: await count('claims'),
    claim_events: await count('claim_events'),
    attachments: await count('attachments'),
  };
  console.log('AFTER:', after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
