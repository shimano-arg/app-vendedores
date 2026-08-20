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
      await fbDb.collection("allowed_emails").doc(docId).set(
        {
          email,
          note: note.trim(),
          addedBy: currentUser.email || "",
          addedByUid: currentUser.uid,
          addedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      showSyncTag("Email autorizado: " + email);
      try {
        openAdminPanel();
      } catch (_e) {
      }
    } catch (e) {
      console.error("addAllowedEmail", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.removeAllowedEmail = async function(docId) {
    if (userRole !== "admin") return;
    if (!confirm(
      "Quitar la autorizacion de este email? Si el usuario ya tiene rol asignado en el panel, va a seguir entrando (la regla pre-aprobada por rol tambien aplica)."
    ))
      return;
    try {
      await fbDb.collection("allowed_emails").doc(docId).delete();
      showSyncTag("Autorizacion quitada");
      try {
        openAdminPanel();
      } catch (_e) {
      }
    } catch (e) {
      console.error("removeAllowedEmail", e);
      alert("Error: " + (e.message || e));
    }
  };
  function renderGeminiConfigSection(_data) {
    const el = document.getElementById("gemini-config-section");
    if (!el) return;
    const cliInstructions = '<div style="text-align:center;margin-bottom:10px"><div style="font-size:12px;font-weight:800;color:#5b21b6">Gemini API Key (OCR de tickets)</div><div style="font-size:10px;color:#64748b;margin-top:2px">v551 SECURITY: la key vive en Secret Manager. Se administra por CLI, no por este panel.</div></div><div style="font-family:Consolas,monospace;font-size:10px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:10px;color:#5b21b6;line-height:1.5"># Ver estado del secret<br>firebase functions:secrets:access GEMINI_API_KEY<br><br># Rotar key<br>firebase functions:secrets:set GEMINI_API_KEY<br>firebase deploy --only functions:geminiOcrProxy</div>';
    el.innerHTML = cliInstructions;
  }
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
    if (hasKey)
      html += '<button class="app-btn-pill app-btn-red" onclick="deleteGmapsApiKey()">Borrar</button>';
    html += "</div>";
    el.innerHTML = html;
  }
  window.saveGmapsApiKey = async function() {
    if (userRole !== "admin") return;
    const raw = prompt(
      "Pega aca la API key de Google Maps (formato AIzaSy...).\n\nIMPORTANTE: en Google Cloud Console restringi la key por HTTP referrer a https://shimano-arg.github.io/* para que nadie te la robe.",
      ""
    );
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
      await fbDb.collection("app_config").doc("google_maps").set(
        {
          apiKey: key,
          updatedBy: currentUser.email || "",
          updatedByUid: currentUser.uid,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      gmapsApiKeyCache = key;
      showSyncTag("Google Maps API key guardada");
      try {
        openAdminPanel();
      } catch (_e) {
      }
    } catch (e) {
      console.error("saveGmapsApiKey", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.deleteGmapsApiKey = async function() {
    if (userRole !== "admin") return;
    if (!confirm(
      "Borrar la API key de Google Maps? El geocoding vuelve a OSM (peor cobertura en AR rural)."
    ))
      return;
    try {
      await fbDb.collection("app_config").doc("google_maps").delete();
      gmapsApiKeyCache = null;
      showSyncTag("Google Maps API key borrada");
      try {
        openAdminPanel();
      } catch (_e) {
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
    if (!confirm(
      "Asignar a " + approverLabel + " como aprobador de los " + vendedores.length + " vendedores?\n\nVa a sobrescribir cualquier aprobador previo asignado a cada vendedor."
    ))
      return;
    let okCount = 0, _errCount = 0;
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
      _errCount = vendedores.length;
      alert("Error: " + (e.message || e));
    }
    if (okCount) {
      showSyncTag(okCount + " vendedor(es) asignado(s) a " + approverLabel);
      try {
        openAdminPanel();
      } catch (_e) {
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
      const _internoOpts = '<option value="">- Sin pareja -</option>' + internos.map(
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
          return usersCache.filter(
            (u) => u.role === "vendedor" && u.internalPartnerUid === internoUid
          );
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
          if (d.displayName)
            cardsHtml += '<div class="uc-name">' + escapeHtml(d.displayName) + "</div>";
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
      if (thead)
        thead.innerHTML = "<th>Email</th><th>Nombre</th><th>Rol</th><th>Vendedor</th><th>Pareja interno</th><th>WhatsApp</th><th>Resp. rendiciones</th><th>Pass</th><th>2FA</th><th></th>";
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
    } catch (_e) {
    }
    if (!confirm(
      'Eliminar acceso de este usuario?\n\nPierde acceso de inmediato. Si vuelve a entrar con Google va a quedar como "sin rol asignado" hasta que vos lo habilites de nuevo.\n\nSu cuenta Google sigue existiendo, no se borra.'
    ))
      return;
    try {
      const snap = await fbDb.collection("roles").doc(uid).get();
      const data = snap.exists ? snap.data() : {};
      logOp("eliminar_usuario", "user", data.email || uid, {
        uid,
        previousRole: data.role,
        previousVendor: data.vendor
      });
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
      if (box)
        box.innerHTML = '<div style="font-size:11px;color:#991b1b;padding:14px">No se pudo cargar la librer\xEDa QR. Usa el secret manual para configurar.</div>';
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
      alert(
        "C\xF3digo incorrecto. Asegurate de que el secret se carg\xF3 bien en Google Authenticator y reintent\xE1."
      );
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
      } catch (_e) {
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
      } catch (_e) {
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
        alert(
          "OK - le envie un mail de reseteo a " + email + ". Decile que revise inbox y spam. El link expira en 1 hora."
        );
        try {
          await fbDb.collection("roles").doc(uid).update({
            passwordChangedBy: currentUser.email || "",
            passwordChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
            passwordResetMethod: "firebase_email"
          });
        } catch (_e) {
        }
      } catch (e) {
        console.error("sendPasswordResetEmail", e);
        alert("Error enviando el mail: " + (e.message || e));
      }
      return;
    }
    if (choice.trim() === "2") {
      const newPwd = prompt(
        "Nueva password-gate para " + email + ":\n\n(Solo afecta la segunda capa de la app, NO el login con email)",
        ""
      );
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
    const whatsapp = waInput ? (waInput.value || "").replace(/\D/g, "") : "";
    if (whatsapp && whatsapp.length < 8) {
      alert(
        "El numero de WhatsApp es muy corto. Tiene que ser el numero completo con codigo de pais (ej. 5491126762031 para Argentina)."
      );
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
      await fbDb.collection("roles").doc(uid).set(
        {
          role,
          vendor,
          internalPartnerUid,
          whatsapp: whatsapp || null,
          rendicionesApproverUid,
          rendicionesApproverEmail,
          assignedBy: currentUser.uid,
          assignedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGVsaW1pbmFkbyBlbCBLTk9XTiBCVUcgZGVsIGdlbWluaUFwaUtleUNhY2hlXHJcbi8vIGNyb3NzLW1vZHVsZS4gTGEga2V5IHlhIG5vIHZpdmUgZW4gRmlyZXN0b3JlIG5pIGNhY2hlYSBuYWRhIGZyb250ZW5kIFx1MjAxNFxyXG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXHJcbi8vIGxlZSB1c2Vyc0NhY2hlIGNvbW8gaWRlbnRpZmllciBsaWJyZS4gRW4gYnVuZGxlIFwidXNlIHN0cmljdFwiIHVuIHJlYWQgYVxyXG4vLyBpZGVudGlmaWVyIG5vLWRlY2xhcmFkbyBuaSBlbiB3aW5kb3cgdGlyYSBSZWZlcmVuY2VFcnJvci4gUHJvbW9jaW9uYXIgYVxyXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcclxuLy8geSBidW5kbGUgbm90aWZpY2FjaW9uZXMgKHNoZWxsKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cudXNlcnNDYWNoZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51c2Vyc0NhY2hlID0gW107XHJcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSlcclxuICAgIC5zbGljZSgpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuZW1haWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5lbWFpbCB8fCAnJykpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPlNpIHVuIHZlbmRlZG9yIHVzYSBHbWFpbCBwZXJzb25hbCAobm8gQHNoaW1hbm8uY29tLmFyKSwgYWdyZWdhbG8gYWNhIGFudGVzIHF1ZSBpbnRlbnRlIGxvZ3VlYXIuIExvcyBlbWFpbHMgQHNoaW1hbm8uY29tLmFyIHkgbG9zIGFkbWlucyBoYXJkY29kZWQgeWEgZXN0YW4gYXV0b3JpemFkb3MgYXV0b21hdGljYW1lbnRlLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoIWFsbG93ZWRMaXN0Lmxlbmd0aCkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMCAxMHB4XCI+Tm8gaGF5IGVtYWlscyBwcmUtYXV0b3JpemFkb3MgdG9kYXZpYS48L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gICAgYWxsb3dlZExpc3QuZm9yRWFjaCgoYWUpID0+IHtcclxuICAgICAgY29uc3QgbGFiZWwgPSBlc2NhcGVIdG1sKGFlLmVtYWlsIHx8IGFlLl9pZCk7XHJcbiAgICAgIGNvbnN0IG5vdGUgPSBhZS5ub3RlID8gJyAmbWlkZG90OyAnICsgZXNjYXBlSHRtbChhZS5ub3RlKSA6ICcnO1xyXG4gICAgICBodG1sICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIGxhYmVsICtcclxuICAgICAgICBub3RlICtcclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVtb3ZlQWxsb3dlZEVtYWlsKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIoYWUuX2lkKSArXHJcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIlF1aXRhciBhdXRvcml6YWNpb25cIiBzdHlsZT1cImJhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NTAlO3dpZHRoOjE4cHg7aGVpZ2h0OjE4cHg7Zm9udC1zaXplOjExcHg7Y3Vyc29yOnBvaW50ZXI7bGluZS1oZWlnaHQ6MVwiPiZ0aW1lczs8L2J1dHRvbj4nICtcclxuICAgICAgICAnPC9kaXY+JztcclxuICAgIH0pO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1ibHVlXCIgb25jbGljaz1cImFkZEFsbG93ZWRFbWFpbCgpXCI+JiM0MzsgQWdyZWdhciBlbWFpbDwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG5cclxud2luZG93LmFkZEFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoJ0VtYWlsIGEgYXV0b3JpemFyIChlai4gYXV0b21hdHJpeC5vZmljaWFsQGdtYWlsLmNvbSk6Jyk7XHJcbiAgaWYgKCFyYXcpIHJldHVybjtcclxuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBpZiAoIS9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvLnRlc3QoZW1haWwpKSB7XHJcbiAgICBhbGVydCgnRWwgZW1haWwgbm8gcGFyZWNlIHZhbGlkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgbm90ZSA9XHJcbiAgICBwcm9tcHQoJ05vdGEgY29ydGEgb3BjaW9uYWwgKGVqLiBcIlZlbmRlZG9yIFoxIEdvbnphbG9cIiBvIFwiUmVlbXBsYXpvIGRlIE1hdXJpY2lvXCIpOicsICcnKSB8fCAnJztcclxuICBjb25zdCBkb2NJZCA9IGVtYWlsVG9Eb2NJZChlbWFpbCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJylcclxuICAgICAgLmRvYyhkb2NJZClcclxuICAgICAgLnNldChcclxuICAgICAgICB7XHJcbiAgICAgICAgICBlbWFpbCxcclxuICAgICAgICAgIG5vdGU6IG5vdGUudHJpbSgpLFxyXG4gICAgICAgICAgYWRkZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICBhZGRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxyXG4gICAgICApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0VtYWlsIGF1dG9yaXphZG86ICcgKyBlbWFpbCk7XHJcbiAgICAvLyBSZWNhcmdhciBwYW5lbFxyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2FkZEFsbG93ZWRFbWFpbCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LnJlbW92ZUFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uIChkb2NJZCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnUXVpdGFyIGxhIGF1dG9yaXphY2lvbiBkZSBlc3RlIGVtYWlsPyBTaSBlbCB1c3VhcmlvIHlhIHRpZW5lIHJvbCBhc2lnbmFkbyBlbiBlbCBwYW5lbCwgdmEgYSBzZWd1aXIgZW50cmFuZG8gKGxhIHJlZ2xhIHByZS1hcHJvYmFkYSBwb3Igcm9sIHRhbWJpZW4gYXBsaWNhKS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5kZWxldGUoKTtcclxuICAgIHNob3dTeW5jVGFnKCdBdXRvcml6YWNpb24gcXVpdGFkYScpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3JlbW92ZUFsbG93ZWRFbWFpbCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09IFNlY2Npb24gR2VtaW5pIEFQSSBLZXkgKGFkbWluKSA9PT1cclxuZnVuY3Rpb24gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihfZGF0YSkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dlbWluaS1jb25maWctc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICAvLyB2NTUxICgyMDI2LTA4LTE5KSBTRUNVUklUWTogbGEga2V5IHZpdmUgZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuXHJcbiAgLy8gRmlyZXN0b3JlLiBMYSBVSSBkZSBhZG1pbiB5YSBubyBwZXJtaXRlIGNhcmdhci9ib3JyYXIgZGVzZGUgZWxcclxuICAvLyBuYXZlZ2Fkb3IgcG9ycXVlIGVzbyB2b2x2ZXJpYSBhIGV4cG9uZXIgbGEga2V5IGEgY3VhbHF1aWVyIHJlYWRlci5cclxuICAvLyBSZWVtcGxhemFkbyBlbCBwYW5lbCB2aWVqbyBwb3IgaW5zdHJ1Y2Npb25lcyBkZSBDTEkuIFNpbiBpbnB1dHMgZGVcclxuICAvLyB1c3VhcmlvIGVuIGVsIEhUTUwsIHNvbG8gdGV4dG8gZmlqby5cclxuICBjb25zdCBjbGlJbnN0cnVjdGlvbnMgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM1YjIxYjZcIj5HZW1pbmkgQVBJIEtleSAoT0NSIGRlIHRpY2tldHMpPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj52NTUxIFNFQ1VSSVRZOiBsYSBrZXkgdml2ZSBlbiBTZWNyZXQgTWFuYWdlci4gU2UgYWRtaW5pc3RyYSBwb3IgQ0xJLCBubyBwb3IgZXN0ZSBwYW5lbC48L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMHB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzoxMHB4O2NvbG9yOiM1YjIxYjY7bGluZS1oZWlnaHQ6MS41XCI+JyArXHJcbiAgICAnIyBWZXIgZXN0YWRvIGRlbCBzZWNyZXQ8YnI+JyArXHJcbiAgICAnZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6YWNjZXNzIEdFTUlOSV9BUElfS0VZPGJyPjxicj4nICtcclxuICAgICcjIFJvdGFyIGtleTxicj4nICtcclxuICAgICdmaXJlYmFzZSBmdW5jdGlvbnM6c2VjcmV0czpzZXQgR0VNSU5JX0FQSV9LRVk8YnI+JyArXHJcbiAgICAnZmlyZWJhc2UgZGVwbG95IC0tb25seSBmdW5jdGlvbnM6Z2VtaW5pT2NyUHJveHknICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnNhbml0aXplZC9wcm9wZXJ0eVxyXG4gIGVsLmlubmVySFRNTCA9IGNsaUluc3RydWN0aW9ucztcclxufVxyXG5cclxuLy8gdjU1MTogc2F2ZUdlbWluaUFwaUtleSArIGRlbGV0ZUdlbWluaUFwaUtleSBlbGltaW5hZG9zLiBMYSBrZXkgdml2ZVxyXG4vLyBlbiBTZWNyZXQgTWFuYWdlciwgbm8gZW4gRmlyZXN0b3JlLiBTZSBhZG1pbmlzdHJhIHBvciBDTEkuIFZlclxyXG4vLyByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uIHBhcmEgbGFzIGluc3RydWNjaW9uZXMuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR09PR0xFIE1BUFMgR2VvY29kaW5nIEFQSSAtIG1lam9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCBxdWUgT1NNXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBMYSBrZXkgc2UgZ3VhcmRhIGVuIGFwcF9jb25maWcvZ29vZ2xlX21hcHMuIFNpIGVzdGEgc2V0ZWFkYSwgbGEgdXNhbW9zXHJcbi8vIGNvbW8gZ2VvY29kZXIgUFJJTUFSSU8gZW4gZ2VvY29kZUNsaWVudEFkZHJlc3M7IHNpIGZhbGxhIG8gbm8gZXN0YVxyXG4vLyBzZXRlYWRhLCBjYWVtb3MgYSBsYSBjYXNjYWRhIE9TTSBOb21pbmF0aW0gY29tbyBmYWxsYmFjay5cclxubGV0IGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xyXG5hc3luYyBmdW5jdGlvbiBnZXRHbWFwc0FwaUtleSgpIHtcclxuICBpZiAoZ21hcHNBcGlLZXlDYWNoZSkgcmV0dXJuIGdtYXBzQXBpS2V5Q2FjaGU7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XHJcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAoZC5hcGlLZXkpIHtcclxuICAgICAgICBnbWFwc0FwaUtleUNhY2hlID0gZC5hcGlLZXk7XHJcbiAgICAgICAgcmV0dXJuIGQuYXBpS2V5O1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIG5vIHNlIHB1ZG8gbGVlciBhcGkga2V5JywgZSk7XHJcbiAgfVxyXG4gIHJldHVybiBudWxsO1xyXG59XHJcbmZ1bmN0aW9uIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihkYXRhKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ21hcHMtY29uZmlnLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgY29uc3QgaGFzS2V5ID0gZGF0YSAmJiBkYXRhLmFwaUtleTtcclxuICBjb25zdCBtYXNrZWQgPSBoYXNLZXkgPyBkYXRhLmFwaUtleS5zbGljZSgwLCA0KSArICdcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjInICsgZGF0YS5hcGlLZXkuc2xpY2UoLTQpIDogJyc7XHJcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9XHJcbiAgICBkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZVxyXG4gICAgICA/IGRhdGEudXBkYXRlZEF0LnRvRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXHJcbiAgICAgIDogJyc7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzA2NWY0NlwiPkdvb2dsZSBNYXBzIEFQSSBLZXkgKGdlb2NvZGluZyk8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkNvbnZpZXJ0ZSBkaXJlY2Npb25lcyBhIGNvb3JkZW5hZGFzIGNvbiBtdWNoYSBtZWpvciBwcmVjaXNpXHUwMEYzbiBxdWUgT1NNIChzb2JyZSB0b2RvIGVuIGxvY2FsaWRhZGVzIGNoaWNhcykuIENvc3RvIGdyYXRpcyBoYXN0YSA0MC4wMDAgcmVxdWVzdHMvbWVzLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoaGFzS2V5KSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICM2ZWU3Yjc7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzo0cHggOHB4O2NvbG9yOiMwNjVmNDZcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChtYXNrZWQpICtcclxuICAgICAgJzwvc3Bhbj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiXCI+Q2FyZ2FkYSBwb3IgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwodXBkYXRlZEJ5IHx8ICdhZG1pbicpICtcclxuICAgICAgKHVwZGF0ZWRBdCA/ICcgKCcgKyBlc2NhcGVIdG1sKHVwZGF0ZWRBdCkgKyAnKScgOiAnJykgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk0YTNiODttYXJnaW4tYm90dG9tOjEwcHg7dGV4dC1hbGlnbjpjZW50ZXJcIj5TaW4gQVBJIGtleS4gR2VvY29kaW5nIHVzYSBPcGVuU3RyZWV0TWFwIChncmF0aXMgcGVybyBwZW9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCkuPC9kaXY+JztcclxuICB9XHJcbiAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXHJcbiAgICAoaGFzS2V5ID8gJ0NhbWJpYXIga2V5JyA6ICdDYXJnYXIga2V5JykgK1xyXG4gICAgJzwvYnV0dG9uPic7XHJcbiAgaWYgKGhhc0tleSlcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiZGVsZXRlR21hcHNBcGlLZXkoKVwiPkJvcnJhcjwvYnV0dG9uPic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG59XHJcbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgY29uc3QgcmF3ID0gcHJvbXB0KFxyXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXHJcbiAgICAnJ1xyXG4gICk7XHJcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGtleSA9IHJhdy50cmltKCk7XHJcbiAgaWYgKCFrZXkpIHtcclxuICAgIGFsZXJ0KCdWYWNpYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xyXG4gICAgYWxlcnQoJ0xhIGtleSBwYXJlY2UgbXV5IGNvcnRhLiBSZXZpc2EgcXVlIGxhIHBlZ2FzdGUgY29tcGxldGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcclxuICAgICAgLmRvYygnZ29vZ2xlX21hcHMnKVxyXG4gICAgICAuc2V0KFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGFwaUtleToga2V5LFxyXG4gICAgICAgICAgdXBkYXRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxyXG4gICAgICApO1xyXG4gICAgZ21hcHNBcGlLZXlDYWNoZSA9IGtleTtcclxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc2F2ZUdtYXBzQXBpS2V5JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ0JvcnJhciBsYSBBUEkga2V5IGRlIEdvb2dsZSBNYXBzPyBFbCBnZW9jb2RpbmcgdnVlbHZlIGEgT1NNIChwZW9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCkuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xyXG4gICAgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbiAgICBzaG93U3luY1RhZygnR29vZ2xlIE1hcHMgQVBJIGtleSBib3JyYWRhJyk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlR21hcHNBcGlLZXknLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBCVUxLIEFQUFJPVkVSIC0gYXNpZ25hciBlbCBtaXNtbyBcIlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzXCJcclxuLy8gYSB0b2RvcyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVXRpbCBjdWFuZG8gdW4gc29sbyBhcHJvYmFkb3IgKGVqLiBQYWJsbyBnZXJlbnRlKSByZXZpc2EgbGFzXHJcbi8vIHJlbmRpY2lvbmVzIGRlIFRPRE9TIGxvcyB2ZW5kZWRvcmVzLiBTaW4gZXN0byBlbCBhZG1pbiB0aWVuZSBxdWVcclxuLy8gYWJyaXIgY2FkYSBmaWxhIGRlbCBwYW5lbCBVc3VhcmlvcyB5IHNldGVhciBlbCBkcm9wZG93biB1bmEgYSB1bmEuXHJcbmZ1bmN0aW9uIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWN0aW9uJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKFxyXG4gICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xyXG4gICk7XHJcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6I2EyMWNhZlwiPkFwcm9iYWRvciBkZSBSZW5kaWNpb25lcyAtIGFzaWduYWNpb24gbWFzaXZhPC9kaXY+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj5BcGxpY2EgZWwgbWlzbW8gcmVzcG9uc2FibGUgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLiBVdGlsIGN1YW5kbyB1biBnZXJlbnRlIGNvbWVyY2lhbCBjZW50cmFsaXphIGxhIGFwcm9iYWNpb24uPC9kaXY+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGlmICghY2FuZGlkYXRlcy5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCBhZG1pbiAvIGdlcmVudGUgLyBpbnRlcm5vLiBQcmltZXJvIGFzaWduYSB1biByb2wgYSBhbGd1aWVuLjwvZGl2Pic7XHJcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXZlbmRlZG9yZXMubGVuZ3RoKSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgdmVuZGVkb3IgdG9kYXZpYS48L2Rpdj4nO1xyXG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxzZWxlY3QgaWQ9XCJidWxrLWFwcHJvdmVyLXNlbGVjdFwiIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtib3JkZXI6MS41cHggc29saWQgI2YwYWJmYztib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOiNmZmY7Zm9udC1mYW1pbHk6aW5oZXJpdDtmbGV4OjE7bWF4LXdpZHRoOjM0MHB4XCI+JztcclxuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xyXG4gIGNhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xyXG4gICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArIHUucm9sZSArICcpJztcclxuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcclxuICB9KTtcclxuICBodG1sICs9ICc8L3NlbGVjdD4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImJ1bGtBc3NpZ25BcHByb3ZlcigpXCI+QXNpZ25hciBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzICgnICtcclxuICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcclxuICAgICcpPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxud2luZG93LmJ1bGtBc3NpZ25BcHByb3ZlciA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcclxuICBjb25zdCB1aWQgPSBzZWwgJiYgc2VsLnZhbHVlO1xyXG4gIGlmICghdWlkKSB7XHJcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcclxuICBpZiAoIWFwcHJvdmVyKSB7XHJcbiAgICBhbGVydCgnQXByb2JhZG9yIG5vIGVuY29udHJhZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xyXG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmVuZGVkb3JlcyBwYXJhIGFzaWduYXIuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGFwcHJvdmVyTGFiZWwgPSBhcHByb3Zlci5kaXNwbGF5TmFtZSB8fCBhcHByb3Zlci5lbWFpbCB8fCBhcHByb3Zlci5fdWlkO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnQXNpZ25hciBhICcgK1xyXG4gICAgICAgIGFwcHJvdmVyTGFiZWwgK1xyXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xyXG4gICAgICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcclxuICAgICAgICAnIHZlbmRlZG9yZXM/XFxuXFxuVmEgYSBzb2JyZXNjcmliaXIgY3VhbHF1aWVyIGFwcm9iYWRvciBwcmV2aW8gYXNpZ25hZG8gYSBjYWRhIHZlbmRlZG9yLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgbGV0IG9rQ291bnQgPSAwLFxyXG4gICAgX2VyckNvdW50ID0gMDtcclxuICAvLyBVcGRhdGUgZW4gbG90ZS4gVXNhbW9zIHVuIGJhdGNoIGRlIEZpcmVzdG9yZS5cclxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcclxuICB2ZW5kZWRvcmVzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHJlZiA9IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2Modi5fdWlkKTtcclxuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgYmF0Y2guY29tbWl0KCk7XHJcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XHJcbiAgICBpZiAodHlwZW9mIGxvZ09wID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGxvZ09wKCdidWxrX2Fzc2lnbl9hcHByb3ZlcicsICdyb2xlcycsIGFwcHJvdmVyTGFiZWwsIHtcclxuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICAgIGFwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHZlbmRlZG9yQ291bnQ6IHZlbmRlZG9yZXMubGVuZ3RoLFxyXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2J1bGtBc3NpZ25BcHByb3ZlcicsIGUpO1xyXG4gICAgX2VyckNvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbiAgaWYgKG9rQ291bnQpIHtcclxuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXHJcbiAgfVxyXG59O1xyXG5cclxuLy8gR2VvY29kaW5nIGNvbiBHb29nbGUgTWFwcyBBUEkuIERldnVlbHZlIHtsYXQsIGxuZywgZGlzcGxheSwgcHJlY2lzaW9ufVxyXG4vLyBvIG51bGwgc2kgbm8gZW5jb250cm8gLyBzaW4ga2V5LlxyXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcclxuICBjb25zdCBrZXkgPSBhd2FpdCBnZXRHbWFwc0FwaUtleSgpO1xyXG4gIGlmICgha2V5KSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xyXG4gIGNvbnN0IGZ1bGxBZGRyID0gW2FkZHJlc3MsIGxvY2FsaXR5LCBwcm92LCAnQXJnZW50aW5hJ10uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJywgJyk7XHJcbiAgLy8gcmVnaW9uPWFyICsgY29tcG9uZW50cz1jb3VudHJ5OkFSIHNlc2dhIGxvcyByZXN1bHRhZG9zIGEgQVIuXHJcbiAgY29uc3QgdXJsID1cclxuICAgICdodHRwczovL21hcHMuZ29vZ2xlYXBpcy5jb20vbWFwcy9hcGkvZ2VvY29kZS9qc29uJyArXHJcbiAgICAnP2FkZHJlc3M9JyArXHJcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcclxuICAgICcmcmVnaW9uPWFyJyArXHJcbiAgICAnJmNvbXBvbmVudHM9Y291bnRyeTpBUicgK1xyXG4gICAgJyZsYW5ndWFnZT1lcycgK1xyXG4gICAgJyZrZXk9JyArXHJcbiAgICBlbmNvZGVVUklDb21wb25lbnQoa2V5KTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHVybCk7XHJcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xyXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT0snICYmIGRhdGEucmVzdWx0cyAmJiBkYXRhLnJlc3VsdHMubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnN0IHJlcyA9IGRhdGEucmVzdWx0c1swXTtcclxuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcclxuICAgICAgaWYgKCFsb2MpIHJldHVybiBudWxsO1xyXG4gICAgICAvLyBsb2NhdGlvbl90eXBlIGluZGljYSBwcmVjaXNpb246IFJPT0ZUT1AgPiBSQU5HRV9JTlRFUlBPTEFURUQgPiBHRU9NRVRSSUNfQ0VOVEVSID4gQVBQUk9YSU1BVEUuXHJcbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XHJcbiAgICAgIGxldCBwcmVjaXNpb24gPSAnYWRkcmVzcyc7XHJcbiAgICAgIGlmIChsdCA9PT0gJ0FQUFJPWElNQVRFJykgcHJlY2lzaW9uID0gJ2xvY2FsaXR5JztcclxuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XHJcbiAgICAgIC8vIEV4dHJhZXIgbG9jYWxpdHkgKyBhZG1pbl9hcmVhIGRlbCByZXNwb25zZSBwYXJhIGF1dG9jb21wbGV0YXIgY2FtcG9zXHJcbiAgICAgIC8vIHF1ZSBTQVAgbm8gZXhwb3J0byAoU2hpcC10byBDaXR5IHZhY2lvIGVzIG11eSBjb211biBlbiBCUHMgdmllam9zKS5cclxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XHJcbiAgICAgIGNvbnN0IGJ5VHlwZSA9ICh0KSA9PiB7XHJcbiAgICAgICAgY29uc3QgYyA9IGNvbXBvbmVudHMuZmluZCgoY2MpID0+IEFycmF5LmlzQXJyYXkoY2MudHlwZXMpICYmIGNjLnR5cGVzLmluY2x1ZGVzKHQpKTtcclxuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XHJcbiAgICAgIH07XHJcbiAgICAgIC8vIFByaW9yaWRhZCBwYXJhIGxvY2FsaWRhZDogbG9jYWxpdHkgPiBzdWJsb2NhbGl0eSA+IGFkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMi5cclxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XHJcbiAgICAgICAgYnlUeXBlKCdsb2NhbGl0eScpIHx8IGJ5VHlwZSgnc3VibG9jYWxpdHknKSB8fCBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMicpIHx8ICcnO1xyXG4gICAgICBjb25zdCBkZXRlY3RlZFByb3ZpbmNlID0gYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzEnKSB8fCAnJztcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBsYXQ6IHBhcnNlRmxvYXQobG9jLmxhdCksXHJcbiAgICAgICAgbG5nOiBwYXJzZUZsb2F0KGxvYy5sbmcpLFxyXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcclxuICAgICAgICBwcmVjaXNpb246IHByZWNpc2lvbixcclxuICAgICAgICBwcm92aWRlcjogJ2dvb2dsZScsXHJcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcclxuICAgICAgICBsb2NhbGl0eTogZGV0ZWN0ZWRMb2NhbGl0eSxcclxuICAgICAgICBwcm92aW5jZTogZGV0ZWN0ZWRQcm92aW5jZSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ1pFUk9fUkVTVUxUUycpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXHJcbiAgICAgICAgJ1tnbWFwc10gUkVRVUVTVF9ERU5JRUQ6JyxcclxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcclxuICAgICAgICAgICcoc2luIGRldGFsbGUpLiBSZXZpc2FyIHF1ZSBsYSBBUEkga2V5IHRlbmdhIGhhYmlsaXRhZGEgR2VvY29kaW5nIEFQSSB5IGVsIHJlZmVycmVyIHBlcm1pdGEgZXN0ZSBkb21pbmlvLidcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdPVkVSX1FVRVJZX0xJTUlUJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcblxyXG53aW5kb3cub3BlbkFkbWluUGFuZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIC8vIENhcmdhciBhbGxvd2VkX2VtYWlscyBwYXJhIG1vc3RyYXIgYXJyaWJhIGxhIHNlY2Npb24gZGUgcHJlLWF1dG9yaXphY2lvbmVzXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGFlUXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZ2V0KCk7XHJcbiAgICBjb25zdCBhbGxvd2VkTGlzdCA9IFtdO1xyXG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKSk7XHJcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdsb2FkIGFsbG93ZWRfZW1haWxzJywgZSk7XHJcbiAgfVxyXG4gIC8vIENhcmdhciBjb25maWcgR2VtaW5pIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXlcclxuICB0cnkge1xyXG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xyXG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihnU25hcC5leGlzdHMgPyBnU25hcC5kYXRhKCkgOiBudWxsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xyXG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihudWxsKTtcclxuICB9XHJcbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBnbVNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XHJcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ21hcHMgY29uZmlnJywgZSk7XHJcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xyXG4gICAgLy8gRTYgZml4IEMxOiB2YWNpYXIgZWwgQXJyYXkgaW4tcGxhY2UgKHByZXNlcnZhIHdpbmRvdy51c2Vyc0NhY2hlIHJlZikuXHJcbiAgICB1c2Vyc0NhY2hlLmxlbmd0aCA9IDA7XHJcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcclxuICAgICAgdXNlcnNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBfdWlkOiBkb2MuaWQgfSwgZG9jLmRhdGEoKSkpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXHJcbiAgICB0cnkge1xyXG4gICAgICByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignYnVsayBhcHByb3ZlciBzZWN0aW9uJywgZSk7XHJcbiAgICB9XHJcbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcclxuICAgIC8vIHB1ZWRhbiB2ZXIgZGVzdGluYXRhcmlvcyBhbCBjcmVhciB0YXJlYXMgZW4gTm90aWZpY2FjaW9uZXMuIFNpbiBlc3RvXHJcbiAgICAvLyBsb3MgdmVuZGVkb3JlcyB2ZW4gZWwgZHJvcGRvd24gdmFjaW8gKHNlY3VyaXR5IHJ1bGVzIGJsb3F1ZWFuIC9yb2xlcykuXHJcbiAgICB0cnkge1xyXG4gICAgICBzeW5jVXNlcnNEaXJlY3RvcnkoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcclxuICAgIH1cclxuICAgIC8vIExpc3RhIGRlIGludGVybm9zIGRpc3BvbmlibGVzIChwYXJhIGFzaWduYXIgcGFyZWphIGEgbG9zIHZlbmRlZG9yZXMpXHJcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XHJcbiAgICBjb25zdCBfaW50ZXJub09wdHMgPVxyXG4gICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIHBhcmVqYSAtPC9vcHRpb24+JyArXHJcbiAgICAgIGludGVybm9zXHJcbiAgICAgICAgLm1hcChcclxuICAgICAgICAgICh1KSA9PlxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICB1Ll91aWQgK1xyXG4gICAgICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xyXG4gICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgIClcclxuICAgICAgICAuam9pbignJyk7XHJcblxyXG4gICAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXNlcnMtdGFibGUtYm9keScpO1xyXG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xyXG4gICAgbGV0IHRhYmxlSHRtbCA9ICcnO1xyXG4gICAgbGV0IGNhcmRzSHRtbCA9ICcnO1xyXG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xyXG4gICAgICB0YWJsZUh0bWwgPVxyXG4gICAgICAgICc8dHI+PHRkIGNvbHNwYW49XCI2XCIgc3R5bGU9XCJjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvdGQ+PC90cj4nO1xyXG4gICAgICBjYXJkc0h0bWwgPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6Izk0YTNiODtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gQWRtaW5zIHByaW1hcmlvcyBwcm90ZWdpZG9zOiBubyBzZSBwdWVkZW4gZWxpbWluYXIgKE1hcmlhbm8gKyBib3QgY29ycG9yYXRpdm8pXHJcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgICAvLyBQYXJhIGxvcyBpbnRlcm5vcyBjYWxjdWxhbW9zIGxhIHJlbGFjaW9uIGludmVyc2E6IHF1aWVuZXMgbG9zIHRpZW5lbiBjb21vIHBhcmVqYVxyXG4gICAgICBmdW5jdGlvbiB2ZW5kb3JzUGFyYUludGVybm8oaW50ZXJub1VpZCkge1xyXG4gICAgICAgIHJldHVybiB1c2Vyc0NhY2hlLmZpbHRlcihcclxuICAgICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicgJiYgdS5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IGludGVybm9VaWRcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIENhbmRpZGF0b3MgYSByZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczogYWRtaW4sIGdlcmVudGUgbyBpbnRlcm5vIChubyB2ZW5kZWRvcmVzIG5pIHZpZXdlcnMgbmkgdW5hc3NpZ25lZClcclxuICAgICAgY29uc3QgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMgPSB1c2Vyc0NhY2hlLmZpbHRlcihcclxuICAgICAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXHJcbiAgICAgICk7XHJcbiAgICAgIHVzZXJzQ2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGRvY0lkID0gZC5fdWlkO1xyXG4gICAgICAgIGNvbnN0IGlzU2VsZiA9IGRvY0lkID09PSBjdXJyZW50VXNlci51aWQ7XHJcbiAgICAgICAgY29uc3QgaXNQcm90ZWN0ZWQgPSBQUk9URUNURURfQURNSU5fRU1BSUxTLmluZGV4T2YoKGQuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpID49IDA7XHJcbiAgICAgICAgY29uc3QgaXNJbnRlcm5vID0gZC5yb2xlID09PSAnaW50ZXJubyc7XHJcbiAgICAgICAgY29uc3Qgcm9sZU9wdGlvbnMgPSBbJ3VuYXNzaWduZWQnLCAnYWRtaW4nLCAnZ2VyZW50ZScsICd2ZW5kZWRvcicsICdpbnRlcm5vJywgJ3ZpZXdlciddXHJcbiAgICAgICAgICAubWFwKFxyXG4gICAgICAgICAgICAocikgPT5cclxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICAgIHIgK1xyXG4gICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgIChkLnJvbGUgPT09IHIgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgKGlzU2VsZiAmJiByICE9PSAnYWRtaW4nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgICAgciArXHJcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgICBjb25zdCB2ZW5kb3JPcHRpb25zID1cclxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LTwvb3B0aW9uPicgK1xyXG4gICAgICAgICAgVkVORE9SUy5tYXAoXHJcbiAgICAgICAgICAgICh2KSA9PlxyXG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgdi5rZXkgK1xyXG4gICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICB2LnpvbmUgK1xyXG4gICAgICAgICAgICAgICcgJyArXHJcbiAgICAgICAgICAgICAgdi5rZXkgK1xyXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgICApLmpvaW4oJycpO1xyXG4gICAgICAgIC8vIFNpIGVzIGludGVybm8sIG1vc3RyYXIgcmVsYWNpb24gaW52ZXJzYSAodmVuZGVkb3JlcyBxdWUgbG8gdGllbmVuIGNvbW8gcGFyZWphKSBlbiB2ZXogZGVsIGRyb3Bkb3duIGVkaXRhYmxlXHJcbiAgICAgICAgbGV0IHBhcmVqYUNlbGw7XHJcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xyXG4gICAgICAgICAgY29uc3QgdmluYyA9IHZlbmRvcnNQYXJhSW50ZXJubyhkb2NJZCk7XHJcbiAgICAgICAgICBpZiAodmluYy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmNcclxuICAgICAgICAgICAgICAubWFwKCh1KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IHUuZGlzcGxheU5hbWUgPyB1LmRpc3BsYXlOYW1lLnNwbGl0KC9cXHMrLylbMF0gOiB1LmVtYWlsIHx8ICcnO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbChsYWJlbCkgK1xyXG4gICAgICAgICAgICAgICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6Izk0YTNiOFwiPignICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8ICcnKSArXHJcbiAgICAgICAgICAgICAgICAgICcpPC9zcGFuPidcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAuam9pbignPGJyPicpO1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsID1cclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiMwZjE3MmE7bGluZS1oZWlnaHQ6MS41XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM0NzU1Njk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbToycHhcIj5WZW5kZWRvcmVzIGV4dGVybm9zIHZpbmN1bGFkb3MgKGF1dG8pPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgbGlzdCArXHJcbiAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsID1cclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM5NGEzYjg7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIC8vIGlucHV0IG9jdWx0byBwYXJhIHF1ZSBzYXZlVXNlclJvbGUgbm8gcGlzZSBlbCB2YWxvciBkZWwgcm9sID0gaW50ZXJubyAobm8gYXBsaWNhIGludGVybmFsUGFydG5lclVpZClcclxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zdCBpbnRlcm5vT3B0c0ZvclJvdyA9XHJcbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcclxuICAgICAgICAgICAgaW50ZXJub3NcclxuICAgICAgICAgICAgICAubWFwKFxyXG4gICAgICAgICAgICAgICAgKHUpID0+XHJcbiAgICAgICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgICAgIHUuX3VpZCArXHJcbiAgICAgICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgICAgICAoZC5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXHJcbiAgICAgICAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cImludGVybmFsLXNlbFwiIHRpdGxlPVwiUGFyZWphIGludGVybm8gKHNvbG8gYXBsaWNhIHNpIGVsIHJvbCBlcyB2ZW5kZWRvcilcIj4nICtcclxuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xyXG4gICAgICAgICAgICAnPC9zZWxlY3Q+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXHJcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojN2MzYWVkO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCI+KFZPUyk8L3NwYW4+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjb25zdCBwcm90ZWN0ZWRUYWcgPVxyXG4gICAgICAgICAgaXNQcm90ZWN0ZWQgJiYgIWlzU2VsZlxyXG4gICAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojN2MzYWVkO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCIgdGl0bGU9XCJBZG1pbiBwcm90ZWdpZG8gLSBubyBzZSBwdWVkZSBlbGltaW5hclwiPiYjMTI4Mjc0OyBQUk9URUdJRE88L3NwYW4+J1xyXG4gICAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHdhVmFsID0gZC53aGF0c2FwcCB8fCAnJztcclxuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9XHJcbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHdhVmFsKSArXHJcbiAgICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgI2NiZDVlMTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZTtiYWNrZ3JvdW5kOiNmZmZcIiB0aXRsZT1cIk51bWVybyBXaGF0c0FwcCBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKHNpbiArIG5pIGVzcGFjaW9zKS4gU2UgdXNhIGFsIGVudmlhciBsYSBydXRhLlwiLz4nO1xyXG4gICAgICAgIC8vIERyb3Bkb3duICdSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcydcclxuICAgICAgICBjb25zdCBjdXJBcHByb3ZlclVpZCA9IGQucmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCAnJztcclxuICAgICAgICBsZXQgcmVuZEFwcHJvdmVyT3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gYXNpZ25hciAtPC9vcHRpb24+JztcclxuICAgICAgICByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcy5mb3JFYWNoKCh1KSA9PiB7XHJcbiAgICAgICAgICBpZiAodS5fdWlkID09PSBkb2NJZCkgcmV0dXJuOyAvLyB1biB1c3VhcmlvIG5vIHB1ZWRlIHNlciBzdSBwcm9waW8gYXByb2JhZG9yXHJcbiAgICAgICAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgKHUucm9sZSB8fCAnJykgKyAnKSc7XHJcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICs9XHJcbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgIGVzY2FwZUF0dHIodS5fdWlkKSArXHJcbiAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAoY3VyQXBwcm92ZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgZXNjYXBlSHRtbChsYmwpICtcclxuICAgICAgICAgICAgJzwvb3B0aW9uPic7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29uc3QgcmVuZEFwcHJvdmVySHRtbCA9XHJcbiAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cInJlbmQtYXBwcm92ZXItc2VsXCIgdGl0bGU9XCJRdWllbiBhcHJ1ZWJhIGxhcyByZW5kaWNpb25lcyBkZSBlc3RlIHVzdWFyaW9cIj4nICtcclxuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgK1xyXG4gICAgICAgICAgJzwvc2VsZWN0Pic7XHJcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDYW1iaWFyIGNvbnRyYXNlXHUwMEYxYVxyXG4gICAgICAgIGNvbnN0IHB3ZEJ0bkh0bWwgPVxyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHhcIiBvbmNsaWNrPVwiY2hhbmdlVXNlclBhc3N3b3JkKFxcJycgK1xyXG4gICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgXCInLCBcIiArXHJcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xyXG4gICAgICAgICAgJylcIj4mIzEyODI3NDsgQ29udHJhc2VcdTAwRjFhPC9idXR0b24+JztcclxuICAgICAgICAvLyBCb3RcdTAwRjNuIENvbmZpZ3VyYXIgMkZBXHJcbiAgICAgICAgY29uc3QgdG90cFN0YXR1c1RhZyA9IGQudG90cEVuYWJsZWRcclxuICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiMxMGI5ODE7Zm9udC13ZWlnaHQ6ODAwXCI+JiMxMDAwMzs8L3NwYW4+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9XHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgICAgKGQudG90cEVuYWJsZWQgPyAnIzEwYjk4MScgOiAnIzViMjFiNicpICtcclxuICAgICAgICAgICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgIFwiJywgXCIgK1xyXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcclxuICAgICAgICAgICcpXCI+JiMxMjgyNzI7IDJGQScgK1xyXG4gICAgICAgICAgdG90cFN0YXR1c1RhZyArXHJcbiAgICAgICAgICAnPC9idXR0b24+JztcclxuICAgICAgICAvLyBEZXNrdG9wIHJvd1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRyIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUgfHwgJycpICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICsgcm9sZU9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwYXJlamFDZWxsICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgd2FJbnB1dEh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyByZW5kQXBwcm92ZXJIdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHRvdHBCdG5IdG1sICsgJzwvdGQ+JztcclxuICAgICAgICBjb25zdCBzaG93RGVsZXRlID0gIWlzU2VsZiAmJiAhaXNQcm90ZWN0ZWQ7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZVxyXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPVxyXG4gICAgICAgICAgJzx0ZD4nICtcclxuICAgICAgICAgIGRlbEJ0biArXHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzwvdHI+JztcclxuICAgICAgICAvLyBNb2JpbGUgY2FyZFxyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVzZXJzLWNhcmRcIiBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXY+PGRpdiBjbGFzcz1cInVjLWVtYWlsXCI+JyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICtcclxuICAgICAgICAgIHlvdVRhZyArXHJcbiAgICAgICAgICBwcm90ZWN0ZWRUYWcgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgaWYgKGQuZGlzcGxheU5hbWUpXHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1uYW1lXCI+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSkgKyAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5Sb2w8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgK1xyXG4gICAgICAgICAgcm9sZU9wdGlvbnMgK1xyXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvciAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArXHJcbiAgICAgICAgICB2ZW5kb3JPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xyXG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcclxuICAgICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvcmVzIHZpbmN1bGFkb3MgKGF1dG8pPC9sYWJlbD4nICtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCArXHJcbiAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UGFyZWphIGludGVybm8gKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD4nICtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCArXHJcbiAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPldoYXRzQXBwIChjb24gY29kaWdvIGRlIHBhaXMsIHNpbiArIG5pIGVzcGFjaW9zKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICB3YUlucHV0SHRtbCArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzPC9sYWJlbD4nICtcclxuICAgICAgICAgIHJlbmRBcHByb3Zlckh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiIHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7ZGlzcGxheTpmbGV4O2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xyXG4gICAgICAgICAgcHdkQnRuSHRtbCArXHJcbiAgICAgICAgICB0b3RwQnRuSHRtbCArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBjb25zdCBkZWxCdG5DID0gc2hvd0RlbGV0ZVxyXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1hY3Rpb25zXCI+JyArXHJcbiAgICAgICAgICBkZWxCdG5DICtcclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xyXG4gICAgY2FyZHNFbC5pbm5lckhUTUwgPSBjYXJkc0h0bWw7XHJcbiAgICAvLyBBY3R1YWxpemEgaGVhZGVyIGRlIHRhYmxhIGNvbiBsYSBjb2x1bW5hIG51ZXZhXHJcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xyXG4gICAgaWYgKHRoZWFkKVxyXG4gICAgICB0aGVhZC5pbm5lckhUTUwgPVxyXG4gICAgICAgICc8dGg+RW1haWw8L3RoPjx0aD5Ob21icmU8L3RoPjx0aD5Sb2w8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlBhcmVqYSBpbnRlcm5vPC90aD48dGg+V2hhdHNBcHA8L3RoPjx0aD5SZXNwLiByZW5kaWNpb25lczwvdGg+PHRoPlBhc3M8L3RoPjx0aD4yRkE8L3RoPjx0aD48L3RoPic7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjI6IGRlbGV0ZVVzZXJSb2xlICsgVE9UUCArIGNoYW5nZVVzZXJQYXNzd29yZCArIHNhdmVVc2VyUm9sZSAoaW5saW5lIEwxNDEwNS0xNDM5MClcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZGVsZXRlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICBhbGVydCgnTm8gcG9kZXMgZWxpbWluYXIgdHUgcHJvcGlvIGFjY2Vzby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRGVmZW5zYSBhZGljaW9uYWw6IGFkbWlucyBwcm90ZWdpZG9zIG5vIHNlIHB1ZWRlbiBlbGltaW5hciBuaSBkZXNkZSBjb25zb2xhXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXBQcmUgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBjb25zdCBlbWFpbFByZSA9IChzbmFwUHJlLmV4aXN0cyA/IHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnIDogJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCBQUk9URUNURUQgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgaWYgKFBST1RFQ1RFRC5pbmRleE9mKGVtYWlsUHJlKSA+PSAwKSB7XHJcbiAgICAgIGFsZXJ0KCdFc3RlIGVzIHVuIGFkbWluIHByb3RlZ2lkbyAoJyArIGVtYWlsUHJlICsgJykgeSBubyBzZSBwdWVkZSBlbGltaW5hci4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAvKiBzaSBmYWxsYSBsYSBsZWN0dXJhIHByZXZpYSwgc2lndWUgY29uIGNvbmZpcm0gKi9cclxuICB9XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBhY2Nlc28gZGUgZXN0ZSB1c3VhcmlvP1xcblxcblBpZXJkZSBhY2Nlc28gZGUgaW5tZWRpYXRvLiBTaSB2dWVsdmUgYSBlbnRyYXIgY29uIEdvb2dsZSB2YSBhIHF1ZWRhciBjb21vIFwic2luIHJvbCBhc2lnbmFkb1wiIGhhc3RhIHF1ZSB2b3MgbG8gaGFiaWxpdGVzIGRlIG51ZXZvLlxcblxcblN1IGN1ZW50YSBHb29nbGUgc2lndWUgZXhpc3RpZW5kbywgbm8gc2UgYm9ycmEuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGNvbnN0IGRhdGEgPSBzbmFwLmV4aXN0cyA/IHNuYXAuZGF0YSgpIDoge307XHJcbiAgICBsb2dPcCgnZWxpbWluYXJfdXN1YXJpbycsICd1c2VyJywgZGF0YS5lbWFpbCB8fCB1aWQsIHtcclxuICAgICAgdWlkLFxyXG4gICAgICBwcmV2aW91c1JvbGU6IGRhdGEucm9sZSxcclxuICAgICAgcHJldmlvdXNWZW5kb3I6IGRhdGEudmVuZG9yLFxyXG4gICAgfSk7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnVXN1YXJpbyBlbGltaW5hZG8nKTtcclxuICAgIGF3YWl0IG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XHJcblxyXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XHJcbiAgY29uc29sZS5sb2coJ1syRkFdIG9wZW5Ub3RwU2V0dXAgY2FsbGVkJywgeyB1aWQsIGVtYWlsLCB1c2VyUm9sZSB9KTtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGVsIGFkbWluaXN0cmFkb3IgcHVlZGUgY29uZmlndXJhciAyRkEgcGFyYSBvdHJvcyB1c3Vhcmlvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCF1aWQpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogVUlEIGRlbCB1c3VhcmlvIG5vIGRpc3BvbmlibGUuIFJlY2FyZ2EgbGEgcGFnaW5hIHkgcmVpbnRlbnRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XHJcbiAgLy8gTW9kYWwgZXhpc3RlP1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKTtcclxuICBpZiAoIW1vZGFsKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvIGVuIGVsIERPTS4gUmVjYXJnYSBsYSBwYWdpbmEgKEN0cmwrU2hpZnQrUikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHN1YnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLXN1YnQnKTtcclxuICBpZiAoc3VidEVsKSBzdWJ0RWwudGV4dENvbnRlbnQgPSAnUGFyYTogJyArIChlbWFpbCB8fCB1aWQpO1xyXG4gIC8vIExlZXIgZXN0YWRvIGFjdHVhbFxyXG4gIGxldCBjdXJFbmFibGVkID0gZmFsc2U7XHJcbiAgbGV0IGN1clNlY3JldCA9IG51bGw7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBjdXJFbmFibGVkID0gISFkLnRvdHBFbmFibGVkO1xyXG4gICAgICBjdXJTZWNyZXQgPSBkLnRvdHBTZWNyZXQgfHwgbnVsbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignWzJGQV0gZG9jIHJvbGVzLycgKyB1aWQgKyAnIG5vIGV4aXN0ZScpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1syRkFdIGVycm9yIGxleWVuZG8gcm9sZXMvJyArIHVpZCwgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBlbCBlc3RhZG8gZGUgMkZBIGRlbCB1c3VhcmlvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XHJcbiAgaWYgKCFjKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IGNvbnRlbmVkb3IgZGVsIG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvLiBSZWNhcmdhIGxhIHBhZ2luYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGN1ckVuYWJsZWQgJiYgY3VyU2VjcmV0KSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZGNmY2U3O2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzE2NjUzNDt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnPGI+JiMxMDAwMzsgMkZBIHlhIGVzdFx1MDBFMSBhY3Rpdm88L2I+IHBhcmEgZXN0ZSB1c3VhcmlvLicgK1xyXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjExcHhcIj5TaSBsbyBwZXJkaVx1MDBGMyBvIGNhbWJpXHUwMEYzIGRlIGNlbHVsYXIsIHBvZFx1MDBFOXMgZ2VuZXJhcmxlIHVubyBudWV2byAoZWwgYW50ZXJpb3IgcXVlZGEgaW52YWxpZGFkbykuPC9zcGFuPicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7bWFyZ2luLXRvcDoxNHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICBcIicsJ1wiICtcclxuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xyXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPicgK1xyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+JyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+JyArXHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgXCInLCdcIiArXHJcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcclxuICAgICAgJ1xcJylcIj5HZW5lcmFyIDJGQTwvYnV0dG9uPicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICB9XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZVRvdHBTZXR1cE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGNvbnN0IHNlY3JldCA9IHRvdHBHZW5lcmF0ZVNlY3JldCgpO1xyXG4gIGNvbnN0IG90cGF1dGggPSB0b3RwQnVpbGRPdHBhdXRoVXJsKHNlY3JldCwgZW1haWwgfHwgdWlkKTtcclxuICB0b3RwU2V0dXBTdGF0ZSA9IHsgdWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGggfTtcclxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xyXG4gIGMuaW5uZXJIVE1MID1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmVmM2M3O2JvcmRlcjoxcHggc29saWQgI2ZjZDM0ZDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6Izc4MzUwZjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcclxuICAgICc8Yj5QYXNvcyBwYXJhIGFjdGl2YXI6PC9iPjxicj4nICtcclxuICAgICcxLiBFbCB1c3VhcmlvIGluc3RhbGEgPGI+R29vZ2xlIEF1dGhlbnRpY2F0b3I8L2I+IGVuIHN1IGNlbHVsYXIuPGJyPicgK1xyXG4gICAgJzIuIFRvY2EgXCJBZ3JlZ2FyXCIgLyBcIitcIiBlbiBsYSBhcHAuPGJyPicgK1xyXG4gICAgJzMuIEVsaWdlIFwiRXNjYW5lYXIgY1x1MDBGM2RpZ28gUVJcIiB5IGVzY2FuZWEgZWwgY1x1MDBGM2RpZ28gYWJham8gKG8gcGVnYSBlbCBzZWNyZXQgbWFudWFsbWVudGUpLjxicj4nICtcclxuICAgICc0LiBBcGFyZWNlIHVuIGNcdTAwRjNkaWdvIGRlIDYgZFx1MDBFRGdpdG9zIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yLjxicj4nICtcclxuICAgICc1LiBMbyBlc2NyaWJlIGVuIGVsIGlucHV0IGRlIGFiYWpvIHBhcmEgY29uZmlybWFyIHkgYWN0aXZhci4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2Y4ZmFmYztib3JkZXI6MXB4IHNvbGlkICNlMmU4ZjA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4O3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzQ3NTU2OTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjRweFwiPlNlY3JldCAoY2FyZ2EgbWFudWFsIHNpIGVsIFFSIGZhbGxhKTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM1YjIxYjY7d29yZC1icmVhazpicmVhay1hbGw7bGV0dGVyLXNwYWNpbmc6LjFlbVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbChzZWNyZXQpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTBweFwiPjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojNDc1NTY5O2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo1cHhcIj5DXHUwMEYzZGlnbyBkZSB2ZXJpZmljYWNpXHUwMEYzbiBkZSBHb29nbGUgQXV0aGVudGljYXRvcjwvbGFiZWw+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJ0b3RwLWNvbmZpcm0taW5wdXRcIiBpbnB1dG1vZGU9XCJudW1lcmljXCIgbWF4bGVuZ3RoPVwiN1wiIHBsYWNlaG9sZGVyPVwiMDAwMDAwXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxOHB4O3RleHQtYWxpZ246Y2VudGVyO2xldHRlci1zcGFjaW5nOi4zZW07Zm9udC13ZWlnaHQ6ODAwXCIvPjwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiY29uZmlybVRvdHBTZXR1cCgpXCI+VmVyaWZpY2FyIHkgYWN0aXZhcjwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiY2xvc2VUb3RwU2V0dXBNb2RhbCgpXCI+Q2FuY2VsYXI8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIC8vIExhenktbG9hZCBxcmNvZGVqcyB5IGdlbmVyYXIuIEVzdGEgbGlicmVyaWEgcGludGEgZWwgUVIgZGlyZWN0byBlbiBlbFxyXG4gIC8vIGNvbnRlbmVkb3IgRE9NIHZpYSBjYW52YXMvaW1nIC0gbm8gbmVjZXNpdGEgY2FsbGJhY2sgdG9EYXRhVVJMLlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkUVJDb2RlTGliKCk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmICghYm94KSByZXR1cm47XHJcbiAgICBib3guaW5uZXJIVE1MID0gJyc7IC8vIGxpbXBpYXIgZWwgXCJHZW5lcmFuZG8gUVIuLi5cIlxyXG4gICAgbmV3IFFSQ29kZShib3gsIHtcclxuICAgICAgdGV4dDogb3RwYXV0aCxcclxuICAgICAgd2lkdGg6IDIyMCxcclxuICAgICAgaGVpZ2h0OiAyMjAsXHJcbiAgICAgIGNvbG9yRGFyazogJyMwMDAwMDAnLFxyXG4gICAgICBjb2xvckxpZ2h0OiAnI2ZmZmZmZicsXHJcbiAgICAgIGNvcnJlY3RMZXZlbDogUVJDb2RlLkNvcnJlY3RMZXZlbC5NLFxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbMkZBXSBFcnJvciBjYXJnYW5kbyBRUiBsaWI6JywgZSk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmIChib3gpXHJcbiAgICAgIGJveC5pbm5lckhUTUwgPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk5MWIxYjtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIXRvdHBTZXR1cFN0YXRlKSByZXR1cm47XHJcbiAgY29uc3QgY29kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1jb25maXJtLWlucHV0JykudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xyXG4gIGlmICghL15cXGR7Nn0kLy50ZXN0KGNvZGUpKSB7XHJcbiAgICBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xyXG4gIGlmICghb2spIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnQ1x1MDBGM2RpZ28gaW5jb3JyZWN0by4gQXNlZ3VyYXRlIGRlIHF1ZSBlbCBzZWNyZXQgc2UgY2FyZ1x1MDBGMyBiaWVuIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yIHkgcmVpbnRlbnRcdTAwRTEuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpXHJcbiAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcclxuICAgICAgICB0b3RwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB0b3RwRW5hYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGFjdGl2YWRvIHBhcmEgJyArICh0b3RwU2V0dXBTdGF0ZS5lbWFpbCB8fCAndXN1YXJpbycpKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKCFjb25maXJtKCdEZXNoYWJpbGl0YXIgMkZBIHBhcmEgZXN0ZSB1c3VhcmlvPyBWYSBhIGVudHJhciBzb2xvIGNvbiBwYXNzd29yZC4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgIC5kb2ModWlkKVxyXG4gICAgICAudXBkYXRlKHtcclxuICAgICAgICB0b3RwRW5hYmxlZDogZmFsc2UsXHJcbiAgICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXHJcbiAgICAgICAgdG90cERpc2FibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHRvdHBEaXNhYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2hhbmdlVXNlclBhc3N3b3JkID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWVtYWlsKSB7XHJcbiAgICBhbGVydCgnRXN0ZSB1c3VhcmlvIG5vIHRpZW5lIGVtYWlsIHJlZ2lzdHJhZG8gLSBubyBzZSBwdWVkZSByZXNldGVhci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgY2hvaWNlID0gcHJvbXB0KFxyXG4gICAgJ1Jlc2V0ZWFyIGNvbnRyYXNlXHUwMEYxYSBkZSAnICtcclxuICAgICAgZW1haWwgK1xyXG4gICAgICAnXFxuXFxuJyArXHJcbiAgICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXHJcbiAgICAgICcxKSBFTlZJQVIgTUFJTCBERSBSRVNFVEVPIChyZWNvbWVuZGFkbylcXG4nICtcclxuICAgICAgJyAgIExlIGxsZWdhIGEgJyArXHJcbiAgICAgIGVtYWlsICtcclxuICAgICAgJyB1biBtYWlsIGRlIEZpcmViYXNlIGNvbiB1biBsaW5rLlxcbicgK1xyXG4gICAgICAnICAgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcclxuICAgICAgJyAgIEVzIGxvIGVzdGFuZGFyIHkgZnVuY2lvbmEgc2VndXJvLlxcblxcbicgK1xyXG4gICAgICAnMikgUmVzZXRlYXIgU09MTyBlbCBwYXNzd29yZC1nYXRlIChzZWd1bmRhIGNhcGEpLlxcbicgK1xyXG4gICAgICAnICAgTm8gY2FtYmlhIGxhIHBhc3N3b3JkIHJlYWwgZGUgRmlyZWJhc2UuIFNpcnZlIHNpIGVsIHVzdWFyaW9cXG4nICtcclxuICAgICAgJyAgIGVudHJhIHBvciBHb29nbGUgeSBvbHZpZG8gbGEgcGFzc3dvcmQtZ2F0ZSBkZSBsYSBhcHAsIE5PIHNpXFxuJyArXHJcbiAgICAgICcgICBvbHZpZG8gbGEgcGFzc3dvcmQgZGVsIGxvZ2luIGNvbiBlbWFpbC5cXG5cXG4nICtcclxuICAgICAgJ0VzY3JpYmkgMSBvIDI6JyxcclxuICAgICcxJ1xyXG4gICk7XHJcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcclxuICAgICAgYWxlcnQoXHJcbiAgICAgICAgJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArXHJcbiAgICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgICAnLiBEZWNpbGUgcXVlIHJldmlzZSBpbmJveCB5IHNwYW0uIEVsIGxpbmsgZXhwaXJhIGVuIDEgaG9yYS4nXHJcbiAgICAgICk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgICAgIC5kb2ModWlkKVxyXG4gICAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcclxuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdChcclxuICAgICAgJ051ZXZhIHBhc3N3b3JkLWdhdGUgcGFyYSAnICtcclxuICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgJzpcXG5cXG4oU29sbyBhZmVjdGEgbGEgc2VndW5kYSBjYXBhIGRlIGxhIGFwcCwgTk8gZWwgbG9naW4gY29uIGVtYWlsKScsXHJcbiAgICAgICcnXHJcbiAgICApO1xyXG4gICAgaWYgKG5ld1B3ZCA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gICAgY29uc3QgcHdkID0gKG5ld1B3ZCB8fCAnJykudHJpbSgpO1xyXG4gICAgaWYgKHB3ZC5sZW5ndGggPCA0KSB7XHJcbiAgICAgIGFsZXJ0KCdMYSBjb250cmFzZVx1MDBGMWEgdGllbmUgcXVlIHRlbmVyIGFsIG1lbm9zIDQgY2FyYWN0ZXJlcy4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZHMgPSBhd2FpdCBidWlsZFBhc3N3b3JkQ3JlZGVudGlhbHMocHdkKTtcclxuICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgICAgLmRvYyh1aWQpXHJcbiAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICBwYXNzd29yZEhhc2g6IGNyZWRzLnBhc3N3b3JkSGFzaCxcclxuICAgICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIHNob3dTeW5jVGFnKCdQYXNzd29yZC1nYXRlIGFjdHVhbGl6YWRhIHBhcmEgJyArIGVtYWlsKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGJ0bikge1xyXG4gIGNvbnN0IGNvbnRhaW5lciA9IGJ0bi5jbG9zZXN0KCd0cicpIHx8IGJ0bi5jbG9zZXN0KCcudXNlcnMtY2FyZCcpO1xyXG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XHJcbiAgY29uc3Qgcm9sZSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucm9sZS1zZWwnKS52YWx1ZTtcclxuICBjb25zdCB2ZW5kb3IgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnZlbmRvci1zZWwnKS52YWx1ZSB8fCBudWxsO1xyXG4gIGNvbnN0IGludGVybmFsU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5pbnRlcm5hbC1zZWwnKTtcclxuICBjb25zdCBpbnRlcm5hbFBhcnRuZXJVaWQgPSBpbnRlcm5hbFNlbCA/IGludGVybmFsU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxyXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XHJcbiAgY29uc3Qgd2hhdHNhcHAgPSB3YUlucHV0ID8gKHdhSW5wdXQudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcRC9nLCAnJykgOiAnJztcclxuICBpZiAod2hhdHNhcHAgJiYgd2hhdHNhcHAubGVuZ3RoIDwgOCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcyAodWlkIGRlbCB1c3VhcmlvIHF1ZSBhcHJ1ZWJhKVxyXG4gIGNvbnN0IHJlbmRBcHByb3ZlclNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucmVuZC1hcHByb3Zlci1zZWwnKTtcclxuICBjb25zdCByZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZEFwcHJvdmVyU2VsID8gcmVuZEFwcHJvdmVyU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xyXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcclxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xyXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cclxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcclxuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xyXG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCk7XHJcbiAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBhcHByb3ZlclVzZXIgPyBhcHByb3ZlclVzZXIuZW1haWwgfHwgbnVsbCA6IG51bGw7XHJcbiAgfVxyXG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgYnRuLnRleHRDb250ZW50ID0gJy4uLic7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh1aWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcm9sZSxcclxuICAgICAgICAgIHZlbmRvcixcclxuICAgICAgICAgIGludGVybmFsUGFydG5lclVpZCxcclxuICAgICAgICAgIHdoYXRzYXBwOiB3aGF0c2FwcCB8fCBudWxsLFxyXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogcmVuZGljaW9uZXNBcHByb3ZlclVpZCxcclxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLFxyXG4gICAgICAgICAgYXNzaWduZWRCeTogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYXNzaWduZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIC8vIFNpIGVsIHVzdWFyaW8gZWRpdG8gc3UgcHJvcGlvIG51bWVybywgYWN0dWFsaXphciBlbCBjYWNoZSBsb2NhbFxyXG4gICAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICAgIG15V2hhdHNhcHBOdW1iZXIgPSB3aGF0c2FwcCB8fCBudWxsO1xyXG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8IG51bGw7XHJcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsIHx8IG51bGw7XHJcbiAgICB9XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnT0snO1xyXG4gICAgLy8gUmUtcmVuZGVyIGRlbCBwYW5lbCBhc2kgbG9zIGRyb3Bkb3ducyBcIlBhcmVqYSBpbnRlcm5vXCIgbXVlc3RyYW4gbG9zIGludGVybm9zIGFjdHVhbGl6YWRvc1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ3JlZnJlc2ggYWRtaW4gcGFuZWwnLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSwgNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIFRvZG9zIGxvcyBoYW5kbGVycyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgc29uIHZlcmJhdGltLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF1QkEsTUFBSSxPQUFPLE9BQU8sZUFBZSxZQUFhLFFBQU8sYUFBYSxDQUFDO0FBQ25FLE1BQU0sYUFBYSxPQUFPO0FBRTFCLFdBQVMsMkJBQTJCLGFBQWE7QUFDL0MsVUFBTSxLQUFLLFNBQVMsZUFBZSx3QkFBd0I7QUFDM0QsUUFBSSxDQUFDLEdBQUk7QUFDVCxtQkFBZSxlQUFlLENBQUMsR0FDNUIsTUFBTSxFQUNOLEtBQUssQ0FBQyxHQUFHLE9BQU8s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
