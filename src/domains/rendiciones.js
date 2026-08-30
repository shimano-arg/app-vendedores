// @ts-nocheck
// Globals leídos del entorno (declarados en index.html inline):
// fbDb, firebase, currentUser, userRole, escapeHtml, escapeAttr, titleCase,
// showSyncTag, compressImage, XLSX, closeClientApplicationDetail,
// myRendicionesApproverUid, myRendicionesApproverEmail (top-level lets del
// inline, visibles al bundle via free reference gracias al Global Environment
// Record compartido).
// Módulo extraído verbatim: tipado real fuera de scope E2.e.
//
// RENDICIONES - solicitud anticipo + gastos con foto + aprobación
// (OCR de tickets vía Gemini API + upload a Firebase Storage).
// Extraído verbatim de index.html (líneas 12994-13894 pre-E2.e) como parte
// de E2.e (e2b-perf 2026-07-28). Preserva 100% comportamiento.
//
// Cross-scope state (via window):
// - window.unsubMisRendiciones + window.unsubTodasRendiciones: listeners con
//   cleanup en detachFirebaseListeners() del inline (línea ~24758 pre-E2.e).
// Locals al módulo: geminiApiKeyCache, rdSolicitudAdj, rdGastoFoto,
// misRendiciones, todasRendiciones, todasRendFilter + 3 constantes
// (GEMINI_MODEL, GEMINI_OCR_PROMPT, SELF_APPROVE_RENDICIONES_EMAILS).
// ============================================================
// RENDICIONES - solicitud anticipo + gastos con foto + aprobacion
// ============================================================
// El responsable de rendiciones se define POR USUARIO desde el Panel Usuarios
// (campo rendicionesApproverUid en /roles/{uid}). Si no hay ninguno asignado,
// la rendicion no se puede enviar. Si el aprobador queda sin rol valido,
// fallback a admin.
//
// === OCR con Gemini API ===
// La API key se carga desde Firestore (collection app_config, doc 'gemini',
// campo 'apiKey'). Se cachea en memoria al primer uso. El admin la configura
// desde el Panel Usuarios -> seccion "Gemini API Key".
// v551 (2026-08-19) SECURITY: API key de Gemini movida de Firestore
// (app_config/gemini) a Secret Manager. Frontend nunca ve la key —
// invoca geminiOcrProxy (functions/index.js) que la usa server-side.
// GEMINI_MODEL + prompt viven en functions/core/gemini-ocr-core.js.
async function extractTicketDataWithGemini(dataUrl) {
  // dataUrl: 'data:image/jpeg;base64,...'
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Formato de imagen invalido');
  const mimeType = m[1];
  const imageBase64 = m[2];

  // Region matchea el deploy del CF (southamerica-east1). Sin region
  // firebase.functions() default us-central1 y da 404. Ver
  // src/sap-client.js:47-56 para el analisis del pattern.
  const callable = firebase.app().functions('southamerica-east1').httpsCallable('geminiOcrProxy');

  // Timeout client-side de 60s como red final. El CF interno tiene su
  // propio timeoutMs=45s al fetch de Gemini + timeoutSeconds=60 al onCall.
  // Sin este race, si la red entre browser y CF muere durante el request
  // el spinner "Analizando ticket con IA..." queda pegado para siempre.
  const CALL_TIMEOUT_MS = 60000;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error('Timeout de 60s esperando respuesta del OCR. Completa manual.')),
      CALL_TIMEOUT_MS
    );
  });

  let res;
  try {
    res = await Promise.race([callable({ imageBase64, mimeType }), timeoutPromise]);
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    const msg = e && e.message ? String(e.message) : String(e);
    if (code === 'functions/deadline-exceeded' || /Timeout de 60s/.test(msg)) {
      throw new Error(
        'Gemini tardo demasiado. Completa el formulario manualmente y envia el gasto.'
      );
    }
    if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') {
      throw new Error('Sesion expirada o sin permisos. Cerra y volve a entrar a la app.');
    }
    if (code === 'functions/failed-precondition') {
      throw new Error('El OCR no esta configurado en el servidor. Avisale a Mariano.');
    }
    throw new Error('OCR fallo: ' + msg);
  }
  const parsed = res && res.data;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OCR devolvio respuesta invalida');
  }
  return parsed;
}

function fillRendGastoFormFromOcr(d) {
  // Mapea el JSON de Gemini a los campos del form. Acepta nulls.
  function setV(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    if (v == null) return;
    el.value = typeof v === 'number' ? v : String(v);
  }
  function setValid(id, v, _validOptions) {
    const el = document.getElementById(id);
    if (!el) return;
    if (v == null) return;
    const s = String(v).toUpperCase();
    // Buscar opcion que matchee
    const opts = [...el.options].map((o) => o.value);
    const hit = opts.find((o) => o.toUpperCase() === s);
    if (hit) el.value = hit;
  }
  setV('rg-numero', d.numeroTicket);
  setValid('rg-desc', d.descripcion); // dropdown ahora
  setValid('rg-modoPago', d.modoPago);
  setValid('rg-moneda', d.moneda);
  setValid('rg-tipoGasto', d.tipoGasto);
  if (d.importe != null) setV('rg-importe', d.importe);
  if (d.importeUsd != null) setV('rg-importeUsd', d.importeUsd);
  setValid('rg-divGasto', d.divisionGasto || 'GASTO LOCAL');
  setV('rg-obs', d.observaciones);
}

let rdSolicitudAdj = null; // base64 del adjunto Excel/PDF/imagen
let rdGastoFoto = null; // base64 del ticket
let misRendiciones = [];
if (typeof window.unsubMisRendiciones === 'undefined') window.unsubMisRendiciones = null;

function ensureRendicionesListener() {
  if (unsubMisRendiciones || !currentUser || !fbDb) return;
  window.unsubMisRendiciones = fbDb
    .collection('rendiciones')
    .where('ownerUid', '==', currentUser.uid)
    .onSnapshot(
      (qs) => {
        misRendiciones = [];
        qs.forEach((d) => misRendiciones.push(Object.assign({ _fsId: d.id }, d.data())));
        misRendiciones.sort((a, b) => {
          // v563 (2026-08-20): docs recien agregados con `serverTimestamp()`
          // pendiente aparecen en el snapshot local con `createdAt=null` antes
          // de que el server confirme. Fallback Infinity los ordena arriba
          // (son los mas nuevos). Antes: fallback 0 los mandaba al final →
          // Federico reporto que tenia que refrescar para ver la rendicion
          // recien enviada.
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Infinity;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Infinity;
          return tb - ta;
        });
        const pane = document.getElementById('rd-pane-mias');
        if (pane && pane.style.display !== 'none') renderMisRendiciones();
        const c = document.getElementById('rd-sub-count-mias');
        if (c) {
          const pendientes = misRendiciones.filter((r) => r.status === 'pending_approval').length;
          c.textContent = pendientes > 0 ? pendientes : '';
        }
      },
      (err) => console.warn('rendiciones listener', err)
    );
}

