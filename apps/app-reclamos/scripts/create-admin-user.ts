/**
 * Uso: npx tsx scripts/create-admin-user.ts <email> <password> "<display name>"
 * Crea un usuario en auth.users + fila en public.profiles con role=admin.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const [email, password, displayName] = process.argv.slice(2);
if (!email || !password || !displayName) {
  console.error('Uso: npx tsx scripts/create-admin-user.ts <email> <password> "<display name>"');
  process.exit(1);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function main() {
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) {
    console.error('Error creando auth user:', authErr.message);
    process.exit(1);
  }
  const userId = created.user!.id;

  const { error: profErr } = await supabase.from('profiles').insert({
    id: userId,
    email,
    role: 'admin',
    display_name: displayName,
  });
  if (profErr) {
    console.error('Error insertando profile:', profErr.message);
    process.exit(1);
  }
  console.log(`OK admin creado: ${email} (id=${userId})`);
}

main();
