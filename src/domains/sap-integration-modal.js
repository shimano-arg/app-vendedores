// @ts-nocheck
// SAP-INTEGRATION-MODAL: modal de importación Excel para masterfiles SAP
// (BPs / Items / SalesEmployees), preview + matching automático contra
// master de la app (POINTS / PRODUCTS / VENDORS), apply a Firestore
// (sap_clients, sap_products, sap_vendors) + listener sap_vendors + helper
// sapGetSlpCodeForVendor. Extraído verbatim de index.html (líneas 6914-7239
// pre-E2.m.1) como parte de E2.m.1 (e2b-perf 2026-07-28).
//
// PRIMER fragmento del dominio sap-integrations (regla #14: dividido en 4).
// Fragmentos pendientes: E2.m.2 sap-admin-panel (~1,373 LOC), E2.m.3
// sap-service-layer (~297 LOC objeto sapSL), E2.m.4 sap-auto-send-listener (~83 LOC).
//
// Cross-scope state (via window):
// - window.sapVendorsCache (Map): LEÍDA por sapGetSlpCodeForVendor (interna),
//   por exports-sap.js bundle (indirect via sapGetSlpCodeForVendor), y por
//   inline (buildQuotationPayload). Preservada como const alias del Map en window.
// - window.unsubSapVendors: cleanup en detachFirebaseListeners inline (L16042).
// ============================================================
// INTEGRACION SAP - carga de masterfiles y match automatico
// ============================================================
// Solo accesible para Mariano. Sube 3 archivos (BPs, Items, SalesEmployees),
// hace el match contra el master de la app (POINTS / PRODUCTS / VENDORS) y
// escribe los mappings encontrados a sap_clients / sap_products / sap_vendors.
let sapIntState = { clientes: null, productos: null, vendedores: null, preview: null };

function isMarianoUser() {
  return currentUser && (currentUser.email || '').toLowerCase() === 'erbinomariano@gmail.com';
}

