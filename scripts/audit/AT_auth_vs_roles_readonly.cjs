#!/usr/bin/env node
// AT — Usuarios de Firebase Auth vs documentos roles/{uid} (SOLO LECTURA).
//
// Para qué: antes de desplegar SEC-02 (commitPedidoCF/updatePedidoLinesCF
// exigen rol vendedor/interno/gerente/admin leído en el servidor), listar las
// cuentas que hoy podrían estar confirmando pedidos gracias al gate viejo por
// dominio y que quedarían BLOQUEADAS: sin doc en roles, con rol vacío,
// 'unassigned', 'viewer' u otro valor fuera de la lista.
//
// Qué lee (nada más):
//   - Firebase Auth: listUsers() paginado (uid, email, proveedores, emailVerified,
//     disabled, lastSignInTime).
//   - Firestore: roles/{uid} (solo el campo role).
//   - Firestore: pedidos con createdAt >= hoy-<dias> (solo ownerUid), para
//     marcar quién creó pedidos recientemente.
// No escribe en ningún lado. No llama a SAP. No tiene modo --apply.
//
// Salida REDACTADA por defecto: email como "m***@dominio", uid truncado a 6
// caracteres. --sin-redactar solo si Mariano lo pide explícitamente (no pegar
// esa salida en informes).
//
// Uso (requiere credenciales de Admin SDK con lectura de Auth + Firestore):
//   GOOGLE_APPLICATION_CREDENTIALS=<ruta-sa.json> \
//     node scripts/audit/AT_auth_vs_roles_readonly.cjs [--dias=30] [--json=salida.json]
//   node scripts/audit/AT_auth_vs_roles_readonly.cjs --self-test   # datos ficticios, sin red
//
// Fase 4 (2026-10-29). Preparado, NO ejecutado contra producción.
'use strict';

const PROJECT = 'app-vendedores-shimano';
const ALLOWED_ROLES = new Set(['vendedor', 'interno', 'gerente', 'admin']);

function parseArgs(argv) {
  const out = { dias: 30, json: null, selfTest: false, redact: true };
  for (const a of argv) {
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--sin-redactar') out.redact = false;
    else if (a.startsWith('--dias=')) out.dias = Math.max(1, Number(a.slice(7)) || 30);
    else if (a.startsWith('--json=')) out.json = a.slice(7);
    else if (a === '--apply') {
      console.error('Este script es de solo lectura: no existe --apply.');
      process.exit(2);
    }
  }
  return out;
}

function redactEmail(email) {
  if (!email) return '(sin email)';
  const [user, domain] = String(email).split('@');
  return `${(user || '?').slice(0, 1)}***@${domain || '?'}`;
}
const redactUid = (uid) => String(uid).slice(0, 6) + '…';

/**
 * Clasifica cada usuario de Auth. Función pura (testeable sin red).
 * @param {Array<{uid:string,email?:string,providers:string[],emailVerified:boolean,disabled:boolean,lastSignIn?:string}>} users
 * @param {Map<string, {exists:boolean, role?:string}>} rolesByUid
 * @param {Map<string, number>} pedidosRecientesByUid
 */
function classify(users, rolesByUid, pedidosRecientesByUid) {
  const rows = [];
  for (const u of users) {
    const r = rolesByUid.get(u.uid) || { exists: false };
    const role = r.exists ? String(r.role || '').toLowerCase().trim() : null;
    let estado;
    if (!r.exists) estado = 'SIN_DOC_ROLES';
    else if (!role) estado = 'ROL_VACIO';
    else if (ALLOWED_ROLES.has(role)) estado = 'OK';
    else estado = `ROL_NO_PERMITIDO(${role})`;
    rows.push({
      uid: u.uid,
      email: u.email || '',
      providers: u.providers,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      lastSignIn: u.lastSignIn || '',
      role,
      estado,
      pedidosRecientes: pedidosRecientesByUid.get(u.uid) || 0,
    });
  }
  const bloqueables = rows.filter((x) => x.estado !== 'OK' && !x.disabled);
  // Prioridad: los que crearon pedidos recientemente son los que SEC-02 frenaría hoy.
  bloqueables.sort((a, b) => b.pedidosRecientes - a.pedidosRecientes);
  return {
    total: rows.length,
    ok: rows.filter((x) => x.estado === 'OK').length,
    deshabilitados: rows.filter((x) => x.disabled).length,
    bloqueables,
    bloqueablesConPedidos: bloqueables.filter((x) => x.pedidosRecientes > 0),
  };
}