window.setRendSubtab = function (sub) {
  document
    .querySelectorAll('.rd-subtab-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.rdsub === sub));
  document.getElementById('rd-pane-solicitud').style.display = sub === 'solicitud' ? '' : 'none';
  document.getElementById('rd-pane-gasto').style.display = sub === 'gasto' ? '' : 'none';
  document.getElementById('rd-pane-mias').style.display = sub === 'mias' ? '' : 'none';
  // v289+: sub-tab TODAS solo visible para admin/gerente.
  const paneTodas = document.getElementById('rd-pane-todas');
  if (paneTodas) paneTodas.style.display = sub === 'todas' ? '' : 'none';
  if (sub === 'mias') renderMisRendiciones();
  if (sub === 'todas') {
    ensureTodasRendicionesListener();
    renderTodasRendiciones();
  }
};

// Adjunto del form de solicitud (Excel/PDF/imagen)
window.onRendAttach = async function (input) {
  const f = input.files && input.files[0];
  if (!f) return;
  try {
    // Si es imagen, comprimir. Si es excel/pdf, guardar tal cual (base64 sin compresion)
    if (f.type && f.type.startsWith('image/')) {
      // v562: 1400/0.78 -> 1000/0.7, mismo motivo que onRendFotoTicket.
      rdSolicitudAdj = { name: f.name, type: f.type, data: await compressImage(f, 1000, 0.7) };
    } else {
      const reader = new FileReader();
      rdSolicitudAdj = await new Promise((resolve, reject) => {
        reader.onload = (e) => resolve({ name: f.name, type: f.type, data: e.target.result });
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
    }
  } catch (e) {
    console.warn('rend attach', e);
    alert(
      'No se pudo procesar el adjunto (posible falta de memoria si es una ' +
        'foto grande). Probá con un archivo mas chico.'
    );
    input.value = '';
    return;
  }
  input.value = '';
  refreshRendAdjGrid();
};
window.removeRendAttach = function () {
  rdSolicitudAdj = null;
  refreshRendAdjGrid();
};
function refreshRendAdjGrid() {
  const grid = document.getElementById('rd-adj-grid');
  if (!grid) return;
  if (rdSolicitudAdj) {
    const isImg = rdSolicitudAdj.type && rdSolicitudAdj.type.startsWith('image/');
    const preview = isImg
      ? '<img src="' + rdSolicitudAdj.data + '"/>'
      : '<div style="font-size:9px;text-align:center;padding:14px 4px;color:var(--text-secondary);word-break:break-all">&#128196;<br>' +
        escapeHtml(rdSolicitudAdj.name) +
        '</div>';
    grid.innerHTML =
      '<div class="photo-cell">' +
      preview +
      '<button type="button" class="rm" onclick="removeRendAttach()">&times;</button></div>';
  } else {
    grid.innerHTML =
      '<label class="photo-cell add"><input type="file" accept=".xlsx,.xls,.csv,image/*,.pdf" onchange="onRendAttach(this)"/>+</label>';
  }
}

window.onRendFotoTicket = async function (input) {
  const f = input.files && input.files[0];
  if (!f) return;
  // v562 (2026-08-20): baja compresion 1400/0.78 -> 1000/0.7 (~200 KB) para
  // evitar OOM en dispositivos modestos (Federico reporto tab crash + "espacio
  // insuficiente" del sistema al enviar rendicion — kill del proceso web
  // durante decode del bitmap 12MP). OCR sigue funcionando bien con 1000px.
  // Try/catch con mensaje explicito al usuario en vez de warn silencioso.
  try {
    rdGastoFoto = await compressImage(f, 1000, 0.7);
  } catch (e) {
    console.warn('foto ticket', e);
    alert(
      'No se pudo procesar la foto (posible falta de memoria). Probá sacarla ' +
        'de nuevo con la app "Camara" (no HDR/RAW) y volvé a intentarlo, o ' +
        'usá una foto mas chica.'
    );
    input.value = '';
    return;
  }
  input.value = '';
  refreshRendFotoGrid();
  // Auto-extraer datos con Gemini OCR
  if (rdGastoFoto) {
    runRendGastoOcr(false);
  }
};

window.reRunRendGastoOcr = function () {
  runRendGastoOcr(true);
};

async function runRendGastoOcr(isManualRetry) {
  if (!rdGastoFoto) {
    alert('Primero subi una foto del ticket.');
    return;
  }
  const statusEl = document.getElementById('rd-ocr-status');
  if (statusEl) {
    statusEl.innerHTML =
      '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:5px;padding:8px 10px;font-size:11px;color:#1e40af;display:flex;align-items:center;gap:8px"><span class="ocr-spinner"></span>Analizando ticket con IA...</div>';
    statusEl.style.display = '';
  }
  try {
    const data = await extractTicketDataWithGemini(rdGastoFoto);
    fillRendGastoFormFromOcr(data);
    if (statusEl) {
      statusEl.innerHTML =
        '<div style="background:var(--color-warning-bg);border:1px solid #fcd34d;border-radius:5px;padding:8px 10px;font-size:11px;color:#78350f">' +
        '<b>&#9888; Revisa los campos</b> autocompletados antes de enviar. La IA puede equivocarse, sobre todo en montos, numero de ticket y descripcion. ' +
        '<button type="button" onclick="reRunRendGastoOcr()" style="background:#0891b2;color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:10px;font-weight:800;cursor:pointer;margin-left:6px">Re-analizar</button>' +
        '</div>';
    }
    showSyncTag('Campos autocompletados');
  } catch (e) {
    console.error('OCR error', e);
    if (statusEl) {
      statusEl.innerHTML =
        '<div style="background:var(--color-danger-bg);border:1px solid #fca5a5;border-radius:5px;padding:8px 10px;font-size:11px;color:var(--color-danger-strong)">' +
        '<b>No se pudieron extraer los datos.</b> Compleí el form manualmente.<br>' +
        '<span style="font-size:10px;opacity:.8">Detalle: ' +
        escapeHtml(String(e.message || e).slice(0, 120)) +
        '</span>' +
        '<button type="button" onclick="reRunRendGastoOcr()" style="background:#0891b2;color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:10px;font-weight:800;cursor:pointer;margin-left:6px">Reintentar</button>' +
        '</div>';
    }
    if (isManualRetry) alert('OCR fallo: ' + (e.message || e));
  }
}
window.removeRendFotoTicket = function () {
  rdGastoFoto = null;
  refreshRendFotoGrid();
  const statusEl = document.getElementById('rd-ocr-status');
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.style.display = 'none';
  }
};
function refreshRendFotoGrid() {
  const grid = document.getElementById('rd-foto-grid');
  if (!grid) return;
  if (rdGastoFoto) {
    grid.innerHTML =
      '<div class="photo-cell"><img src="' +
      rdGastoFoto +
      '"/><button type="button" class="rm" onclick="removeRendFotoTicket()">&times;</button></div>';
  } else {
    grid.innerHTML =
      '<label class="photo-cell add" style="background:#fce7f3;border-color:#f9a8d4;color:#9d174d;font-size:10px;font-weight:800;letter-spacing:.3px"><input type="file" accept="image/*" capture="environment" style="display:none" onchange="onRendFotoTicket(this)"/>&#128247; SACAR<br>FOTO</label>' +
      '<label class="photo-cell add" style="background:#dbeafe;border-color:#93c5fd;color:#1e40af;font-size:10px;font-weight:800;letter-spacing:.3px"><input type="file" accept="image/*" style="display:none" onchange="onRendFotoTicket(this)"/>&#128194; ELEGIR<br>DE GALERÍA</label>';
  }
}

// v308+: usuarios que auto-aprueban sus rendiciones (directores del area).
// No requieren un responsable externo asignado en Panel Usuarios; el
// submit del gasto/solicitud queda con status='approved' + approvedBy = self.
// Motivo: Diego Valsi es director del area y rinde directo, sin necesidad
// de que otro apruebe. Agregar mas emails aqui si suma otro director.
const SELF_APPROVE_RENDICIONES_EMAILS = new Set(['diego.valsi@shimano.uy']);

function isSelfApproverForRendiciones() {
  const email = ((currentUser && currentUser.email) || '').toLowerCase().trim();
  return SELF_APPROVE_RENDICIONES_EMAILS.has(email);
}

async function resolveMyRendicionesApprover() {
  // Devuelve {uid, email} del responsable asignado al usuario logueado.
  // Si no esta asignado o el doc no existe, devuelve null.
  //
  // IMPORTANTE: los vendedores NO pueden leer /roles/{otroUid} por security
  // rules. Estrategia:
  //   1. Si tenemos el email cacheado en /roles/{yo}.rendicionesApproverEmail
  //      (lo escribe bulkAssignApprover), usar eso directo - 0 reads extra.
  //   2. Si no, leer del directorio publico app_config/users_directory que
  //      admin sincroniza al abrir Panel Usuarios.
  //   3. Fallback /roles (solo funciona para admin/gerente).
  if (!myRendicionesApproverUid) return null;
  if (myRendicionesApproverEmail) {
    return {
      uid: myRendicionesApproverUid,
      email: myRendicionesApproverEmail,
      name: myRendicionesApproverEmail,
    };
  }
  try {
    const dirSnap = await fbDb.collection('app_config').doc('users_directory').get();
    if (dirSnap.exists) {
      const dir = (dirSnap.data() || {}).users || {};
      const u = dir[myRendicionesApproverUid];
      if (u) {
        return {
          uid: myRendicionesApproverUid,
          email: u.email || '',
          name: u.displayName || u.email || '',
        };
      }
    }
  } catch (e) {
    console.warn('resolve approver via directory', e);
  }
  try {
    const snap = await fbDb.collection('roles').doc(myRendicionesApproverUid).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      uid: myRendicionesApproverUid,
      email: data.email || '',
      name: data.displayName || data.email || '',
    };
  } catch (e) {
    console.warn('resolve approver via roles', e);
    return null;
  }
}

async function notifyRendicionApprover(approver, title, description, rendId) {
  if (!approver || !approver.uid) return;
  try {
    await fbDb.collection('notifications').add({
      type: 'rendicion_approval',
      fromUid: currentUser.uid,
      fromEmail: currentUser.email || '',
      fromName: currentUser.displayName || currentUser.email || '',
      targetUid: approver.uid,
      targetEmail: approver.email,
      title: title,
      description: description,
      rendicionId: rendId,
      status: 'unread',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('notif approver', approver.email, e);
  }
}

window.submitRendSolicitud = async function () {
  function read(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }
  const errors = [];
  [
    'rd-solicitadoPor',
    'rd-motivo',
    'rd-tipoOp',
    'rd-importe',
    'rd-moneda',
    'rd-obs',
    'rd-estado',
  ].forEach((id) => {
    if (!read(id)) errors.push(id.replace('rd-', ''));
  });
  if (errors.length) {
    alert('Faltan: ' + errors.join(', '));
    return;
  }
  // v308+: Diego (director) auto-aprueba. Mismo patron que submitRendGasto.
  const selfApprove = isSelfApproverForRendiciones();
  let approver;
  if (selfApprove) {
    approver = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      name: (currentUser.displayName || currentUser.email || '') + ' (auto, director)',
    };
    if (!confirm('Registrar esta solicitud (auto-aprobada como director del area)?')) return;
  } else {
    approver = await resolveMyRendicionesApprover();
    if (!approver) {
      alert(
        'No tenes un responsable de rendiciones asignado. Pedile a Mariano que lo configure en el Panel Usuarios.'
      );
      return;
    }
    if (
      !confirm(
        'Enviar la solicitud a "' +
          (approver.name || approver.email) +
          '"? Va a quedar PENDIENTE DE APROBACION hasta que la apruebe.'
      )
    )
      return;
  }
  const data = {
    tipo: 'solicitud',
    solicitadoPor: read('rd-solicitadoPor'),
    motivo: read('rd-motivo'),
    tipoOperacion: read('rd-tipoOp'),
    importe: parseFloat(read('rd-importe')) || 0,
    moneda: read('rd-moneda'),
    observaciones: read('rd-obs'),
    estadoSolicitud: read('rd-estado'),
    adjunto: rdSolicitudAdj || null,
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email || '',
    ownerName: currentUser.displayName || currentUser.email || '',
    vendor: assignedVendor || null,
    approverUid: approver.uid,
    approverEmail: approver.email,
    status: selfApprove ? 'approved' : 'pending_approval',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (selfApprove) {
    data.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.approvedBy = currentUser.uid;
    data.approvedByEmail = currentUser.email || '';
    data.approvalNote = 'Auto-aprobada (director del area)';
  }
  const btn = document.querySelector('#rd-solicitud-form .btn-confirm');
  if (btn) {
    btn.disabled = true;
    btn.textContent = selfApprove ? 'Registrando...' : 'Enviando...';
  }
  try {
    const ref = await fbDb.collection('rendiciones').add(data);
    if (!selfApprove) {
      await notifyRendicionApprover(
        approver,
        'Nueva solicitud: ' + data.tipoOperacion,
        'Vendedor: ' +
          (data.ownerName || data.ownerEmail) +
          '\nImporte: ' +
          data.importe +
          ' ' +
          data.moneda +
          '\nMotivo: ' +
          data.motivo,
        ref.id
      );
    }
    showSyncTag(
      selfApprove
        ? 'Solicitud registrada (auto-aprobada)'
        : 'Solicitud enviada a ' + (approver.name || approver.email)
    );
    document.getElementById('rd-solicitud-form').reset();
    rdSolicitudAdj = null;
    refreshRendAdjGrid();
    setRendSubtab('mias');
  } catch (e) {
    console.error('submit solicitud', e);
    alert('Error: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar solicitud';
    }
  }
};

// v308+: helper que sube una foto en formato data URL base64 a Firebase Storage
// bajo el path rendiciones/{ownerUid}/{timestamp}_ticket.{ext} y devuelve la
// downloadURL. Sirve tanto para el submit en vivo como para el script de
// retro-migracion de las 46 rendiciones que ya tienen fotoTicket embebido.
async function uploadRendicionFotoToStorage(dataUrl, ownerUid) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const m = /^data:image\/(\w+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('Formato de imagen invalido (esperado data:image/*;base64,...)');
  const ext = (m[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const b64 = m[2];
  // Convertir base64 a Blob (mas eficiente que putString para archivos grandes)
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/' + ext });
  const ts = Date.now();
  const path = 'rendiciones/' + (ownerUid || 'anonimo') + '/' + ts + '_ticket.' + ext;
  const ref = firebase.storage().ref(path);
  // v539 (2026-08-18): timeout 60s al upload Storage. Firebase Storage put no
  // soporta AbortController directo pero Promise.race con setTimeout resuelve
  // el bloqueo. Sin timeout el boton "Subiendo foto..." quedaba pegado
  // infinito si Storage colgaba (red rota / rules deny / foto muy grande).
  const putPromise = ref.put(blob);
  const timeoutPromise = new Promise((_resolve, reject) => {
    setTimeout(() => {
      try {
        putPromise.cancel?.();
      } catch (_e) {}
      reject(
        new Error(
          'Timeout: la subida de la foto tardo mas de 60 segundos. Verifica tu conexion y reintenta.'
        )
      );
    }, 60000);
  });
  const snap = await Promise.race([putPromise, timeoutPromise]);
  return await snap.ref.getDownloadURL();
}

window.submitRendGasto = async function () {
  function read(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }
  const errors = [];
  // Foto del ticket y numero de ticket son OPCIONALES - el vendedor puede
  // cargar un gasto manual sin comprobante (caso GASTO SIN COMPROBANTE).
  [
    'rg-desc',
    'rg-modoPago',
    'rg-moneda',
    'rg-tipoGasto',
    'rg-importe',
    'rg-divGasto',
    'rg-obs',
  ].forEach((id) => {
    if (!read(id)) errors.push(id.replace('rg-', ''));
  });
  if (errors.length) {
    alert('Faltan: ' + errors.join(', '));
    return;
  }
  // v308+: Diego (y otros directores del area en SELF_APPROVE_RENDICIONES_EMAILS)
  // rinde directo sin approver externo. La rendicion queda status='approved'
  // desde el submit y no se notifica a nadie mas.
  const selfApprove = isSelfApproverForRendiciones();
  let approver;
  if (selfApprove) {
    approver = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      name: (currentUser.displayName || currentUser.email || '') + ' (auto, director)',
    };
    if (!confirm('Registrar este gasto (auto-aprobado como director del area)?')) return;
  } else {
    approver = await resolveMyRendicionesApprover();
    if (!approver) {
      alert(
        'No tenes un responsable de rendiciones asignado. Pedile a Mariano que lo configure en el Panel Usuarios.'
      );
      return;
    }
    if (
      !confirm('Enviar este gasto a "' + (approver.name || approver.email) + '" para aprobacion?')
    )
      return;
  }
  const importe = parseFloat(read('rg-importe')) || 0;
  const importeUsd = parseFloat(read('rg-importeUsd')) || 0;
  // v308+: la foto del ticket ahora se sube a Firebase Storage (no embebida
  // base64 en Firestore). Guardamos solo la URL en fotoTicketUrl para que:
  // (a) el doc Firestore pese ~1KB en vez de 50-500KB
  // (b) Power BI Import mode no explote VertiPaq al escalar
  // Retro-compat: docs viejos siguen con fotoTicket base64; los renderers
  // priorizan fotoTicketUrl y caen a fotoTicket si no existe.
  const btn = document.querySelector('#rd-gasto-form .btn-confirm');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Subiendo foto...';
  }
  let fotoTicketUrl = '';
  if (rdGastoFoto && typeof rdGastoFoto === 'string' && rdGastoFoto.startsWith('data:image/')) {
    try {
      fotoTicketUrl = await uploadRendicionFotoToStorage(rdGastoFoto, currentUser.uid);
    } catch (e) {
      console.error('upload foto ticket', e);
      alert(
        'Error subiendo la foto del ticket: ' +
          (e.message || e) +
          '\n\nEl gasto NO se envio. Reintenta.'
      );
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Enviar gasto a aprobacion';
      }
      return;
    }
  }
  const data = {
    tipo: 'gasto',
    numeroTicket: read('rg-numero'),
    descripcion: read('rg-desc'), // dropdown: COMBUSTIBLE / COMIDA / HOSPEDAJE / PEAJE / TRASLADO / OTROS
    modoPago: read('rg-modoPago'), // dropdown: RECARGABLE / CORPORATIVA / EFECTIVO
    moneda: read('rg-moneda'), // dropdown: PESOS / DOLARES / OTRAS MONEDAS
    tipoGasto: read('rg-tipoGasto'), // dropdown: GASTO CON COMPROBANTE / GASTO SIN COMPROBANTE / FACTURA A
    importe: importe,
    importeUsd: importeUsd,
    divisionGasto: read('rg-divGasto'), // dropdown: GASTO LOCAL / GASTO REGIONAL
    observaciones: read('rg-obs'),
    fotoTicketUrl: fotoTicketUrl, // v308+: URL de Storage, no base64
    ownerUid: currentUser.uid,
    ownerEmail: currentUser.email || '',
    ownerName: currentUser.displayName || currentUser.email || '',
    vendor: assignedVendor || null,
    approverUid: approver.uid,
    approverEmail: approver.email,
    status: selfApprove ? 'approved' : 'pending_approval',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (selfApprove) {
    // v308+: auto-aprobado (Diego director). Poblar campos de aprobacion
    // como si el propio owner fuese el approver.
    data.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.approvedBy = currentUser.uid;
    data.approvedByEmail = currentUser.email || '';
    data.approvalNote = 'Auto-aprobada (director del area)';
  }
  if (btn) {
    btn.textContent = selfApprove ? 'Registrando...' : 'Enviando...';
  }
  try {
    const ref = await fbDb.collection('rendiciones').add(data);
    if (!selfApprove) {
      await notifyRendicionApprover(
        approver,
        'Nuevo gasto: ' + data.descripcion,
        'Vendedor: ' +
          (data.ownerName || data.ownerEmail) +
          '\nImporte: ' +
          data.importe +
          ' ' +
          data.moneda +
          '\nTicket: ' +
          data.numeroTicket +
          '\nDescripción: ' +
          data.descripcion +
          '\nTipo: ' +
          data.tipoGasto,
        ref.id
      );
    }
    showSyncTag(
      selfApprove
        ? 'Gasto registrado (auto-aprobado)'
        : 'Gasto enviado a ' + (approver.name || approver.email)
    );
    document.getElementById('rd-gasto-form').reset();
    rdGastoFoto = null;
    refreshRendFotoGrid();
    setRendSubtab('mias');
  } catch (e) {
    console.error('submit gasto', e);
    alert('Error: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar gasto a aprobacion';
    }
  }
};

function renderMisRendiciones() {
  const cont = document.getElementById('rd-mias-list');
  if (!cont) return;
  if (!misRendiciones.length) {
    cont.innerHTML = '<div class="notif-empty">No tenes rendiciones cargadas todavia.</div>';
    return;
  }
  let html = '';
  misRendiciones.forEach((r) => {
    const stCls =
      r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending';
    const stLbl =
      r.status === 'approved'
        ? '✓ Aprobada'
        : r.status === 'rejected'
          ? '✕ Rechazada'
          : 'Pendiente de aprobacion';
    const dt = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : null) : null;
    const dtStr = dt ? dt.toLocaleString('es-AR') : '';
    const tipoTag = r.tipo === 'gasto' ? 'GASTO' : 'SOLICITUD';
    const ttl =
      r.tipo === 'gasto'
        ? (r.descripcion || '-') + ' &middot; ' + (r.tipoGasto || '')
        : (r.tipoOperacion || '-') + ' &middot; ' + (r.motivo || '');
    const rId = r._fsId || r._id || r.id || '';
    // Card clickeable -> abre modal con detalle completo (incluye foto del
    // ticket / adjunto). Reutiliza openRendicionDetail que ya usa el admin
    // desde notificaciones. Sin approver buttons porque somos el owner.
    html +=
      '<div class="rd-mias-card ' +
      stCls +
      '" onclick="openRendicionDetail(\'' +
      escapeAttr(rId) +
      '\')" style="cursor:pointer" title="Tocar para ver el detalle y el ticket">';
    html += '<h5><span class="rd-tipo-tag">' + tipoTag + '</span>' + escapeHtml(ttl) + '</h5>';
    html +=
      '<div class="rd-meta">Importe: <b>' +
      (r.importe || 0).toLocaleString('es-AR') +
      ' ' +
      escapeHtml(r.moneda || '') +
      '</b>';
    if (r.tipo === 'gasto') html += ' &middot; Ticket: ' + escapeHtml(r.numeroTicket || '');
    html += ' &middot; ' + escapeHtml(dtStr) + '</div>';
    html += '<div><span class="rd-status">' + stLbl + '</span></div>';
    if (r.status === 'rejected' && r.rejectedReason)
      html +=
        '<div style="font-size:10px;color:var(--color-danger-strong);margin-top:4px"><b>Motivo:</b> ' +
        escapeHtml(r.rejectedReason) +
        '</div>';
    html +=
      '<div style="font-size:10px;color:#0891b2;margin-top:6px;font-weight:700">&#128194; Tocar para ver detalle y comprobante &rarr;</div>';
    html += '</div>';
  });
  cont.innerHTML = html;
}

// v289+: gestion "TODAS LAS RENDICIONES" para admin/gerente.
// Reutiliza openRendicionDetail (que ya usa el vendedor en "Mis rendiciones"
// y el approver desde notifications) para mostrar el detalle completo con
// foto del ticket / adjunto.
let todasRendiciones = [];
if (typeof window.unsubTodasRendiciones === 'undefined') window.unsubTodasRendiciones = null;
let todasRendFilter = 'all'; // all | approved | pending_approval | rejected

function ensureTodasRendicionesListener() {
  if (unsubTodasRendiciones || !currentUser || !fbDb) return;
  if (userRole !== 'admin' && userRole !== 'gerente') return;
  // Sin filtro por owner - trae TODAS las rendiciones. Las Rules de
  // /rendiciones ya permiten read para isReader() (incluye admin/gerente).
  window.unsubTodasRendiciones = fbDb.collection('rendiciones').onSnapshot(
    (qs) => {
      todasRendiciones = [];
      qs.forEach((d) => todasRendiciones.push(Object.assign({ _fsId: d.id }, d.data())));
      // Ordenar por fecha desc.
      todasRendiciones.sort((a, b) => {
        // v563: mismo fix que misRendiciones — fallback Infinity para docs
        // con serverTimestamp() pendiente.
        const ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : Infinity;
        const tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : Infinity;
        return tb - ta;
      });
      // Actualizar contadores por estado.
      const cntAll = todasRendiciones.length;
      const cntApproved = todasRendiciones.filter((r) => r.status === 'approved').length;
      const cntPending = todasRendiciones.filter((r) => r.status === 'pending_approval').length;
      const cntRejected = todasRendiciones.filter((r) => r.status === 'rejected').length;
      const e1 = document.getElementById('rd-todas-count-all');
      if (e1) e1.textContent = cntAll;
      const e2 = document.getElementById('rd-todas-count-approved');
      if (e2) e2.textContent = cntApproved;
      const e3 = document.getElementById('rd-todas-count-pending');
      if (e3) e3.textContent = cntPending;
      const e4 = document.getElementById('rd-todas-count-rejected');
      if (e4) e4.textContent = cntRejected;
      // Badge en la sub-tab (total).
      const badge = document.getElementById('rd-sub-count-todas');
      if (badge) badge.textContent = cntAll;
      renderTodasRendiciones();
    },
    (err) => console.warn('todasRendiciones listener', err)
  );
}

window.setTodasRendFilter = function (f) {
  todasRendFilter = f || 'all';
  document.querySelectorAll('.rd-todas-filter').forEach((b) => {
    const active = b.dataset.rdfilter === todasRendFilter;
    b.classList.toggle('active', active);
    // Cuando esta activa, ponerla en marron. Sino, borde de color segun estado.
    if (active) {
      b.style.background = '#7c2d12';
      b.style.color = '#fff';
      b.style.borderColor = '#7c2d12';
    } else {
      b.style.background = '#fff';
      if (b.dataset.rdfilter === 'approved') {
        b.style.color = '#166534';
        b.style.borderColor = '#86efac';
      } else if (b.dataset.rdfilter === 'pending_approval') {
        b.style.color = '#92400e';
        b.style.borderColor = '#fbbf24';
      } else if (b.dataset.rdfilter === 'rejected') {
        b.style.color = '#991b1b';
        b.style.borderColor = '#fca5a5';
      } else {
        b.style.color = '#7c2d12';
        b.style.borderColor = '#7c2d12';
      }
    }
  });
  renderTodasRendiciones();
};

function renderTodasRendiciones() {
  const cont = document.getElementById('rd-todas-list');
  if (!cont) return;
  if (!todasRendiciones.length) {
    cont.innerHTML =
      '<div class="notif-empty">No hay rendiciones cargadas todavia en toda la organizacion.</div>';
    return;
  }
  // Aplicar filtro por estado + buscador.
  const q = ((document.getElementById('rd-todas-search') || {}).value || '').toLowerCase().trim();
  let items = todasRendiciones;
  if (todasRendFilter !== 'all') {
    items = items.filter((r) => r.status === todasRendFilter);
  }
  if (q) {
    items = items.filter((r) => {
      const s = [
        r.ownerName || '',
        r.ownerEmail || '',
        r.descripcion || '',
        r.numeroTicket || '',
        r.motivo || '',
        r.tipoGasto || '',
        r.tipoOperacion || '',
        r.observaciones || '',
      ]
        .join(' ')
        .toLowerCase();
      return s.indexOf(q) >= 0;
    });
  }
  if (!items.length) {
    cont.innerHTML =
      '<div class="notif-empty">No hay rendiciones que coincidan con el filtro / busqueda.</div>';
    return;
  }
  let html = '';
  items.forEach((r) => {
    const stCls =
      r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending';
    const stLbl =
      r.status === 'approved'
        ? '✓ Aprobada'
        : r.status === 'rejected'
          ? '✕ Rechazada'
          : 'Pendiente de aprobacion';
    const dt = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
    const dtStr = dt ? dt.toLocaleString('es-AR') : '';
    const tipoTag = r.tipo === 'gasto' ? 'GASTO' : 'SOLICITUD';
    const ttl =
      r.tipo === 'gasto'
        ? (r.descripcion || '-') + ' &middot; ' + (r.tipoGasto || '')
        : (r.tipoOperacion || '-') + ' &middot; ' + (r.motivo || '');
    const rId = r._fsId || r._id || r.id || '';
    const vendorLbl = r.ownerName || r.ownerEmail || '(sin owner)';
    html +=
      '<div class="rd-mias-card ' +
      stCls +
      '" onclick="openRendicionDetail(\'' +
      escapeAttr(rId) +
      '\')" style="cursor:pointer" title="Tocar para ver el detalle y el ticket">';
    html +=
      '<div style="font-size:10px;font-weight:800;color:#7c2d12;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">&#128100; ' +
      escapeHtml(vendorLbl) +
      '</div>';
    html += '<h5><span class="rd-tipo-tag">' + tipoTag + '</span>' + escapeHtml(ttl) + '</h5>';
    html +=
      '<div class="rd-meta">Importe: <b>' +
      (r.importe || 0).toLocaleString('es-AR') +
      ' ' +
      escapeHtml(r.moneda || '') +
      '</b>';
    if (r.tipo === 'gasto') html += ' &middot; Ticket: ' + escapeHtml(r.numeroTicket || '');
    html += ' &middot; ' + escapeHtml(dtStr) + '</div>';
    html += '<div><span class="rd-status">' + stLbl + '</span></div>';
    if (r.status === 'rejected' && r.rejectedReason)
      html +=
        '<div style="font-size:10px;color:var(--color-danger-strong);margin-top:4px"><b>Motivo:</b> ' +
        escapeHtml(r.rejectedReason) +
        '</div>';
    if (r.status === 'approved' && r.approvedByEmail)
      html +=
        '<div style="font-size:10px;color:var(--color-success);margin-top:4px"><b>Aprobada por:</b> ' +
        escapeHtml(r.approvedByEmail) +
        '</div>';
    html +=
      '<div style="font-size:10px;color:#0891b2;margin-top:6px;font-weight:700">&#128194; Tocar para ver detalle y comprobante &rarr;</div>';
    html += '</div>';
  });
  cont.innerHTML = html;
}

window.exportMisRendicionesExcel = function () {
  if (typeof XLSX === 'undefined') {
    alert('Libreria XLSX no cargo. Recarga la pagina.');
    return;
  }
  const aprobadas = (misRendiciones || []).filter((r) => r.status === 'approved');
  if (!aprobadas.length) {
    alert('No tenes rendiciones APROBADAS todavia. Solo las aprobadas se incluyen en el Excel.');
    return;
  }
  const gastos = aprobadas.filter((r) => r.tipo === 'gasto');
  const sols = aprobadas.filter((r) => r.tipo === 'solicitud');

  const wb = XLSX.utils.book_new();

  // ===== Hoja "RENDICIÓN" - formato Shimano =====
  // Estructura del original:
  // r2: titulo "PLANILLA RENDICION"
  // r4: subtitulo "gastos visitas DD-MM-AAAA"
  // r8: headers
  // r9 en adelante: datos
  // Las columnas son: A=FECHA / B=NUMERO TICKET / C=DESCRIPCION / D=MODO PAGO / E=MONEDA / F=TIPO GASTO / G=IMPORTE / H=DIVISION GASTO / I=OBSERVACIONES
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const fechaArg = dd + '-' + mm + '-' + yyyy;

  const aoa = [];
  while (aoa.length < 1) aoa.push([]); // r1 vacia
  aoa.push(['', 'PLANILLA RENDICIÓN']); // r2
  aoa.push([]); // r3
  aoa.push(['', '', '', 'gastos visitas ' + fechaArg]); // r4
  aoa.push([]);
  aoa.push([]);
  aoa.push([]); // r5-r7
  // r8: headers (col A vacia para mantener el shift que tiene el original)
  aoa.push([
    'FECHA',
    'NUMERO DE TICKET',
    'DESCRIPCIÓN',
    'MODO DE PAGO',
    'MONEDA',
    'TIPO DE GASTO',
    'IMPORTE',
    'DIVISIÓN GASTO',
    'OBSERVACIONES',
  ]);
  // Filas de datos
  gastos.forEach((r) => {
    const dt = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
    aoa.push([
      dt
        ? String(dt.getDate()).padStart(2, '0') +
          '-' +
          String(dt.getMonth() + 1).padStart(2, '0') +
          '-' +
          dt.getFullYear()
        : '',
      r.numeroTicket || '',
      r.descripcion || '',
      r.modoPago || '',
      r.moneda || '',
      r.tipoGasto || '',
      r.importe || 0,
      r.divisionGasto || '',
      r.observaciones || '',
    ]);
  });
  // Total al final
  if (gastos.length) {
    aoa.push([]);
    const totalPesos = gastos
      .filter((g) => g.moneda === 'PESOS')
      .reduce((s, g) => s + (parseFloat(g.importe) || 0), 0);
    const totalDolares = gastos
      .filter((g) => g.moneda === 'DOLARES')
      .reduce((s, g) => s + (parseFloat(g.importe) || 0), 0);
    aoa.push(['', '', '', '', '', 'TOTAL PESOS', totalPesos, '', '']);
    if (totalDolares > 0) aoa.push(['', '', '', '', '', 'TOTAL DÓLARES', totalDolares, '', '']);
    aoa.push(['', '', '', '', '', 'CANT. TICKETS', gastos.length, '', '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 15 },
    { wch: 14 },
    { wch: 24 },
    { wch: 14 },
    { wch: 18 },
    { wch: 35 },
  ];
  // Merge del titulo PLANILLA RENDICIÓN (B2:H2)
  ws['!merges'] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 7 } },
    { s: { r: 3, c: 3 }, e: { r: 3, c: 7 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'RENDICIÓN');

  // ===== Hoja "Solicitudes / Anticipos" =====
  if (sols.length) {
    const solRows = sols.map((r) => {
      const dt = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
      return {
        Fecha: dt
          ? String(dt.getDate()).padStart(2, '0') +
            '-' +
            String(dt.getMonth() + 1).padStart(2, '0') +
            '-' +
            dt.getFullYear()
          : '',
        'Solicitado por': r.solicitadoPor || '',
        'Tipo operación': r.tipoOperacion || '',
        'Motivo / evento': r.motivo || '',
        Importe: r.importe || 0,
        Moneda: r.moneda || '',
        Observaciones: r.observaciones || '',
        Estado: r.estadoSolicitud || '',
        'Aprobado por': r.approvedByEmail || '',
      };
    });
    const wsS = XLSX.utils.json_to_sheet(solRows);
    wsS['!cols'] = [
      { wch: 12 },
      { wch: 30 },
      { wch: 22 },
      { wch: 35 },
      { wch: 14 },
      { wch: 14 },
      { wch: 35 },
      { wch: 12 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, wsS, 'Solicitudes');
  }

  // ===== Hoja "Desplegable" - listas de validación (referencia para receptor) =====
  const desplegable = [
    ['MODO DE PAGO', '', 'MONEDA', '', 'TIPO DE GASTO', '', 'DESCRIPCIÓN', '', 'DIVISIÓN GASTO'],
    ['RECARGABLE', '', 'PESOS', '', 'GASTO CON COMPROBANTE', '', 'COMBUSTIBLE', '', 'GASTO LOCAL'],
    ['CORPORATIVA', '', 'DÓLARES', '', 'GASTO SIN COMPROBANTE', '', 'COMIDA', '', 'GASTO REGIONAL'],
    ['EFECTIVO', '', 'OTRAS MONEDAS', '', 'FACTURA A', '', 'HOSPEDAJE', '', ''],
    ['', '', '', '', '', '', 'PEAJE', '', ''],
    ['', '', '', '', '', '', 'TRASLADO', '', ''],
    ['', '', '', '', '', '', 'OTROS', '', ''],
  ];
  const wsD = XLSX.utils.aoa_to_sheet(desplegable);
  wsD['!cols'] = [
    { wch: 22 },
    { wch: 2 },
    { wch: 16 },
    { wch: 2 },
    { wch: 24 },
    { wch: 2 },
    { wch: 16 },
    { wch: 2 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsD, 'Desplegable');

  // Nombre archivo en formato Shimano
  const MESES_NOMBRE = [
    'ENERO',
    'FEBRERO',
    'MARZO',
    'ABRIL',
    'MAYO',
    'JUNIO',
    'JULIO',
    'AGOSTO',
    'SEPTIEMBRE',
    'OCTUBRE',
    'NOVIEMBRE',
    'DICIEMBRE',
  ];
  const fname =
    'RENDICION DE GASTOS ' + dd + ' DE ' + MESES_NOMBRE[today.getMonth()] + ' ' + yyyy + '.xlsx';
  XLSX.writeFile(wb, fname);
  showSyncTag('Excel descargado: ' + aprobadas.length + ' rendiciones');
};

// Aprobacion desde notif (gerente)
window.openRendicionDetail = async function (rendId, notifId) {
  if (!rendId) {
    alert('Rendicion no encontrada.');
    return;
  }
  try {
    const snap = await fbDb.collection('rendiciones').doc(rendId).get();
    if (!snap.exists) {
      alert('La rendicion ya no existe.');
      return;
    }
    const r = Object.assign({ _id: rendId }, snap.data());
    const c = document.getElementById('ca-detail-content');
    let h =
      '<div style="padding:18px 20px;font-size:12px;color:var(--text-primary);line-height:1.6">';
    h +=
      '<h4 style="font-size:12px;color:#be185d;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding-bottom:5px;border-bottom:1.5px solid #fbcfe8">Datos</h4>';
    if (r.tipo === 'gasto') {
      h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
      h += '<div><b>Ticket #:</b> ' + escapeHtml(r.numeroTicket || '') + '</div>';
      h += '<div><b>Descripci&oacute;n:</b> ' + escapeHtml(r.descripcion || '') + '</div>';
      h += '<div><b>Modo pago:</b> ' + escapeHtml(r.modoPago || '') + '</div>';
      h += '<div><b>Moneda:</b> ' + escapeHtml(r.moneda || '') + '</div>';
      h += '<div><b>Tipo de gasto:</b> ' + escapeHtml(r.tipoGasto || '') + '</div>';
      h += '<div><b>Divisi&oacute;n:</b> ' + escapeHtml(r.divisionGasto || '') + '</div>';
      h +=
        '<div><b>Importe:</b> ' +
        (r.importe || 0).toLocaleString('es-AR') +
        ' ' +
        escapeHtml(r.moneda || '') +
        '</div>';
      // v404 (2026-08-05): reemplazado "Importe USD" por "Fecha" DD.MM.YYYY.
      const _fechaStr = (() => {
        const d = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
        if (!d) return '-';
        return (
          String(d.getDate()).padStart(2, '0') +
          '.' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '.' +
          d.getFullYear()
        );
      })();
      h += '<div><b>Fecha:</b> ' + _fechaStr + '</div>';
      h +=
        '<div style="grid-column:1/-1"><b>Observaciones:</b> ' +
        escapeHtml(r.observaciones || '') +
        '</div>';
      h += '</div>';
      // v308+: preferir fotoTicketUrl (Firebase Storage) sobre fotoTicket
      // (base64 legacy). Docs viejos siguen funcionando via fallback.
      const _tSrc = r.fotoTicketUrl || r.fotoTicket || '';
      if (_tSrc)
        h +=
          '<div style="margin-top:10px"><b>Ticket:</b><br><img src="' +
          _tSrc +
          '" id="rd-ticket-img" style="max-width:300px;border-radius:6px;border:1px solid var(--border-subtle);cursor:pointer" onclick="openImgViewer(\'rd-ticket-img\')"/></div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
      h +=
        '<div><b>Tipo:</b> SOLICITUD</div><div><b>Tipo op:</b> ' +
        escapeHtml(r.tipoOperacion || '') +
        '</div>';
      h += '<div><b>Solicitado por:</b> ' + escapeHtml(r.solicitadoPor || '') + '</div>';
      h += '<div><b>Estado solicitud:</b> ' + escapeHtml(r.estadoSolicitud || '') + '</div>';
      h +=
        '<div><b>Importe:</b> ' +
        (r.importe || 0).toLocaleString('es-AR') +
        ' ' +
        escapeHtml(r.moneda || '') +
        '</div>';
      h += '<div></div>';
      h += '<div style="grid-column:1/-1"><b>Motivo:</b> ' + escapeHtml(r.motivo || '') + '</div>';
      h +=
        '<div style="grid-column:1/-1"><b>Obs:</b> ' + escapeHtml(r.observaciones || '') + '</div>';
      h += '</div>';
      if (r.adjunto && r.adjunto.data) {
        const isImg = r.adjunto.type && r.adjunto.type.startsWith('image/');
        h +=
          '<div style="margin-top:10px"><b>Adjunto:</b> ' +
          escapeHtml(r.adjunto.name || '') +
          '<br>';
        if (isImg)
          h +=
            '<img src="' +
            r.adjunto.data +
            '" id="rd-adj-img" style="max-width:300px;border-radius:6px;border:1px solid var(--border-subtle);cursor:pointer" onclick="openImgViewer(\'rd-adj-img\')"/>';
        else
          h +=
            '<a href="' +
            r.adjunto.data +
            '" download="' +
            escapeAttr(r.adjunto.name || 'adjunto') +
            '" style="color:#0891b2;font-weight:700">&#11015; Descargar</a>';
        h += '</div>';
      }
    }
    h +=
      '<div style="margin-top:12px;font-size:11px;color:var(--text-muted)">Vendedor: <b>' +
      escapeHtml(r.ownerName || r.ownerEmail || '') +
      '</b></div>';
    if (r.status === 'rejected')
      h +=
        '<div style="background:var(--color-danger-bg);border:1px solid #fca5a5;border-radius:4px;padding:8px;margin-top:8px;color:var(--color-danger-strong)"><b>RECHAZADA</b> por ' +
        escapeHtml(r.rejectedByEmail || '') +
        '. Motivo: ' +
        escapeHtml(r.rejectedReason || '-') +
        '</div>';
    if (r.status === 'approved')
      h +=
        '<div style="background:var(--color-success-bg);border:1px solid #86efac;border-radius:4px;padding:8px;margin-top:8px;color:var(--color-success)"><b>APROBADA</b> por ' +
        escapeHtml(r.approvedByEmail || '') +
        '</div>';
    // Autorizacion: soy el approverUid guardado en el doc, o admin.
    const iAmApprover = r.approverUid === currentUser.uid || userRole === 'admin';
    if (r.status === 'pending_approval' && iAmApprover) {
      h +=
        '<div style="display:flex;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle)">';
      h +=
        '<button class="qmodal-btn primary" style="flex:1" onclick="approveRendicion(\'' +
        escapeAttr(rendId) +
        "','" +
        escapeAttr(notifId || '') +
        '\')">Aprobar</button>';
      h +=
        '<button class="qmodal-btn danger" style="flex:1" onclick="rejectRendicion(\'' +
        escapeAttr(rendId) +
        "','" +
        escapeAttr(notifId || '') +
        '\')">Rechazar</button>';
      h += '</div>';
    }
    h += '</div>';
    c.innerHTML = h;
    document.getElementById('ca-detail-modal').classList.add('open');
  } catch (e) {
    console.error('open rend detail', e);
    alert('Error: ' + (e.message || e));
  }
};

window.approveRendicion = async function (rendId, notifId) {
  if (!confirm('Confirmar aprobacion?')) return;
  try {
    // v531 (2026-08-18): optimistic update - antes el user tenia que
    // refrescar para ver la rendicion pasar a APROBADA porque el
    // snapshot Firestore llega despues del render. Ahora actualizamos
    // los caches locales y re-renderamos inmediato.
    const localApproved = {
      status: 'approved',
      approvedBy: currentUser.uid,
      approvedByEmail: currentUser.email || '',
    };
    if (typeof todasRendiciones !== 'undefined' && todasRendiciones) {
      const t = todasRendiciones.find((r) => (r._fsId || r.id) === rendId);
      if (t) Object.assign(t, localApproved);
    }
    if (typeof misRendiciones !== 'undefined' && misRendiciones) {
      const m = misRendiciones.find((r) => (r._fsId || r.id) === rendId);
      if (m) Object.assign(m, localApproved);
    }
    try {
      renderTodasRendiciones();
    } catch (_e) {}
    try {
      if (typeof renderMisRendiciones === 'function') renderMisRendiciones();
    } catch (_e) {}
    await fbDb
      .collection('rendiciones')
      .doc(rendId)
      .update({
        status: 'approved',
        approvedBy: currentUser.uid,
        approvedByEmail: currentUser.email || '',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    const snap = await fbDb.collection('rendiciones').doc(rendId).get();
    const r = snap.data() || {};
    if (r.ownerUid) {
      await fbDb.collection('notifications').add({
        type: 'rendicion_approval_ack',
        fromUid: currentUser.uid,
        fromEmail: currentUser.email || '',
        fromName: currentUser.displayName || currentUser.email || '',
        targetUid: r.ownerUid,
        title: 'Rendicion APROBADA',
        message: 'Tu rendicion fue aprobada y queda lista para exportar al Excel.',
        rendicionId: rendId,
        status: 'unread',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (notifId) {
      try {
        await fbDb
          .collection('notifications')
          .doc(notifId)
          .update({ status: 'done', doneAt: firebase.firestore.FieldValue.serverTimestamp() });
      } catch (_e) {}
    }
    showSyncTag('Rendicion aprobada');
    closeClientApplicationDetail();
  } catch (e) {
    console.error('approve rend', e);
    alert('Error: ' + (e.message || e));
  }
};

window.rejectRendicion = async function (rendId, notifId) {
  const reason = prompt('Motivo del rechazo (se notifica al vendedor):', '');
  if (reason === null) return;
  if (!reason.trim()) {
    alert('Tenes que indicar un motivo.');
    return;
  }
  try {
    // v531: optimistic update (idem approveRendicion).
    const localRejected = {
      status: 'rejected',
      rejectedBy: currentUser.uid,
      rejectedByEmail: currentUser.email || '',
      rejectedReason: reason.trim(),
    };
    if (typeof todasRendiciones !== 'undefined' && todasRendiciones) {
      const t = todasRendiciones.find((r) => (r._fsId || r.id) === rendId);
      if (t) Object.assign(t, localRejected);
    }
    if (typeof misRendiciones !== 'undefined' && misRendiciones) {
      const m = misRendiciones.find((r) => (r._fsId || r.id) === rendId);
      if (m) Object.assign(m, localRejected);
    }
    try {
      renderTodasRendiciones();
    } catch (_e) {}
    try {
      if (typeof renderMisRendiciones === 'function') renderMisRendiciones();
    } catch (_e) {}
    await fbDb
      .collection('rendiciones')
      .doc(rendId)
      .update({
        status: 'rejected',
        rejectedBy: currentUser.uid,
        rejectedByEmail: currentUser.email || '',
        rejectedReason: reason.trim(),
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    const snap = await fbDb.collection('rendiciones').doc(rendId).get();
    const r = snap.data() || {};
    if (r.ownerUid) {
      await fbDb.collection('notifications').add({
        type: 'rendicion_approval_ack',
        fromUid: currentUser.uid,
        fromEmail: currentUser.email || '',
        fromName: currentUser.displayName || currentUser.email || '',
        targetUid: r.ownerUid,
        title: 'Rendicion RECHAZADA',
        message: 'Tu rendicion fue rechazada.\nMotivo: ' + reason.trim(),
        rendicionId: rendId,
        status: 'unread',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (notifId) {
      try {
        await fbDb
          .collection('notifications')
          .doc(notifId)
          .update({ status: 'done', doneAt: firebase.firestore.FieldValue.serverTimestamp() });
      } catch (_e) {}
    }
    showSyncTag('Rendicion rechazada');
    closeClientApplicationDetail();
  } catch (e) {
    console.error('reject rend', e);
    alert('Error: ' + (e.message || e));
  }
};

// === Exports a window para callers cross-scope ===
// Funciones llamadas desde fuera del bloque rendiciones:
// - ensureRendicionesListener: init global post-login (línea ~12035, ~18610 pre-E2.e).
// - openRendicionDetail: notif render en notifItemHtml (línea ~14228 pre-E2.e).
// Otras funciones ya usan window.foo = function... verbatim (13 handlers).
window.ensureRendicionesListener = ensureRendicionesListener;
window.openRendicionDetail = window.openRendicionDetail || openRendicionDetail;
// E6 hotfix 2: renders + listener llamados desde setTab('rend') + oninput inline L8224+.
window.renderMisRendiciones = renderMisRendiciones;
window.ensureTodasRendicionesListener = ensureTodasRendicionesListener;
window.renderTodasRendiciones = renderTodasRendiciones;
