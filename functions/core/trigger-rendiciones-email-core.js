// @ts-check
/**
 * v1116 (2026-09-30): dispara el workflow `send-rendiciones-email.yml` de
 * GitHub Actions manualmente desde el frontend. Uso: cuando Mariano necesita
 * forzar el envio de rendiciones aprobadas sin esperar el cron (Lun/Mie 8 UTC).
 *
 * Requiere Secret Manager: GITHUB_DISPATCH_TOKEN (Personal Access Token
 * fine-grained con scope `Actions: write` limitado al repo app-vendedores).
 *
 * Core testeable con mock de fetch + auth. Wrapper Firebase en
 * `functions/index.js`.
 */

/**
 * @typedef {Object} TriggerDeps
 * @property {typeof fetch} fetch
 * @property {(uid: string) => Promise<string>} getUserRole
 * @property {string} githubToken - PAT de GitHub
 * @property {(msg: string, extra?: object) => void} log
 */

/**
 * @typedef {Object} TriggerData
 * @property {string} [force] - si 'true', pasa force=true al workflow (envia
 *                              incluso las ya notificadas). Default: 'false'.
 * @property {string} [replayIds] - IDs puntuales separados por coma (replay
 *                                  quirurgico). Default: ''.
 */

const REPO_OWNER = 'shimano-arg';
const REPO_NAME = 'app-vendedores';
const WORKFLOW_ID = 'send-rendiciones-email.yml';
const WORKFLOW_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}`;

/**
 * @param {TriggerData} data
 * @param {{ uid: string, token?: any } | null} auth
 * @param {TriggerDeps} deps
 */
export async function handleTriggerRendicionesEmailManual(data, auth, deps) {
  if (!auth || !auth.uid) {
    throw { code: 'unauthenticated', message: 'Auth requerida' };
  }
  const role = await deps.getUserRole(auth.uid);
  const email = (auth.token && auth.token.email) || '';
  const isMariano =
    email === 'mariano.erbino@shimano.com.ar' || email === 'erbinomariano@gmail.com';
  if (role !== 'admin' && role !== 'gerente' && !isMariano) {
    throw {
      code: 'permission-denied',
      message: 'Solo admin, gerente o Mariano pueden disparar el envio manual.',
    };
  }
  if (!deps.githubToken) {
    throw {
      code: 'failed-precondition',
      message: 'Secret GITHUB_DISPATCH_TOKEN no configurado.',
    };
  }

  const force = String((data && data.force) || 'false');
  const replayIds = String((data && data.replayIds) || '');

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`;
  const body = JSON.stringify({
    ref: 'main',
    inputs: {
      force,
      skip_mark: 'false',
      replay_ids: replayIds,
    },
  });

  deps.log('[triggerRendicionesEmail] dispatching workflow', {
    user: email,
    force,
    replayIds: replayIds ? replayIds.slice(0, 100) : '(none)',
  });

  const resp = await deps.fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + deps.githubToken,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'app-vendedores-shimano/dispatch',
    },
    body,
  });

  // Success: 204 No Content. Fail: 401/403/404/422.
  if (resp.status === 204) {
    deps.log('[triggerRendicionesEmail] success 204', { user: email });
    return {
      success: true,
      workflowUrl: WORKFLOW_URL,
      message: 'Workflow disparado. Revisá tu email en 1-3 minutos.',
    };
  }

  let errBody = '';
  try {
    errBody = await resp.text();
  } catch (_e) {
    errBody = '(no body)';
  }
  deps.log('[triggerRendicionesEmail] fail', { status: resp.status, body: errBody.slice(0, 300) });
  throw {
    code: 'internal',
    message: `GitHub API fallo (${resp.status}): ${errBody.slice(0, 200)}`,
  };
}
