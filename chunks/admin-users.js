"use strict";
(() => {
  // src/domains/admin-users.js
  if (typeof window.usersCache === "undefined") window.usersCache = [];
  var usersCache = window.usersCache;
  function renderAllowedEmailsSection(allowedList) {
    const el = document.getElementById("allowed-emails-section");
    if (!el) return;
    allowedList = (allowedList || []).slice().sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    let html = '<div style="text-align:center;margin-bottom:10px">';
    html += '<div style="font-size:12px;font-weight:800;color:#1e40af">Emails pre-autorizados</div>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:2px">Si un vendedor usa Gmail personal (no @shimano.com.ar), agregalo aca antes que intente loguear. Los emails @shimano.com.ar y los admins hardcoded ya estan autorizados automaticamente.</div>';
    html += "</div>";
    if (!allowedList.length) {
      html += '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0 10px">No hay emails pre-autorizados todavia.</div>';
    } else {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:10px">';
      allowedList.forEach((ae) => {
        const label = escapeHtml(ae.email || ae._id);
        const note = ae.note ? " &middot; " + escapeHtml(ae.note) : "";
        html += '<div style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #bfdbfe;border-radius:14px;padding:3px 4px 3px 10px;font-size:11px;color:#1e40af;font-weight:600">' + label + note + `<button onclick="removeAllowedEmail('` + escapeAttr(ae._id) + `')" title="Quitar autorizacion" style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1">&times;</button></div>`;
      });
      html += "</div>";
    }
    html += '<div style="text-align:center"><button class="app-btn-pill app-btn-blue" onclick="addAllowedEmail()">&#43; Agregar email</button></div>';
    el.innerHTML = html;
  }
  window.addAllowedEmail = async function() {
    if (userRole !== "admin") return;
    const raw = prompt("Email a autorizar (ej. automatrix.oficial@gmail.com):");
    if (!raw) return;
    const email = raw.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("El email no parece valido.");
      return;
    }
    const note = prompt('Nota corta opcional (ej. "Vendedor Z1 Gonzalo" o "Reemplazo de Mauricio"):', "") || "";
    const docId = emailToDocId(email);
    try {
      await fbDb.collection("allowed_emails").doc(docId).set({
        email,
        note: note.trim(),
        addedBy: currentUser.email || "",
        addedByUid: currentUser.uid,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      showSyncTag("Email autorizado: " + email);
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("addAllowedEmail", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.removeAllowedEmail = async function(docId) {
    if (userRole !== "admin") return;
    if (!confirm("Quitar la autorizacion de este email? Si el usuario ya tiene rol asignado en el panel, va a seguir entrando (la regla pre-aprobada por rol tambien aplica).")) return;
    try {
      await fbDb.collection("allowed_emails").doc(docId).delete();
      showSyncTag("Autorizacion quitada");
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("removeAllowedEmail", e);
      alert("Error: " + (e.message || e));
    }
  };
  function renderGeminiConfigSection(data) {
    const el = document.getElementById("gemini-config-section");
    if (!el) return;
    const hasKey = data && data.apiKey;
    const masked = hasKey ? data.apiKey.slice(0, 4) + "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" + data.apiKey.slice(-4) : "";
    const updatedBy = data && data.updatedBy || "";
    const updatedAt = data && data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate().toLocaleString("es-AR") : "";
    let html = '<div style="text-align:center;margin-bottom:10px">';
    html += '<div style="font-size:12px;font-weight:800;color:#5b21b6">Gemini API Key (OCR de tickets)</div>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:2px">La usan los vendedores cuando suben una foto de ticket para auto-completar los campos del form de gastos.</div>';
    html += "</div>";
    if (hasKey) {
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;justify-content:center">';
      html += '<span style="font-family:Consolas,monospace;font-size:11px;background:#fff;border:1px solid #ddd6fe;border-radius:4px;padding:4px 8px;color:#5b21b6">' + escapeHtml(masked) + "</span>";
      html += '<span style="font-size:10px;color:#64748b">Cargada por ' + escapeHtml(updatedBy || "admin") + (updatedAt ? " (" + escapeHtml(updatedAt) + ")" : "") + "</span>";
      html += "</div>";
    } else {
      html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-align:center">Aun no se cargo ninguna API key. Los vendedores no van a poder usar el OCR.</div>';
    }
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">';
    html += '<button class="app-btn-pill app-btn-violet" onclick="saveGeminiApiKey()">' + (hasKey ? "Cambiar key" : "Cargar key") + "</button>";
    if (hasKey) html += '<button class="app-btn-pill app-btn-red" onclick="deleteGeminiApiKey()">Borrar</button>';
    html += "</div>";
    el.innerHTML = html;
  }
  window.saveGeminiApiKey = async function() {
    if (userRole !== "admin") return;
    const raw = prompt("Pega aca la API key de Gemini (formato AQ.Ab... o AIzaSy...):", "");
    if (raw === null) return;
    const key = raw.trim();
    if (!key) {
      alert("Vacia.");
      return;
    }
    if (key.length < 20) {
      alert("La key parece muy corta. Revisa que la pegaste completa.");
      return;
    }
    try {
      await fbDb.collection("app_config").doc("gemini").set({
        apiKey: key,
        updatedBy: currentUser.email || "",
        updatedByUid: currentUser.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      geminiApiKeyCache = key;
      showSyncTag("API key guardada");
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("saveGeminiApiKey", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.deleteGeminiApiKey = async function() {
    if (userRole !== "admin") return;
    if (!confirm("Borrar la API key de Gemini? Los vendedores no van a poder usar el OCR hasta que cargues una nueva.")) return;
    try {
      await fbDb.collection("app_config").doc("gemini").delete();
      geminiApiKeyCache = null;
      showSyncTag("API key borrada");
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("deleteGeminiApiKey", e);
      alert("Error: " + (e.message || e));
    }
  };
  var gmapsApiKeyCache = null;
  function renderGmapsConfigSection(data) {
    const el = document.getElementById("gmaps-config-section");
    if (!el) return;
    const hasKey = data && data.apiKey;
    const masked = hasKey ? data.apiKey.slice(0, 4) + "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" + data.apiKey.slice(-4) : "";
    const updatedBy = data && data.updatedBy || "";
    const updatedAt = data && data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate().toLocaleString("es-AR") : "";
    let html = '<div style="text-align:center;margin-bottom:10px">';
    html += '<div style="font-size:12px;font-weight:800;color:#065f46">Google Maps API Key (geocoding)</div>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:2px">Convierte direcciones a coordenadas con mucha mejor precisi\xF3n que OSM (sobre todo en localidades chicas). Costo gratis hasta 40.000 requests/mes.</div>';
    html += "</div>";
    if (hasKey) {
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;justify-content:center">';
      html += '<span style="font-family:Consolas,monospace;font-size:11px;background:#fff;border:1px solid #6ee7b7;border-radius:4px;padding:4px 8px;color:#065f46">' + escapeHtml(masked) + "</span>";
      html += '<span style="font-size:10px;color:#64748b">Cargada por ' + escapeHtml(updatedBy || "admin") + (updatedAt ? " (" + escapeHtml(updatedAt) + ")" : "") + "</span>";
      html += "</div>";
    } else {
      html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-align:center">Sin API key. Geocoding usa OpenStreetMap (gratis pero peor cobertura en AR rural).</div>';
    }
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">';
    html += '<button class="app-btn-pill app-btn-cyan" onclick="saveGmapsApiKey()" style="background:#10b981">' + (hasKey ? "Cambiar key" : "Cargar key") + "</button>";
    if (hasKey) html += '<button class="app-btn-pill app-btn-red" onclick="deleteGmapsApiKey()">Borrar</button>';
    html += "</div>";
    el.innerHTML = html;
  }
  window.saveGmapsApiKey = async function() {
    if (userRole !== "admin") return;
    const raw = prompt("Pega aca la API key de Google Maps (formato AIzaSy...).\n\nIMPORTANTE: en Google Cloud Console restringi la key por HTTP referrer a https://shimano-arg.github.io/* para que nadie te la robe.", "");
    if (raw === null) return;
    const key = raw.trim();
    if (!key) {
      alert("Vacia.");
      return;
    }
    if (key.length < 20) {
      alert("La key parece muy corta. Revisa que la pegaste completa.");
      return;
    }
    try {
      await fbDb.collection("app_config").doc("google_maps").set({
        apiKey: key,
        updatedBy: currentUser.email || "",
        updatedByUid: currentUser.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      gmapsApiKeyCache = key;
      showSyncTag("Google Maps API key guardada");
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("saveGmapsApiKey", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.deleteGmapsApiKey = async function() {
    if (userRole !== "admin") return;
    if (!confirm("Borrar la API key de Google Maps? El geocoding vuelve a OSM (peor cobertura en AR rural).")) return;
    try {
      await fbDb.collection("app_config").doc("google_maps").delete();
      gmapsApiKeyCache = null;
      showSyncTag("Google Maps API key borrada");
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("deleteGmapsApiKey", e);
      alert("Error: " + (e.message || e));
    }
  };
  function renderBulkApproverSection() {
    const el = document.getElementById("bulk-approver-section");
    if (!el) return;
    const candidates = (usersCache || []).filter(
      (u) => u.role === "admin" || u.role === "gerente" || u.role === "interno"
    );
    const vendedores = (usersCache || []).filter((u) => u.role === "vendedor");
    let html = '<div style="text-align:center;margin-bottom:10px">';
    html += '<div style="font-size:12px;font-weight:800;color:#a21caf">Aprobador de Rendiciones - asignacion masiva</div>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:2px">Aplica el mismo responsable a TODOS los vendedores de un solo click. Util cuando un gerente comercial centraliza la aprobacion.</div>';
    html += "</div>";
    if (!candidates.length) {
      html += '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0">No hay usuarios con rol admin / gerente / interno. Primero asigna un rol a alguien.</div>';
      el.innerHTML = html;
      return;
    }
    if (!vendedores.length) {
      html += '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:6px 0">No hay usuarios con rol vendedor todavia.</div>';
      el.innerHTML = html;
      return;
    }
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">';
    html += '<select id="bulk-approver-select" style="padding:8px 10px;border:1.5px solid #f0abfc;border-radius:6px;font-size:12px;background:#fff;font-family:inherit;flex:1;max-width:340px">';
    html += '<option value="">- Elegir aprobador -</option>';
    candidates.forEach((u) => {
      const lbl = (u.displayName || u.email || u._uid) + " (" + u.role + ")";
      html += '<option value="' + escapeAttr(u._uid) + '">' + escapeHtml(lbl) + "</option>";
    });
    html += "</select>";
    html += '<button class="app-btn-pill app-btn-violet" onclick="bulkAssignApprover()">Asignar a TODOS los vendedores (' + vendedores.length + ")</button>";
    html += "</div>";
    el.innerHTML = html;
  }
  window.bulkAssignApprover = async function() {
    if (userRole !== "admin") {
      alert("Solo admin.");
      return;
    }
    const sel = document.getElementById("bulk-approver-select");
    const uid = sel && sel.value;
    if (!uid) {
      alert("Eleg&iacute; un aprobador del dropdown.");
      return;
    }
    const approver = (usersCache || []).find((u) => u._uid === uid);
    if (!approver) {
      alert("Aprobador no encontrado.");
      return;
    }
    const vendedores = (usersCache || []).filter((u) => u.role === "vendedor");
    if (!vendedores.length) {
      alert("No hay vendedores para asignar.");
      return;
    }
    const approverLabel = approver.displayName || approver.email || approver._uid;
    if (!confirm("Asignar a " + approverLabel + " como aprobador de los " + vendedores.length + " vendedores?\n\nVa a sobrescribir cualquier aprobador previo asignado a cada vendedor.")) return;
    let okCount = 0, errCount = 0;
    const batch = fbDb.batch();
    vendedores.forEach((v) => {
      const ref = fbDb.collection("roles").doc(v._uid);
      batch.update(ref, {
        rendicionesApproverUid: uid,
        rendicionesApproverEmail: approver.email || "",
        rendicionesApproverUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rendicionesApproverUpdatedBy: currentUser.email || ""
      });
    });
    try {
      await batch.commit();
      okCount = vendedores.length;
      if (typeof logOp === "function") {
        logOp("bulk_assign_approver", "roles", approverLabel, {
          approverUid: uid,
          approverEmail: approver.email || "",
          vendedorCount: vendedores.length,
          vendedorUids: vendedores.map((v) => v._uid)
        });
      }
    } catch (e) {
      console.error("bulkAssignApprover", e);
      errCount = vendedores.length;
      alert("Error: " + (e.message || e));
    }
    if (okCount) {
      showSyncTag(okCount + " vendedor(es) asignado(s) a " + approverLabel);
      try {
        openAdminPanel();
      } catch (e) {
      }
    }
  };
  window.openAdminPanel = async function() {
    if (userRole !== "admin") return;
    document.getElementById("admin-modal").classList.add("open");
    try {
      const aeQs = await fbDb.collection("allowed_emails").get();
      const allowedList = [];
      aeQs.forEach((d) => allowedList.push(Object.assign({ _id: d.id }, d.data())));
      renderAllowedEmailsSection(allowedList);
    } catch (e) {
      console.warn("load allowed_emails", e);
    }
    try {
      const gSnap = await fbDb.collection("app_config").doc("gemini").get();
      renderGeminiConfigSection(gSnap.exists ? gSnap.data() : null);
    } catch (e) {
      console.warn("load gemini config", e);
      renderGeminiConfigSection(null);
    }
    try {
      const gmSnap = await fbDb.collection("app_config").doc("google_maps").get();
      renderGmapsConfigSection(gmSnap.exists ? gmSnap.data() : null);
    } catch (e) {
      console.warn("load gmaps config", e);
      renderGmapsConfigSection(null);
    }
    try {
      const qs = await fbDb.collection("roles").orderBy("email").get();
      usersCache.length = 0;
      qs.forEach((doc) => {
        usersCache.push(Object.assign({ _uid: doc.id }, doc.data()));
      });
      try {
        renderBulkApproverSection();
      } catch (e) {
        console.warn("bulk approver section", e);
      }
      try {
        syncUsersDirectory();
      } catch (e) {
        console.warn("syncUsersDirectory", e);
      }
      const internos = usersCache.filter((u) => u.role === "interno");
      const internoOpts = '<option value="">- Sin pareja -</option>' + internos.map(
        (u) => '<option value="' + u._uid + '">' + escapeHtml(u.email || u.displayName || u._uid) + "</option>"
      ).join("");
      const tbody = document.getElementById("users-table-body");
      const cardsEl = document.getElementById("users-cards");
      let tableHtml = "";
      let cardsHtml = "";
      if (!usersCache.length) {
        tableHtml = '<tr><td colspan="6" style="color:#94a3b8;text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</td></tr>';
        cardsHtml = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</div>';
      } else {
        let vendorsParaInterno2 = function(internoUid) {
          return usersCache.filter((u) => u.role === "vendedor" && u.internalPartnerUid === internoUid);
        };
        var vendorsParaInterno = vendorsParaInterno2;
        const PROTECTED_ADMIN_EMAILS = ["bot.shimano.pesca@gmail.com", "erbinomariano@gmail.com"];
        const rendApproversCandidates = usersCache.filter(
          (u) => u.role === "admin" || u.role === "gerente" || u.role === "interno"
        );
        usersCache.forEach((d) => {
          const docId = d._uid;
          const isSelf = docId === currentUser.uid;
          const isProtected = PROTECTED_ADMIN_EMAILS.indexOf((d.email || "").toLowerCase()) >= 0;
          const isInterno = d.role === "interno";
          const roleOptions = ["unassigned", "admin", "gerente", "vendedor", "interno", "viewer"].map(
            (r) => '<option value="' + r + '"' + (d.role === r ? " selected" : "") + (isSelf && r !== "admin" ? " disabled" : "") + ">" + r + "</option>"
          ).join("");
          const vendorOptions = '<option value="">-</option>' + VENDORS.map(
            (v) => '<option value="' + v.key + '"' + (d.vendor === v.key ? " selected" : "") + ">" + v.zone + " " + v.key + "</option>"
          ).join("");
          let parejaCell;
          if (isInterno) {
            const vinc = vendorsParaInterno2(docId);
            if (vinc.length) {
              const list = vinc.map((u) => {
                const label = u.displayName ? u.displayName.split(/\s+/)[0] : u.email || "";
                return escapeHtml(label) + ' <span style="color:#94a3b8">(' + escapeHtml(u.email || "") + ")</span>";
              }).join("<br>");
              parejaCell = '<div style="font-size:10px;color:#0f172a;line-height:1.5"><div style="font-size:9px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Vendedores externos vinculados (auto)</div>' + list + "</div>";
            } else {
              parejaCell = '<div style="font-size:10px;color:#94a3b8;font-style:italic">Aun ningun vendedor lo tiene como pareja</div>';
            }
            parejaCell += '<input type="hidden" class="internal-sel" value=""/>';
          } else {
            const internoOptsForRow = '<option value="">- Sin pareja -</option>' + internos.map(
              (u) => '<option value="' + u._uid + '"' + (d.internalPartnerUid === u._uid ? " selected" : "") + ">" + escapeHtml(u.email || u.displayName || u._uid) + "</option>"
            ).join("");
            parejaCell = '<select class="internal-sel" title="Pareja interno (solo aplica si el rol es vendedor)">' + internoOptsForRow + "</select>";
          }
          const youTag = isSelf ? ' <span style="color:#7c3aed;font-size:9px;font-weight:800">(VOS)</span>' : "";
          const protectedTag = isProtected && !isSelf ? ' <span style="color:#7c3aed;font-size:9px;font-weight:800" title="Admin protegido - no se puede eliminar">&#128274; PROTEGIDO</span>' : "";
          const waVal = d.whatsapp || "";
          const waInputHtml = '<input type="tel" class="wa-input" placeholder="ej. 5491126762031" value="' + escapeAttr(waVal) + '" style="width:100%;padding:5px 7px;border:1.5px solid #cbd5e1;border-radius:4px;font-size:11px;font-family:inherit;outline:none;background:#fff" title="Numero WhatsApp completo con codigo de pais (sin + ni espacios). Se usa al enviar la ruta."/>';
          const curApproverUid = d.rendicionesApproverUid || "";
          let rendApproverOptions = '<option value="">- Sin asignar -</option>';
          rendApproversCandidates.forEach((u) => {
            if (u._uid === docId) return;
            const lbl = (u.displayName || u.email || u._uid) + " (" + (u.role || "") + ")";
            rendApproverOptions += '<option value="' + escapeAttr(u._uid) + '"' + (curApproverUid === u._uid ? " selected" : "") + ">" + escapeHtml(lbl) + "</option>";
          });
          const rendApproverHtml = '<select class="rend-approver-sel" title="Quien aprueba las rendiciones de este usuario">' + rendApproverOptions + "</select>";
          const pwdBtnHtml = `<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px" onclick="changeUserPassword('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">&#128274; Contrase\xF1a</button>';
          const totpStatusTag = d.totpEnabled ? ' <span style="color:#10b981;font-weight:800">&#10003;</span>' : "";
          const totpBtnHtml = '<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px;background:' + (d.totpEnabled ? "#10b981" : "#5b21b6") + `" onclick="openTotpSetup('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">&#128272; 2FA' + totpStatusTag + "</button>";
          tableHtml += '<tr data-uid="' + docId + '">';
          tableHtml += "<td>" + escapeHtml(d.email || "") + youTag + protectedTag + "</td>";
          tableHtml += "<td>" + escapeHtml(d.displayName || "") + "</td>";
          tableHtml += '<td><select class="role-sel">' + roleOptions + "</select></td>";
          tableHtml += '<td><select class="vendor-sel">' + vendorOptions + "</select></td>";
          tableHtml += "<td>" + parejaCell + "</td>";
          tableHtml += "<td>" + waInputHtml + "</td>";
          tableHtml += "<td>" + rendApproverHtml + "</td>";
          tableHtml += "<td>" + pwdBtnHtml + "</td>";
          tableHtml += "<td>" + totpBtnHtml + "</td>";
          const showDelete = !isSelf && !isProtected;
          const delBtn = showDelete ? `<button class="rm-user-btn" onclick="deleteUserRole('` + docId + `')">Eliminar</button>` : "";
          tableHtml += "<td>" + delBtn + `<button class="save-btn" onclick="saveUserRole('` + docId + `', this)">Guardar</button></td>`;
          tableHtml += "</tr>";
          cardsHtml += '<div class="users-card" data-uid="' + docId + '">';
          cardsHtml += '<div><div class="uc-email">' + escapeHtml(d.email || "") + youTag + protectedTag + "</div>";
          if (d.displayName) cardsHtml += '<div class="uc-name">' + escapeHtml(d.displayName) + "</div>";
          cardsHtml += "</div>";
          cardsHtml += '<div class="uc-row"><label>Rol</label><select class="role-sel">' + roleOptions + "</select></div>";
          cardsHtml += '<div class="uc-row"><label>Vendedor (solo si rol = vendedor)</label><select class="vendor-sel">' + vendorOptions + "</select></div>";
          if (isInterno) {
            cardsHtml += '<div class="uc-row"><label>Vendedores vinculados (auto)</label>' + parejaCell + "</div>";
          } else {
            cardsHtml += '<div class="uc-row"><label>Pareja interno (solo si rol = vendedor)</label>' + parejaCell + "</div>";
          }
          cardsHtml += '<div class="uc-row"><label>WhatsApp (con codigo de pais, sin + ni espacios)</label>' + waInputHtml + "</div>";
          cardsHtml += '<div class="uc-row"><label>Responsable de rendiciones</label>' + rendApproverHtml + "</div>";
          cardsHtml += '<div class="uc-row" style="text-align:center;display:flex;gap:6px;justify-content:center;flex-wrap:wrap">' + pwdBtnHtml + totpBtnHtml + "</div>";
          const delBtnC = showDelete ? `<button class="rm-user-btn" onclick="deleteUserRole('` + docId + `')">Eliminar</button>` : "";
          cardsHtml += '<div class="uc-actions">' + delBtnC + `<button class="save-btn" onclick="saveUserRole('` + docId + `', this)">Guardar</button></div>`;
          cardsHtml += "</div>";
        });
      }
      tbody.innerHTML = tableHtml;
      cardsEl.innerHTML = cardsHtml;
      const thead = document.querySelector("#users-table thead tr");
      if (thead) thead.innerHTML = "<th>Email</th><th>Nombre</th><th>Rol</th><th>Vendedor</th><th>Pareja interno</th><th>WhatsApp</th><th>Resp. rendiciones</th><th>Pass</th><th>2FA</th><th></th>";
    } catch (e) {
      console.error("openAdminPanel", e);
      alert("Error cargando usuarios: " + (e.message || e));
    }
  };
  window.closeAdminPanel = function() {
    document.getElementById("admin-modal").classList.remove("open");
  };
  window.deleteUserRole = async function(uid) {
    if (userRole !== "admin") return;
    if (uid === currentUser.uid) {
      alert("No podes eliminar tu propio acceso.");
      return;
    }
    try {
      const snapPre = await fbDb.collection("roles").doc(uid).get();
      const emailPre = (snapPre.exists ? snapPre.data().email || "" : "").toLowerCase();
      const PROTECTED = ["bot.shimano.pesca@gmail.com", "erbinomariano@gmail.com"];
      if (PROTECTED.indexOf(emailPre) >= 0) {
        alert("Este es un admin protegido (" + emailPre + ") y no se puede eliminar.");
        return;
      }
    } catch (e) {
    }
    if (!confirm('Eliminar acceso de este usuario?\n\nPierde acceso de inmediato. Si vuelve a entrar con Google va a quedar como "sin rol asignado" hasta que vos lo habilites de nuevo.\n\nSu cuenta Google sigue existiendo, no se borra.')) return;
    try {
      const snap = await fbDb.collection("roles").doc(uid).get();
      const data = snap.exists ? snap.data() : {};
      logOp("eliminar_usuario", "user", data.email || uid, { uid, previousRole: data.role, previousVendor: data.vendor });
      await fbDb.collection("roles").doc(uid).delete();
      showSyncTag("Usuario eliminado");
      await openAdminPanel();
    } catch (e) {
      console.error("deleteUserRole", e);
      alert("Error: " + (e.message || e));
    }
  };
  var totpSetupState = null;
  window.openTotpSetup = async function(uid, email) {
    console.log("[2FA] openTotpSetup called", { uid, email, userRole });
    if (userRole !== "admin") {
      alert("Solo el administrador puede configurar 2FA para otros usuarios.");
      return;
    }
    if (!uid) {
      alert("Error: UID del usuario no disponible. Recarga la pagina y reintenta.");
      return;
    }
    totpSetupState = null;
    const modal = document.getElementById("totp-setup-modal");
    if (!modal) {
      alert("Error: modal de 2FA no encontrado en el DOM. Recarga la pagina (Ctrl+Shift+R).");
      return;
    }
    const subtEl = document.getElementById("totp-setup-subt");
    if (subtEl) subtEl.textContent = "Para: " + (email || uid);
    let curEnabled = false;
    let curSecret = null;
    try {
      const snap = await fbDb.collection("roles").doc(uid).get();
      if (snap.exists) {
        const d = snap.data() || {};
        curEnabled = !!d.totpEnabled;
        curSecret = d.totpSecret || null;
      } else {
        console.warn("[2FA] doc roles/" + uid + " no existe");
      }
    } catch (e) {
      console.error("[2FA] error leyendo roles/" + uid, e);
      alert("Error leyendo el estado de 2FA del usuario: " + (e.message || e));
      return;
    }
    const c = document.getElementById("totp-setup-content");
    if (!c) {
      alert("Error: contenedor del modal de 2FA no encontrado. Recarga la pagina.");
      return;
    }
    if (curEnabled && curSecret) {
      c.innerHTML = `<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:12px;font-size:12px;color:#166534;text-align:center"><b>&#10003; 2FA ya est\xE1 activo</b> para este usuario.<br><span style="font-size:11px">Si lo perdi\xF3 o cambi\xF3 de celular, pod\xE9s generarle uno nuevo (el anterior queda invalidado).</span></div><div style="display:flex;gap:8px;margin-top:14px;justify-content:center;flex-wrap:wrap"><button class="app-btn-pill app-btn-violet" onclick="generateNewTotp('` + escapeAttr(uid) + "','" + escapeAttr(email || "") + `')">Generar nuevo (resetear)</button><button class="app-btn-pill app-btn-red" onclick="disableTotp('` + escapeAttr(uid) + `')">Deshabilitar 2FA</button></div>`;
    } else {
      c.innerHTML = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px;font-size:12px;color:#1e40af;text-align:center">Este usuario todav\xEDa no tiene 2FA configurado. Gener\xE1 un nuevo c\xF3digo para que lo escanee con Google Authenticator.</div><div style="text-align:center;margin-top:14px"><button class="app-btn-pill app-btn-violet" onclick="generateNewTotp('` + escapeAttr(uid) + "','" + escapeAttr(email || "") + `')">Generar 2FA</button></div>`;
    }
    document.getElementById("totp-setup-modal").classList.add("open");
  };
  window.closeTotpSetupModal = function() {
    document.getElementById("totp-setup-modal").classList.remove("open");
    totpSetupState = null;
  };
  window.generateNewTotp = async function(uid, email) {
    if (userRole !== "admin") return;
    const secret = totpGenerateSecret();
    const otpauth = totpBuildOtpauthUrl(secret, email || uid);
    totpSetupState = { uid, email, secret, otpauth };
    const c = document.getElementById("totp-setup-content");
    c.innerHTML = '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:11px;color:#78350f;margin-bottom:14px"><b>Pasos para activar:</b><br>1. El usuario instala <b>Google Authenticator</b> en su celular.<br>2. Toca "Agregar" / "+" en la app.<br>3. Elige "Escanear c\xF3digo QR" y escanea el c\xF3digo abajo (o pega el secret manualmente).<br>4. Aparece un c\xF3digo de 6 d\xEDgitos en Google Authenticator.<br>5. Lo escribe en el input de abajo para confirmar y activar.</div>';
    c.innerHTML += '<div style="text-align:center;margin-bottom:14px"><div id="totp-qr-container" style="display:inline-block;background:#fff;padding:10px;border:1px solid #e5e7eb;border-radius:6px">Generando QR...</div></div>';
    c.innerHTML += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center;margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Secret (carga manual si el QR falla)</div><div style="font-family:Consolas,monospace;font-size:13px;font-weight:800;color:#5b21b6;word-break:break-all;letter-spacing:.1em">' + escapeHtml(secret) + "</div></div>";
    c.innerHTML += '<div style="margin-bottom:10px"><label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:5px">C\xF3digo de verificaci\xF3n de Google Authenticator</label><input type="text" id="totp-confirm-input" inputmode="numeric" maxlength="7" placeholder="000000" style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:5px;font-size:18px;text-align:center;letter-spacing:.3em;font-weight:800"/></div>';
    c.innerHTML += '<div style="display:flex;gap:8px;justify-content:center"><button class="app-btn-pill app-btn-violet" onclick="confirmTotpSetup()">Verificar y activar</button><button class="app-btn-pill app-btn-red" onclick="closeTotpSetupModal()">Cancelar</button></div>';
    try {
      await loadQRCodeLib();
      const box = document.getElementById("totp-qr-container");
      if (!box) return;
      box.innerHTML = "";
      new QRCode(box, {
        text: otpauth,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (e) {
      console.warn("[2FA] Error cargando QR lib:", e);
      const box = document.getElementById("totp-qr-container");
      if (box) box.innerHTML = '<div style="font-size:11px;color:#991b1b;padding:14px">No se pudo cargar la librer\xEDa QR. Usa el secret manual para configurar.</div>';
    }
  };
  window.confirmTotpSetup = async function() {
    if (!totpSetupState) return;
    const code = (document.getElementById("totp-confirm-input").value || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      alert("Ingres\xE1 los 6 d\xEDgitos.");
      return;
    }
    const ok = await totpVerifyCode(totpSetupState.secret, code, 1);
    if (!ok) {
      alert("C\xF3digo incorrecto. Asegurate de que el secret se carg\xF3 bien en Google Authenticator y reintent\xE1.");
      return;
    }
    try {
      await fbDb.collection("roles").doc(totpSetupState.uid).update({
        totpSecret: totpSetupState.secret,
        totpEnabled: true,
        totpEnabledAt: firebase.firestore.FieldValue.serverTimestamp(),
        totpEnabledBy: currentUser.email || ""
      });
      showSyncTag("2FA activado para " + (totpSetupState.email || "usuario"));
      closeTotpSetupModal();
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      console.error("save totp", e);
      alert("Error guardando: " + (e.message || e));
    }
  };
  window.disableTotp = async function(uid) {
    if (userRole !== "admin") return;
    if (!confirm("Deshabilitar 2FA para este usuario? Va a entrar solo con password.")) return;
    try {
      await fbDb.collection("roles").doc(uid).update({
        totpEnabled: false,
        totpSecret: firebase.firestore.FieldValue.delete(),
        totpDisabledBy: currentUser.email || "",
        totpDisabledAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showSyncTag("2FA deshabilitado");
      closeTotpSetupModal();
      try {
        openAdminPanel();
      } catch (e) {
      }
    } catch (e) {
      alert("Error: " + (e.message || e));
    }
  };
  window.changeUserPassword = async function(uid, email) {
    if (userRole !== "admin") return;
    if (!email) {
      alert("Este usuario no tiene email registrado - no se puede resetear.");
      return;
    }
    const choice = prompt(
      "Resetear contrase\xF1a de " + email + "\n\nElegi una opcion (1 / 2):\n\n1) ENVIAR MAIL DE RESETEO (recomendado)\n   Le llega a " + email + " un mail de Firebase con un link.\n   El usuario clickea, setea su nueva password y vuelve a la app.\n   Es lo estandar y funciona seguro.\n\n2) Resetear SOLO el password-gate (segunda capa).\n   No cambia la password real de Firebase. Sirve si el usuario\n   entra por Google y olvido la password-gate de la app, NO si\n   olvido la password del login con email.\n\nEscribi 1 o 2:",
      "1"
    );
    if (choice === null) return;
    if (choice.trim() === "1") {
      try {
        await fbAuth.sendPasswordResetEmail(email);
        alert("OK - le envie un mail de reseteo a " + email + ". Decile que revise inbox y spam. El link expira en 1 hora.");
        try {
          await fbDb.collection("roles").doc(uid).update({
            passwordChangedBy: currentUser.email || "",
            passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
            passwordResetMethod: "firebase_email"
          });
        } catch (e) {
        }
      } catch (e) {
        console.error("sendPasswordResetEmail", e);
        alert("Error enviando el mail: " + (e.message || e));
      }
      return;
    }
    if (choice.trim() === "2") {
      const newPwd = prompt("Nueva password-gate para " + email + ":\n\n(Solo afecta la segunda capa de la app, NO el login con email)", "");
      if (newPwd === null) return;
      const pwd = (newPwd || "").trim();
      if (pwd.length < 4) {
        alert("La contrase\xF1a tiene que tener al menos 4 caracteres.");
        return;
      }
      try {
        const creds = await buildPasswordCredentials(pwd);
        await fbDb.collection("roles").doc(uid).update({
          passwordHash: creds.passwordHash,
          passwordSalt: creds.passwordSalt,
          passwordChangedBy: currentUser.email || "",
          passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
          passwordResetMethod: "gate_only"
        });
        showSyncTag("Password-gate actualizada para " + email);
      } catch (e) {
        console.error("changeUserPassword gate", e);
        alert("Error guardando: " + (e.message || e));
      }
      return;
    }
    alert("Opcion no valida. Cancelado.");
  };
  window.saveUserRole = async function(uid, btn) {
    const container = btn.closest("tr") || btn.closest(".users-card");
    if (!container) return;
    const role = container.querySelector(".role-sel").value;
    const vendor = container.querySelector(".vendor-sel").value || null;
    const internalSel = container.querySelector(".internal-sel");
    const internalPartnerUid = internalSel ? internalSel.value || null : null;
    const waInput = container.querySelector(".wa-input");
    let whatsapp = waInput ? (waInput.value || "").replace(/\D/g, "") : "";
    if (whatsapp && whatsapp.length < 8) {
      alert("El numero de WhatsApp es muy corto. Tiene que ser el numero completo con codigo de pais (ej. 5491126762031 para Argentina).");
      return;
    }
    const rendApproverSel = container.querySelector(".rend-approver-sel");
    const rendicionesApproverUid = rendApproverSel ? rendApproverSel.value || null : null;
    let rendicionesApproverEmail = null;
    if (rendicionesApproverUid) {
      const approverUser = (usersCache || []).find((u) => u._uid === rendicionesApproverUid);
      rendicionesApproverEmail = approverUser ? approverUser.email || null : null;
    }
    btn.disabled = true;
    btn.textContent = "...";
    try {
      await fbDb.collection("roles").doc(uid).set({ role, vendor, internalPartnerUid, whatsapp: whatsapp || null, rendicionesApproverUid, rendicionesApproverEmail, assignedBy: currentUser.uid, assignedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (uid === currentUser.uid) {
        myWhatsappNumber = whatsapp || null;
        myRendicionesApproverUid = rendicionesApproverUid || null;
        myRendicionesApproverEmail = rendicionesApproverEmail || null;
      }
      btn.textContent = "OK";
      setTimeout(() => {
        try {
          openAdminPanel();
        } catch (e) {
          console.error("refresh admin panel", e);
        }
      }, 400);
    } catch (e) {
      console.error("saveUserRole", e);
      alert("Error guardando: " + (e.message || e));
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  };
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gS05PV04gQlVHIHByZXNlcnZhZG8gdmVyYmF0aW06IGdlbWluaUFwaUtleUNhY2hlIHNlIHJlYXNpZ25hIHNpbiBwcmVmaXggZW5cclxuLy8gc2F2ZUdlbWluaUFwaUtleS9kZWxldGVHZW1pbmlBcGlLZXksIHBlcm8gbGEgZGVjbGFyYWNpXHUwMEYzbiBgbGV0IGdlbWluaUFwaUtleUNhY2hlYFxyXG4vLyB2aXZlIGVuIHJlbmRpY2lvbmVzLmpzIGJ1bmRsZSAoZXh0cmFcdTAwRURkYSBlbiBFMi5lKS4gTGFzIHJlYXNpZ25hY2lvbmVzIGRlc2RlXHJcbi8vIGVzdGUgYnVuZGxlIGFkbWluLXVzZXJzIGFmZWN0YW4gdW4gYmluZGluZyBsb2NhbCBkaXN0aW50byBxdWUgcmVuZGljaW9uZXMuanNcclxuLy8gTk8gdmUgXHUyMTkyIGNhY2hlIG5vIHNlIGludmFsaWRhIGNyb3NzLW1cdTAwRjNkdWxvLiBUT0RPIEU2OiBwcm9tb3ZlciBhIHdpbmRvdy5nZW1pbmlBcGlLZXlDYWNoZS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IEYxOiB1c2Vyc0NhY2hlICsgYWxsb3dlZC1lbWFpbHMgKyBnZW1pbmkgKyBnbWFwcyArIGJ1bGstYXBwcm92ZXIgKyBvcGVuQWRtaW5QYW5lbCArIGNsb3NlQWRtaW5QYW5lbCAoaW5saW5lIEwxMTYxOS0xMjEzMSlcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4vLyBDUk9TUy1TQ09QRSAoRTYgZml4LCBjb2RlIHJldmlldyBDMSk6IHN5bmNVc2Vyc0RpcmVjdG9yeSAoYnVuZGxlIG5vdGlmaWNhY2lvbmVzKVxyXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcclxuLy8gaWRlbnRpZmllciBuby1kZWNsYXJhZG8gbmkgZW4gd2luZG93IHRpcmEgUmVmZXJlbmNlRXJyb3IuIFByb21vY2lvbmFyIGFcclxuLy8gd2luZG93LnVzZXJzQ2FjaGUgcHJlc2VydmEgbGEgcmVmZXJlbmNpYSBlbnRyZSBidW5kbGUgYWRtaW4tdXNlcnMgKGNodW5rIGxhenkpXHJcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXHJcbmlmICh0eXBlb2Ygd2luZG93LnVzZXJzQ2FjaGUgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cudXNlcnNDYWNoZSA9IFtdO1xyXG5jb25zdCB1c2Vyc0NhY2hlID0gd2luZG93LnVzZXJzQ2FjaGU7XHJcblxyXG5mdW5jdGlvbiByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCl7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSkuc2xpY2UoKS5zb3J0KChhLCBiKSA9PiAoYS5lbWFpbCB8fCAnJykubG9jYWxlQ29tcGFyZShiLmVtYWlsIHx8ICcnKSk7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMWU0MGFmXCI+RW1haWxzIHByZS1hdXRvcml6YWRvczwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj5TaSB1biB2ZW5kZWRvciB1c2EgR21haWwgcGVyc29uYWwgKG5vIEBzaGltYW5vLmNvbS5hciksIGFncmVnYWxvIGFjYSBhbnRlcyBxdWUgaW50ZW50ZSBsb2d1ZWFyLiBMb3MgZW1haWxzIEBzaGltYW5vLmNvbS5hciB5IGxvcyBhZG1pbnMgaGFyZGNvZGVkIHlhIGVzdGFuIGF1dG9yaXphZG9zIGF1dG9tYXRpY2FtZW50ZS48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDAgMTBweFwiPk5vIGhheSBlbWFpbHMgcHJlLWF1dG9yaXphZG9zIHRvZGF2aWEuPC9kaXY+JztcclxuICB9IGVsc2Uge1xyXG4gICAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICAgIGFsbG93ZWRMaXN0LmZvckVhY2goYWUgPT4ge1xyXG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcclxuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XHJcbiAgICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPidcclxuICAgICAgICArIGxhYmVsICsgbm90ZVxyXG4gICAgICAgICsgJzxidXR0b24gb25jbGljaz1cInJlbW92ZUFsbG93ZWRFbWFpbChcXCcnICsgZXNjYXBlQXR0cihhZS5faWQpICsgJ1xcJylcIiB0aXRsZT1cIlF1aXRhciBhdXRvcml6YWNpb25cIiBzdHlsZT1cImJhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NTAlO3dpZHRoOjE4cHg7aGVpZ2h0OjE4cHg7Zm9udC1zaXplOjExcHg7Y3Vyc29yOnBvaW50ZXI7bGluZS1oZWlnaHQ6MVwiPiZ0aW1lczs8L2J1dHRvbj4nXHJcbiAgICAgICAgKyAnPC9kaXY+JztcclxuICAgIH0pO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9XHJcbiAgaHRtbCArPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWJsdWVcIiBvbmNsaWNrPVwiYWRkQWxsb3dlZEVtYWlsKClcIj4mIzQzOyBBZ3JlZ2FyIGVtYWlsPC9idXR0b24+PC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG59XHJcblxyXG53aW5kb3cuYWRkQWxsb3dlZEVtYWlsID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoJ0VtYWlsIGEgYXV0b3JpemFyIChlai4gYXV0b21hdHJpeC5vZmljaWFsQGdtYWlsLmNvbSk6Jyk7XHJcbiAgaWYgKCFyYXcpIHJldHVybjtcclxuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBpZiAoIS9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvLnRlc3QoZW1haWwpKSB7IGFsZXJ0KCdFbCBlbWFpbCBubyBwYXJlY2UgdmFsaWRvLicpOyByZXR1cm47IH1cclxuICBjb25zdCBub3RlID0gcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XHJcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5zZXQoe1xyXG4gICAgICBlbWFpbCwgbm90ZTogbm90ZS50cmltKCksXHJcbiAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLCBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgIGFkZGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgfSwge21lcmdlOiB0cnVlfSk7XHJcbiAgICBzaG93U3luY1RhZygnRW1haWwgYXV0b3JpemFkbzogJyArIGVtYWlsKTtcclxuICAgIC8vIFJlY2FyZ2FyIHBhbmVsXHJcbiAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbihkb2NJZCl7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKCFjb25maXJtKCdRdWl0YXIgbGEgYXV0b3JpemFjaW9uIGRlIGVzdGUgZW1haWw/IFNpIGVsIHVzdWFyaW8geWEgdGllbmUgcm9sIGFzaWduYWRvIGVuIGVsIHBhbmVsLCB2YSBhIHNlZ3VpciBlbnRyYW5kbyAobGEgcmVnbGEgcHJlLWFwcm9iYWRhIHBvciByb2wgdGFtYmllbiBhcGxpY2EpLicpKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKS5kb2MoZG9jSWQpLmRlbGV0ZSgpO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0F1dG9yaXphY2lvbiBxdWl0YWRhJyk7XHJcbiAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBTZWNjaW9uIEdlbWluaSBBUEkgS2V5IChhZG1pbikgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZGF0YSl7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ2VtaW5pLWNvbmZpZy1zZWN0aW9uJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGhhc0tleSA9IGRhdGEgJiYgZGF0YS5hcGlLZXk7XHJcbiAgY29uc3QgbWFza2VkID0gaGFzS2V5ID8gKGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkpIDogJyc7XHJcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9IChkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZSkgPyBkYXRhLnVwZGF0ZWRBdC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcnO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzViMjFiNlwiPkdlbWluaSBBUEkgS2V5IChPQ1IgZGUgdGlja2V0cyk8L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+TGEgdXNhbiBsb3MgdmVuZGVkb3JlcyBjdWFuZG8gc3ViZW4gdW5hIGZvdG8gZGUgdGlja2V0IHBhcmEgYXV0by1jb21wbGV0YXIgbG9zIGNhbXBvcyBkZWwgZm9ybSBkZSBnYXN0b3MuPC9kaXY+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGlmIChoYXNLZXkpIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxMHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gICAgaHRtbCArPSAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgI2RkZDZmZTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzViMjFiNlwiPicgKyBlc2NhcGVIdG1sKG1hc2tlZCkgKyAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGJcIj5DYXJnYWRhIHBvciAnICsgZXNjYXBlSHRtbCh1cGRhdGVkQnkgfHwgJ2FkbWluJykgKyAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArICc8L3NwYW4+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPkF1biBubyBzZSBjYXJnbyBuaW5ndW5hIEFQSSBrZXkuIExvcyB2ZW5kZWRvcmVzIG5vIHZhbiBhIHBvZGVyIHVzYXIgZWwgT0NSLjwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cInNhdmVHZW1pbmlBcGlLZXkoKVwiPicgKyAoaGFzS2V5ID8gJ0NhbWJpYXIga2V5JyA6ICdDYXJnYXIga2V5JykgKyAnPC9idXR0b24+JztcclxuICBpZiAoaGFzS2V5KSBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRlbGV0ZUdlbWluaUFwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbndpbmRvdy5zYXZlR2VtaW5pQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR2VtaW5pIChmb3JtYXRvIEFRLkFiLi4uIG8gQUl6YVN5Li4uKTonLCAnJyk7XHJcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGtleSA9IHJhdy50cmltKCk7XHJcbiAgaWYgKCFrZXkpIHsgYWxlcnQoJ1ZhY2lhLicpOyByZXR1cm47IH1cclxuICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7IGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpOyByZXR1cm47IH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnZW1pbmknKS5zZXQoe1xyXG4gICAgICBhcGlLZXk6IGtleSxcclxuICAgICAgdXBkYXRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgdXBkYXRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICB9LCB7bWVyZ2U6IHRydWV9KTtcclxuICAgIGdlbWluaUFwaUtleUNhY2hlID0ga2V5OyAvLyByZWZyZXNjYXIgY2FjaGUgbG9jYWxcclxuICAgIHNob3dTeW5jVGFnKCdBUEkga2V5IGd1YXJkYWRhJyk7XHJcbiAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR2VtaW5pQXBpS2V5JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZGVsZXRlR2VtaW5pQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWNvbmZpcm0oJ0JvcnJhciBsYSBBUEkga2V5IGRlIEdlbWluaT8gTG9zIHZlbmRlZG9yZXMgbm8gdmFuIGEgcG9kZXIgdXNhciBlbCBPQ1IgaGFzdGEgcXVlIGNhcmd1ZXMgdW5hIG51ZXZhLicpKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ2VtaW5pJykuZGVsZXRlKCk7XHJcbiAgICBnZW1pbmlBcGlLZXlDYWNoZSA9IG51bGw7XHJcbiAgICBzaG93U3luY1RhZygnQVBJIGtleSBib3JyYWRhJyk7XHJcbiAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVHZW1pbmlBcGlLZXknLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHT09HTEUgTUFQUyBHZW9jb2RpbmcgQVBJIC0gbWVqb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsIHF1ZSBPU01cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3NcclxuLy8gY29tbyBnZW9jb2RlciBQUklNQVJJTyBlbiBnZW9jb2RlQ2xpZW50QWRkcmVzczsgc2kgZmFsbGEgbyBubyBlc3RhXHJcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxyXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbmFzeW5jIGZ1bmN0aW9uIGdldEdtYXBzQXBpS2V5KCl7XHJcbiAgaWYgKGdtYXBzQXBpS2V5Q2FjaGUpIHJldHVybiBnbWFwc0FwaUtleUNhY2hlO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xyXG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBzbmFwLmRhdGEoKSB8fCB7fTtcclxuICAgICAgaWYgKGQuYXBpS2V5KSB7IGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTsgcmV0dXJuIGQuYXBpS2V5OyB9XHJcbiAgICB9XHJcbiAgfSBjYXRjaChlKSB7IGNvbnNvbGUud2FybignW2dtYXBzXSBubyBzZSBwdWRvIGxlZXIgYXBpIGtleScsIGUpOyB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpe1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dtYXBzLWNvbmZpZy1zZWN0aW9uJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGhhc0tleSA9IGRhdGEgJiYgZGF0YS5hcGlLZXk7XHJcbiAgY29uc3QgbWFza2VkID0gaGFzS2V5ID8gKGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkpIDogJyc7XHJcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9IChkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZSkgPyBkYXRhLnVwZGF0ZWRBdC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcnO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzA2NWY0NlwiPkdvb2dsZSBNYXBzIEFQSSBLZXkgKGdlb2NvZGluZyk8L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGlmIChoYXNLZXkpIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxMHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gICAgaHRtbCArPSAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgIzZlZTdiNztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzA2NWY0NlwiPicgKyBlc2NhcGVIdG1sKG1hc2tlZCkgKyAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGJcIj5DYXJnYWRhIHBvciAnICsgZXNjYXBlSHRtbCh1cGRhdGVkQnkgfHwgJ2FkbWluJykgKyAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArICc8L3NwYW4+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xyXG4gIH1cclxuICBodG1sICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgaHRtbCArPSAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWN5YW5cIiBvbmNsaWNrPVwic2F2ZUdtYXBzQXBpS2V5KClcIiBzdHlsZT1cImJhY2tncm91bmQ6IzEwYjk4MVwiPicgKyAoaGFzS2V5ID8gJ0NhbWJpYXIga2V5JyA6ICdDYXJnYXIga2V5JykgKyAnPC9idXR0b24+JztcclxuICBpZiAoaGFzS2V5KSBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRlbGV0ZUdtYXBzQXBpS2V5KClcIj5Cb3JyYXI8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG53aW5kb3cuc2F2ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsICcnKTtcclxuICBpZiAocmF3ID09PSBudWxsKSByZXR1cm47XHJcbiAgY29uc3Qga2V5ID0gcmF3LnRyaW0oKTtcclxuICBpZiAoIWtleSkgeyBhbGVydCgnVmFjaWEuJyk7IHJldHVybjsgfVxyXG4gIGlmIChrZXkubGVuZ3RoIDwgMjApIHsgYWxlcnQoJ0xhIGtleSBwYXJlY2UgbXV5IGNvcnRhLiBSZXZpc2EgcXVlIGxhIHBlZ2FzdGUgY29tcGxldGEuJyk7IHJldHVybjsgfVxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuc2V0KHtcclxuICAgICAgYXBpS2V5OiBrZXksXHJcbiAgICAgIHVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICB1cGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgfSwge21lcmdlOiB0cnVlfSk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xyXG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgZ3VhcmRhZGEnKTtcclxuICAgIHRyeSB7IG9wZW5BZG1pblBhbmVsKCk7IH0gY2F0Y2goZSkge31cclxuICB9IGNhdGNoKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVHbWFwc0FwaUtleScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG53aW5kb3cuZGVsZXRlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbigpe1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmICghY29uZmlybSgnQm9ycmFyIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHM/IEVsIGdlb2NvZGluZyB2dWVsdmUgYSBPU00gKHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZGVsZXRlKCk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0gbnVsbDtcclxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcclxuICAgIHRyeSB7IG9wZW5BZG1pblBhbmVsKCk7IH0gY2F0Y2goZSkge31cclxuICB9IGNhdGNoKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZUdtYXBzQXBpS2V5JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQlVMSyBBUFBST1ZFUiAtIGFzaWduYXIgZWwgbWlzbW8gXCJSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lc1wiXHJcbi8vIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXMgZGUgdW4gc29sbyBjbGljay5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFV0aWwgY3VhbmRvIHVuIHNvbG8gYXByb2JhZG9yIChlai4gUGFibG8gZ2VyZW50ZSkgcmV2aXNhIGxhc1xyXG4vLyByZW5kaWNpb25lcyBkZSBUT0RPUyBsb3MgdmVuZGVkb3Jlcy4gU2luIGVzdG8gZWwgYWRtaW4gdGllbmUgcXVlXHJcbi8vIGFicmlyIGNhZGEgZmlsYSBkZWwgcGFuZWwgVXN1YXJpb3MgeSBzZXRlYXIgZWwgZHJvcGRvd24gdW5hIGEgdW5hLlxyXG5mdW5jdGlvbiByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCl7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWN0aW9uJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKHUgPT5cclxuICAgIHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xyXG4gICk7XHJcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIodSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6I2EyMWNhZlwiPkFwcm9iYWRvciBkZSBSZW5kaWNpb25lcyAtIGFzaWduYWNpb24gbWFzaXZhPC9kaXY+JztcclxuICBodG1sICs9ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFjYW5kaWRhdGVzLmxlbmd0aCkge1xyXG4gICAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIGFkbWluIC8gZ2VyZW50ZSAvIGludGVybm8uIFByaW1lcm8gYXNpZ25hIHVuIHJvbCBhIGFsZ3VpZW4uPC9kaXY+JztcclxuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCB2ZW5kZWRvciB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBodG1sICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gIGh0bWwgKz0gJzxzZWxlY3QgaWQ9XCJidWxrLWFwcHJvdmVyLXNlbGVjdFwiIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtib3JkZXI6MS41cHggc29saWQgI2YwYWJmYztib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOiNmZmY7Zm9udC1mYW1pbHk6aW5oZXJpdDtmbGV4OjE7bWF4LXdpZHRoOjM0MHB4XCI+JztcclxuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xyXG4gIGNhbmRpZGF0ZXMuZm9yRWFjaCh1ID0+IHtcclxuICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyB1LnJvbGUgKyAnKSc7XHJcbiAgICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGVzY2FwZUF0dHIodS5fdWlkKSArICdcIj4nICsgZXNjYXBlSHRtbChsYmwpICsgJzwvb3B0aW9uPic7XHJcbiAgfSk7XHJcbiAgaHRtbCArPSAnPC9zZWxlY3Q+JztcclxuICBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImJ1bGtBc3NpZ25BcHByb3ZlcigpXCI+QXNpZ25hciBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzICgnICsgdmVuZGVkb3Jlcy5sZW5ndGggKyAnKTwvYnV0dG9uPic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG59XHJcbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbigpe1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgeyBhbGVydCgnU29sbyBhZG1pbi4nKTsgcmV0dXJuOyB9XHJcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1bGstYXBwcm92ZXItc2VsZWN0Jyk7XHJcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcclxuICBpZiAoIXVpZCkgeyBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7IHJldHVybjsgfVxyXG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQodSA9PiB1Ll91aWQgPT09IHVpZCk7XHJcbiAgaWYgKCFhcHByb3ZlcikgeyBhbGVydCgnQXByb2JhZG9yIG5vIGVuY29udHJhZG8uJyk7IHJldHVybjsgfVxyXG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKHUgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcclxuICBpZiAoIXZlbmRlZG9yZXMubGVuZ3RoKSB7IGFsZXJ0KCdObyBoYXkgdmVuZGVkb3JlcyBwYXJhIGFzaWduYXIuJyk7IHJldHVybjsgfVxyXG4gIGNvbnN0IGFwcHJvdmVyTGFiZWwgPSBhcHByb3Zlci5kaXNwbGF5TmFtZSB8fCBhcHByb3Zlci5lbWFpbCB8fCBhcHByb3Zlci5fdWlkO1xyXG4gIGlmICghY29uZmlybSgnQXNpZ25hciBhICcgKyBhcHByb3ZlckxhYmVsICsgJyBjb21vIGFwcm9iYWRvciBkZSBsb3MgJyArIHZlbmRlZG9yZXMubGVuZ3RoICsgJyB2ZW5kZWRvcmVzP1xcblxcblZhIGEgc29icmVzY3JpYmlyIGN1YWxxdWllciBhcHJvYmFkb3IgcHJldmlvIGFzaWduYWRvIGEgY2FkYSB2ZW5kZWRvci4nKSkgcmV0dXJuO1xyXG4gIGxldCBva0NvdW50ID0gMCwgZXJyQ291bnQgPSAwO1xyXG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxyXG4gIGNvbnN0IGJhdGNoID0gZmJEYi5iYXRjaCgpO1xyXG4gIHZlbmRlZG9yZXMuZm9yRWFjaCh2ID0+IHtcclxuICAgIGNvbnN0IHJlZiA9IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2Modi5fdWlkKTtcclxuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgYmF0Y2guY29tbWl0KCk7XHJcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XHJcbiAgICBpZiAodHlwZW9mIGxvZ09wID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGxvZ09wKCdidWxrX2Fzc2lnbl9hcHByb3ZlcicsICdyb2xlcycsIGFwcHJvdmVyTGFiZWwsIHtcclxuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICAgIGFwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHZlbmRlZG9yQ291bnQ6IHZlbmRlZG9yZXMubGVuZ3RoLFxyXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAodiA9PiB2Ll91aWQpLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9IGNhdGNoKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2J1bGtBc3NpZ25BcHByb3ZlcicsIGUpO1xyXG4gICAgZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxuICBpZiAob2tDb3VudCkge1xyXG4gICAgc2hvd1N5bmNUYWcob2tDb3VudCArICcgdmVuZGVkb3IoZXMpIGFzaWduYWRvKHMpIGEgJyArIGFwcHJvdmVyTGFiZWwpO1xyXG4gICAgdHJ5IHsgb3BlbkFkbWluUGFuZWwoKTsgfSBjYXRjaChlKSB7fSAvLyByZWZyZXNjYXJcclxuICB9XHJcbn07XHJcblxyXG4vLyBHZW9jb2RpbmcgY29uIEdvb2dsZSBNYXBzIEFQSS4gRGV2dWVsdmUge2xhdCwgbG5nLCBkaXNwbGF5LCBwcmVjaXNpb259XHJcbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXHJcbmFzeW5jIGZ1bmN0aW9uIGdlb2NvZGVXaXRoR29vZ2xlTWFwcyhhZGRyZXNzLCBsb2NhbGl0eSwgcHJvdmluY2VDb2RlKXtcclxuICBjb25zdCBrZXkgPSBhd2FpdCBnZXRHbWFwc0FwaUtleSgpO1xyXG4gIGlmICgha2V5KSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBwcm92ID0gKHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicpID8gdGl0bGVDYXNlKHByb3ZpbmNlQ29kZSB8fCAnJykgOiAocHJvdmluY2VDb2RlIHx8ICcnKTtcclxuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xyXG4gIC8vIHJlZ2lvbj1hciArIGNvbXBvbmVudHM9Y291bnRyeTpBUiBzZXNnYSBsb3MgcmVzdWx0YWRvcyBhIEFSLlxyXG4gIGNvbnN0IHVybCA9ICdodHRwczovL21hcHMuZ29vZ2xlYXBpcy5jb20vbWFwcy9hcGkvZ2VvY29kZS9qc29uJ1xyXG4gICAgKyAnP2FkZHJlc3M9JyArIGVuY29kZVVSSUNvbXBvbmVudChmdWxsQWRkcilcclxuICAgICsgJyZyZWdpb249YXInXHJcbiAgICArICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJ1xyXG4gICAgKyAnJmxhbmd1YWdlPWVzJ1xyXG4gICAgKyAnJmtleT0nICsgZW5jb2RlVVJJQ29tcG9uZW50KGtleSk7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xyXG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcclxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByLmpzb24oKTtcclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xyXG4gICAgICBjb25zdCByZXMgPSBkYXRhLnJlc3VsdHNbMF07XHJcbiAgICAgIGNvbnN0IGxvYyA9IHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb247XHJcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcclxuICAgICAgLy8gbG9jYXRpb25fdHlwZSBpbmRpY2EgcHJlY2lzaW9uOiBST09GVE9QID4gUkFOR0VfSU5URVJQT0xBVEVEID4gR0VPTUVUUklDX0NFTlRFUiA+IEFQUFJPWElNQVRFLlxyXG4gICAgICBjb25zdCBsdCA9IChyZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uX3R5cGUpIHx8ICcnO1xyXG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xyXG4gICAgICBpZiAobHQgPT09ICdBUFBST1hJTUFURScpIHByZWNpc2lvbiA9ICdsb2NhbGl0eSc7XHJcbiAgICAgIGVsc2UgaWYgKGx0ID09PSAnR0VPTUVUUklDX0NFTlRFUicpIHByZWNpc2lvbiA9ICdzdHJlZXQnO1xyXG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xyXG4gICAgICAvLyBxdWUgU0FQIG5vIGV4cG9ydG8gKFNoaXAtdG8gQ2l0eSB2YWNpbyBlcyBtdXkgY29tdW4gZW4gQlBzIHZpZWpvcykuXHJcbiAgICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXMuYWRkcmVzc19jb21wb25lbnRzIHx8IFtdO1xyXG4gICAgICBjb25zdCBieVR5cGUgPSB0ID0+IHtcclxuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKGNjID0+IEFycmF5LmlzQXJyYXkoY2MudHlwZXMpICYmIGNjLnR5cGVzLmluY2x1ZGVzKHQpKTtcclxuICAgICAgICByZXR1cm4gYyA/IChjLmxvbmdfbmFtZSB8fCAnJykgOiAnJztcclxuICAgICAgfTtcclxuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxyXG4gICAgICBjb25zdCBkZXRlY3RlZExvY2FsaXR5ID0gYnlUeXBlKCdsb2NhbGl0eScpIHx8IGJ5VHlwZSgnc3VibG9jYWxpdHknKSB8fCBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMicpIHx8ICcnO1xyXG4gICAgICBjb25zdCBkZXRlY3RlZFByb3ZpbmNlID0gYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzEnKSB8fCAnJztcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBsYXQ6IHBhcnNlRmxvYXQobG9jLmxhdCksXHJcbiAgICAgICAgbG5nOiBwYXJzZUZsb2F0KGxvYy5sbmcpLFxyXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcclxuICAgICAgICBwcmVjaXNpb246IHByZWNpc2lvbixcclxuICAgICAgICBwcm92aWRlcjogJ2dvb2dsZScsXHJcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcclxuICAgICAgICBsb2NhbGl0eTogZGV0ZWN0ZWRMb2NhbGl0eSxcclxuICAgICAgICBwcm92aW5jZTogZGV0ZWN0ZWRQcm92aW5jZSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ1pFUk9fUkVTVUxUUycpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gUkVRVUVTVF9ERU5JRUQ6JywgZGF0YS5lcnJvcl9tZXNzYWdlIHx8ICcoc2luIGRldGFsbGUpLiBSZXZpc2FyIHF1ZSBsYSBBUEkga2V5IHRlbmdhIGhhYmlsaXRhZGEgR2VvY29kaW5nIEFQSSB5IGVsIHJlZmVycmVyIHBlcm1pdGEgZXN0ZSBkb21pbmlvLicpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gT1ZFUl9RVUVSWV9MSU1JVCAtIGV4Y2VkaW8gZWwgbGltaXRlLiBDYWVtb3MgYSBPU00uJyk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIHN0YXR1cyBpbmVzcGVyYWRvOicsIGRhdGEuc3RhdHVzLCBkYXRhLmVycm9yX21lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gZ2VvY29kZSBlcnJvcjonLCBlKTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxufVxyXG5cclxud2luZG93Lm9wZW5BZG1pblBhbmVsID0gYXN5bmMgZnVuY3Rpb24oKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcclxuICB0cnkge1xyXG4gICAgY29uc3QgYWVRcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKS5nZXQoKTtcclxuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XHJcbiAgICBhZVFzLmZvckVhY2goZCA9PiBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oe19pZDogZC5pZH0sIGQuZGF0YSgpKSkpO1xyXG4gICAgcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpO1xyXG4gIH0gY2F0Y2goZSkgeyBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTsgfVxyXG4gIC8vIENhcmdhciBjb25maWcgR2VtaW5pIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXlcclxuICB0cnkge1xyXG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xyXG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihnU25hcC5leGlzdHMgPyBnU25hcC5kYXRhKCkgOiBudWxsKTtcclxuICB9IGNhdGNoKGUpIHsgY29uc29sZS53YXJuKCdsb2FkIGdlbWluaSBjb25maWcnLCBlKTsgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihudWxsKTsgfVxyXG4gIC8vIENhcmdhciBjb25maWcgR29vZ2xlIE1hcHMgcGFyYSBtb3N0cmFyIGxhIHNlY2Npb24gZGUgQVBJIGtleS5cclxuICB0cnkge1xyXG4gICAgY29uc3QgZ21TbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xyXG4gICAgcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGdtU25hcC5leGlzdHMgPyBnbVNuYXAuZGF0YSgpIDogbnVsbCk7XHJcbiAgfSBjYXRjaChlKSB7IGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTsgcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKG51bGwpOyB9XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLm9yZGVyQnkoJ2VtYWlsJykuZ2V0KCk7XHJcbiAgICAvLyBFNiBmaXggQzE6IHZhY2lhciBlbCBBcnJheSBpbi1wbGFjZSAocHJlc2VydmEgd2luZG93LnVzZXJzQ2FjaGUgcmVmKS5cclxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcclxuICAgIHFzLmZvckVhY2goZG9jID0+IHsgdXNlcnNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oe191aWQ6IGRvYy5pZH0sIGRvYy5kYXRhKCkpKTsgfSk7XHJcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXHJcbiAgICB0cnkgeyByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCk7IH0gY2F0Y2goZSkgeyBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpOyB9XHJcbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcclxuICAgIC8vIHB1ZWRhbiB2ZXIgZGVzdGluYXRhcmlvcyBhbCBjcmVhciB0YXJlYXMgZW4gTm90aWZpY2FjaW9uZXMuIFNpbiBlc3RvXHJcbiAgICAvLyBsb3MgdmVuZGVkb3JlcyB2ZW4gZWwgZHJvcGRvd24gdmFjaW8gKHNlY3VyaXR5IHJ1bGVzIGJsb3F1ZWFuIC9yb2xlcykuXHJcbiAgICB0cnkgeyBzeW5jVXNlcnNEaXJlY3RvcnkoKTsgfSBjYXRjaChlKSB7IGNvbnNvbGUud2Fybignc3luY1VzZXJzRGlyZWN0b3J5JywgZSk7IH1cclxuICAgIC8vIExpc3RhIGRlIGludGVybm9zIGRpc3BvbmlibGVzIChwYXJhIGFzaWduYXIgcGFyZWphIGEgbG9zIHZlbmRlZG9yZXMpXHJcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKHUgPT4gdS5yb2xlID09PSAnaW50ZXJubycpO1xyXG4gICAgY29uc3QgaW50ZXJub09wdHMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIHBhcmVqYSAtPC9vcHRpb24+JyArIGludGVybm9zLm1hcCh1ID0+XHJcbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArIHUuX3VpZCArICdcIj4nICsgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArICc8L29wdGlvbj4nXHJcbiAgICApLmpvaW4oJycpO1xyXG5cclxuICAgIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLXRhYmxlLWJvZHknKTtcclxuICAgIGNvbnN0IGNhcmRzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXNlcnMtY2FyZHMnKTtcclxuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcclxuICAgIGxldCBjYXJkc0h0bWwgPSAnJztcclxuICAgIGlmICghdXNlcnNDYWNoZS5sZW5ndGgpIHtcclxuICAgICAgdGFibGVIdG1sID0gJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XHJcbiAgICAgIGNhcmRzSHRtbCA9ICc8ZGl2IHN0eWxlPVwiY29sb3I6Izk0YTNiODtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gQWRtaW5zIHByaW1hcmlvcyBwcm90ZWdpZG9zOiBubyBzZSBwdWVkZW4gZWxpbWluYXIgKE1hcmlhbm8gKyBib3QgY29ycG9yYXRpdm8pXHJcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgICAvLyBQYXJhIGxvcyBpbnRlcm5vcyBjYWxjdWxhbW9zIGxhIHJlbGFjaW9uIGludmVyc2E6IHF1aWVuZXMgbG9zIHRpZW5lbiBjb21vIHBhcmVqYVxyXG4gICAgICBmdW5jdGlvbiB2ZW5kb3JzUGFyYUludGVybm8oaW50ZXJub1VpZCl7XHJcbiAgICAgICAgcmV0dXJuIHVzZXJzQ2FjaGUuZmlsdGVyKHUgPT4gdS5yb2xlID09PSAndmVuZGVkb3InICYmIHUuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSBpbnRlcm5vVWlkKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBDYW5kaWRhdG9zIGEgcmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM6IGFkbWluLCBnZXJlbnRlIG8gaW50ZXJubyAobm8gdmVuZGVkb3JlcyBuaSB2aWV3ZXJzIG5pIHVuYXNzaWduZWQpXHJcbiAgICAgIGNvbnN0IHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzID0gdXNlcnNDYWNoZS5maWx0ZXIodSA9PlxyXG4gICAgICAgIHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xyXG4gICAgICApO1xyXG4gICAgICB1c2Vyc0NhY2hlLmZvckVhY2goZCA9PiB7XHJcbiAgICAgICAgY29uc3QgZG9jSWQgPSBkLl91aWQ7XHJcbiAgICAgICAgY29uc3QgaXNTZWxmID0gZG9jSWQgPT09IGN1cnJlbnRVc2VyLnVpZDtcclxuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcclxuICAgICAgICBjb25zdCBpc0ludGVybm8gPSBkLnJvbGUgPT09ICdpbnRlcm5vJztcclxuICAgICAgICBjb25zdCByb2xlT3B0aW9ucyA9IFsndW5hc3NpZ25lZCcsJ2FkbWluJywnZ2VyZW50ZScsJ3ZlbmRlZG9yJywnaW50ZXJubycsJ3ZpZXdlciddLm1hcChyID0+XHJcbiAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgKyByICsgJ1wiJyArIChkLnJvbGUgPT09IHIgPyAnIHNlbGVjdGVkJyA6ICcnKSArIChpc1NlbGYgJiYgciAhPT0gJ2FkbWluJyA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nICsgciArICc8L29wdGlvbj4nXHJcbiAgICAgICAgKS5qb2luKCcnKTtcclxuICAgICAgICBjb25zdCB2ZW5kb3JPcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tPC9vcHRpb24+JyArIFZFTkRPUlMubWFwKHYgPT5cclxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArIHYua2V5ICsgJ1wiJyArIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArICc+JyArIHYuem9uZSArICcgJyArIHYua2V5ICsgJzwvb3B0aW9uPidcclxuICAgICAgICApLmpvaW4oJycpO1xyXG4gICAgICAgIC8vIFNpIGVzIGludGVybm8sIG1vc3RyYXIgcmVsYWNpb24gaW52ZXJzYSAodmVuZGVkb3JlcyBxdWUgbG8gdGllbmVuIGNvbW8gcGFyZWphKSBlbiB2ZXogZGVsIGRyb3Bkb3duIGVkaXRhYmxlXHJcbiAgICAgICAgbGV0IHBhcmVqYUNlbGw7XHJcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xyXG4gICAgICAgICAgY29uc3QgdmluYyA9IHZlbmRvcnNQYXJhSW50ZXJubyhkb2NJZCk7XHJcbiAgICAgICAgICBpZiAodmluYy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmMubWFwKHUgPT4ge1xyXG4gICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6ICh1LmVtYWlsIHx8ICcnKTtcclxuICAgICAgICAgICAgICByZXR1cm4gZXNjYXBlSHRtbChsYWJlbCkgKyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6Izk0YTNiOFwiPignICsgZXNjYXBlSHRtbCh1LmVtYWlsIHx8ICcnKSArICcpPC9zcGFuPic7XHJcbiAgICAgICAgICAgIH0pLmpvaW4oJzxicj4nKTtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCA9ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzBmMTcyYTtsaW5lLWhlaWdodDoxLjVcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzQ3NTU2OTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjJweFwiPlZlbmRlZG9yZXMgZXh0ZXJub3MgdmluY3VsYWRvcyAoYXV0byk8L2Rpdj4nICsgbGlzdCArICc8L2Rpdj4nO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCA9ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6Izk0YTNiODtmb250LXN0eWxlOml0YWxpY1wiPkF1biBuaW5ndW4gdmVuZGVkb3IgbG8gdGllbmUgY29tbyBwYXJlamE8L2Rpdj4nO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxyXG4gICAgICAgICAgcGFyZWphQ2VsbCArPSAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIiBjbGFzcz1cImludGVybmFsLXNlbFwiIHZhbHVlPVwiXCIvPic7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgKyBpbnRlcm5vcy5tYXAodSA9PlxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgKyB1Ll91aWQgKyAnXCInICsgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArICc+JyArIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgKyAnPC9vcHRpb24+J1xyXG4gICAgICAgICAgKS5qb2luKCcnKTtcclxuICAgICAgICAgIHBhcmVqYUNlbGwgPSAnPHNlbGVjdCBjbGFzcz1cImludGVybmFsLXNlbFwiIHRpdGxlPVwiUGFyZWphIGludGVybm8gKHNvbG8gYXBsaWNhIHNpIGVsIHJvbCBlcyB2ZW5kZWRvcilcIj4nICsgaW50ZXJub09wdHNGb3JSb3cgKyAnPC9zZWxlY3Q+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiM3YzNhZWQ7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIj4oVk9TKTwvc3Bhbj4nIDogJyc7XHJcbiAgICAgICAgY29uc3QgcHJvdGVjdGVkVGFnID0gaXNQcm90ZWN0ZWQgJiYgIWlzU2VsZiA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojN2MzYWVkO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCIgdGl0bGU9XCJBZG1pbiBwcm90ZWdpZG8gLSBubyBzZSBwdWVkZSBlbGltaW5hclwiPiYjMTI4Mjc0OyBQUk9URUdJRE88L3NwYW4+JyA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHdhVmFsID0gZC53aGF0c2FwcCB8fCAnJztcclxuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9ICc8aW5wdXQgdHlwZT1cInRlbFwiIGNsYXNzPVwid2EtaW5wdXRcIiBwbGFjZWhvbGRlcj1cImVqLiA1NDkxMTI2NzYyMDMxXCIgdmFsdWU9XCInICsgZXNjYXBlQXR0cih3YVZhbCkgKyAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgI2NiZDVlMTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZTtiYWNrZ3JvdW5kOiNmZmZcIiB0aXRsZT1cIk51bWVybyBXaGF0c0FwcCBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKHNpbiArIG5pIGVzcGFjaW9zKS4gU2UgdXNhIGFsIGVudmlhciBsYSBydXRhLlwiLz4nO1xyXG4gICAgICAgIC8vIERyb3Bkb3duICdSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcydcclxuICAgICAgICBjb25zdCBjdXJBcHByb3ZlclVpZCA9IGQucmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCAnJztcclxuICAgICAgICBsZXQgcmVuZEFwcHJvdmVyT3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gYXNpZ25hciAtPC9vcHRpb24+JztcclxuICAgICAgICByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcy5mb3JFYWNoKHUgPT4ge1xyXG4gICAgICAgICAgaWYgKHUuX3VpZCA9PT0gZG9jSWQpIHJldHVybjsgLy8gdW4gdXN1YXJpbyBubyBwdWVkZSBzZXIgc3UgcHJvcGlvIGFwcm9iYWRvclxyXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBlc2NhcGVBdHRyKHUuX3VpZCkgKyAnXCInICsgKGN1ckFwcHJvdmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArICc+JyArIGVzY2FwZUh0bWwobGJsKSArICc8L29wdGlvbj4nO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IHJlbmRBcHByb3Zlckh0bWwgPSAnPHNlbGVjdCBjbGFzcz1cInJlbmQtYXBwcm92ZXItc2VsXCIgdGl0bGU9XCJRdWllbiBhcHJ1ZWJhIGxhcyByZW5kaWNpb25lcyBkZSBlc3RlIHVzdWFyaW9cIj4nICsgcmVuZEFwcHJvdmVyT3B0aW9ucyArICc8L3NlbGVjdD4nO1xyXG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ2FtYmlhciBjb250cmFzZVx1MDBGMWFcclxuICAgICAgICBjb25zdCBwd2RCdG5IdG1sID0gJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHhcIiBvbmNsaWNrPVwiY2hhbmdlVXNlclBhc3N3b3JkKFxcJycgKyBkb2NJZCArICdcXCcsICcgKyBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgKyAnKVwiPiYjMTI4Mjc0OyBDb250cmFzZVx1MDBGMWE8L2J1dHRvbj4nO1xyXG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ29uZmlndXJhciAyRkFcclxuICAgICAgICBjb25zdCB0b3RwU3RhdHVzVGFnID0gZC50b3RwRW5hYmxlZCA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPicgOiAnJztcclxuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9ICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4O2JhY2tncm91bmQ6JyArIChkLnRvdHBFbmFibGVkID8gJyMxMGI5ODEnIDogJyM1YjIxYjYnKSArICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICsgZG9jSWQgKyAnXFwnLCAnICsgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJylcIj4mIzEyODI3MjsgMkZBJyArIHRvdHBTdGF0dXNUYWcgKyAnPC9idXR0b24+JztcclxuICAgICAgICAvLyBEZXNrdG9wIHJvd1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRyIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUgfHwgJycpICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICsgcm9sZU9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwYXJlamFDZWxsICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgd2FJbnB1dEh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyByZW5kQXBwcm92ZXJIdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHRvdHBCdG5IdG1sICsgJzwvdGQ+JztcclxuICAgICAgICBjb25zdCBzaG93RGVsZXRlID0gIWlzU2VsZiAmJiAhaXNQcm90ZWN0ZWQ7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZSA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArIGRvY0lkICsgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPicgOiAnJztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZGVsQnRuICsgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArIGRvY0lkICsgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPC90cj4nO1xyXG4gICAgICAgIC8vIE1vYmlsZSBjYXJkXHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidXNlcnMtY2FyZFwiIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2PjxkaXYgY2xhc3M9XCJ1Yy1lbWFpbFwiPicgKyBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICsgeW91VGFnICsgcHJvdGVjdGVkVGFnICsgJzwvZGl2Pic7XHJcbiAgICAgICAgaWYgKGQuZGlzcGxheU5hbWUpIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLW5hbWVcIj4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lKSArICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+Um9sPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICsgcm9sZU9wdGlvbnMgKyAnPC9zZWxlY3Q+PC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgKyB2ZW5kb3JPcHRpb25zICsgJzwvc2VsZWN0PjwvZGl2Pic7XHJcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xyXG4gICAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yZXMgdmluY3VsYWRvcyAoYXV0byk8L2xhYmVsPicgKyBwYXJlamFDZWxsICsgJzwvZGl2Pic7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5QYXJlamEgaW50ZXJubyAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPicgKyBwYXJlamFDZWxsICsgJzwvZGl2Pic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgKyB3YUlucHV0SHRtbCArICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5SZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczwvbGFiZWw+JyArIHJlbmRBcHByb3Zlckh0bWwgKyAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICsgcHdkQnRuSHRtbCArIHRvdHBCdG5IdG1sICsgJzwvZGl2Pic7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGUgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgKyBkb2NJZCArICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nIDogJyc7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgKyBkZWxCdG5DICsgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArIGRvY0lkICsgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xyXG4gICAgY2FyZHNFbC5pbm5lckhUTUwgPSBjYXJkc0h0bWw7XHJcbiAgICAvLyBBY3R1YWxpemEgaGVhZGVyIGRlIHRhYmxhIGNvbiBsYSBjb2x1bW5hIG51ZXZhXHJcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xyXG4gICAgaWYgKHRoZWFkKSB0aGVhZC5pbm5lckhUTUwgPSAnPHRoPkVtYWlsPC90aD48dGg+Tm9tYnJlPC90aD48dGg+Um9sPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5QYXJlamEgaW50ZXJubzwvdGg+PHRoPldoYXRzQXBwPC90aD48dGg+UmVzcC4gcmVuZGljaW9uZXM8L3RoPjx0aD5QYXNzPC90aD48dGg+MkZBPC90aD48dGg+PC90aD4nO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbigpe1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBGMjogZGVsZXRlVXNlclJvbGUgKyBUT1RQICsgY2hhbmdlVXNlclBhc3N3b3JkICsgc2F2ZVVzZXJSb2xlIChpbmxpbmUgTDE0MTA1LTE0MzkwKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5kZWxldGVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uKHVpZCl7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7IGFsZXJ0KCdObyBwb2RlcyBlbGltaW5hciB0dSBwcm9waW8gYWNjZXNvLicpOyByZXR1cm47IH1cclxuICAvLyBEZWZlbnNhIGFkaWNpb25hbDogYWRtaW5zIHByb3RlZ2lkb3Mgbm8gc2UgcHVlZGVuIGVsaW1pbmFyIG5pIGRlc2RlIGNvbnNvbGFcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcFByZSA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGNvbnN0IGVtYWlsUHJlID0gKHNuYXBQcmUuZXhpc3RzID8gKHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnKSA6ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgY29uc3QgUFJPVEVDVEVEID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcclxuICAgIGlmIChQUk9URUNURUQuaW5kZXhPZihlbWFpbFByZSkgPj0gMCkge1xyXG4gICAgICBhbGVydCgnRXN0ZSBlcyB1biBhZG1pbiBwcm90ZWdpZG8gKCcgKyBlbWFpbFByZSArICcpIHkgbm8gc2UgcHVlZGUgZWxpbWluYXIuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICB9IGNhdGNoKGUpIHsgLyogc2kgZmFsbGEgbGEgbGVjdHVyYSBwcmV2aWEsIHNpZ3VlIGNvbiBjb25maXJtICovIH1cclxuICBpZiAoIWNvbmZpcm0oJ0VsaW1pbmFyIGFjY2VzbyBkZSBlc3RlIHVzdWFyaW8/XFxuXFxuUGllcmRlIGFjY2VzbyBkZSBpbm1lZGlhdG8uIFNpIHZ1ZWx2ZSBhIGVudHJhciBjb24gR29vZ2xlIHZhIGEgcXVlZGFyIGNvbW8gXCJzaW4gcm9sIGFzaWduYWRvXCIgaGFzdGEgcXVlIHZvcyBsbyBoYWJpbGl0ZXMgZGUgbnVldm8uXFxuXFxuU3UgY3VlbnRhIEdvb2dsZSBzaWd1ZSBleGlzdGllbmRvLCBubyBzZSBib3JyYS4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xyXG4gICAgY29uc3QgZGF0YSA9IHNuYXAuZXhpc3RzID8gc25hcC5kYXRhKCkgOiB7fTtcclxuICAgIGxvZ09wKCdlbGltaW5hcl91c3VhcmlvJywgJ3VzZXInLCBkYXRhLmVtYWlsIHx8IHVpZCwge3VpZCwgcHJldmlvdXNSb2xlOiBkYXRhLnJvbGUsIHByZXZpb3VzVmVuZG9yOiBkYXRhLnZlbmRvcn0pO1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmRlbGV0ZSgpO1xyXG4gICAgc2hvd1N5bmNUYWcoJ1VzdWFyaW8gZWxpbWluYWRvJyk7XHJcbiAgICBhd2FpdCBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XHJcblxyXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uKHVpZCwgZW1haWwpe1xyXG4gIGNvbnNvbGUubG9nKCdbMkZBXSBvcGVuVG90cFNldHVwIGNhbGxlZCcsIHt1aWQsIGVtYWlsLCB1c2VyUm9sZX0pO1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gZWwgYWRtaW5pc3RyYWRvciBwdWVkZSBjb25maWd1cmFyIDJGQSBwYXJhIG90cm9zIHVzdWFyaW9zLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXVpZCkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiBVSUQgZGVsIHVzdWFyaW8gbm8gZGlzcG9uaWJsZS4gUmVjYXJnYSBsYSBwYWdpbmEgeSByZWludGVudGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxuICAvLyBNb2RhbCBleGlzdGU/XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpO1xyXG4gIGlmICghbW9kYWwpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8gZW4gZWwgRE9NLiBSZWNhcmdhIGxhIHBhZ2luYSAoQ3RybCtTaGlmdCtSKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgc3VidEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtc3VidCcpO1xyXG4gIGlmIChzdWJ0RWwpIHN1YnRFbC50ZXh0Q29udGVudCA9ICdQYXJhOiAnICsgKGVtYWlsIHx8IHVpZCk7XHJcbiAgLy8gTGVlciBlc3RhZG8gYWN0dWFsXHJcbiAgbGV0IGN1ckVuYWJsZWQgPSBmYWxzZTtcclxuICBsZXQgY3VyU2VjcmV0ID0gbnVsbDtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGlmIChzbmFwLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XHJcbiAgICAgIGN1ckVuYWJsZWQgPSAhIWQudG90cEVuYWJsZWQ7XHJcbiAgICAgIGN1clNlY3JldCA9IGQudG90cFNlY3JldCB8fCBudWxsO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS53YXJuKCdbMkZBXSBkb2Mgcm9sZXMvJyArIHVpZCArICcgbm8gZXhpc3RlJyk7XHJcbiAgICB9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbMkZBXSBlcnJvciBsZXllbmRvIHJvbGVzLycgKyB1aWQsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gZWwgZXN0YWRvIGRlIDJGQSBkZWwgdXN1YXJpbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xyXG4gIGlmICghYykge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiBjb250ZW5lZG9yIGRlbCBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkby4gUmVjYXJnYSBsYSBwYWdpbmEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjdXJFbmFibGVkICYmIGN1clNlY3JldCkge1xyXG4gICAgYy5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2RjZmNlNztib3JkZXI6MXB4IHNvbGlkICM4NmVmYWM7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMxNjY1MzQ7dGV4dC1hbGlnbjpjZW50ZXJcIj4nXHJcbiAgICAgICsgJzxiPiYjMTAwMDM7IDJGQSB5YSBlc3RcdTAwRTEgYWN0aXZvPC9iPiBwYXJhIGVzdGUgdXN1YXJpby4nXHJcbiAgICAgICsgJzxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4XCI+U2kgbG8gcGVyZGlcdTAwRjMgbyBjYW1iaVx1MDBGMyBkZSBjZWx1bGFyLCBwb2RcdTAwRTlzIGdlbmVyYXJsZSB1bm8gbnVldm8gKGVsIGFudGVyaW9yIHF1ZWRhIGludmFsaWRhZG8pLjwvc3Bhbj4nXHJcbiAgICAgICsgJzwvZGl2PidcclxuICAgICAgKyAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O21hcmdpbi10b3A6MTRweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+J1xyXG4gICAgICArICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICsgZXNjYXBlQXR0cih1aWQpICsgJ1xcJyxcXCcnICsgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgKyAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPidcclxuICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICsgZXNjYXBlQXR0cih1aWQpICsgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+J1xyXG4gICAgICArICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjLmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPidcclxuICAgICAgKyAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLidcclxuICAgICAgKyAnPC9kaXY+J1xyXG4gICAgICArICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+J1xyXG4gICAgICArICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICsgZXNjYXBlQXR0cih1aWQpICsgJ1xcJyxcXCcnICsgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgKyAnXFwnKVwiPkdlbmVyYXIgMkZBPC9idXR0b24+J1xyXG4gICAgICArICc8L2Rpdj4nO1xyXG4gIH1cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlVG90cFNldHVwTW9kYWwgPSBmdW5jdGlvbigpe1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbih1aWQsIGVtYWlsKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCBzZWNyZXQgPSB0b3RwR2VuZXJhdGVTZWNyZXQoKTtcclxuICBjb25zdCBvdHBhdXRoID0gdG90cEJ1aWxkT3RwYXV0aFVybChzZWNyZXQsIGVtYWlsIHx8IHVpZCk7XHJcbiAgdG90cFNldHVwU3RhdGUgPSB7dWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGh9O1xyXG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XHJcbiAgYy5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZlZjNjNztib3JkZXI6MXB4IHNvbGlkICNmY2QzNGQ7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM3ODM1MGY7bWFyZ2luLWJvdHRvbToxNHB4XCI+J1xyXG4gICAgKyAnPGI+UGFzb3MgcGFyYSBhY3RpdmFyOjwvYj48YnI+J1xyXG4gICAgKyAnMS4gRWwgdXN1YXJpbyBpbnN0YWxhIDxiPkdvb2dsZSBBdXRoZW50aWNhdG9yPC9iPiBlbiBzdSBjZWx1bGFyLjxicj4nXHJcbiAgICArICcyLiBUb2NhIFwiQWdyZWdhclwiIC8gXCIrXCIgZW4gbGEgYXBwLjxicj4nXHJcbiAgICArICczLiBFbGlnZSBcIkVzY2FuZWFyIGNcdTAwRjNkaWdvIFFSXCIgeSBlc2NhbmVhIGVsIGNcdTAwRjNkaWdvIGFiYWpvIChvIHBlZ2EgZWwgc2VjcmV0IG1hbnVhbG1lbnRlKS48YnI+J1xyXG4gICAgKyAnNC4gQXBhcmVjZSB1biBjXHUwMEYzZGlnbyBkZSA2IGRcdTAwRURnaXRvcyBlbiBHb29nbGUgQXV0aGVudGljYXRvci48YnI+J1xyXG4gICAgKyAnNS4gTG8gZXNjcmliZSBlbiBlbCBpbnB1dCBkZSBhYmFqbyBwYXJhIGNvbmZpcm1hciB5IGFjdGl2YXIuJ1xyXG4gICAgKyAnPC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9ICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZjhmYWZjO2JvcmRlcjoxcHggc29saWQgI2UyZThmMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+J1xyXG4gICAgKyAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojNDc1NTY5O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206NHB4XCI+U2VjcmV0IChjYXJnYSBtYW51YWwgc2kgZWwgUVIgZmFsbGEpPC9kaXY+J1xyXG4gICAgKyAnPGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzViMjFiNjt3b3JkLWJyZWFrOmJyZWFrLWFsbDtsZXR0ZXItc3BhY2luZzouMWVtXCI+JyArIGVzY2FwZUh0bWwoc2VjcmV0KSArICc8L2Rpdj4nXHJcbiAgICArICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9ICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxMHB4XCI+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiM0NzU1Njk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjVweFwiPkNcdTAwRjNkaWdvIGRlIHZlcmlmaWNhY2lcdTAwRjNuIGRlIEdvb2dsZSBBdXRoZW50aWNhdG9yPC9sYWJlbD4nXHJcbiAgICArICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInRvdHAtY29uZmlybS1pbnB1dFwiIGlucHV0bW9kZT1cIm51bWVyaWNcIiBtYXhsZW5ndGg9XCI3XCIgcGxhY2Vob2xkZXI9XCIwMDAwMDBcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzoxMHB4IDEycHg7Ym9yZGVyOjEuNXB4IHNvbGlkICNjYmQ1ZTE7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7bGV0dGVyLXNwYWNpbmc6LjNlbTtmb250LXdlaWdodDo4MDBcIi8+PC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImNvbmZpcm1Ub3RwU2V0dXAoKVwiPlZlcmlmaWNhciB5IGFjdGl2YXI8L2J1dHRvbj4nXHJcbiAgICArICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImNsb3NlVG90cFNldHVwTW9kYWwoKVwiPkNhbmNlbGFyPC9idXR0b24+PC9kaXY+JztcclxuICAvLyBMYXp5LWxvYWQgcXJjb2RlanMgeSBnZW5lcmFyLiBFc3RhIGxpYnJlcmlhIHBpbnRhIGVsIFFSIGRpcmVjdG8gZW4gZWxcclxuICAvLyBjb250ZW5lZG9yIERPTSB2aWEgY2FudmFzL2ltZyAtIG5vIG5lY2VzaXRhIGNhbGxiYWNrIHRvRGF0YVVSTC5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZFFSQ29kZUxpYigpO1xyXG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XHJcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xyXG4gICAgYm94LmlubmVySFRNTCA9ICcnOyAvLyBsaW1waWFyIGVsIFwiR2VuZXJhbmRvIFFSLi4uXCJcclxuICAgIG5ldyBRUkNvZGUoYm94LCB7XHJcbiAgICAgIHRleHQ6IG90cGF1dGgsXHJcbiAgICAgIHdpZHRoOiAyMjAsXHJcbiAgICAgIGhlaWdodDogMjIwLFxyXG4gICAgICBjb2xvckRhcms6ICcjMDAwMDAwJyxcclxuICAgICAgY29sb3JMaWdodDogJyNmZmZmZmYnLFxyXG4gICAgICBjb3JyZWN0TGV2ZWw6IFFSQ29kZS5Db3JyZWN0TGV2ZWwuTVxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1syRkFdIEVycm9yIGNhcmdhbmRvIFFSIGxpYjonLCBlKTtcclxuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xyXG4gICAgaWYgKGJveCkgYm94LmlubmVySFRNTCA9ICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk5MWIxYjtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uKCl7XHJcbiAgaWYgKCF0b3RwU2V0dXBTdGF0ZSkgcmV0dXJuO1xyXG4gIGNvbnN0IGNvZGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtY29uZmlybS1pbnB1dCcpLnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXHMrL2csICcnKTtcclxuICBpZiAoIS9eXFxkezZ9JC8udGVzdChjb2RlKSkgeyBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTsgcmV0dXJuOyB9XHJcbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xyXG4gIGlmICghb2spIHsgYWxlcnQoJ0NcdTAwRjNkaWdvIGluY29ycmVjdG8uIEFzZWd1cmF0ZSBkZSBxdWUgZWwgc2VjcmV0IHNlIGNhcmdcdTAwRjMgYmllbiBlbiBHb29nbGUgQXV0aGVudGljYXRvciB5IHJlaW50ZW50XHUwMEUxLicpOyByZXR1cm47IH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpLnVwZGF0ZSh7XHJcbiAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcclxuICAgICAgdG90cEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHRvdHBFbmFibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gICAgc2hvd1N5bmNUYWcoJzJGQSBhY3RpdmFkbyBwYXJhICcgKyAodG90cFNldHVwU3RhdGUuZW1haWwgfHwgJ3VzdWFyaW8nKSk7XHJcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XHJcbiAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHt9XHJcbiAgfSBjYXRjaChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbih1aWQpe1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmICghY29uZmlybSgnRGVzaGFiaWxpdGFyIDJGQSBwYXJhIGVzdGUgdXN1YXJpbz8gVmEgYSBlbnRyYXIgc29sbyBjb24gcGFzc3dvcmQuJykpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLnVwZGF0ZSh7XHJcbiAgICAgIHRvdHBFbmFibGVkOiBmYWxzZSxcclxuICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXHJcbiAgICAgIHRvdHBEaXNhYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgdG90cERpc2FibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7IG9wZW5BZG1pblBhbmVsKCk7IH0gY2F0Y2goZSkge31cclxuICB9IGNhdGNoKGUpIHsgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7IH1cclxufTtcclxuXHJcbndpbmRvdy5jaGFuZ2VVc2VyUGFzc3dvcmQgPSBhc3luYyBmdW5jdGlvbih1aWQsIGVtYWlsKXtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWVtYWlsKSB7IGFsZXJ0KCdFc3RlIHVzdWFyaW8gbm8gdGllbmUgZW1haWwgcmVnaXN0cmFkbyAtIG5vIHNlIHB1ZWRlIHJlc2V0ZWFyLicpOyByZXR1cm47IH1cclxuICBjb25zdCBjaG9pY2UgPSBwcm9tcHQoXHJcbiAgICAnUmVzZXRlYXIgY29udHJhc2VcdTAwRjFhIGRlICcgKyBlbWFpbCArICdcXG5cXG4nICtcclxuICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXHJcbiAgICAnMSkgRU5WSUFSIE1BSUwgREUgUkVTRVRFTyAocmVjb21lbmRhZG8pXFxuJyArXHJcbiAgICAnICAgTGUgbGxlZ2EgYSAnICsgZW1haWwgKyAnIHVuIG1haWwgZGUgRmlyZWJhc2UgY29uIHVuIGxpbmsuXFxuJyArXHJcbiAgICAnICAgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcclxuICAgICcgICBFcyBsbyBlc3RhbmRhciB5IGZ1bmNpb25hIHNlZ3Vyby5cXG5cXG4nICtcclxuICAgICcyKSBSZXNldGVhciBTT0xPIGVsIHBhc3N3b3JkLWdhdGUgKHNlZ3VuZGEgY2FwYSkuXFxuJyArXHJcbiAgICAnICAgTm8gY2FtYmlhIGxhIHBhc3N3b3JkIHJlYWwgZGUgRmlyZWJhc2UuIFNpcnZlIHNpIGVsIHVzdWFyaW9cXG4nICtcclxuICAgICcgICBlbnRyYSBwb3IgR29vZ2xlIHkgb2x2aWRvIGxhIHBhc3N3b3JkLWdhdGUgZGUgbGEgYXBwLCBOTyBzaVxcbicgK1xyXG4gICAgJyAgIG9sdmlkbyBsYSBwYXNzd29yZCBkZWwgbG9naW4gY29uIGVtYWlsLlxcblxcbicgK1xyXG4gICAgJ0VzY3JpYmkgMSBvIDI6JyxcclxuICAgICcxJ1xyXG4gICk7XHJcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcclxuICAgICAgYWxlcnQoJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArIGVtYWlsICsgJy4gRGVjaWxlIHF1ZSByZXZpc2UgaW5ib3ggeSBzcGFtLiBFbCBsaW5rIGV4cGlyYSBlbiAxIGhvcmEuJyk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLnVwZGF0ZSh7XHJcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoKGUpe31cclxuICAgIH0gY2F0Y2goZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcclxuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdCgnTnVldmEgcGFzc3dvcmQtZ2F0ZSBwYXJhICcgKyBlbWFpbCArICc6XFxuXFxuKFNvbG8gYWZlY3RhIGxhIHNlZ3VuZGEgY2FwYSBkZSBsYSBhcHAsIE5PIGVsIGxvZ2luIGNvbiBlbWFpbCknLCAnJyk7XHJcbiAgICBpZiAobmV3UHdkID09PSBudWxsKSByZXR1cm47XHJcbiAgICBjb25zdCBwd2QgPSAobmV3UHdkIHx8ICcnKS50cmltKCk7XHJcbiAgICBpZiAocHdkLmxlbmd0aCA8IDQpIHsgYWxlcnQoJ0xhIGNvbnRyYXNlXHUwMEYxYSB0aWVuZSBxdWUgdGVuZXIgYWwgbWVub3MgNCBjYXJhY3RlcmVzLicpOyByZXR1cm47IH1cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNyZWRzID0gYXdhaXQgYnVpbGRQYXNzd29yZENyZWRlbnRpYWxzKHB3ZCk7XHJcbiAgICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS51cGRhdGUoe1xyXG4gICAgICAgIHBhc3N3b3JkSGFzaDogY3JlZHMucGFzc3dvcmRIYXNoLFxyXG4gICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxyXG4gICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXHJcbiAgICAgIH0pO1xyXG4gICAgICBzaG93U3luY1RhZygnUGFzc3dvcmQtZ2F0ZSBhY3R1YWxpemFkYSBwYXJhICcgKyBlbWFpbCk7XHJcbiAgICB9IGNhdGNoKGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uKHVpZCwgYnRuKXtcclxuICBjb25zdCBjb250YWluZXIgPSBidG4uY2xvc2VzdCgndHInKSB8fCBidG4uY2xvc2VzdCgnLnVzZXJzLWNhcmQnKTtcclxuICBpZiAoIWNvbnRhaW5lcikgcmV0dXJuO1xyXG4gIGNvbnN0IHJvbGUgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJvbGUtc2VsJykudmFsdWU7XHJcbiAgY29uc3QgdmVuZG9yID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy52ZW5kb3Itc2VsJykudmFsdWUgfHwgbnVsbDtcclxuICBjb25zdCBpbnRlcm5hbFNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcuaW50ZXJuYWwtc2VsJyk7XHJcbiAgY29uc3QgaW50ZXJuYWxQYXJ0bmVyVWlkID0gaW50ZXJuYWxTZWwgPyAoaW50ZXJuYWxTZWwudmFsdWUgfHwgbnVsbCkgOiBudWxsO1xyXG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxyXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XHJcbiAgbGV0IHdoYXRzYXBwID0gd2FJbnB1dCA/ICh3YUlucHV0LnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXEQvZywgJycpIDogJyc7XHJcbiAgaWYgKHdoYXRzYXBwICYmIHdoYXRzYXBwLmxlbmd0aCA8IDgpIHtcclxuICAgIGFsZXJ0KCdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMgKHVpZCBkZWwgdXN1YXJpbyBxdWUgYXBydWViYSlcclxuICBjb25zdCByZW5kQXBwcm92ZXJTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJlbmQtYXBwcm92ZXItc2VsJyk7XHJcbiAgY29uc3QgcmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRBcHByb3ZlclNlbCA/IChyZW5kQXBwcm92ZXJTZWwudmFsdWUgfHwgbnVsbCkgOiBudWxsO1xyXG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xyXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcclxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xyXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cclxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcclxuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xyXG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQodSA9PiB1Ll91aWQgPT09IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpO1xyXG4gICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gYXBwcm92ZXJVc2VyID8gKGFwcHJvdmVyVXNlci5lbWFpbCB8fCBudWxsKSA6IG51bGw7XHJcbiAgfVxyXG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7IGJ0bi50ZXh0Q29udGVudCA9ICcuLi4nO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuc2V0KHtyb2xlLCB2ZW5kb3IsIGludGVybmFsUGFydG5lclVpZCwgd2hhdHNhcHA6IHdoYXRzYXBwIHx8IG51bGwsIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQsIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLCBhc3NpZ25lZEJ5OiBjdXJyZW50VXNlci51aWQsIGFzc2lnbmVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpfSwge21lcmdlOiB0cnVlfSk7XHJcbiAgICAvLyBTaSBlbCB1c3VhcmlvIGVkaXRvIHN1IHByb3BpbyBudW1lcm8sIGFjdHVhbGl6YXIgZWwgY2FjaGUgbG9jYWxcclxuICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xyXG4gICAgICBteVdoYXRzYXBwTnVtYmVyID0gd2hhdHNhcHAgfHwgbnVsbDtcclxuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCBudWxsO1xyXG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCB8fCBudWxsO1xyXG4gICAgfVxyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ09LJztcclxuICAgIC8vIFJlLXJlbmRlciBkZWwgcGFuZWwgYXNpIGxvcyBkcm9wZG93bnMgXCJQYXJlamEgaW50ZXJub1wiIG11ZXN0cmFuIGxvcyBpbnRlcm5vcyBhY3R1YWxpemFkb3NcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICB0cnkgeyBvcGVuQWRtaW5QYW5lbCgpOyB9IGNhdGNoKGUpIHsgY29uc29sZS5lcnJvcigncmVmcmVzaCBhZG1pbiBwYW5lbCcsIGUpOyB9XHJcbiAgICB9LCA0MDApO1xyXG4gIH0gY2F0Y2goZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc2F2ZVVzZXJSb2xlJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTsgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xyXG4gIH1cclxufTtcclxuXHJcblxyXG4vLyBUb2RvcyBsb3MgaGFuZGxlcnMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIHNvbiB2ZXJiYXRpbS5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBMEJBLE1BQUksT0FBTyxPQUFPLGVBQWUsWUFBYSxRQUFPLGFBQWEsQ0FBQztBQUNuRSxNQUFNLGFBQWEsT0FBTztBQUUxQixXQUFTLDJCQUEyQixhQUFZO0FBQzlDLFVBQU0sS0FBSyxTQUFTLGVBQWUsd0JBQXdCO0FBQzNELFFBQUksQ0FBQyxHQUFJO0FBQ1QsbUJBQWUsZUFBZSxDQUFDLEdBQUcsTUFBTSxFQUFFLEtBQUssQ0FBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksY0FBYyxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQ3JHLFFBQUksT0FBTztBQUNYLFlBQVE7QUFDUixZQUFRO0FBQ1IsWUFBUTtBQUNSLFFBQUksQ0FBQyxZQUFZLFFBQVE7QUFDdkIsY0FBUTtBQUFBLElBQ1YsT0FBTztBQUNMLGNBQVE7QUFDUixrQkFBWSxRQUFRLFFBQU07QUFDeEIsY0FBTSxRQUFRLFdBQVcsR0FBRyxTQUFTLEdBQUcsR0FBRztBQUMzQyxjQUFNLE9BQU8sR0FBRyxPQUFPLGVBQWUsV0FBVyxHQUFHLElBQUksSUFBSTtBQUM1RCxnQkFBUSxtTUFDSixRQUFRLE9BQ1IsMENBQTJDLFdBQVcsR0FBRyxHQUFHLElBQUk7QUFBQSxNQUV0RSxDQUFDO0FBQ0QsY0FBUTtBQUFBLElBQ1Y7QUFDQSxZQUFRO0FBQ1IsT0FBRyxZQUFZO0FBQUEsRUFDakI7QUFFQSxTQUFPLGtCQUFrQixpQkFBZ0I7QUFDdkMsUUFBSSxhQUFhLFFBQVM7QUFDMUIsVUFBTSxNQUFN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QUU7QUFBQSxNQUM5QztBQUNBO0FBQUEsSUFDRjtBQUNBLFVBQU0sOEJBQThCO0FBQUEsRUFDdEM7QUFFQSxTQUFPLGVBQWUsZUFBZSxLQUFLLEtBQUk7QUFDNUMsVUFBTSxZQUFZLElBQUksUUFBUSxJQUFJLEtBQUssSUFBSSxRQUFRLGFBQWE7QUFDaEUsUUFBSSxDQUFDLFVBQVc7QUFDaEIsVUFBTSxPQUFPLFVBQVUsY0FBYyxXQUFXLEVBQUU7QUFDbEQsVUFBTSxTQUFTLFVBQVUsY0FBYyxhQUFhLEVBQUUsU0FBUztBQUMvRCxVQUFNLGNBQWMsVUFBVSxjQUFjLGVBQWU7QUFDM0QsVUFBTSxxQkFBcUIsY0FBZSxZQUFZLFNBQVMsT0FBUTtBQUV2RSxVQUFNLFVBQVUsVUFBVSxjQUFjLFdBQVc7QUFDbkQsUUFBSSxXQUFXLFdBQVcsUUFBUSxTQUFTLElBQUksUUFBUSxPQUFPLEVBQUUsSUFBSTtBQUNwRSxRQUFJLFlBQVksU0FBUyxTQUFTLEdBQUc7QUFDbkMsWUFBTSw2SEFBNkg7QUFDbkk7QUFBQSxJQUNGO0FBRUEsVUFBTSxrQkFBa0IsVUFBVSxjQUFjLG9CQUFvQjtBQUNwRSxVQUFNLHlCQUF5QixrQkFBbUIsZ0JBQWdCLFNBQVMsT0FBUTtBQU1uRixRQUFJLDJCQUEyQjtBQUMvQixRQUFJLHdCQUF3QjtBQUMxQixZQUFNLGdCQUFnQixjQUFjLENBQUMsR0FBRyxLQUFLLE9BQUssRUFBRSxTQUFTLHNCQUFzQjtBQUNuRixpQ0FBMkIsZUFBZ0IsYUFBYSxTQUFTLE9BQVE7QUFBQSxJQUMzRTtBQUNBLFFBQUksV0FBVztBQUFNLFFBQUksY0FBYztBQUN2QyxRQUFJO0FBQ0YsWUFBTSxLQUFLLFdBQVcsT0FBTyxFQUFFLElBQUksR0FBRyxFQUFFLElBQUksRUFBQyxNQUFNLFFBQVEsb0JBQW9CLFVBQVUsWUFBWSxNQUFNLHdCQUFnRCwwQkFBb0QsWUFBWSxZQUFZLEtBQUssWUFBWSxTQUFTLFVBQVUsV0FBVyxnQkFBZ0IsRUFBQyxHQUFHLEVBQUMsT0FBTyxLQUFJLENBQUM7QUFFdlQsVUFBSSxRQUFRLFlBQVksS0FBSztBQUMzQiwyQkFBbUIsWUFBWTtBQUMvQixtQ0FBMkIsMEJBQTBCO0FBQ3JELHFDQUE2Qiw0QkFBNEI7QUFBQSxNQUMzRDtBQUNBLFVBQUksY0FBYztBQUVsQixpQkFBVyxNQUFNO0FBQ2YsWUFBSTtBQUFFLHlCQUFlO0FBQUEsUUFBRyxTQUFRLEdBQUc7QUFBRSxrQkFBUSxNQUFNLHVCQUF1QixDQUFDO0FBQUEsUUFBRztBQUFBLE1BQ2hGLEdBQUcsR0FBRztBQUFBLElBQ1IsU0FBUSxHQUFHO0FBQ1QsY0FBUSxNQUFNLGdCQUFnQixDQUFDO0FBQy9CLFlBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQzVDLFVBQUksV0FBVztBQUFPLFVBQUksY0FBYztBQUFBLElBQzFDO0FBQUEsRUFDRjsiLAogICJuYW1lcyI6IFsidmVuZG9yc1BhcmFJbnRlcm5vIl0KfQo=