window.openSapIntegrationModal = function () {
  if (!isMarianoUser()) {
    alert('Esta seccion es exclusiva del admin principal.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('Falta libreria XLSX. Recarga la pagina y reintenta.');
    return;
  }
  sapIntState = { clientes: null, productos: null, vendedores: null, preview: null };
  document.getElementById('sap-int-preview').innerHTML = '';
  ['clientes', 'productos', 'vendedores'].forEach((k) => {
    const inp = document.getElementById('sap-int-' + k);
    if (inp) inp.value = '';
    const info = document.getElementById('sap-int-' + k + '-info');
    if (info) {
      info.textContent = 'Sin archivo cargado.';
      info.className = 'sap-int-file-info';
    }
    inp.onchange = (ev) => sapIntOnFile(ev.target, k);
  });
  document.getElementById('sap-integration-modal').classList.add('open');
};
window.closeSapIntegrationModal = function () {
  document.getElementById('sap-integration-modal').classList.remove('open');
};

function sapNormStr(s) {
  return (s || '')
    .toString()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bS\.?A\.?\b|\bS\.?R\.?L\.?\b|\bS\.?A\.?S\.?\b|\bLTDA?\.?\b|\bCIA\.?\b/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function sapKeyStr(s) {
  return sapNormStr(s).replace(/\s/g, '');
}

function sapIntOnFile(inputEl, kind) {
  const f = inputEl.files && inputEl.files[0];
  const info = document.getElementById('sap-int-' + kind + '-info');
  if (!f) {
    sapIntState[kind] = null;
    info.textContent = 'Sin archivo cargado.';
    info.className = 'sap-int-file-info';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      sapIntState[kind] = rows;
      // v385: reemplazado innerHTML por composición segura con textContent.
      // f.name viene del <input type="file">, es user-controlled -> CodeQL
      // marcaba "DOM text reinterpreted as HTML" (XSS). El bold visual se
      // arma con un <b> creado por DOM API con textContent seguro.
      info.replaceChildren();
      const bold = document.createElement('b');
      bold.textContent = f.name;
      info.appendChild(bold);
      info.appendChild(document.createTextNode(' — ' + rows.length + ' filas leidas'));
      info.className = 'sap-int-file-info ok';
    } catch (err) {
      console.error('sap int parse', err);
      sapIntState[kind] = null;
      info.textContent = 'Error leyendo el archivo: ' + (err.message || err);
      info.className = 'sap-int-file-info err';
    }
  };
  reader.readAsArrayBuffer(f);
}

function pickCol(row, candidates) {
  // Busca el primer nombre de columna en `candidates` que exista en la fila (case-insensitive)
  const keys = Object.keys(row);
  for (const c of candidates) {
    const cL = c.toLowerCase();
    for (const k of keys) {
      if (k.toLowerCase().trim() === cL) return row[k];
    }
  }
  return '';
}

function processSapClientes(rows) {
  // Resultado: {matches:[{appName, sapCode, sapName}], dupApp:[], noMatch:[{sapCode,sapName}]}
  const out = { matches: [], dupApp: [], noMatch: [] };
  if (!rows || !rows.length) return out;
  // App: nombres unicos de clientes desde POINTS
  const appNames = new Set();
  (POINTS || []).forEach((p) => {
    (p.clients || []).forEach((n) => {
      appNames.add(n);
    });
  });
  // Indexar por nombre normalizado
  const appByKey = new Map();
  appNames.forEach((n) => {
    const k = sapKeyStr(n);
    if (!appByKey.has(k)) appByKey.set(k, []);
    appByKey.get(k).push(n);
  });
  // Procesar SAP rows
  rows.forEach((r) => {
    const code = (pickCol(r, ['CardCode', 'Card Code', 'BP Code', 'Codigo', 'Cod']) || '')
      .toString()
      .trim();
    const name = (
      pickCol(r, ['CardName', 'Card Name', 'BP Name', 'Nombre', 'Razon Social', 'RazonSocial']) ||
      ''
    )
      .toString()
      .trim();
    if (!code || !name) return;
    const k = sapKeyStr(name);
    const list = appByKey.get(k) || [];
    if (list.length === 1) {
      out.matches.push({ appName: list[0], sapCode: code, sapName: name });
    } else if (list.length > 1) {
      out.dupApp.push({ sapCode: code, sapName: name, candidates: list });
    } else {
      out.noMatch.push({ sapCode: code, sapName: name });
    }
  });
  return out;
}

function processSapProductos(rows) {
  const out = { matches: [], noMatch: [] };
  if (!rows || !rows.length) return out;
  const list = typeof PRODUCTS !== 'undefined' && Array.isArray(PRODUCTS) ? PRODUCTS : [];
  // Indexar por codigo App (uppercase)
  const byCode = new Map();
  list.forEach((p) => byCode.set((p.code || '').toUpperCase().trim(), p));
  rows.forEach((r) => {
    const sapCode = (pickCol(r, ['ItemCode', 'Item Code', 'Material', 'Codigo', 'SKU']) || '')
      .toString()
      .trim();
    const sapName = (pickCol(r, ['ItemName', 'Item Name', 'Description', 'Descripcion']) || '')
      .toString()
      .trim();
    if (!sapCode) return;
    const codeUp = sapCode.toUpperCase();
    const appP = byCode.get(codeUp);
    if (appP) {
      out.matches.push({
        appCode: appP.code,
        sapCode: sapCode,
        sapName: sapName,
        appDesc: appP.desc,
      });
    } else {
      out.noMatch.push({ sapCode: sapCode, sapName: sapName });
    }
  });
  return out;
}

function processSapVendedores(rows) {
  const out = { matches: [], noMatch: [] };
  if (!rows || !rows.length) return out;
  const vendors = typeof VENDORS !== 'undefined' && Array.isArray(VENDORS) ? VENDORS : [];
  const byKey = new Map();
  vendors.forEach((v) => byKey.set(sapKeyStr(v.key), v));
  rows.forEach((r) => {
    const sCode = (pickCol(r, ['SlpCode', 'Slp Code', 'Codigo', 'EmpId']) || '').toString().trim();
    const sName = (pickCol(r, ['SlpName', 'Slp Name', 'Nombre', 'Sales Employee']) || '')
      .toString()
      .trim();
    if (!sCode || !sName) return;
    const k = sapKeyStr(sName);
    const vendor = byKey.get(k);
    if (vendor) {
      out.matches.push({
        vendorKey: vendor.key,
        slpCode: sCode,
        slpName: sName,
        zone: vendor.zone,
      });
    } else {
      out.noMatch.push({ slpCode: sCode, slpName: sName });
    }
  });
  return out;
}

window.runSapIntegrationPreview = function () {
  if (!sapIntState.clientes && !sapIntState.productos && !sapIntState.vendedores) {
    alert('Subi al menos uno de los 3 archivos.');
    return;
  }
  const cli = sapIntState.clientes ? processSapClientes(sapIntState.clientes) : null;
  const pro = sapIntState.productos ? processSapProductos(sapIntState.productos) : null;
  const ven = sapIntState.vendedores ? processSapVendedores(sapIntState.vendedores) : null;
  sapIntState.preview = { cli, pro, ven };

  let html = '<div class="sap-int-summary">';
  if (cli) {
    html +=
      '<div class="sap-int-summary-card ok"><div class="num">' +
      cli.matches.length +
      '</div><div class="lbl">Clientes match</div></div>';
    html +=
      '<div class="sap-int-summary-card warn"><div class="num">' +
      cli.dupApp.length +
      '</div><div class="lbl">Clientes ambiguos</div></div>';
    html +=
      '<div class="sap-int-summary-card err"><div class="num">' +
      cli.noMatch.length +
      '</div><div class="lbl">Sin match</div></div>';
  }
  if (pro) {
    html +=
      '<div class="sap-int-summary-card ok"><div class="num">' +
      pro.matches.length +
      '</div><div class="lbl">Productos match</div></div>';
    html +=
      '<div class="sap-int-summary-card err"><div class="num">' +
      pro.noMatch.length +
      '</div><div class="lbl">SKU sin match</div></div>';
  }
  if (ven) {
    html +=
      '<div class="sap-int-summary-card ok"><div class="num">' +
      ven.matches.length +
      '</div><div class="lbl">Vendedores match</div></div>';
    html +=
      '<div class="sap-int-summary-card err"><div class="num">' +
      ven.noMatch.length +
      '</div><div class="lbl">Vendedores sin match</div></div>';
  }
  html += '</div>';

  function table(title, headers, rowsArr, cls) {
    let s = '<div class="sap-int-section"><h4>' + title + ' (' + rowsArr.length + ')</h4>';
    if (!rowsArr.length) {
      s += '<div style="font-size:11px;color:var(--text-muted);padding:8px">Sin datos.</div></div>';
      return s;
    }
    s +=
      '<div style="max-height:240px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:4px"><table class="sap-int-preview-table"><thead><tr>';
    headers.forEach((h) => (s += '<th>' + h + '</th>'));
    s += '</tr></thead><tbody>';
    rowsArr.slice(0, 200).forEach((r) => {
      s += '<tr class="' + cls + '">';
      r.forEach((v) => (s += '<td>' + escapeHtml(v == null ? '' : v.toString()) + '</td>'));
      s += '</tr>';
    });
    s += '</tbody></table></div>';
    if (rowsArr.length > 200)
      s +=
        '<div style="font-size:10px;color:var(--text-muted);text-align:center;padding:4px">Mostrando primeros 200 de ' +
        rowsArr.length +
        '. El "Aplicar" procesa todos.</div>';
    s += '</div>';
    return s;
  }

  if (cli) {
    html += table(
      'Clientes - Matches a aplicar',
      ['Tienda App', 'CardCode SAP', 'CardName SAP'],
      cli.matches.map((m) => [m.appName, m.sapCode, m.sapName]),
      'col-match'
    );
    if (cli.dupApp.length) {
      html += table(
        'Clientes - Ambiguos (varias tiendas con mismo nombre normalizado)',
        ['CardCode', 'CardName', 'Candidatos App'],
        cli.dupApp.map((m) => [m.sapCode, m.sapName, m.candidates.join(' | ')]),
        'col-warn'
      );
    }
    html += table(
      'Clientes - Sin match en la app',
      ['CardCode', 'CardName'],
      cli.noMatch.map((m) => [m.sapCode, m.sapName]),
      'col-err'
    );
  }
  if (pro) {
    html += table(
      'Productos - Matches por codigo',
      ['Codigo App', 'ItemCode SAP', 'Desc SAP', 'Desc App'],
      pro.matches.map((m) => [m.appCode, m.sapCode, m.sapName, m.appDesc]),
      'col-match'
    );
    html += table(
      'Productos - SKU del archivo SAP sin SKU equivalente en la app',
      ['ItemCode', 'ItemName'],
      pro.noMatch.map((m) => [m.sapCode, m.sapName]),
      'col-err'
    );
  }
  if (ven) {
    html += table(
      'Vendedores - Matches',
      ['Vendedor App', 'Zona', 'SlpCode', 'SlpName SAP'],
      ven.matches.map((m) => [m.vendorKey, m.zone, m.slpCode, m.slpName]),
      'col-match'
    );
    html += table(
      'Vendedores - Sin match (revisar nombres)',
      ['SlpCode', 'SlpName'],
      ven.noMatch.map((m) => [m.slpCode, m.slpName]),
      'col-err'
    );
  }

  const totMatches =
    (cli ? cli.matches.length : 0) +
    (pro ? pro.matches.length : 0) +
    (ven ? ven.matches.length : 0);
  html +=
    '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid var(--border-subtle)">';
  html +=
    '<button class="sap-btn secondary" onclick="downloadSapIntegrationReport()" title="Descarga un CSV con todos los matches y sin-match para revisar / archivar">Descargar reporte CSV</button>';
  html +=
    '<button class="sap-btn success" onclick="applySapIntegration()"' +
    (totMatches === 0 ? ' disabled' : '') +
    '>Aplicar ' +
    totMatches +
    ' match(es) a Firestore</button>';
  html += '</div>';

  document.getElementById('sap-int-preview').innerHTML = html;
};

window.downloadSapIntegrationReport = function () {
  const pv = sapIntState.preview;
  if (!pv) {
    alert('No hay preview generado.');
    return;
  }
  const rows = [
    ['Tipo', 'Estado', 'Codigo SAP', 'Nombre/Desc SAP', 'Codigo/Nombre App', 'Detalle'],
  ];
  if (pv.cli) {
    pv.cli.matches.forEach((m) =>
      rows.push(['cliente', 'match', m.sapCode, m.sapName, m.appName, ''])
    );
    pv.cli.dupApp.forEach((m) =>
      rows.push([
        'cliente',
        'ambiguo',
        m.sapCode,
        m.sapName,
        m.candidates.join(' | '),
        'Multiples tiendas comparten nombre normalizado',
      ])
    );
    pv.cli.noMatch.forEach((m) =>
      rows.push(['cliente', 'sin_match', m.sapCode, m.sapName, '', ''])
    );
  }
  if (pv.pro) {
    pv.pro.matches.forEach((m) =>
      rows.push(['producto', 'match', m.sapCode, m.sapName, m.appCode, m.appDesc])
    );
    pv.pro.noMatch.forEach((m) =>
      rows.push(['producto', 'sin_match', m.sapCode, m.sapName, '', ''])
    );
  }
  if (pv.ven) {
    pv.ven.matches.forEach((m) =>
      rows.push(['vendedor', 'match', m.slpCode, m.slpName, m.vendorKey, m.zone])
    );
    pv.ven.noMatch.forEach((m) =>
      rows.push(['vendedor', 'sin_match', m.slpCode, m.slpName, '', ''])
    );
  }
  const csv = rowsToCsv(rows);
  downloadBlob(
    '﻿' + csv,
    'sap_integration_report_' + new Date().toISOString().slice(0, 10) + '.csv',
    'text/csv;charset=utf-8'
  );
  showSyncTag('Reporte descargado');
};

window.applySapIntegration = async function () {
  if (!isMarianoUser()) {
    alert('Solo Mariano puede aplicar.');
    return;
  }
  const pv = sapIntState.preview;
  if (!pv) {
    alert('Generar el preview primero.');
    return;
  }
  const totalMatches =
    (pv.cli ? pv.cli.matches.length : 0) +
    (pv.pro ? pv.pro.matches.length : 0) +
    (pv.ven ? pv.ven.matches.length : 0);
  if (!totalMatches) {
    alert('No hay matches para aplicar.');
    return;
  }
  if (
    !confirm(
      'Se van a escribir ' +
        totalMatches +
        ' mapeos a Firestore (pisando los existentes en cada match).\n\n¿Continuar?'
    )
  )
    return;
  const btn = document.querySelector('#sap-int-preview .sap-btn.success');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Aplicando...';
  }
  let ok = 0,
    fail = 0;
  const errs = [];
  // Clientes -> sap_clients
  if (pv.cli) {
    for (const m of pv.cli.matches) {
      try {
        const docId = sapNorm(m.appName)
          .replace(/[^A-Z0-9]/g, '_')
          .slice(0, 1400);
        await fbDb
          .collection('sap_clients')
          .doc(docId)
          .set(
            {
              clientName: m.appName,
              sapCode: m.sapCode,
              sapName: m.sapName,
              updatedBy: currentUser.email || '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              source: 'sap_integration_v1',
            },
            { merge: true }
          );
        ok++;
      } catch (e) {
        fail++;
        if (errs.length < 3) errs.push('cli ' + m.appName + ': ' + (e.message || e));
      }
    }
  }
  // Productos -> sap_products
  if (pv.pro) {
    for (const m of pv.pro.matches) {
      try {
        const docId = (m.appCode || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1400);
        await fbDb
          .collection('sap_products')
          .doc(docId)
          .set(
            {
              productCode: m.appCode,
              sapMaterial: m.sapCode,
              sapName: m.sapName,
              updatedBy: currentUser.email || '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              source: 'sap_integration_v1',
            },
            { merge: true }
          );
        ok++;
      } catch (e) {
        fail++;
        if (errs.length < 3) errs.push('prod ' + m.appCode + ': ' + (e.message || e));
      }
    }
  }
  // Vendedores -> sap_vendors
  if (pv.ven) {
    for (const m of pv.ven.matches) {
      try {
        const docId = sapKeyStr(m.vendorKey);
        await fbDb
          .collection('sap_vendors')
          .doc(docId)
          .set(
            {
              vendorKey: m.vendorKey,
              slpCode: m.slpCode,
              slpName: m.slpName,
              zone: m.zone || '',
              updatedBy: currentUser.email || '',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              source: 'sap_integration_v1',
            },
            { merge: true }
          );
        ok++;
      } catch (e) {
        fail++;
        if (errs.length < 3) errs.push('vendor ' + m.vendorKey + ': ' + (e.message || e));
      }
    }
  }
  logOp('sap_integration_apply', 'sap_master', new Date().toISOString().slice(0, 10), {
    ok,
    fail,
    totalMatches,
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Aplicar ' + totalMatches + ' match(es) a Firestore';
  }
  let msg = 'Aplicacion finalizada.\nGuardados OK: ' + ok + '\nFallidos: ' + fail;
  if (errs.length) msg += '\n\nPrimeros errores:\n- ' + errs.join('\n- ');
  alert(msg);
  showSyncTag('SAP integration: ' + ok + ' OK / ' + fail + ' fallidos');
};

// Cache + listener para sap_vendors (para usar SlpCode al generar ZIP DTW)
if (typeof window.sapVendorsCache === 'undefined') window.sapVendorsCache = new Map();
const sapVendorsCache = window.sapVendorsCache;
if (typeof window.unsubSapVendors === 'undefined') window.unsubSapVendors = null;
function ensureSapVendorsListener() {
  if (unsubSapVendors || !currentUser || !fbDb) return;
  window.unsubSapVendors = fbDb.collection('sap_vendors').onSnapshot(
    (qs) => {
      sapVendorsCache.clear();
      qs.forEach((d) => sapVendorsCache.set(d.id, Object.assign({ _id: d.id }, d.data())));
    },
    (err) => console.warn('sap_vendors listener', err)
  );
}
function sapGetSlpCodeForVendor(vendorKey) {
  if (!vendorKey) return '';
  // Indice por vendorKey directo
  for (const v of sapVendorsCache.values()) {
    if ((v.vendorKey || '').toLowerCase() === vendorKey.toLowerCase()) return v.slpCode || '';
  }
  return '';
}

// === Exports a window ===
// - ensureSapVendorsListener: llamada desde init global (L11825).
// - sapGetSlpCodeForVendor: llamada desde inline buildQuotationPayload (L13170)
//   y desde exports-sap.js bundle.
// - isMarianoUser: helper puede usarse desde otros dominios (admin gates).
window.ensureSapVendorsListener = ensureSapVendorsListener;
window.sapGetSlpCodeForVendor = sapGetSlpCodeForVendor;
if (typeof window.isMarianoUser === 'undefined') window.isMarianoUser = isMarianoUser;
