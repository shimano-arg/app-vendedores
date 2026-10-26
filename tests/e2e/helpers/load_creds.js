// @ts-check
/**
 * Carga TEST_USER_EMAIL y TEST_USER_PASSWORD desde env o gcloud Secret Manager
 * (si env está vacío). Expone `loadE2eCreds()` → `{email, password}`.
 */
import { spawnSync } from 'node:child_process';

const PROJECT = 'app-vendedores-shimano';

function fetchSecret(name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid name: ${name}`);
  const r = spawnSync(
    'gcloud',
    ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${PROJECT}`],
    { encoding: 'utf8', shell: true }
  );
  if (r.status !== 0) {
    throw new Error(`gcloud secret ${name} fetch failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').replace(/\r?\n$/, '');
}

export function loadE2eCreds() {
  let email = process.env.TEST_USER_EMAIL || '';
  let password = process.env.TEST_USER_PASSWORD || '';
  if (!email) {
    try {
      email = fetchSecret('test-user-email');
    } catch (_e) {
      /* ignore */
    }
  }
  if (!password) {
    try {
      password = fetchSecret('test-user-password');
    } catch (_e) {
      /* ignore */
    }
  }
  if (!email || !password || /placeholder/i.test(email) || /placeholder/i.test(password)) {
    return {
      email: null,
      password: null,
      _reason: 'test-user secrets not configured or placeholder',
    };
  }
  return { email, password };
}
