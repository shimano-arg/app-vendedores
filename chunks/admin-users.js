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
      aeQs.forEach((d) => {
        allowedList.push(Object.assign({ _id: d.id }, d.data()));
      });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+U2kgdW4gdmVuZGVkb3IgdXNhIEdtYWlsIHBlcnNvbmFsIChubyBAc2hpbWFuby5jb20uYXIpLCBhZ3JlZ2FsbyBhY2EgYW50ZXMgcXVlIGludGVudGUgbG9ndWVhci4gTG9zIGVtYWlscyBAc2hpbWFuby5jb20uYXIgeSBsb3MgYWRtaW5zIGhhcmRjb2RlZCB5YSBlc3RhbiBhdXRvcml6YWRvcyBhdXRvbWF0aWNhbWVudGUuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMCAxMHB4XCI+Tm8gaGF5IGVtYWlscyBwcmUtYXV0b3JpemFkb3MgdG9kYXZpYS48L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xuICAgIGFsbG93ZWRMaXN0LmZvckVhY2goKGFlKSA9PiB7XG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcbiAgICAgIGNvbnN0IG5vdGUgPSBhZS5ub3RlID8gJyAmbWlkZG90OyAnICsgZXNjYXBlSHRtbChhZS5ub3RlKSA6ICcnO1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzozcHggNHB4IDNweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiMxZTQwYWY7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXG4gICAgICAgIGxhYmVsICtcbiAgICAgICAgbm90ZSArXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJyZW1vdmVBbGxvd2VkRW1haWwoXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIoYWUuX2lkKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXG4gICAgICAgICc8L2Rpdj4nO1xuICAgIH0pO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxuXG53aW5kb3cuYWRkQWxsb3dlZEVtYWlsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xuICBpZiAoIXJhdykgcmV0dXJuO1xuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xuICAgIGFsZXJ0KCdFbCBlbWFpbCBubyBwYXJlY2UgdmFsaWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBub3RlID1cbiAgICBwcm9tcHQoJ05vdGEgY29ydGEgb3BjaW9uYWwgKGVqLiBcIlZlbmRlZG9yIFoxIEdvbnphbG9cIiBvIFwiUmVlbXBsYXpvIGRlIE1hdXJpY2lvXCIpOicsICcnKSB8fCAnJztcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXG4gICAgICAuZG9jKGRvY0lkKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIG5vdGU6IG5vdGUudHJpbSgpLFxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIGFkZGVkQnlVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICBhZGRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xuICAgIC8vIFJlY2FyZ2FyIHBhbmVsXG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnJlbW92ZUFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uIChkb2NJZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5kZWxldGUoKTtcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3JlbW92ZUFsbG93ZWRFbWFpbCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT0gU2VjY2lvbiBHZW1pbmkgQVBJIEtleSAoYWRtaW4pID09PVxuZnVuY3Rpb24gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihfZGF0YSkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICAvLyB2NTUxICgyMDI2LTA4LTE5KSBTRUNVUklUWTogbGEga2V5IHZpdmUgZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuXG4gIC8vIEZpcmVzdG9yZS4gTGEgVUkgZGUgYWRtaW4geWEgbm8gcGVybWl0ZSBjYXJnYXIvYm9ycmFyIGRlc2RlIGVsXG4gIC8vIG5hdmVnYWRvciBwb3JxdWUgZXNvIHZvbHZlcmlhIGEgZXhwb25lciBsYSBrZXkgYSBjdWFscXVpZXIgcmVhZGVyLlxuICAvLyBSZWVtcGxhemFkbyBlbCBwYW5lbCB2aWVqbyBwb3IgaW5zdHJ1Y2Npb25lcyBkZSBDTEkuIFNpbiBpbnB1dHMgZGVcbiAgLy8gdXN1YXJpbyBlbiBlbCBIVE1MLCBzb2xvIHRleHRvIGZpam8uXG4gIGNvbnN0IGNsaUluc3RydWN0aW9ucyA9XG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNWIyMWI2XCI+R2VtaW5pIEFQSSBLZXkgKE9DUiBkZSB0aWNrZXRzKTwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPnY1NTEgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLiBTZSBhZG1pbmlzdHJhIHBvciBDTEksIG5vIHBvciBlc3RlIHBhbmVsLjwvZGl2PicgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTBweDtiYWNrZ3JvdW5kOiNmNWYzZmY7Ym9yZGVyOjFweCBzb2xpZCAjZGRkNmZlO2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6MTBweDtjb2xvcjojNWIyMWI2O2xpbmUtaGVpZ2h0OjEuNVwiPicgK1xuICAgICcjIFZlciBlc3RhZG8gZGVsIHNlY3JldDxicj4nICtcbiAgICAnZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6YWNjZXNzIEdFTUlOSV9BUElfS0VZPGJyPjxicj4nICtcbiAgICAnIyBSb3RhciBrZXk8YnI+JyArXG4gICAgJ2ZpcmViYXNlIGZ1bmN0aW9uczpzZWNyZXRzOnNldCBHRU1JTklfQVBJX0tFWTxicj4nICtcbiAgICAnZmlyZWJhc2UgZGVwbG95IC0tb25seSBmdW5jdGlvbnM6Z2VtaW5pT2NyUHJveHknICtcbiAgICAnPC9kaXY+JztcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVuc2FuaXRpemVkL3Byb3BlcnR5XG4gIGVsLmlubmVySFRNTCA9IGNsaUluc3RydWN0aW9ucztcbn1cblxuLy8gdjU1MTogc2F2ZUdlbWluaUFwaUtleSArIGRlbGV0ZUdlbWluaUFwaUtleSBlbGltaW5hZG9zLiBMYSBrZXkgdml2ZVxuLy8gZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuIEZpcmVzdG9yZS4gU2UgYWRtaW5pc3RyYSBwb3IgQ0xJLiBWZXJcbi8vIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24gcGFyYSBsYXMgaW5zdHJ1Y2Npb25lcy5cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHT09HTEUgTUFQUyBHZW9jb2RpbmcgQVBJIC0gbWVqb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsIHF1ZSBPU01cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTGEga2V5IHNlIGd1YXJkYSBlbiBhcHBfY29uZmlnL2dvb2dsZV9tYXBzLiBTaSBlc3RhIHNldGVhZGEsIGxhIHVzYW1vc1xuLy8gY29tbyBnZW9jb2RlciBQUklNQVJJTyBlbiBnZW9jb2RlQ2xpZW50QWRkcmVzczsgc2kgZmFsbGEgbyBubyBlc3RhXG4vLyBzZXRlYWRhLCBjYWVtb3MgYSBsYSBjYXNjYWRhIE9TTSBOb21pbmF0aW0gY29tbyBmYWxsYmFjay5cbmxldCBnbWFwc0FwaUtleUNhY2hlID0gbnVsbDtcbmFzeW5jIGZ1bmN0aW9uIGdldEdtYXBzQXBpS2V5KCkge1xuICBpZiAoZ21hcHNBcGlLZXlDYWNoZSkgcmV0dXJuIGdtYXBzQXBpS2V5Q2FjaGU7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBzbmFwLmRhdGEoKSB8fCB7fTtcbiAgICAgIGlmIChkLmFwaUtleSkge1xuICAgICAgICBnbWFwc0FwaUtleUNhY2hlID0gZC5hcGlLZXk7XG4gICAgICAgIHJldHVybiBkLmFwaUtleTtcbiAgICAgIH1cbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gbm8gc2UgcHVkbyBsZWVyIGFwaSBrZXknLCBlKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cbmZ1bmN0aW9uIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihkYXRhKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dtYXBzLWNvbmZpZy1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgY29uc3QgaGFzS2V5ID0gZGF0YSAmJiBkYXRhLmFwaUtleTtcbiAgY29uc3QgbWFza2VkID0gaGFzS2V5ID8gZGF0YS5hcGlLZXkuc2xpY2UoMCwgNCkgKyAnXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyXHUyMDIyJyArIGRhdGEuYXBpS2V5LnNsaWNlKC00KSA6ICcnO1xuICBjb25zdCB1cGRhdGVkQnkgPSAoZGF0YSAmJiBkYXRhLnVwZGF0ZWRCeSkgfHwgJyc7XG4gIGNvbnN0IHVwZGF0ZWRBdCA9XG4gICAgZGF0YSAmJiBkYXRhLnVwZGF0ZWRBdCAmJiBkYXRhLnVwZGF0ZWRBdC50b0RhdGVcbiAgICAgID8gZGF0YS51cGRhdGVkQXQudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcbiAgICAgIDogJyc7XG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzA2NWY0NlwiPkdvb2dsZSBNYXBzIEFQSSBLZXkgKGdlb2NvZGluZyk8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKGhhc0tleSkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgIzZlZTdiNztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzA2NWY0NlwiPicgK1xuICAgICAgZXNjYXBlSHRtbChtYXNrZWQpICtcbiAgICAgICc8L3NwYW4+JztcbiAgICBodG1sICs9XG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiXCI+Q2FyZ2FkYSBwb3IgJyArXG4gICAgICBlc2NhcGVIdG1sKHVwZGF0ZWRCeSB8fCAnYWRtaW4nKSArXG4gICAgICAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7bWFyZ2luLWJvdHRvbToxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+U2luIEFQSSBrZXkuIEdlb2NvZGluZyB1c2EgT3BlblN0cmVldE1hcCAoZ3JhdGlzIHBlcm8gcGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLjwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xuICBodG1sICs9XG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1jeWFuXCIgb25jbGljaz1cInNhdmVHbWFwc0FwaUtleSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiMxMGI5ODFcIj4nICtcbiAgICAoaGFzS2V5ID8gJ0NhbWJpYXIga2V5JyA6ICdDYXJnYXIga2V5JykgK1xuICAgICc8L2J1dHRvbj4nO1xuICBpZiAoaGFzS2V5KVxuICAgIGh0bWwgKz1cbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRlbGV0ZUdtYXBzQXBpS2V5KClcIj5Cb3JyYXI8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxud2luZG93LnNhdmVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHJhdyA9IHByb21wdChcbiAgICAnUGVnYSBhY2EgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcyAoZm9ybWF0byBBSXphU3kuLi4pLlxcblxcbklNUE9SVEFOVEU6IGVuIEdvb2dsZSBDbG91ZCBDb25zb2xlIHJlc3RyaW5naSBsYSBrZXkgcG9yIEhUVFAgcmVmZXJyZXIgYSBodHRwczovL3NoaW1hbm8tYXJnLmdpdGh1Yi5pby8qIHBhcmEgcXVlIG5hZGllIHRlIGxhIHJvYmUuJyxcbiAgICAnJ1xuICApO1xuICBpZiAocmF3ID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IGtleSA9IHJhdy50cmltKCk7XG4gIGlmICgha2V5KSB7XG4gICAgYWxlcnQoJ1ZhY2lhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7XG4gICAgYWxlcnQoJ0xhIGtleSBwYXJlY2UgbXV5IGNvcnRhLiBSZXZpc2EgcXVlIGxhIHBlZ2FzdGUgY29tcGxldGEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxuICAgICAgLmRvYygnZ29vZ2xlX21hcHMnKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIGFwaUtleToga2V5LFxuICAgICAgICAgIHVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgdXBkYXRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBrZXk7XG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgZ3VhcmRhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVHbWFwc0FwaUtleScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xud2luZG93LmRlbGV0ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0JvcnJhciBsYSBBUEkga2V5IGRlIEdvb2dsZSBNYXBzPyBFbCBnZW9jb2RpbmcgdnVlbHZlIGEgT1NNIChwZW9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCkuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZGVsZXRlKCk7XG4gICAgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgYm9ycmFkYScpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBCVUxLIEFQUFJPVkVSIC0gYXNpZ25hciBlbCBtaXNtbyBcIlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzXCJcbi8vIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXMgZGUgdW4gc29sbyBjbGljay5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVXRpbCBjdWFuZG8gdW4gc29sbyBhcHJvYmFkb3IgKGVqLiBQYWJsbyBnZXJlbnRlKSByZXZpc2EgbGFzXG4vLyByZW5kaWNpb25lcyBkZSBUT0RPUyBsb3MgdmVuZGVkb3Jlcy4gU2luIGVzdG8gZWwgYWRtaW4gdGllbmUgcXVlXG4vLyBhYnJpciBjYWRhIGZpbGEgZGVsIHBhbmVsIFVzdWFyaW9zIHkgc2V0ZWFyIGVsIGRyb3Bkb3duIHVuYSBhIHVuYS5cbmZ1bmN0aW9uIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1bGstYXBwcm92ZXItc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKFxuICAgICh1KSA9PiB1LnJvbGUgPT09ICdhZG1pbicgfHwgdS5yb2xlID09PSAnZ2VyZW50ZScgfHwgdS5yb2xlID09PSAnaW50ZXJubydcbiAgKTtcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6I2EyMWNhZlwiPkFwcm9iYWRvciBkZSBSZW5kaWNpb25lcyAtIGFzaWduYWNpb24gbWFzaXZhPC9kaXY+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoIWNhbmRpZGF0ZXMubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCBhZG1pbiAvIGdlcmVudGUgLyBpbnRlcm5vLiBQcmltZXJvIGFzaWduYSB1biByb2wgYSBhbGd1aWVuLjwvZGl2Pic7XG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgdmVuZGVkb3IgdG9kYXZpYS48L2Rpdj4nO1xuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XG4gICAgcmV0dXJuO1xuICB9XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8c2VsZWN0IGlkPVwiYnVsay1hcHByb3Zlci1zZWxlY3RcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Ym9yZGVyOjEuNXB4IHNvbGlkICNmMGFiZmM7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7YmFja2dyb3VuZDojZmZmO2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZmxleDoxO21heC13aWR0aDozNDBweFwiPic7XG4gIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciBhcHJvYmFkb3IgLTwvb3B0aW9uPic7XG4gIGNhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xuICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyB1LnJvbGUgKyAnKSc7XG4gICAgaHRtbCArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBlc2NhcGVBdHRyKHUuX3VpZCkgKyAnXCI+JyArIGVzY2FwZUh0bWwobGJsKSArICc8L29wdGlvbj4nO1xuICB9KTtcbiAgaHRtbCArPSAnPC9zZWxlY3Q+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImJ1bGtBc3NpZ25BcHByb3ZlcigpXCI+QXNpZ25hciBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzICgnICtcbiAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgJyk8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxud2luZG93LmJ1bGtBc3NpZ25BcHByb3ZlciA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlbGVjdCcpO1xuICBjb25zdCB1aWQgPSBzZWwgJiYgc2VsLnZhbHVlO1xuICBpZiAoIXVpZCkge1xuICAgIGFsZXJ0KCdFbGVnJmlhY3V0ZTsgdW4gYXByb2JhZG9yIGRlbCBkcm9wZG93bi4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYXBwcm92ZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSB1aWQpO1xuICBpZiAoIWFwcHJvdmVyKSB7XG4gICAgYWxlcnQoJ0Fwcm9iYWRvciBubyBlbmNvbnRyYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmVuZGVkb3JlcyBwYXJhIGFzaWduYXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyTGFiZWwgPSBhcHByb3Zlci5kaXNwbGF5TmFtZSB8fCBhcHByb3Zlci5lbWFpbCB8fCBhcHByb3Zlci5fdWlkO1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnQXNpZ25hciBhICcgK1xuICAgICAgICBhcHByb3ZlckxhYmVsICtcbiAgICAgICAgJyBjb21vIGFwcm9iYWRvciBkZSBsb3MgJyArXG4gICAgICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcbiAgICAgICAgJyB2ZW5kZWRvcmVzP1xcblxcblZhIGEgc29icmVzY3JpYmlyIGN1YWxxdWllciBhcHJvYmFkb3IgcHJldmlvIGFzaWduYWRvIGEgY2FkYSB2ZW5kZWRvci4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICBsZXQgb2tDb3VudCA9IDAsXG4gICAgX2VyckNvdW50ID0gMDtcbiAgLy8gVXBkYXRlIGVuIGxvdGUuIFVzYW1vcyB1biBiYXRjaCBkZSBGaXJlc3RvcmUuXG4gIGNvbnN0IGJhdGNoID0gZmJEYi5iYXRjaCgpO1xuICB2ZW5kZWRvcmVzLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCByZWYgPSBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHYuX3VpZCk7XG4gICAgYmF0Y2gudXBkYXRlKHJlZiwge1xuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogdWlkLFxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICB0cnkge1xuICAgIGF3YWl0IGJhdGNoLmNvbW1pdCgpO1xuICAgIG9rQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBpZiAodHlwZW9mIGxvZ09wID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBsb2dPcCgnYnVsa19hc3NpZ25fYXBwcm92ZXInLCAncm9sZXMnLCBhcHByb3ZlckxhYmVsLCB7XG4gICAgICAgIGFwcHJvdmVyVWlkOiB1aWQsXG4gICAgICAgIGFwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxuICAgICAgICB2ZW5kZWRvckNvdW50OiB2ZW5kZWRvcmVzLmxlbmd0aCxcbiAgICAgICAgdmVuZGVkb3JVaWRzOiB2ZW5kZWRvcmVzLm1hcCgodikgPT4gdi5fdWlkKSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2J1bGtBc3NpZ25BcHByb3ZlcicsIGUpO1xuICAgIF9lcnJDb3VudCA9IHZlbmRlZG9yZXMubGVuZ3RoO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG4gIGlmIChva0NvdW50KSB7XG4gICAgc2hvd1N5bmNUYWcob2tDb3VudCArICcgdmVuZGVkb3IoZXMpIGFzaWduYWRvKHMpIGEgJyArIGFwcHJvdmVyTGFiZWwpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fSAvLyByZWZyZXNjYXJcbiAgfVxufTtcblxuLy8gR2VvY29kaW5nIGNvbiBHb29nbGUgTWFwcyBBUEkuIERldnVlbHZlIHtsYXQsIGxuZywgZGlzcGxheSwgcHJlY2lzaW9ufVxuLy8gbyBudWxsIHNpIG5vIGVuY29udHJvIC8gc2luIGtleS5cbmFzeW5jIGZ1bmN0aW9uIF9nZW9jb2RlV2l0aEdvb2dsZU1hcHMoYWRkcmVzcywgbG9jYWxpdHksIHByb3ZpbmNlQ29kZSkge1xuICBjb25zdCBrZXkgPSBhd2FpdCBnZXRHbWFwc0FwaUtleSgpO1xuICBpZiAoIWtleSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHByb3YgPSB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlQ29kZSB8fCAnJykgOiBwcm92aW5jZUNvZGUgfHwgJyc7XG4gIGNvbnN0IGZ1bGxBZGRyID0gW2FkZHJlc3MsIGxvY2FsaXR5LCBwcm92LCAnQXJnZW50aW5hJ10uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJywgJyk7XG4gIC8vIHJlZ2lvbj1hciArIGNvbXBvbmVudHM9Y291bnRyeTpBUiBzZXNnYSBsb3MgcmVzdWx0YWRvcyBhIEFSLlxuICBjb25zdCB1cmwgPVxuICAgICdodHRwczovL21hcHMuZ29vZ2xlYXBpcy5jb20vbWFwcy9hcGkvZ2VvY29kZS9qc29uJyArXG4gICAgJz9hZGRyZXNzPScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChmdWxsQWRkcikgK1xuICAgICcmcmVnaW9uPWFyJyArXG4gICAgJyZjb21wb25lbnRzPWNvdW50cnk6QVInICtcbiAgICAnJmxhbmd1YWdlPWVzJyArXG4gICAgJyZrZXk9JyArXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSk7XG4gIHRyeSB7XG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgci5qc29uKCk7XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT0snICYmIGRhdGEucmVzdWx0cyAmJiBkYXRhLnJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICBjb25zdCByZXMgPSBkYXRhLnJlc3VsdHNbMF07XG4gICAgICBjb25zdCBsb2MgPSByZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uO1xuICAgICAgaWYgKCFsb2MpIHJldHVybiBudWxsO1xuICAgICAgLy8gbG9jYXRpb25fdHlwZSBpbmRpY2EgcHJlY2lzaW9uOiBST09GVE9QID4gUkFOR0VfSU5URVJQT0xBVEVEID4gR0VPTUVUUklDX0NFTlRFUiA+IEFQUFJPWElNQVRFLlxuICAgICAgY29uc3QgbHQgPSAocmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbl90eXBlKSB8fCAnJztcbiAgICAgIGxldCBwcmVjaXNpb24gPSAnYWRkcmVzcyc7XG4gICAgICBpZiAobHQgPT09ICdBUFBST1hJTUFURScpIHByZWNpc2lvbiA9ICdsb2NhbGl0eSc7XG4gICAgICBlbHNlIGlmIChsdCA9PT0gJ0dFT01FVFJJQ19DRU5URVInKSBwcmVjaXNpb24gPSAnc3RyZWV0JztcbiAgICAgIC8vIEV4dHJhZXIgbG9jYWxpdHkgKyBhZG1pbl9hcmVhIGRlbCByZXNwb25zZSBwYXJhIGF1dG9jb21wbGV0YXIgY2FtcG9zXG4gICAgICAvLyBxdWUgU0FQIG5vIGV4cG9ydG8gKFNoaXAtdG8gQ2l0eSB2YWNpbyBlcyBtdXkgY29tdW4gZW4gQlBzIHZpZWpvcykuXG4gICAgICBjb25zdCBjb21wb25lbnRzID0gcmVzLmFkZHJlc3NfY29tcG9uZW50cyB8fCBbXTtcbiAgICAgIGNvbnN0IGJ5VHlwZSA9ICh0KSA9PiB7XG4gICAgICAgIGNvbnN0IGMgPSBjb21wb25lbnRzLmZpbmQoKGNjKSA9PiBBcnJheS5pc0FycmF5KGNjLnR5cGVzKSAmJiBjYy50eXBlcy5pbmNsdWRlcyh0KSk7XG4gICAgICAgIHJldHVybiBjID8gYy5sb25nX25hbWUgfHwgJycgOiAnJztcbiAgICAgIH07XG4gICAgICAvLyBQcmlvcmlkYWQgcGFyYSBsb2NhbGlkYWQ6IGxvY2FsaXR5ID4gc3VibG9jYWxpdHkgPiBhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzIuXG4gICAgICBjb25zdCBkZXRlY3RlZExvY2FsaXR5ID1cbiAgICAgICAgYnlUeXBlKCdsb2NhbGl0eScpIHx8IGJ5VHlwZSgnc3VibG9jYWxpdHknKSB8fCBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMicpIHx8ICcnO1xuICAgICAgY29uc3QgZGV0ZWN0ZWRQcm92aW5jZSA9IGJ5VHlwZSgnYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8xJykgfHwgJyc7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBsYXQ6IHBhcnNlRmxvYXQobG9jLmxhdCksXG4gICAgICAgIGxuZzogcGFyc2VGbG9hdChsb2MubG5nKSxcbiAgICAgICAgZGlzcGxheTogcmVzLmZvcm1hdHRlZF9hZGRyZXNzIHx8IGZ1bGxBZGRyLFxuICAgICAgICBwcmVjaXNpb246IHByZWNpc2lvbixcbiAgICAgICAgcHJvdmlkZXI6ICdnb29nbGUnLFxuICAgICAgICBsb2NhdGlvblR5cGU6IGx0LFxuICAgICAgICBsb2NhbGl0eTogZGV0ZWN0ZWRMb2NhbGl0eSxcbiAgICAgICAgcHJvdmluY2U6IGRldGVjdGVkUHJvdmluY2UsXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdaRVJPX1JFU1VMVFMnKSB7XG4gICAgICBjb25zb2xlLmxvZygnW2dtYXBzXSBaRVJPX1JFU1VMVFMgZm9yOicsIGZ1bGxBZGRyKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdSRVFVRVNUX0RFTklFRCcpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICdbZ21hcHNdIFJFUVVFU1RfREVOSUVEOicsXG4gICAgICAgIGRhdGEuZXJyb3JfbWVzc2FnZSB8fFxuICAgICAgICAgICcoc2luIGRldGFsbGUpLiBSZXZpc2FyIHF1ZSBsYSBBUEkga2V5IHRlbmdhIGhhYmlsaXRhZGEgR2VvY29kaW5nIEFQSSB5IGVsIHJlZmVycmVyIHBlcm1pdGEgZXN0ZSBkb21pbmlvLidcbiAgICAgICk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT1ZFUl9RVUVSWV9MSU1JVCcpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gT1ZFUl9RVUVSWV9MSU1JVCAtIGV4Y2VkaW8gZWwgbGltaXRlLiBDYWVtb3MgYSBPU00uJyk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIHN0YXR1cyBpbmVzcGVyYWRvOicsIGRhdGEuc3RhdHVzLCBkYXRhLmVycm9yX21lc3NhZ2UpO1xuICAgIHJldHVybiBudWxsO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIGdlb2NvZGUgZXJyb3I6JywgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxud2luZG93Lm9wZW5BZG1pblBhbmVsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAvLyBDYXJnYXIgYWxsb3dlZF9lbWFpbHMgcGFyYSBtb3N0cmFyIGFycmliYSBsYSBzZWNjaW9uIGRlIHByZS1hdXRvcml6YWNpb25lc1xuICB0cnkge1xuICAgIGNvbnN0IGFlUXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZ2V0KCk7XG4gICAgY29uc3QgYWxsb3dlZExpc3QgPSBbXTtcbiAgICBhZVFzLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGFsbG93ZWRMaXN0LnB1c2goT2JqZWN0LmFzc2lnbih7IF9pZDogZC5pZCB9LCBkLmRhdGEoKSkpO1xuICAgIH0pO1xuICAgIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBhbGxvd2VkX2VtYWlscycsIGUpO1xuICB9XG4gIC8vIENhcmdhciBjb25maWcgR2VtaW5pIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXlcbiAgdHJ5IHtcbiAgICBjb25zdCBnU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ2VtaW5pJykuZ2V0KCk7XG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihnU25hcC5leGlzdHMgPyBnU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnZW1pbmkgY29uZmlnJywgZSk7XG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihudWxsKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdvb2dsZSBNYXBzIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXkuXG4gIHRyeSB7XG4gICAgY29uc3QgZ21TbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihnbVNuYXAuZXhpc3RzID8gZ21TbmFwLmRhdGEoKSA6IG51bGwpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdsb2FkIGdtYXBzIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihudWxsKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLm9yZGVyQnkoJ2VtYWlsJykuZ2V0KCk7XG4gICAgLy8gRTYgZml4IEMxOiB2YWNpYXIgZWwgQXJyYXkgaW4tcGxhY2UgKHByZXNlcnZhIHdpbmRvdy51c2Vyc0NhY2hlIHJlZikuXG4gICAgdXNlcnNDYWNoZS5sZW5ndGggPSAwO1xuICAgIHFzLmZvckVhY2goKGRvYykgPT4ge1xuICAgICAgdXNlcnNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBfdWlkOiBkb2MuaWQgfSwgZG9jLmRhdGEoKSkpO1xuICAgIH0pO1xuICAgIC8vIFJlbmRlciBkZWwgYmxvcXVlIFwiQXNpZ25hciBhcHJvYmFkb3IgYSB0b2RvcyBsb3MgdmVuZGVkb3Jlc1wiIGFycmliYSBkZSBsYSB0YWJsYS5cbiAgICB0cnkge1xuICAgICAgcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignYnVsayBhcHByb3ZlciBzZWN0aW9uJywgZSk7XG4gICAgfVxuICAgIC8vIFNpbmNyb25pemFyIGVsIGRpcmVjdG9yaW8gcHVibGljbyBkZSB1c3VhcmlvcyBwYXJhIHF1ZSBsb3MgdmVuZGVkb3Jlc1xuICAgIC8vIHB1ZWRhbiB2ZXIgZGVzdGluYXRhcmlvcyBhbCBjcmVhciB0YXJlYXMgZW4gTm90aWZpY2FjaW9uZXMuIFNpbiBlc3RvXG4gICAgLy8gbG9zIHZlbmRlZG9yZXMgdmVuIGVsIGRyb3Bkb3duIHZhY2lvIChzZWN1cml0eSBydWxlcyBibG9xdWVhbiAvcm9sZXMpLlxuICAgIHRyeSB7XG4gICAgICBzeW5jVXNlcnNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ3N5bmNVc2Vyc0RpcmVjdG9yeScsIGUpO1xuICAgIH1cbiAgICAvLyBMaXN0YSBkZSBpbnRlcm5vcyBkaXNwb25pYmxlcyAocGFyYSBhc2lnbmFyIHBhcmVqYSBhIGxvcyB2ZW5kZWRvcmVzKVxuICAgIGNvbnN0IGludGVybm9zID0gdXNlcnNDYWNoZS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ2ludGVybm8nKTtcbiAgICBjb25zdCBfaW50ZXJub09wdHMgPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xuICAgICAgaW50ZXJub3NcbiAgICAgICAgLm1hcChcbiAgICAgICAgICAodSkgPT5cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICB1Ll91aWQgK1xuICAgICAgICAgICAgJ1wiPicgK1xuICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICApXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLXRhYmxlLWJvZHknKTtcbiAgICBjb25zdCBjYXJkc0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLWNhcmRzJyk7XG4gICAgbGV0IHRhYmxlSHRtbCA9ICcnO1xuICAgIGxldCBjYXJkc0h0bWwgPSAnJztcbiAgICBpZiAoIXVzZXJzQ2FjaGUubGVuZ3RoKSB7XG4gICAgICB0YWJsZUh0bWwgPVxuICAgICAgICAnPHRyPjx0ZCBjb2xzcGFuPVwiNlwiIHN0eWxlPVwiY29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L3RkPjwvdHI+JztcbiAgICAgIGNhcmRzSHRtbCA9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6Izk0YTNiODtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBZG1pbnMgcHJpbWFyaW9zIHByb3RlZ2lkb3M6IG5vIHNlIHB1ZWRlbiBlbGltaW5hciAoTWFyaWFubyArIGJvdCBjb3Jwb3JhdGl2bylcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuICAgICAgLy8gUGFyYSBsb3MgaW50ZXJub3MgY2FsY3VsYW1vcyBsYSByZWxhY2lvbiBpbnZlcnNhOiBxdWllbmVzIGxvcyB0aWVuZW4gY29tbyBwYXJlamFcbiAgICAgIGZ1bmN0aW9uIHZlbmRvcnNQYXJhSW50ZXJubyhpbnRlcm5vVWlkKSB7XG4gICAgICAgIHJldHVybiB1c2Vyc0NhY2hlLmZpbHRlcihcbiAgICAgICAgICAodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InICYmIHUuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSBpbnRlcm5vVWlkXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBDYW5kaWRhdG9zIGEgcmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM6IGFkbWluLCBnZXJlbnRlIG8gaW50ZXJubyAobm8gdmVuZGVkb3JlcyBuaSB2aWV3ZXJzIG5pIHVuYXNzaWduZWQpXG4gICAgICBjb25zdCByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKFxuICAgICAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICAgICApO1xuICAgICAgdXNlcnNDYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY0lkID0gZC5fdWlkO1xuICAgICAgICBjb25zdCBpc1NlbGYgPSBkb2NJZCA9PT0gY3VycmVudFVzZXIudWlkO1xuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcbiAgICAgICAgY29uc3QgaXNJbnRlcm5vID0gZC5yb2xlID09PSAnaW50ZXJubyc7XG4gICAgICAgIGNvbnN0IHJvbGVPcHRpb25zID0gWyd1bmFzc2lnbmVkJywgJ2FkbWluJywgJ2dlcmVudGUnLCAndmVuZGVkb3InLCAnaW50ZXJubycsICd2aWV3ZXInXVxuICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAocikgPT5cbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICAgICAgciArXG4gICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAoZC5yb2xlID09PSByID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAoaXNTZWxmICYmIHIgIT09ICdhZG1pbicgPyAnIGRpc2FibGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHIgK1xuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgIClcbiAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIGNvbnN0IHZlbmRvck9wdGlvbnMgPVxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LTwvb3B0aW9uPicgK1xuICAgICAgICAgIFZFTkRPUlMubWFwKFxuICAgICAgICAgICAgKHYpID0+XG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHYuem9uZSArXG4gICAgICAgICAgICAgICcgJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgICApLmpvaW4oJycpO1xuICAgICAgICAvLyBTaSBlcyBpbnRlcm5vLCBtb3N0cmFyIHJlbGFjaW9uIGludmVyc2EgKHZlbmRlZG9yZXMgcXVlIGxvIHRpZW5lbiBjb21vIHBhcmVqYSkgZW4gdmV6IGRlbCBkcm9wZG93biBlZGl0YWJsZVxuICAgICAgICBsZXQgcGFyZWphQ2VsbDtcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xuICAgICAgICAgIGNvbnN0IHZpbmMgPSB2ZW5kb3JzUGFyYUludGVybm8oZG9jSWQpO1xuICAgICAgICAgIGlmICh2aW5jLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmNcbiAgICAgICAgICAgICAgLm1hcCgodSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6IHUuZW1haWwgfHwgJyc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwobGFiZWwpICtcbiAgICAgICAgICAgICAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojOTRhM2I4XCI+KCcgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8ICcnKSArXG4gICAgICAgICAgICAgICAgICAnKTwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgLmpvaW4oJzxicj4nKTtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiMwZjE3MmE7bGluZS1oZWlnaHQ6MS41XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM0NzU1Njk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbToycHhcIj5WZW5kZWRvcmVzIGV4dGVybm9zIHZpbmN1bGFkb3MgKGF1dG8pPC9kaXY+JyArXG4gICAgICAgICAgICAgIGxpc3QgK1xuICAgICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZWphQ2VsbCA9XG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6Izk0YTNiODtmb250LXN0eWxlOml0YWxpY1wiPkF1biBuaW5ndW4gdmVuZGVkb3IgbG8gdGllbmUgY29tbyBwYXJlamE8L2Rpdj4nO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBpbnB1dCBvY3VsdG8gcGFyYSBxdWUgc2F2ZVVzZXJSb2xlIG5vIHBpc2UgZWwgdmFsb3IgZGVsIHJvbCA9IGludGVybm8gKG5vIGFwbGljYSBpbnRlcm5hbFBhcnRuZXJVaWQpXG4gICAgICAgICAgcGFyZWphQ2VsbCArPSAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIiBjbGFzcz1cImludGVybmFsLXNlbFwiIHZhbHVlPVwiXCIvPic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgaW50ZXJub09wdHNGb3JSb3cgPVxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xuICAgICAgICAgICAgaW50ZXJub3NcbiAgICAgICAgICAgICAgLm1hcChcbiAgICAgICAgICAgICAgICAodSkgPT5cbiAgICAgICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgICAgICB1Ll91aWQgK1xuICAgICAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgICAgICAoZC5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgdS5kaXNwbGF5TmFtZSB8fCB1Ll91aWQpICtcbiAgICAgICAgICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgLmpvaW4oJycpO1xuICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB0aXRsZT1cIlBhcmVqYSBpbnRlcm5vIChzb2xvIGFwbGljYSBzaSBlbCByb2wgZXMgdmVuZGVkb3IpXCI+JyArXG4gICAgICAgICAgICBpbnRlcm5vT3B0c0ZvclJvdyArXG4gICAgICAgICAgICAnPC9zZWxlY3Q+JztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB5b3VUYWcgPSBpc1NlbGZcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojN2MzYWVkO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCI+KFZPUyk8L3NwYW4+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIGNvbnN0IHByb3RlY3RlZFRhZyA9XG4gICAgICAgICAgaXNQcm90ZWN0ZWQgJiYgIWlzU2VsZlxuICAgICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzdjM2FlZDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiIHRpdGxlPVwiQWRtaW4gcHJvdGVnaWRvIC0gbm8gc2UgcHVlZGUgZWxpbWluYXJcIj4mIzEyODI3NDsgUFJPVEVHSURPPC9zcGFuPidcbiAgICAgICAgICAgIDogJyc7XG4gICAgICAgIGNvbnN0IHdhVmFsID0gZC53aGF0c2FwcCB8fCAnJztcbiAgICAgICAgY29uc3Qgd2FJbnB1dEh0bWwgPVxuICAgICAgICAgICc8aW5wdXQgdHlwZT1cInRlbFwiIGNsYXNzPVwid2EtaW5wdXRcIiBwbGFjZWhvbGRlcj1cImVqLiA1NDkxMTI2NzYyMDMxXCIgdmFsdWU9XCInICtcbiAgICAgICAgICBlc2NhcGVBdHRyKHdhVmFsKSArXG4gICAgICAgICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjVweCA3cHg7Ym9yZGVyOjEuNXB4IHNvbGlkICNjYmQ1ZTE7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7Zm9udC1mYW1pbHk6aW5oZXJpdDtvdXRsaW5lOm5vbmU7YmFja2dyb3VuZDojZmZmXCIgdGl0bGU9XCJOdW1lcm8gV2hhdHNBcHAgY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChzaW4gKyBuaSBlc3BhY2lvcykuIFNlIHVzYSBhbCBlbnZpYXIgbGEgcnV0YS5cIi8+JztcbiAgICAgICAgLy8gRHJvcGRvd24gJ1Jlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzJ1xuICAgICAgICBjb25zdCBjdXJBcHByb3ZlclVpZCA9IGQucmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCAnJztcbiAgICAgICAgbGV0IHJlbmRBcHByb3Zlck9wdGlvbnMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIGFzaWduYXIgLTwvb3B0aW9uPic7XG4gICAgICAgIHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICAgICAgICBpZiAodS5fdWlkID09PSBkb2NJZCkgcmV0dXJuOyAvLyB1biB1c3VhcmlvIG5vIHB1ZWRlIHNlciBzdSBwcm9waW8gYXByb2JhZG9yXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgKz1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICBlc2NhcGVBdHRyKHUuX3VpZCkgK1xuICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAoY3VyQXBwcm92ZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICBlc2NhcGVIdG1sKGxibCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZW5kQXBwcm92ZXJIdG1sID1cbiAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cInJlbmQtYXBwcm92ZXItc2VsXCIgdGl0bGU9XCJRdWllbiBhcHJ1ZWJhIGxhcyByZW5kaWNpb25lcyBkZSBlc3RlIHVzdWFyaW9cIj4nICtcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+JztcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDYW1iaWFyIGNvbnRyYXNlXHUwMEYxYVxuICAgICAgICBjb25zdCBwd2RCdG5IdG1sID1cbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweFwiIG9uY2xpY2s9XCJjaGFuZ2VVc2VyUGFzc3dvcmQoXFwnJyArXG4gICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgIFwiJywgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXG4gICAgICAgICAgJylcIj4mIzEyODI3NDsgQ29udHJhc2VcdTAwRjFhPC9idXR0b24+JztcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDb25maWd1cmFyIDJGQVxuICAgICAgICBjb25zdCB0b3RwU3RhdHVzVGFnID0gZC50b3RwRW5hYmxlZFxuICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiMxMGI5ODE7Zm9udC13ZWlnaHQ6ODAwXCI+JiMxMDAwMzs8L3NwYW4+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIGNvbnN0IHRvdHBCdG5IdG1sID1cbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweDtiYWNrZ3JvdW5kOicgK1xuICAgICAgICAgIChkLnRvdHBFbmFibGVkID8gJyMxMGI5ODEnIDogJyM1YjIxYjYnKSArXG4gICAgICAgICAgJ1wiIG9uY2xpY2s9XCJvcGVuVG90cFNldHVwKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICBcIicsIFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xuICAgICAgICAgICcpXCI+JiMxMjgyNzI7IDJGQScgK1xuICAgICAgICAgIHRvdHBTdGF0dXNUYWcgK1xuICAgICAgICAgICc8L2J1dHRvbj4nO1xuICAgICAgICAvLyBEZXNrdG9wIHJvd1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ciBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArIHlvdVRhZyArIHByb3RlY3RlZFRhZyArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUgfHwgJycpICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInJvbGUtc2VsXCI+JyArIHJvbGVPcHRpb25zICsgJzwvc2VsZWN0PjwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICsgdmVuZG9yT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwYXJlamFDZWxsICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHdhSW5wdXRIdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHJlbmRBcHByb3Zlckh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB0b3RwQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIGNvbnN0IHNob3dEZWxldGUgPSAhaXNTZWxmICYmICFpc1Byb3RlY3RlZDtcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZVxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgdGFibGVIdG1sICs9XG4gICAgICAgICAgJzx0ZD4nICtcbiAgICAgICAgICBkZWxCdG4gK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPC90cj4nO1xuICAgICAgICAvLyBNb2JpbGUgY2FyZFxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1c2Vycy1jYXJkXCIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXY+PGRpdiBjbGFzcz1cInVjLWVtYWlsXCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArXG4gICAgICAgICAgeW91VGFnICtcbiAgICAgICAgICBwcm90ZWN0ZWRUYWcgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBpZiAoZC5kaXNwbGF5TmFtZSlcbiAgICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1uYW1lXCI+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSkgKyAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5Sb2w8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgK1xuICAgICAgICAgIHJvbGVPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgK1xuICAgICAgICAgIHZlbmRvck9wdGlvbnMgK1xuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvcmVzIHZpbmN1bGFkb3MgKGF1dG8pPC9sYWJlbD4nICtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5QYXJlamEgaW50ZXJubyAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPicgK1xuICAgICAgICAgICAgcGFyZWphQ2VsbCArXG4gICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgK1xuICAgICAgICAgIHdhSW5wdXRIdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM8L2xhYmVsPicgK1xuICAgICAgICAgIHJlbmRBcHByb3Zlckh0bWwgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiIHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7ZGlzcGxheTpmbGV4O2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xuICAgICAgICAgIHB3ZEJ0bkh0bWwgK1xuICAgICAgICAgIHRvdHBCdG5IdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGVcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgK1xuICAgICAgICAgIGRlbEJ0bkMgK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xuICAgIGNhcmRzRWwuaW5uZXJIVE1MID0gY2FyZHNIdG1sO1xuICAgIC8vIEFjdHVhbGl6YSBoZWFkZXIgZGUgdGFibGEgY29uIGxhIGNvbHVtbmEgbnVldmFcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xuICAgIGlmICh0aGVhZClcbiAgICAgIHRoZWFkLmlubmVySFRNTCA9XG4gICAgICAgICc8dGg+RW1haWw8L3RoPjx0aD5Ob21icmU8L3RoPjx0aD5Sb2w8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlBhcmVqYSBpbnRlcm5vPC90aD48dGg+V2hhdHNBcHA8L3RoPjx0aD5SZXNwLiByZW5kaWNpb25lczwvdGg+PHRoPlBhc3M8L3RoPjx0aD4yRkE8L3RoPjx0aD48L3RoPic7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdvcGVuQWRtaW5QYW5lbCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuY2xvc2VBZG1pblBhbmVsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjI6IGRlbGV0ZVVzZXJSb2xlICsgVE9UUCArIGNoYW5nZVVzZXJQYXNzd29yZCArIHNhdmVVc2VyUm9sZSAoaW5saW5lIEwxNDEwNS0xNDM5MClcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZGVsZXRlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcbiAgICBhbGVydCgnTm8gcG9kZXMgZWxpbWluYXIgdHUgcHJvcGlvIGFjY2Vzby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRGVmZW5zYSBhZGljaW9uYWw6IGFkbWlucyBwcm90ZWdpZG9zIG5vIHNlIHB1ZWRlbiBlbGltaW5hciBuaSBkZXNkZSBjb25zb2xhXG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcFByZSA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBjb25zdCBlbWFpbFByZSA9IChzbmFwUHJlLmV4aXN0cyA/IHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnIDogJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgUFJPVEVDVEVEID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcbiAgICBpZiAoUFJPVEVDVEVELmluZGV4T2YoZW1haWxQcmUpID49IDApIHtcbiAgICAgIGFsZXJ0KCdFc3RlIGVzIHVuIGFkbWluIHByb3RlZ2lkbyAoJyArIGVtYWlsUHJlICsgJykgeSBubyBzZSBwdWVkZSBlbGltaW5hci4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgLyogc2kgZmFsbGEgbGEgbGVjdHVyYSBwcmV2aWEsIHNpZ3VlIGNvbiBjb25maXJtICovXG4gIH1cbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0VsaW1pbmFyIGFjY2VzbyBkZSBlc3RlIHVzdWFyaW8/XFxuXFxuUGllcmRlIGFjY2VzbyBkZSBpbm1lZGlhdG8uIFNpIHZ1ZWx2ZSBhIGVudHJhciBjb24gR29vZ2xlIHZhIGEgcXVlZGFyIGNvbW8gXCJzaW4gcm9sIGFzaWduYWRvXCIgaGFzdGEgcXVlIHZvcyBsbyBoYWJpbGl0ZXMgZGUgbnVldm8uXFxuXFxuU3UgY3VlbnRhIEdvb2dsZSBzaWd1ZSBleGlzdGllbmRvLCBubyBzZSBib3JyYS4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgY29uc3QgZGF0YSA9IHNuYXAuZXhpc3RzID8gc25hcC5kYXRhKCkgOiB7fTtcbiAgICBsb2dPcCgnZWxpbWluYXJfdXN1YXJpbycsICd1c2VyJywgZGF0YS5lbWFpbCB8fCB1aWQsIHtcbiAgICAgIHVpZCxcbiAgICAgIHByZXZpb3VzUm9sZTogZGF0YS5yb2xlLFxuICAgICAgcHJldmlvdXNWZW5kb3I6IGRhdGEudmVuZG9yLFxuICAgIH0pO1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5kZWxldGUoKTtcbiAgICBzaG93U3luY1RhZygnVXN1YXJpbyBlbGltaW5hZG8nKTtcbiAgICBhd2FpdCBvcGVuQWRtaW5QYW5lbCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxubGV0IHRvdHBTZXR1cFN0YXRlID0gbnVsbDsgLy8ge3VpZCwgZW1haWwsIHNlY3JldCwgb3RwYXV0aH1cblxud2luZG93Lm9wZW5Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBjb25zb2xlLmxvZygnWzJGQV0gb3BlblRvdHBTZXR1cCBjYWxsZWQnLCB7IHVpZCwgZW1haWwsIHVzZXJSb2xlIH0pO1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcbiAgICBhbGVydCgnU29sbyBlbCBhZG1pbmlzdHJhZG9yIHB1ZWRlIGNvbmZpZ3VyYXIgMkZBIHBhcmEgb3Ryb3MgdXN1YXJpb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdWlkKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBVSUQgZGVsIHVzdWFyaW8gbm8gZGlzcG9uaWJsZS4gUmVjYXJnYSBsYSBwYWdpbmEgeSByZWludGVudGEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcbiAgLy8gTW9kYWwgZXhpc3RlP1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHtcbiAgICBhbGVydCgnRXJyb3I6IG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvIGVuIGVsIERPTS4gUmVjYXJnYSBsYSBwYWdpbmEgKEN0cmwrU2hpZnQrUikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHN1YnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLXN1YnQnKTtcbiAgaWYgKHN1YnRFbCkgc3VidEVsLnRleHRDb250ZW50ID0gJ1BhcmE6ICcgKyAoZW1haWwgfHwgdWlkKTtcbiAgLy8gTGVlciBlc3RhZG8gYWN0dWFsXG4gIGxldCBjdXJFbmFibGVkID0gZmFsc2U7XG4gIGxldCBjdXJTZWNyZXQgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgICBjdXJFbmFibGVkID0gISFkLnRvdHBFbmFibGVkO1xuICAgICAgY3VyU2VjcmV0ID0gZC50b3RwU2VjcmV0IHx8IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUud2FybignWzJGQV0gZG9jIHJvbGVzLycgKyB1aWQgKyAnIG5vIGV4aXN0ZScpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1syRkFdIGVycm9yIGxleWVuZG8gcm9sZXMvJyArIHVpZCwgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gZWwgZXN0YWRvIGRlIDJGQSBkZWwgdXN1YXJpbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xuICBpZiAoIWMpIHtcbiAgICBhbGVydCgnRXJyb3I6IGNvbnRlbmVkb3IgZGVsIG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvLiBSZWNhcmdhIGxhIHBhZ2luYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGN1ckVuYWJsZWQgJiYgY3VyU2VjcmV0KSB7XG4gICAgYy5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNkY2ZjZTc7Ym9yZGVyOjFweCBzb2xpZCAjODZlZmFjO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjojMTY2NTM0O3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAnPGI+JiMxMDAwMzsgMkZBIHlhIGVzdFx1MDBFMSBhY3Rpdm88L2I+IHBhcmEgZXN0ZSB1c3VhcmlvLicgK1xuICAgICAgJzxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4XCI+U2kgbG8gcGVyZGlcdTAwRjMgbyBjYW1iaVx1MDBGMyBkZSBjZWx1bGFyLCBwb2RcdTAwRTlzIGdlbmVyYXJsZSB1bm8gbnVldm8gKGVsIGFudGVyaW9yIHF1ZWRhIGludmFsaWRhZG8pLjwvc3Bhbj4nICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7bWFyZ2luLXRvcDoxNHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICBcIicsJ1wiICtcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcbiAgICAgICdcXCcpXCI+R2VuZXJhciBudWV2byAocmVzZXRlYXIpPC9idXR0b24+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICAnXFwnKVwiPkRlc2hhYmlsaXRhciAyRkE8L2J1dHRvbj4nICtcbiAgICAgICc8L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xuICAgICAgJ0VzdGUgdXN1YXJpbyB0b2Rhdlx1MDBFRGEgbm8gdGllbmUgMkZBIGNvbmZpZ3VyYWRvLiBHZW5lclx1MDBFMSB1biBudWV2byBjXHUwMEYzZGlnbyBwYXJhIHF1ZSBsbyBlc2NhbmVlIGNvbiBHb29nbGUgQXV0aGVudGljYXRvci4nICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgXCInLCdcIiArXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgMkZBPC9idXR0b24+JyArXG4gICAgICAnPC9kaXY+JztcbiAgfVxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VUb3RwU2V0dXBNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcbn07XG5cbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgY29uc3Qgc2VjcmV0ID0gdG90cEdlbmVyYXRlU2VjcmV0KCk7XG4gIGNvbnN0IG90cGF1dGggPSB0b3RwQnVpbGRPdHBhdXRoVXJsKHNlY3JldCwgZW1haWwgfHwgdWlkKTtcbiAgdG90cFNldHVwU3RhdGUgPSB7IHVpZDogdWlkLCBlbWFpbDogZW1haWwsIHNlY3JldDogc2VjcmV0LCBvdHBhdXRoOiBvdHBhdXRoIH07XG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XG4gIGMuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2ZlZjNjNztib3JkZXI6MXB4IHNvbGlkICNmY2QzNGQ7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM3ODM1MGY7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXG4gICAgJzxiPlBhc29zIHBhcmEgYWN0aXZhcjo8L2I+PGJyPicgK1xuICAgICcxLiBFbCB1c3VhcmlvIGluc3RhbGEgPGI+R29vZ2xlIEF1dGhlbnRpY2F0b3I8L2I+IGVuIHN1IGNlbHVsYXIuPGJyPicgK1xuICAgICcyLiBUb2NhIFwiQWdyZWdhclwiIC8gXCIrXCIgZW4gbGEgYXBwLjxicj4nICtcbiAgICAnMy4gRWxpZ2UgXCJFc2NhbmVhciBjXHUwMEYzZGlnbyBRUlwiIHkgZXNjYW5lYSBlbCBjXHUwMEYzZGlnbyBhYmFqbyAobyBwZWdhIGVsIHNlY3JldCBtYW51YWxtZW50ZSkuPGJyPicgK1xuICAgICc0LiBBcGFyZWNlIHVuIGNcdTAwRjNkaWdvIGRlIDYgZFx1MDBFRGdpdG9zIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yLjxicj4nICtcbiAgICAnNS4gTG8gZXNjcmliZSBlbiBlbCBpbnB1dCBkZSBhYmFqbyBwYXJhIGNvbmZpcm1hciB5IGFjdGl2YXIuJyArXG4gICAgJzwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj48ZGl2IGlkPVwidG90cC1xci1jb250YWluZXJcIiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6I2ZmZjtwYWRkaW5nOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCAjZTVlN2ViO2JvcmRlci1yYWRpdXM6NnB4XCI+R2VuZXJhbmRvIFFSLi4uPC9kaXY+PC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2Y4ZmFmYztib3JkZXI6MXB4IHNvbGlkICNlMmU4ZjA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4O3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiM0NzU1Njk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbTo0cHhcIj5TZWNyZXQgKGNhcmdhIG1hbnVhbCBzaSBlbCBRUiBmYWxsYSk8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzViMjFiNjt3b3JkLWJyZWFrOmJyZWFrLWFsbDtsZXR0ZXItc3BhY2luZzouMWVtXCI+JyArXG4gICAgZXNjYXBlSHRtbChzZWNyZXQpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjEwcHhcIj48bGFiZWwgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzQ3NTU2OTtkaXNwbGF5OmJsb2NrO21hcmdpbi1ib3R0b206NXB4XCI+Q1x1MDBGM2RpZ28gZGUgdmVyaWZpY2FjaVx1MDBGM24gZGUgR29vZ2xlIEF1dGhlbnRpY2F0b3I8L2xhYmVsPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInRvdHAtY29uZmlybS1pbnB1dFwiIGlucHV0bW9kZT1cIm51bWVyaWNcIiBtYXhsZW5ndGg9XCI3XCIgcGxhY2Vob2xkZXI9XCIwMDAwMDBcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzoxMHB4IDEycHg7Ym9yZGVyOjEuNXB4IHNvbGlkICNjYmQ1ZTE7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7bGV0dGVyLXNwYWNpbmc6LjNlbTtmb250LXdlaWdodDo4MDBcIi8+PC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImNvbmZpcm1Ub3RwU2V0dXAoKVwiPlZlcmlmaWNhciB5IGFjdGl2YXI8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJjbG9zZVRvdHBTZXR1cE1vZGFsKClcIj5DYW5jZWxhcjwvYnV0dG9uPjwvZGl2Pic7XG4gIC8vIExhenktbG9hZCBxcmNvZGVqcyB5IGdlbmVyYXIuIEVzdGEgbGlicmVyaWEgcGludGEgZWwgUVIgZGlyZWN0byBlbiBlbFxuICAvLyBjb250ZW5lZG9yIERPTSB2aWEgY2FudmFzL2ltZyAtIG5vIG5lY2VzaXRhIGNhbGxiYWNrIHRvRGF0YVVSTC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkUVJDb2RlTGliKCk7XG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XG4gICAgaWYgKCFib3gpIHJldHVybjtcbiAgICBib3guaW5uZXJIVE1MID0gJyc7IC8vIGxpbXBpYXIgZWwgXCJHZW5lcmFuZG8gUVIuLi5cIlxuICAgIG5ldyBRUkNvZGUoYm94LCB7XG4gICAgICB0ZXh0OiBvdHBhdXRoLFxuICAgICAgd2lkdGg6IDIyMCxcbiAgICAgIGhlaWdodDogMjIwLFxuICAgICAgY29sb3JEYXJrOiAnIzAwMDAwMCcsXG4gICAgICBjb2xvckxpZ2h0OiAnI2ZmZmZmZicsXG4gICAgICBjb3JyZWN0TGV2ZWw6IFFSQ29kZS5Db3JyZWN0TGV2ZWwuTSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignWzJGQV0gRXJyb3IgY2FyZ2FuZG8gUVIgbGliOicsIGUpO1xuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xuICAgIGlmIChib3gpXG4gICAgICBib3guaW5uZXJIVE1MID1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTkxYjFiO3BhZGRpbmc6MTRweFwiPk5vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlclx1MDBFRGEgUVIuIFVzYSBlbCBzZWNyZXQgbWFudWFsIHBhcmEgY29uZmlndXJhci48L2Rpdj4nO1xuICB9XG59O1xuXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0b3RwU2V0dXBTdGF0ZSkgcmV0dXJuO1xuICBjb25zdCBjb2RlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLWNvbmZpcm0taW5wdXQnKS52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxzKy9nLCAnJyk7XG4gIGlmICghL15cXGR7Nn0kLy50ZXN0KGNvZGUpKSB7XG4gICAgYWxlcnQoJ0luZ3Jlc1x1MDBFMSBsb3MgNiBkXHUwMEVEZ2l0b3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG9rID0gYXdhaXQgdG90cFZlcmlmeUNvZGUodG90cFNldHVwU3RhdGUuc2VjcmV0LCBjb2RlLCAxKTtcbiAgaWYgKCFvaykge1xuICAgIGFsZXJ0KFxuICAgICAgJ0NcdTAwRjNkaWdvIGluY29ycmVjdG8uIEFzZWd1cmF0ZSBkZSBxdWUgZWwgc2VjcmV0IHNlIGNhcmdcdTAwRjMgYmllbiBlbiBHb29nbGUgQXV0aGVudGljYXRvciB5IHJlaW50ZW50XHUwMEUxLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHRvdHBTZXR1cFN0YXRlLnVpZClcbiAgICAgIC51cGRhdGUoe1xuICAgICAgICB0b3RwU2VjcmV0OiB0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsXG4gICAgICAgIHRvdHBFbmFibGVkOiB0cnVlLFxuICAgICAgICB0b3RwRW5hYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgdG90cEVuYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICB9KTtcbiAgICBzaG93U3luY1RhZygnMkZBIGFjdGl2YWRvIHBhcmEgJyArICh0b3RwU2V0dXBTdGF0ZS5lbWFpbCB8fCAndXN1YXJpbycpKTtcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5kaXNhYmxlVG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICghY29uZmlybSgnRGVzaGFiaWxpdGFyIDJGQSBwYXJhIGVzdGUgdXN1YXJpbz8gVmEgYSBlbnRyYXIgc29sbyBjb24gcGFzc3dvcmQuJykpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh1aWQpXG4gICAgICAudXBkYXRlKHtcbiAgICAgICAgdG90cEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICB0b3RwU2VjcmV0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5kZWxldGUoKSxcbiAgICAgICAgdG90cERpc2FibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICB0b3RwRGlzYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICB9KTtcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmNoYW5nZVVzZXJQYXNzd29yZCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAoIWVtYWlsKSB7XG4gICAgYWxlcnQoJ0VzdGUgdXN1YXJpbyBubyB0aWVuZSBlbWFpbCByZWdpc3RyYWRvIC0gbm8gc2UgcHVlZGUgcmVzZXRlYXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGNob2ljZSA9IHByb21wdChcbiAgICAnUmVzZXRlYXIgY29udHJhc2VcdTAwRjFhIGRlICcgK1xuICAgICAgZW1haWwgK1xuICAgICAgJ1xcblxcbicgK1xuICAgICAgJ0VsZWdpIHVuYSBvcGNpb24gKDEgLyAyKTpcXG5cXG4nICtcbiAgICAgICcxKSBFTlZJQVIgTUFJTCBERSBSRVNFVEVPIChyZWNvbWVuZGFkbylcXG4nICtcbiAgICAgICcgICBMZSBsbGVnYSBhICcgK1xuICAgICAgZW1haWwgK1xuICAgICAgJyB1biBtYWlsIGRlIEZpcmViYXNlIGNvbiB1biBsaW5rLlxcbicgK1xuICAgICAgJyAgIEVsIHVzdWFyaW8gY2xpY2tlYSwgc2V0ZWEgc3UgbnVldmEgcGFzc3dvcmQgeSB2dWVsdmUgYSBsYSBhcHAuXFxuJyArXG4gICAgICAnICAgRXMgbG8gZXN0YW5kYXIgeSBmdW5jaW9uYSBzZWd1cm8uXFxuXFxuJyArXG4gICAgICAnMikgUmVzZXRlYXIgU09MTyBlbCBwYXNzd29yZC1nYXRlIChzZWd1bmRhIGNhcGEpLlxcbicgK1xuICAgICAgJyAgIE5vIGNhbWJpYSBsYSBwYXNzd29yZCByZWFsIGRlIEZpcmViYXNlLiBTaXJ2ZSBzaSBlbCB1c3VhcmlvXFxuJyArXG4gICAgICAnICAgZW50cmEgcG9yIEdvb2dsZSB5IG9sdmlkbyBsYSBwYXNzd29yZC1nYXRlIGRlIGxhIGFwcCwgTk8gc2lcXG4nICtcbiAgICAgICcgICBvbHZpZG8gbGEgcGFzc3dvcmQgZGVsIGxvZ2luIGNvbiBlbWFpbC5cXG5cXG4nICtcbiAgICAgICdFc2NyaWJpIDEgbyAyOicsXG4gICAgJzEnXG4gICk7XG4gIGlmIChjaG9pY2UgPT09IG51bGwpIHJldHVybjtcbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcxJykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmYkF1dGguc2VuZFBhc3N3b3JkUmVzZXRFbWFpbChlbWFpbCk7XG4gICAgICBhbGVydChcbiAgICAgICAgJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArXG4gICAgICAgICAgZW1haWwgK1xuICAgICAgICAgICcuIERlY2lsZSBxdWUgcmV2aXNlIGluYm94IHkgc3BhbS4gRWwgbGluayBleHBpcmEgZW4gMSBob3JhLidcbiAgICAgICk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmYkRiXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgICAgICAuZG9jKHVpZClcbiAgICAgICAgICAudXBkYXRlKHtcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdmaXJlYmFzZV9lbWFpbCcsXG4gICAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XG4gICAgICBhbGVydCgnRXJyb3IgZW52aWFuZG8gZWwgbWFpbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcyJykge1xuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdChcbiAgICAgICdOdWV2YSBwYXNzd29yZC1nYXRlIHBhcmEgJyArXG4gICAgICAgIGVtYWlsICtcbiAgICAgICAgJzpcXG5cXG4oU29sbyBhZmVjdGEgbGEgc2VndW5kYSBjYXBhIGRlIGxhIGFwcCwgTk8gZWwgbG9naW4gY29uIGVtYWlsKScsXG4gICAgICAnJ1xuICAgICk7XG4gICAgaWYgKG5ld1B3ZCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IHB3ZCA9IChuZXdQd2QgfHwgJycpLnRyaW0oKTtcbiAgICBpZiAocHdkLmxlbmd0aCA8IDQpIHtcbiAgICAgIGFsZXJ0KCdMYSBjb250cmFzZVx1MDBGMWEgdGllbmUgcXVlIHRlbmVyIGFsIG1lbm9zIDQgY2FyYWN0ZXJlcy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNyZWRzID0gYXdhaXQgYnVpbGRQYXNzd29yZENyZWRlbnRpYWxzKHB3ZCk7XG4gICAgICBhd2FpdCBmYkRiXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAgIC5kb2ModWlkKVxuICAgICAgICAudXBkYXRlKHtcbiAgICAgICAgICBwYXNzd29yZEhhc2g6IGNyZWRzLnBhc3N3b3JkSGFzaCxcbiAgICAgICAgICBwYXNzd29yZFNhbHQ6IGNyZWRzLnBhc3N3b3JkU2FsdCxcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdnYXRlX29ubHknLFxuICAgICAgICB9KTtcbiAgICAgIHNob3dTeW5jVGFnKCdQYXNzd29yZC1nYXRlIGFjdHVhbGl6YWRhIHBhcmEgJyArIGVtYWlsKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdjaGFuZ2VVc2VyUGFzc3dvcmQgZ2F0ZScsIGUpO1xuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgYWxlcnQoJ09wY2lvbiBubyB2YWxpZGEuIENhbmNlbGFkby4nKTtcbn07XG5cbndpbmRvdy5zYXZlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBidG4pIHtcbiAgY29uc3QgY29udGFpbmVyID0gYnRuLmNsb3Nlc3QoJ3RyJykgfHwgYnRuLmNsb3Nlc3QoJy51c2Vycy1jYXJkJyk7XG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJvbGUtc2VsJykudmFsdWU7XG4gIGNvbnN0IHZlbmRvciA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcudmVuZG9yLXNlbCcpLnZhbHVlIHx8IG51bGw7XG4gIGNvbnN0IGludGVybmFsU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5pbnRlcm5hbC1zZWwnKTtcbiAgY29uc3QgaW50ZXJuYWxQYXJ0bmVyVWlkID0gaW50ZXJuYWxTZWwgPyBpbnRlcm5hbFNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcbiAgLy8gV2hhdHNBcHA6IGxpbXBpYXIgdG9kbyBsbyBxdWUgbm8gc2VhIGRpZ2l0byAoYWNlcHRhICssIGVzcGFjaW9zLCBwYXJcdTAwRTludGVzaXMsIGV0Yy4pXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XG4gIGNvbnN0IHdoYXRzYXBwID0gd2FJbnB1dCA/ICh3YUlucHV0LnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXEQvZywgJycpIDogJyc7XG4gIGlmICh3aGF0c2FwcCAmJiB3aGF0c2FwcC5sZW5ndGggPCA4KSB7XG4gICAgYWxlcnQoXG4gICAgICAnRWwgbnVtZXJvIGRlIFdoYXRzQXBwIGVzIG11eSBjb3J0by4gVGllbmUgcXVlIHNlciBlbCBudW1lcm8gY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChlai4gNTQ5MTEyNjc2MjAzMSBwYXJhIEFyZ2VudGluYSkuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzICh1aWQgZGVsIHVzdWFyaW8gcXVlIGFwcnVlYmEpXG4gIGNvbnN0IHJlbmRBcHByb3ZlclNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucmVuZC1hcHByb3Zlci1zZWwnKTtcbiAgY29uc3QgcmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRBcHByb3ZlclNlbCA/IHJlbmRBcHByb3ZlclNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcbiAgLy8gQ2FjaGVhciB0YW1iaWVuIGVsIGVtYWlsIGRlbCBhcHJvYmFkb3IgZW4gZWwgZG9jIGRlbCB2ZW5kZWRvcjogbG9zXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcbiAgLy8gbmVjZXNpdGFuIGVsIGVtYWlsIGFjYSBwYXJhIHBvZGVyIG1hbmRhciBsYSByZW5kaWNpb24gKHJlc29sdmVNeVJlbmRpY2lvbmVzQXBwcm92ZXJcbiAgLy8gbG8gdXNhIGNvbW8gcHJpbWVyIGZhc3QtcGF0aCkuIFNpbiBlc3RvIGVsIGZsdWpvIGRlcGVuZGlhIGRlbCBkaXJlY3RvcmlvXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cbiAgbGV0IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IG51bGw7XG4gIGlmIChyZW5kaWNpb25lc0FwcHJvdmVyVWlkKSB7XG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCk7XG4gICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gYXBwcm92ZXJVc2VyID8gYXBwcm92ZXJVc2VyLmVtYWlsIHx8IG51bGwgOiBudWxsO1xuICB9XG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gIGJ0bi50ZXh0Q29udGVudCA9ICcuLi4nO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHVpZClcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIHZlbmRvcixcbiAgICAgICAgICBpbnRlcm5hbFBhcnRuZXJVaWQsXG4gICAgICAgICAgd2hhdHNhcHA6IHdoYXRzYXBwIHx8IG51bGwsXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogcmVuZGljaW9uZXNBcHByb3ZlclVpZCxcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCxcbiAgICAgICAgICBhc3NpZ25lZEJ5OiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgYXNzaWduZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICAvLyBTaSBlbCB1c3VhcmlvIGVkaXRvIHN1IHByb3BpbyBudW1lcm8sIGFjdHVhbGl6YXIgZWwgY2FjaGUgbG9jYWxcbiAgICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcbiAgICAgIG15V2hhdHNhcHBOdW1iZXIgPSB3aGF0c2FwcCB8fCBudWxsO1xuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCBudWxsO1xuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgfHwgbnVsbDtcbiAgICB9XG4gICAgYnRuLnRleHRDb250ZW50ID0gJ09LJztcbiAgICAvLyBSZS1yZW5kZXIgZGVsIHBhbmVsIGFzaSBsb3MgZHJvcGRvd25zIFwiUGFyZWphIGludGVybm9cIiBtdWVzdHJhbiBsb3MgaW50ZXJub3MgYWN0dWFsaXphZG9zXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdyZWZyZXNoIGFkbWluIHBhbmVsJywgZSk7XG4gICAgICB9XG4gICAgfSwgNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVVc2VyUm9sZScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhcic7XG4gIH1cbn07XG5cbi8vIFRvZG9zIGxvcyBoYW5kbGVycyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgc29uIHZlcmJhdGltLlxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBdUJBLE1BQUksT0FBTyxPQUFPLGVBQWUsWUFBYSxRQUFPLGFBQWEsQ0FBQztBQUNuRSxNQUFNLGFBQWEsT0FBTztBQUUxQixXQUFTLDJCQUEyQixhQUFhO0FBQy9DLFVBQU0sS0FBSyxTQUFTLGVBQWUsd0JBQXdCO0FBQzNELFFBQUksQ0FBQyxHQUFJO0FBQ1QsbUJBQWUsZUFBZSxDQUFDLEdBQzVCLE1BQU0sRUFDTixLQUFLLENBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxJQUFJLGNBQWMsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUM5RCxRQUFJLE9BQU87QUFDWCxZQUFRO0FBQ1IsWUFDRTtBQUNGLFlBQVE7QUFDUixRQUFJLENBQUMsWUFBWSxRQUFRO0FBQ3ZCLGNBQ0U7QUFBQSxJQUNKLE9BQU87QUFDTCxjQUNFO0FBQ0Ysa0JBQVksUUFBUSxDQUFDLE9BQU87QUFDMUIsY0FBTSxRQUFRLFdBQVcsR0FBRyxTQUFTLEdBQUcsR0FBRztBQUMzQyxjQUFNLE9BQU8sR0FBRyxPQUFPLGVBQWUsV0FBVyxHQUFHLElBQUksSUFBSTtBQUM1RCxnQkFDRSxtTUFDQSxRQUNBLE9BQ0EsMENBQ0EsV0FBVyxHQUFHLEdBQUcsSUFDakI7QUFBQSxNQUVKLENBQUM7QUFDRCxjQUFRO0FBQUEsSUFDVjtBQUNBLFlBQ0U7QUFDRixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUVBLFNBQU8sa0JBQWtCLGlCQUFrQjtBQUN6QyxRQUFJLGFBQWEsUUFBUztBQUMxQixVQUFNLE1BQU0sT0FBTyx1REFBdUQ7QUFDMUUsUUFBSSxDQUFDLElBQUs7QUFDVixVQUFNLFFBQVEsSUFBSSxZQUFZLEVBQUUsS0FBSztBQUNyQyxRQUFJLENBQUMsNkJB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