function render(result, opts) {
  const f = (x) => ({
    uid: opts.redact ? redactUid(x.uid) : x.uid,
    email: opts.redact ? redactEmail(x.email) : x.email,
    proveedores: x.providers.join('+') || '-',
    verificado: x.emailVerified ? 'sí' : 'no',
    estado: x.estado,
    pedidos: x.pedidosRecientes,
    ultimoLogin: x.lastSignIn ? x.lastSignIn.slice(0, 10) : '-',
  });
  const lines = [];
  lines.push(`Usuarios de Auth: ${result.total} | con rol válido: ${result.ok} | deshabilitados: ${result.deshabilitados}`);
  lines.push(`Quedarían BLOQUEADOS por SEC-02 (habilitados, sin rol válido): ${result.bloqueables.length}`);
  lines.push(`  de ellos con pedidos creados en los últimos ${opts.dias} días: ${result.bloqueablesConPedidos.length}`);
  lines.push('');
  lines.push('uid      | email            | proveedores   | verif | estado                  | pedidos | último login');
  for (const x of result.bloqueables.map(f)) {
    lines.push(
      [x.uid.padEnd(8), x.email.padEnd(16), x.proveedores.padEnd(13), x.verificado.padEnd(5), x.estado.padEnd(23), String(x.pedidos).padEnd(7), x.ultimoLogin].join(' | ')
    );
  }
  return lines.join('\n');
}

async function loadFromFirebase(opts) {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const users = [];
  let token;
  do {
    const page = await admin.auth().listUsers(1000, token);
    for (const u of page.users) {
      users.push({
        uid: u.uid,
        email: u.email,
        providers: (u.providerData || []).map((p) => p.providerId),
        emailVerified: !!u.emailVerified,
        disabled: !!u.disabled,
        lastSignIn: u.metadata && u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : '',
      });
    }
    token = page.pageToken;
  } while (token);

  const db = admin.firestore();
  const rolesByUid = new Map();
  const refs = users.map((u) => db.collection('roles').doc(u.uid));
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await db.getAll(...refs.slice(i, i + 300), { fieldMask: ['role'] });
    for (const s of snaps) rolesByUid.set(s.id, { exists: s.exists, role: s.exists ? (s.data() || {}).role : undefined });
  }

  // createdAt es string ISO en /pedidos (CLAUDE.md §76).
  const cutoff = new Date(Date.now() - opts.dias * 86400000).toISOString();
  const ped = await db.collection('pedidos').where('createdAt', '>=', cutoff).select('ownerUid').get();
  const pedidosRecientesByUid = new Map();
  ped.forEach((d) => {
    const o = (d.data() || {}).ownerUid;
    if (o) pedidosRecientesByUid.set(o, (pedidosRecientesByUid.get(o) || 0) + 1);
  });
  return { users, rolesByUid, pedidosRecientesByUid };
}

function selfTestData() {
  const users = [
    { uid: 'aaaaaa111', email: 'vendedor1@shimano.com.ar', providers: ['google.com'], emailVerified: true, disabled: false, lastSignIn: '2026-10-28T12:00:00Z' },
    { uid: 'bbbbbb222', email: 'vde.gmail@gmail.com', providers: ['google.com'], emailVerified: true, disabled: false, lastSignIn: '2026-10-28T12:00:00Z' },
    { uid: 'cccccc333', email: 'nuevo@gmail.com', providers: ['google.com'], emailVerified: true, disabled: false, lastSignIn: '2026-10-20T12:00:00Z' },
    { uid: 'dddddd444', email: 'mirador@shimano.com.ar', providers: ['password'], emailVerified: false, disabled: false, lastSignIn: '2026-10-27T12:00:00Z' },
    { uid: 'eeeeee555', email: 'sindoc@shimano.com.ar', providers: ['microsoft.com'], emailVerified: true, disabled: false, lastSignIn: '2026-10-25T12:00:00Z' },
    { uid: 'ffffff666', email: 'baja@shimano.com.ar', providers: ['google.com'], emailVerified: true, disabled: true, lastSignIn: '2026-09-01T12:00:00Z' },
  ];
  const rolesByUid = new Map([
    ['aaaaaa111', { exists: true, role: 'vendedor' }],
    ['bbbbbb222', { exists: true, role: 'Vendedor' }],
    ['cccccc333', { exists: true, role: 'unassigned' }],
    ['dddddd444', { exists: true, role: 'viewer' }],
    ['ffffff666', { exists: true, role: '' }],
  ]);
  const pedidosRecientesByUid = new Map([
    ['aaaaaa111', 12],
    ['dddddd444', 2],
  ]);
  return { users, rolesByUid, pedidosRecientesByUid };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const data = opts.selfTest ? selfTestData() : await loadFromFirebase(opts);
  const result = classify(data.users, data.rolesByUid, data.pedidosRecientesByUid);
  console.log(render(result, opts));
  if (opts.json) {
    require('node:fs').writeFileSync(
      opts.json,
      JSON.stringify(
        {
          generadoEn: new Date().toISOString(),
          dias: opts.dias,
          redactado: opts.redact,
          total: result.total,
          ok: result.ok,
          bloqueables: result.bloqueables.map((x) => ({
            ...x,
            uid: opts.redact ? redactUid(x.uid) : x.uid,
            email: opts.redact ? redactEmail(x.email) : x.email,
          })),
        },
        null,
        2
      )
    );
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('AT falló:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { classify, redactEmail, redactUid, parseArgs, ALLOWED_ROLES };
