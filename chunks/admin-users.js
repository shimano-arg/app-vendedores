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
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Si un vendedor usa Gmail personal (no @shimano.com.ar), agregalo aca antes que intente loguear. Los emails @shimano.com.ar y los admins hardcoded ya estan autorizados automaticamente.</div>';
    html += "</div>";
    if (!allowedList.length) {
      html += '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0 10px">No hay emails pre-autorizados todavia.</div>';
    } else {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:10px">';
      allowedList.forEach((ae) => {
        const label = escapeHtml(ae.email || ae._id);
        const note = ae.note ? " &middot; " + escapeHtml(ae.note) : "";
        html += '<div style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-elevated);border:1px solid #bfdbfe;border-radius:14px;padding:3px 4px 3px 10px;font-size:11px;color:#1e40af;font-weight:600">' + label + note + `<button onclick="removeAllowedEmail('` + escapeAttr(ae._id) + `')" title="Quitar autorizacion" style="background:var(--color-danger);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1">&times;</button></div>`;
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
    el.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:14px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px";
    const title = document.createElement("div");
    title.style.cssText = "font-size:12px;font-weight:800;color:var(--color-accent-violet);margin-bottom:6px";
    title.textContent = "Gemini API Key (OCR de tickets)";
    const msg = document.createElement("div");
    msg.style.cssText = "font-size:11px;color:var(--text-muted)";
    msg.textContent = "Guardado por seguridad en Google Secret Manager";
    wrap.appendChild(title);
    wrap.appendChild(msg);
    el.appendChild(wrap);
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
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Convierte direcciones a coordenadas con mucha mejor precisi\xF3n que OSM (sobre todo en localidades chicas). Costo gratis hasta 40.000 requests/mes.</div>';
    html += "</div>";
    if (hasKey) {
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;justify-content:center">';
      html += '<span style="font-family:Consolas,monospace;font-size:11px;background:var(--bg-elevated);border:1px solid #6ee7b7;border-radius:4px;padding:4px 8px;color:#065f46">' + escapeHtml(masked) + "</span>";
      html += '<span style="font-size:10px;color:var(--text-muted)">Cargada por ' + escapeHtml(updatedBy || "admin") + (updatedAt ? " (" + escapeHtml(updatedAt) + ")" : "") + "</span>";
      html += "</div>";
    } else {
      html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;text-align:center">Sin API key. Geocoding usa OpenStreetMap (gratis pero peor cobertura en AR rural).</div>';
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
      if (typeof window._invalidateGmapsKeyCache === "function") {
        try {
          window._invalidateGmapsKeyCache();
        } catch (_e) {
        }
      }
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
      if (typeof window._invalidateGmapsKeyCache === "function") {
        try {
          window._invalidateGmapsKeyCache();
        } catch (_e) {
        }
      }
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
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Aplica el mismo responsable a TODOS los vendedores de un solo click. Util cuando un gerente comercial centraliza la aprobacion.</div>';
    html += "</div>";
    if (!candidates.length) {
      html += '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0">No hay usuarios con rol admin / gerente / interno. Primero asigna un rol a alguien.</div>';
      el.innerHTML = html;
      return;
    }
    if (!vendedores.length) {
      html += '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0">No hay usuarios con rol vendedor todavia.</div>';
      el.innerHTML = html;
      return;
    }
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">';
    html += '<select id="bulk-approver-select" style="padding:8px 10px;border:1.5px solid #f0abfc;border-radius:6px;font-size:12px;background:var(--bg-elevated);font-family:inherit;flex:1;max-width:340px">';
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
        tableHtml = '<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</td></tr>';
        cardsHtml = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:18px">No hay usuarios todavia. Esperan que ingresen con Google.</div>';
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
                return escapeHtml(label) + ' <span style="color:var(--text-muted)">(' + escapeHtml(u.email || "") + ")</span>";
              }).join("<br>");
              parejaCell = '<div style="font-size:10px;color:var(--text-primary);line-height:1.5"><div style="font-size:9px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Vendedores externos vinculados (auto)</div>' + list + "</div>";
            } else {
              parejaCell = '<div style="font-size:10px;color:var(--text-muted);font-style:italic">Aun ningun vendedor lo tiene como pareja</div>';
            }
            parejaCell += '<input type="hidden" class="internal-sel" value=""/>';
          } else {
            const internoOptsForRow = '<option value="">- Sin pareja -</option>' + internos.map(
              (u) => '<option value="' + u._uid + '"' + (d.internalPartnerUid === u._uid ? " selected" : "") + ">" + escapeHtml(u.email || u.displayName || u._uid) + "</option>"
            ).join("");
            parejaCell = '<select class="internal-sel" title="Pareja interno (solo aplica si el rol es vendedor)">' + internoOptsForRow + "</select>";
          }
          const youTag = isSelf ? ' <span style="color:var(--color-accent-violet);font-size:9px;font-weight:800">(VOS)</span>' : "";
          const protectedTag = isProtected && !isSelf ? ' <span style="color:var(--color-accent-violet);font-size:9px;font-weight:800" title="Admin protegido - no se puede eliminar">PROTEGIDO</span>' : "";
          const waVal = d.whatsapp || "";
          const waInputHtml = '<input type="tel" class="wa-input" placeholder="ej. 5491126762031" value="' + escapeAttr(waVal) + '" style="width:100%;padding:5px 7px;border:1.5px solid var(--border-default);border-radius:4px;font-size:11px;font-family:inherit;outline:none;background:var(--bg-elevated)" title="Numero WhatsApp completo con codigo de pais (sin + ni espacios). Se usa al enviar la ruta."/>';
          const curApproverUid = d.rendicionesApproverUid || "";
          let rendApproverOptions = '<option value="">- Sin asignar -</option>';
          rendApproversCandidates.forEach((u) => {
            if (u._uid === docId) return;
            const lbl = (u.displayName || u.email || u._uid) + " (" + (u.role || "") + ")";
            rendApproverOptions += '<option value="' + escapeAttr(u._uid) + '"' + (curApproverUid === u._uid ? " selected" : "") + ">" + escapeHtml(lbl) + "</option>";
          });
          const rendApproverHtml = '<select class="rend-approver-sel" title="Quien aprueba las rendiciones de este usuario">' + rendApproverOptions + "</select>";
          const pwdBtnHtml = `<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px" onclick="changeUserPassword('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">Contrase\xF1a</button>';
          const totpStatusTag = d.totpEnabled ? ' <span style="color:#10b981;font-weight:800">&#10003;</span>' : "";
          const totpBtnHtml = '<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px;background:' + (d.totpEnabled ? "#10b981" : "#5b21b6") + `" onclick="openTotpSetup('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">2FA' + totpStatusTag + "</button>";
          tableHtml += '<tr data-uid="' + docId + '">';
          tableHtml += "<td>" + escapeHtml(d.email || "") + youTag + protectedTag + "</td>";
          tableHtml += "<td>" + escapeHtml(d.displayName || "") + "</td>";
          tableHtml += '<td><select class="role-sel">' + roleOptions + "</select></td>";
          tableHtml += '<td><select class="vendor-sel">' + vendorOptions + "</select></td>";
          tableHtml += "<td>" + parejaCell + "</td>";
          tableHtml += '<td class="wa-col">' + waInputHtml + "</td>";
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
        thead.innerHTML = '<th>Email</th><th>Nombre</th><th>Rol</th><th>Vendedor</th><th>Pareja interno</th><th class="wa-col">WhatsApp</th><th>Resp. rendiciones</th><th>Pass</th><th>2FA</th><th></th>';
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
      c.innerHTML = `<div style="background:var(--color-success-bg);border:1px solid #86efac;border-radius:6px;padding:12px;font-size:12px;color:var(--color-success);text-align:center"><b>&#10003; 2FA ya est\xE1 activo</b> para este usuario.<br><span style="font-size:11px">Si lo perdi\xF3 o cambi\xF3 de celular, pod\xE9s generarle uno nuevo (el anterior queda invalidado).</span></div><div style="display:flex;gap:8px;margin-top:14px;justify-content:center;flex-wrap:wrap"><button class="app-btn-pill app-btn-violet" onclick="generateNewTotp('` + escapeAttr(uid) + "','" + escapeAttr(email || "") + `')">Generar nuevo (resetear)</button><button class="app-btn-pill app-btn-red" onclick="disableTotp('` + escapeAttr(uid) + `')">Deshabilitar 2FA</button></div>`;
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
    c.innerHTML = '<div style="background:var(--color-warning-bg);border:1px solid #fcd34d;border-radius:6px;padding:12px;font-size:11px;color:#78350f;margin-bottom:14px"><b>Pasos para activar:</b><br>1. El usuario instala <b>Google Authenticator</b> en su celular.<br>2. Toca "Agregar" / "+" en la app.<br>3. Elige "Escanear c\xF3digo QR" y escanea el c\xF3digo abajo (o pega el secret manualmente).<br>4. Aparece un c\xF3digo de 6 d\xEDgitos en Google Authenticator.<br>5. Lo escribe en el input de abajo para confirmar y activar.</div>';
    c.innerHTML += '<div style="text-align:center;margin-bottom:14px"><div id="totp-qr-container" style="display:inline-block;background:var(--bg-elevated);padding:10px;border:1px solid var(--border-subtle);border-radius:6px">Generando QR...</div></div>';
    c.innerHTML += '<div style="background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:6px;padding:10px;text-align:center;margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Secret (carga manual si el QR falla)</div><div style="font-family:Consolas,monospace;font-size:13px;font-weight:800;color:var(--color-accent-violet);word-break:break-all;letter-spacing:.1em">' + escapeHtml(secret) + "</div></div>";
    c.innerHTML += '<div style="margin-bottom:10px"><label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:5px">C\xF3digo de verificaci\xF3n de Google Authenticator</label><input type="text" id="totp-confirm-input" inputmode="numeric" maxlength="7" placeholder="000000" style="width:100%;padding:10px 12px;border:1.5px solid var(--border-default);border-radius:5px;font-size:18px;text-align:center;letter-spacing:.3em;font-weight:800"/></div>';
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
        box.innerHTML = '<div style="font-size:11px;color:var(--color-danger-strong);padding:14px">No se pudo cargar la librer\xEDa QR. Usa el secret manual para configurar.</div>';
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
      "Resetear contrase\xF1a de " + email + "\n\nElegi una opcion (1 / 2):\n\n1) ENVIAR MAIL DE RESETEO (recomendado)\n Le llega a " + email + " un mail de Firebase con un link.\n El usuario clickea, setea su nueva password y vuelve a la app.\n Es lo estandar y funciona seguro.\n\n2) Resetear SOLO el password-gate (segunda capa).\n No cambia la password real de Firebase. Sirve si el usuario\n entra por Google y olvido la password-gate de la app, NO si\n olvido la password del login con email.\n\nEscribi 1 o 2:",
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNpIHVuIHZlbmRlZG9yIHVzYSBHbWFpbCBwZXJzb25hbCAobm8gQHNoaW1hbm8uY29tLmFyKSwgYWdyZWdhbG8gYWNhIGFudGVzIHF1ZSBpbnRlbnRlIGxvZ3VlYXIuIExvcyBlbWFpbHMgQHNoaW1hbm8uY29tLmFyIHkgbG9zIGFkbWlucyBoYXJkY29kZWQgeWEgZXN0YW4gYXV0b3JpemFkb3MgYXV0b21hdGljYW1lbnRlLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmICghYWxsb3dlZExpc3QubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gICAgYWxsb3dlZExpc3QuZm9yRWFjaCgoYWUpID0+IHtcbiAgICAgIGNvbnN0IGxhYmVsID0gZXNjYXBlSHRtbChhZS5lbWFpbCB8fCBhZS5faWQpO1xuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBsYWJlbCArXG4gICAgICAgIG5vdGUgK1xuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVtb3ZlQWxsb3dlZEVtYWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiUXVpdGFyIGF1dG9yaXphY2lvblwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXIpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo1MCU7d2lkdGg6MThweDtoZWlnaHQ6MThweDtmb250LXNpemU6MTFweDtjdXJzb3I6cG9pbnRlcjtsaW5lLWhlaWdodDoxXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xuICAgICAgICAnPC9kaXY+JztcbiAgICB9KTtcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWJsdWVcIiBvbmNsaWNrPVwiYWRkQWxsb3dlZEVtYWlsKClcIj4mIzQzOyBBZ3JlZ2FyIGVtYWlsPC9idXR0b24+PC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cblxud2luZG93LmFkZEFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHJhdyA9IHByb21wdCgnRW1haWwgYSBhdXRvcml6YXIgKGVqLiBhdXRvbWF0cml4Lm9maWNpYWxAZ21haWwuY29tKTonKTtcbiAgaWYgKCFyYXcpIHJldHVybjtcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIGlmICghL15bXlxcc0BdK0BbXlxcc0BdK1xcLlteXFxzQF0rJC8udGVzdChlbWFpbCkpIHtcbiAgICBhbGVydCgnRWwgZW1haWwgbm8gcGFyZWNlIHZhbGlkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgbm90ZSA9XG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XG4gIGNvbnN0IGRvY0lkID0gZW1haWxUb0RvY0lkKGVtYWlsKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKVxuICAgICAgLmRvYyhkb2NJZClcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBlbWFpbCxcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcbiAgICAgICAgICBhZGRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBzaG93U3luY1RhZygnRW1haWwgYXV0b3JpemFkbzogJyArIGVtYWlsKTtcbiAgICAvLyBSZWNhcmdhciBwYW5lbFxuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignYWRkQWxsb3dlZEVtYWlsJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdRdWl0YXIgbGEgYXV0b3JpemFjaW9uIGRlIGVzdGUgZW1haWw/IFNpIGVsIHVzdWFyaW8geWEgdGllbmUgcm9sIGFzaWduYWRvIGVuIGVsIHBhbmVsLCB2YSBhIHNlZ3VpciBlbnRyYW5kbyAobGEgcmVnbGEgcHJlLWFwcm9iYWRhIHBvciByb2wgdGFtYmllbiBhcGxpY2EpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XG4gICAgc2hvd1N5bmNUYWcoJ0F1dG9yaXphY2lvbiBxdWl0YWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09IFNlY2Npb24gR2VtaW5pIEFQSSBLZXkgKGFkbWluKSA9PT1cbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ2VtaW5pLWNvbmZpZy1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXG4gIC8vIHY2MzkgKDIwMjYtMDgtMjYpOiBVWCBzaW1wbGlmaWNhZG8gcG9yIHBlZGlkbyBNYXJpYW5vIFx1MjAxNCBzaW4gaW5zdHJ1Y2Npb25lc1xuICAvLyBDTEkgZW4gZWwgcGFuZWwsIHNvbG8gdW4gYmFubmVyIGV4cGxpY2FuZG8gZG9uZGUgdml2ZSBsYSBrZXkuXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cbiAgZWwudGV4dENvbnRlbnQgPSAnJztcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxuICAgICd0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE0cHggMTJweDtiYWNrZ3JvdW5kOiNmNWYzZmY7Ym9yZGVyOjFweCBzb2xpZCAjZGRkNmZlO2JvcmRlci1yYWRpdXM6NnB4JztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTttYXJnaW4tYm90dG9tOjZweCc7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0dlbWluaSBBUEkgS2V5IChPQ1IgZGUgdGlja2V0cyknO1xuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbXNnLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xuICAvLyBJY29ubyBjYW5kYWRvICsgdGV4dG8uIHRleHRDb250ZW50IGVzIHNhZmUgKG5vIEhUTUwgcGFyc2luZykuXG4gIG1zZy50ZXh0Q29udGVudCA9ICdHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XG4gIHdyYXAuYXBwZW5kQ2hpbGQodGl0bGUpO1xuICB3cmFwLmFwcGVuZENoaWxkKG1zZyk7XG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXG4vLyBlbiBTZWNyZXQgTWFuYWdlciwgbm8gZW4gRmlyZXN0b3JlLiBTZSBhZG1pbmlzdHJhIHBvciBDTEkuIFZlclxuLy8gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbiBwYXJhIGxhcyBpbnN0cnVjY2lvbmVzLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdPT0dMRSBNQVBTIEdlb2NvZGluZyBBUEkgLSBtZWpvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwgcXVlIE9TTVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMYSBrZXkgc2UgZ3VhcmRhIGVuIGFwcF9jb25maWcvZ29vZ2xlX21hcHMuIFNpIGVzdGEgc2V0ZWFkYSwgbGEgdXNhbW9zXG4vLyBjb21vIGdlb2NvZGVyIFBSSU1BUklPIGVuIGdlb2NvZGVDbGllbnRBZGRyZXNzOyBzaSBmYWxsYSBvIG5vIGVzdGFcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxubGV0IGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuYXN5bmMgZnVuY3Rpb24gZ2V0R21hcHNBcGlLZXkoKSB7XG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xuICAgIGlmIChzbmFwLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKGQuYXBpS2V5KSB7XG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcbiAgICAgICAgcmV0dXJuIGQuYXBpS2V5O1xuICAgICAgfVxuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBubyBzZSBwdWRvIGxlZXIgYXBpIGtleScsIGUpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ21hcHMtY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xuICBjb25zdCBtYXNrZWQgPSBoYXNLZXkgPyBkYXRhLmFwaUtleS5zbGljZSgwLCA0KSArICdcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjInICsgZGF0YS5hcGlLZXkuc2xpY2UoLTQpIDogJyc7XG4gIGNvbnN0IHVwZGF0ZWRCeSA9IChkYXRhICYmIGRhdGEudXBkYXRlZEJ5KSB8fCAnJztcbiAgY29uc3QgdXBkYXRlZEF0ID1cbiAgICBkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZVxuICAgICAgPyBkYXRhLnVwZGF0ZWRBdC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxuICAgICAgOiAnJztcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKGhhc0tleSkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjNmVlN2I3O2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjb2xvcjojMDY1ZjQ2XCI+JyArXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xuICAgICAgJzwvc3Bhbj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Q2FyZ2FkYSBwb3IgJyArXG4gICAgICBlc2NhcGVIdG1sKHVwZGF0ZWRCeSB8fCAnYWRtaW4nKSArXG4gICAgICAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcbiAgICAnPC9idXR0b24+JztcbiAgaWYgKGhhc0tleSlcbiAgICBodG1sICs9XG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCByYXcgPSBwcm9tcHQoXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXG4gICAgJydcbiAgKTtcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xuICBpZiAoIWtleSkge1xuICAgIGFsZXJ0KCdWYWNpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBhcGlLZXk6IGtleSxcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xuICAgIC8vIHY5MjQ6IGludmFsaWRhciBlbCBjYWNoZSBpbmxpbmUgZGVsIHNoZWxsIChlbCBnZW9jb2RpbmcgcmVhbCB2aXZlIGFsbGkpLlxuICAgIGlmICh0eXBlb2Ygd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuICAgIC8vIHY5MjQ6IGlkZW0gc2F2ZSBcdTIwMTQgaW52YWxpZGFyIGNhY2hlIGlubGluZS5cbiAgICBpZiAodHlwZW9mIHdpbmRvdy5faW52YWxpZGF0ZUdtYXBzS2V5Q2FjaGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHdpbmRvdy5faW52YWxpZGF0ZUdtYXBzS2V5Q2FjaGUoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBzaG93U3luY1RhZygnR29vZ2xlIE1hcHMgQVBJIGtleSBib3JyYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVHbWFwc0FwaUtleScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEJVTEsgQVBQUk9WRVIgLSBhc2lnbmFyIGVsIG1pc21vIFwiUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXNcIlxuLy8gYSB0b2RvcyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVdGlsIGN1YW5kbyB1biBzb2xvIGFwcm9iYWRvciAoZWouIFBhYmxvIGdlcmVudGUpIHJldmlzYSBsYXNcbi8vIHJlbmRpY2lvbmVzIGRlIFRPRE9TIGxvcyB2ZW5kZWRvcmVzLiBTaW4gZXN0byBlbCBhZG1pbiB0aWVuZSBxdWVcbi8vIGFicmlyIGNhZGEgZmlsYSBkZWwgcGFuZWwgVXN1YXJpb3MgeSBzZXRlYXIgZWwgZHJvcGRvd24gdW5hIGEgdW5hLlxuZnVuY3Rpb24gcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgY29uc3QgY2FuZGlkYXRlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoXG4gICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xuICApO1xuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojYTIxY2FmXCI+QXByb2JhZG9yIGRlIFJlbmRpY2lvbmVzIC0gYXNpZ25hY2lvbiBtYXNpdmE8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoIWNhbmRpZGF0ZXMubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgYWRtaW4gLyBnZXJlbnRlIC8gaW50ZXJuby4gUHJpbWVybyBhc2lnbmEgdW4gcm9sIGEgYWxndWllbi48L2Rpdj4nO1xuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCB2ZW5kZWRvciB0b2RhdmlhLjwvZGl2Pic7XG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbiAgICByZXR1cm47XG4gIH1cbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xuICBodG1sICs9XG4gICAgJzxzZWxlY3QgaWQ9XCJidWxrLWFwcHJvdmVyLXNlbGVjdFwiIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtib3JkZXI6MS41cHggc29saWQgI2YwYWJmYztib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xuICBjYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcbiAgfSk7XG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJidWxrQXNzaWduQXBwcm92ZXIoKVwiPkFzaWduYXIgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyAoJyArXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xuICAgICcpPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcbiAgaWYgKCFhcHByb3Zlcikge1xuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZlbmRlZG9yZXMgcGFyYSBhc2lnbmFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHByb3ZlckxhYmVsID0gYXBwcm92ZXIuZGlzcGxheU5hbWUgfHwgYXBwcm92ZXIuZW1haWwgfHwgYXBwcm92ZXIuX3VpZDtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0FzaWduYXIgYSAnICtcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xuICAgICAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgbGV0IG9rQ291bnQgPSAwLFxuICAgIF9lcnJDb3VudCA9IDA7XG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcbiAgdmVuZGVkb3Jlcy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHVpZCxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBsb2dPcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxuICAgICAgICBhcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXG4gICAgICB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdidWxrQXNzaWduQXBwcm92ZXInLCBlKTtcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxuICBpZiAob2tDb3VudCkge1xuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXG4gIH1cbn07XG5cbi8vIEdlb2NvZGluZyBjb24gR29vZ2xlIE1hcHMgQVBJLiBEZXZ1ZWx2ZSB7bGF0LCBsbmcsIGRpc3BsYXksIHByZWNpc2lvbn1cbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcbiAgY29uc3Qga2V5ID0gYXdhaXQgZ2V0R21hcHNBcGlLZXkoKTtcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cbiAgY29uc3QgdXJsID1cbiAgICAnaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMuY29tL21hcHMvYXBpL2dlb2NvZGUvanNvbicgK1xuICAgICc/YWRkcmVzcz0nICtcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcbiAgICAnJnJlZ2lvbj1hcicgK1xuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXG4gICAgJyZsYW5ndWFnZT1lcycgK1xuICAgICcma2V5PScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XG4gICAgICBjb25zdCBieVR5cGUgPSAodCkgPT4ge1xuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XG4gICAgICB9O1xuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XG4gICAgICAgIGJ5VHlwZSgnbG9jYWxpdHknKSB8fCBieVR5cGUoJ3N1YmxvY2FsaXR5JykgfHwgYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzInKSB8fCAnJztcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGF0OiBwYXJzZUZsb2F0KGxvYy5sYXQpLFxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcbiAgICAgICAgcHJlY2lzaW9uOiBwcmVjaXNpb24sXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcbiAgICAgICAgbG9jYWxpdHk6IGRldGVjdGVkTG9jYWxpdHksXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcbiAgICAgICAgICAnKHNpbiBkZXRhbGxlKS4gUmV2aXNhciBxdWUgbGEgQVBJIGtleSB0ZW5nYSBoYWJpbGl0YWRhIEdlb2NvZGluZyBBUEkgeSBlbCByZWZlcnJlciBwZXJtaXRhIGVzdGUgZG9taW5pby4nXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcbiAgdHJ5IHtcbiAgICBjb25zdCBhZVFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmdldCgpO1xuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdlbWluaSBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5XG4gIHRyeSB7XG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZ1NuYXAuZXhpc3RzID8gZ1NuYXAuZGF0YSgpIDogbnVsbCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxuICB0cnkge1xuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xuICAgIC8vIEU2IGZpeCBDMTogdmFjaWFyIGVsIEFycmF5IGluLXBsYWNlIChwcmVzZXJ2YSB3aW5kb3cudXNlcnNDYWNoZSByZWYpLlxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIHVzZXJzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgX3VpZDogZG9jLmlkIH0sIGRvYy5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXG4gICAgdHJ5IHtcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpO1xuICAgIH1cbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcbiAgICAvLyBwdWVkYW4gdmVyIGRlc3RpbmF0YXJpb3MgYWwgY3JlYXIgdGFyZWFzIGVuIE5vdGlmaWNhY2lvbmVzLiBTaW4gZXN0b1xuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cbiAgICB0cnkge1xuICAgICAgc3luY1VzZXJzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcbiAgICB9XG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XG4gICAgY29uc3QgX2ludGVybm9PcHRzID1cbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgIGludGVybm9zXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICdcIj4nICtcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xuICAgICAgdGFibGVIdG1sID1cbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvdGQ+PC90cj4nO1xuICAgICAgY2FyZHNIdG1sID1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBZG1pbnMgcHJpbWFyaW9zIHByb3RlZ2lkb3M6IG5vIHNlIHB1ZWRlbiBlbGltaW5hciAoTWFyaWFubyArIGJvdCBjb3Jwb3JhdGl2bylcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuICAgICAgLy8gUGFyYSBsb3MgaW50ZXJub3MgY2FsY3VsYW1vcyBsYSByZWxhY2lvbiBpbnZlcnNhOiBxdWllbmVzIGxvcyB0aWVuZW4gY29tbyBwYXJlamFcbiAgICAgIGZ1bmN0aW9uIHZlbmRvcnNQYXJhSW50ZXJubyhpbnRlcm5vVWlkKSB7XG4gICAgICAgIHJldHVybiB1c2Vyc0NhY2hlLmZpbHRlcihcbiAgICAgICAgICAodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InICYmIHUuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSBpbnRlcm5vVWlkXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBDYW5kaWRhdG9zIGEgcmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM6IGFkbWluLCBnZXJlbnRlIG8gaW50ZXJubyAobm8gdmVuZGVkb3JlcyBuaSB2aWV3ZXJzIG5pIHVuYXNzaWduZWQpXG4gICAgICBjb25zdCByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKFxuICAgICAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICAgICApO1xuICAgICAgdXNlcnNDYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY0lkID0gZC5fdWlkO1xuICAgICAgICBjb25zdCBpc1NlbGYgPSBkb2NJZCA9PT0gY3VycmVudFVzZXIudWlkO1xuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcbiAgICAgICAgY29uc3QgaXNJbnRlcm5vID0gZC5yb2xlID09PSAnaW50ZXJubyc7XG4gICAgICAgIGNvbnN0IHJvbGVPcHRpb25zID0gWyd1bmFzc2lnbmVkJywgJ2FkbWluJywgJ2dlcmVudGUnLCAndmVuZGVkb3InLCAnaW50ZXJubycsICd2aWV3ZXInXVxuICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAocikgPT5cbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICAgICAgciArXG4gICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAoZC5yb2xlID09PSByID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAoaXNTZWxmICYmIHIgIT09ICdhZG1pbicgPyAnIGRpc2FibGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHIgK1xuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgIClcbiAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIGNvbnN0IHZlbmRvck9wdGlvbnMgPVxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LTwvb3B0aW9uPicgK1xuICAgICAgICAgIFZFTkRPUlMubWFwKFxuICAgICAgICAgICAgKHYpID0+XG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHYuem9uZSArXG4gICAgICAgICAgICAgICcgJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgICApLmpvaW4oJycpO1xuICAgICAgICAvLyBTaSBlcyBpbnRlcm5vLCBtb3N0cmFyIHJlbGFjaW9uIGludmVyc2EgKHZlbmRlZG9yZXMgcXVlIGxvIHRpZW5lbiBjb21vIHBhcmVqYSkgZW4gdmV6IGRlbCBkcm9wZG93biBlZGl0YWJsZVxuICAgICAgICBsZXQgcGFyZWphQ2VsbDtcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xuICAgICAgICAgIGNvbnN0IHZpbmMgPSB2ZW5kb3JzUGFyYUludGVybm8oZG9jSWQpO1xuICAgICAgICAgIGlmICh2aW5jLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmNcbiAgICAgICAgICAgICAgLm1hcCgodSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6IHUuZW1haWwgfHwgJyc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwobGFiZWwpICtcbiAgICAgICAgICAgICAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPignICtcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XG4gICAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbToycHhcIj5WZW5kZWRvcmVzIGV4dGVybm9zIHZpbmN1bGFkb3MgKGF1dG8pPC9kaXY+JyArXG4gICAgICAgICAgICAgIGxpc3QgK1xuICAgICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZWphQ2VsbCA9XG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgICAgICAgIGludGVybm9zXG4gICAgICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAgICAgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xuICAgICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIj4oVk9TKTwvc3Bhbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3QgcHJvdGVjdGVkVGFnID1cbiAgICAgICAgICBpc1Byb3RlY3RlZCAmJiAhaXNTZWxmXG4gICAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiIHRpdGxlPVwiQWRtaW4gcHJvdGVnaWRvIC0gbm8gc2UgcHVlZGUgZWxpbWluYXJcIj5QUk9URUdJRE88L3NwYW4+J1xuICAgICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3Qgd2FWYWwgPSBkLndoYXRzYXBwIHx8ICcnO1xuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9XG4gICAgICAgICAgJzxpbnB1dCB0eXBlPVwidGVsXCIgY2xhc3M9XCJ3YS1pbnB1dFwiIHBsYWNlaG9sZGVyPVwiZWouIDU0OTExMjY3NjIwMzFcIiB2YWx1ZT1cIicgK1xuICAgICAgICAgIGVzY2FwZUF0dHIod2FWYWwpICtcbiAgICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpXCIgdGl0bGU9XCJOdW1lcm8gV2hhdHNBcHAgY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChzaW4gKyBuaSBlc3BhY2lvcykuIFNlIHVzYSBhbCBlbnZpYXIgbGEgcnV0YS5cIi8+JztcbiAgICAgICAgLy8gRHJvcGRvd24gJ1Jlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzJ1xuICAgICAgICBjb25zdCBjdXJBcHByb3ZlclVpZCA9IGQucmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCAnJztcbiAgICAgICAgbGV0IHJlbmRBcHByb3Zlck9wdGlvbnMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIGFzaWduYXIgLTwvb3B0aW9uPic7XG4gICAgICAgIHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICAgICAgICBpZiAodS5fdWlkID09PSBkb2NJZCkgcmV0dXJuOyAvLyB1biB1c3VhcmlvIG5vIHB1ZWRlIHNlciBzdSBwcm9waW8gYXByb2JhZG9yXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgKz1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICBlc2NhcGVBdHRyKHUuX3VpZCkgK1xuICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAoY3VyQXBwcm92ZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICBlc2NhcGVIdG1sKGxibCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZW5kQXBwcm92ZXJIdG1sID1cbiAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cInJlbmQtYXBwcm92ZXItc2VsXCIgdGl0bGU9XCJRdWllbiBhcHJ1ZWJhIGxhcyByZW5kaWNpb25lcyBkZSBlc3RlIHVzdWFyaW9cIj4nICtcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+JztcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDYW1iaWFyIGNvbnRyYXNlXHUwMEYxYVxuICAgICAgICBjb25zdCBwd2RCdG5IdG1sID1cbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweFwiIG9uY2xpY2s9XCJjaGFuZ2VVc2VyUGFzc3dvcmQoXFwnJyArXG4gICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgIFwiJywgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXG4gICAgICAgICAgJylcIj5Db250cmFzZVx1MDBGMWE8L2J1dHRvbj4nO1xuICAgICAgICAvLyBCb3RcdTAwRjNuIENvbmZpZ3VyYXIgMkZBXG4gICAgICAgIGNvbnN0IHRvdHBTdGF0dXNUYWcgPSBkLnRvdHBFbmFibGVkXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzEwYjk4MTtmb250LXdlaWdodDo4MDBcIj4mIzEwMDAzOzwvc3Bhbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3QgdG90cEJ0bkh0bWwgPVxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4O2JhY2tncm91bmQ6JyArXG4gICAgICAgICAgKGQudG90cEVuYWJsZWQgPyAnIzEwYjk4MScgOiAnIzViMjFiNicpICtcbiAgICAgICAgICAnXCIgb25jbGljaz1cIm9wZW5Ub3RwU2V0dXAoXFwnJyArXG4gICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgIFwiJywgXCIgK1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXG4gICAgICAgICAgJylcIj4yRkEnICtcbiAgICAgICAgICB0b3RwU3RhdHVzVGFnICtcbiAgICAgICAgICAnPC9idXR0b24+JztcbiAgICAgICAgLy8gRGVza3RvcCByb3dcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dHIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lIHx8ICcnKSArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgKyByb2xlT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcGFyZWphQ2VsbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkIGNsYXNzPVwid2EtY29sXCI+JyArIHdhSW5wdXRIdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHJlbmRBcHByb3Zlckh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB0b3RwQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIGNvbnN0IHNob3dEZWxldGUgPSAhaXNTZWxmICYmICFpc1Byb3RlY3RlZDtcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZVxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgdGFibGVIdG1sICs9XG4gICAgICAgICAgJzx0ZD4nICtcbiAgICAgICAgICBkZWxCdG4gK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPC90cj4nO1xuICAgICAgICAvLyBNb2JpbGUgY2FyZFxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1c2Vycy1jYXJkXCIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXY+PGRpdiBjbGFzcz1cInVjLWVtYWlsXCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArXG4gICAgICAgICAgeW91VGFnICtcbiAgICAgICAgICBwcm90ZWN0ZWRUYWcgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBpZiAoZC5kaXNwbGF5TmFtZSlcbiAgICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1uYW1lXCI+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSkgKyAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5Sb2w8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgK1xuICAgICAgICAgIHJvbGVPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgK1xuICAgICAgICAgIHZlbmRvck9wdGlvbnMgK1xuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvcmVzIHZpbmN1bGFkb3MgKGF1dG8pPC9sYWJlbD4nICtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5QYXJlamEgaW50ZXJubyAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPicgK1xuICAgICAgICAgICAgcGFyZWphQ2VsbCArXG4gICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgK1xuICAgICAgICAgIHdhSW5wdXRIdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM8L2xhYmVsPicgK1xuICAgICAgICAgIHJlbmRBcHByb3Zlckh0bWwgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiIHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7ZGlzcGxheTpmbGV4O2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xuICAgICAgICAgIHB3ZEJ0bkh0bWwgK1xuICAgICAgICAgIHRvdHBCdG5IdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGVcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgK1xuICAgICAgICAgIGRlbEJ0bkMgK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xuICAgIGNhcmRzRWwuaW5uZXJIVE1MID0gY2FyZHNIdG1sO1xuICAgIC8vIEFjdHVhbGl6YSBoZWFkZXIgZGUgdGFibGEgY29uIGxhIGNvbHVtbmEgbnVldmFcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xuICAgIGlmICh0aGVhZClcbiAgICAgIHRoZWFkLmlubmVySFRNTCA9XG4gICAgICAgICc8dGg+RW1haWw8L3RoPjx0aD5Ob21icmU8L3RoPjx0aD5Sb2w8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlBhcmVqYSBpbnRlcm5vPC90aD48dGggY2xhc3M9XCJ3YS1jb2xcIj5XaGF0c0FwcDwvdGg+PHRoPlJlc3AuIHJlbmRpY2lvbmVzPC90aD48dGg+UGFzczwvdGg+PHRoPjJGQTwvdGg+PHRoPjwvdGg+JztcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29wZW5BZG1pblBhbmVsJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIHVzdWFyaW9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBGMjogZGVsZXRlVXNlclJvbGUgKyBUT1RQICsgY2hhbmdlVXNlclBhc3N3b3JkICsgc2F2ZVVzZXJSb2xlIChpbmxpbmUgTDE0MTA1LTE0MzkwKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5kZWxldGVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xuICAgIGFsZXJ0KCdObyBwb2RlcyBlbGltaW5hciB0dSBwcm9waW8gYWNjZXNvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBEZWZlbnNhIGFkaWNpb25hbDogYWRtaW5zIHByb3RlZ2lkb3Mgbm8gc2UgcHVlZGVuIGVsaW1pbmFyIG5pIGRlc2RlIGNvbnNvbGFcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwUHJlID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGNvbnN0IGVtYWlsUHJlID0gKHNuYXBQcmUuZXhpc3RzID8gc25hcFByZS5kYXRhKCkuZW1haWwgfHwgJycgOiAnJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBQUk9URUNURUQgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuICAgIGlmIChQUk9URUNURUQuaW5kZXhPZihlbWFpbFByZSkgPj0gMCkge1xuICAgICAgYWxlcnQoJ0VzdGUgZXMgdW4gYWRtaW4gcHJvdGVnaWRvICgnICsgZW1haWxQcmUgKyAnKSB5IG5vIHNlIHB1ZWRlIGVsaW1pbmFyLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBzaSBmYWxsYSBsYSBsZWN0dXJhIHByZXZpYSwgc2lndWUgY29uIGNvbmZpcm0gKi9cbiAgfVxuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRWxpbWluYXIgYWNjZXNvIGRlIGVzdGUgdXN1YXJpbz9cXG5cXG5QaWVyZGUgYWNjZXNvIGRlIGlubWVkaWF0by4gU2kgdnVlbHZlIGEgZW50cmFyIGNvbiBHb29nbGUgdmEgYSBxdWVkYXIgY29tbyBcInNpbiByb2wgYXNpZ25hZG9cIiBoYXN0YSBxdWUgdm9zIGxvIGhhYmlsaXRlcyBkZSBudWV2by5cXG5cXG5TdSBjdWVudGEgR29vZ2xlIHNpZ3VlIGV4aXN0aWVuZG8sIG5vIHNlIGJvcnJhLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBjb25zdCBkYXRhID0gc25hcC5leGlzdHMgPyBzbmFwLmRhdGEoKSA6IHt9O1xuICAgIGxvZ09wKCdlbGltaW5hcl91c3VhcmlvJywgJ3VzZXInLCBkYXRhLmVtYWlsIHx8IHVpZCwge1xuICAgICAgdWlkLFxuICAgICAgcHJldmlvdXNSb2xlOiBkYXRhLnJvbGUsXG4gICAgICBwcmV2aW91c1ZlbmRvcjogZGF0YS52ZW5kb3IsXG4gICAgfSk7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmRlbGV0ZSgpO1xuICAgIHNob3dTeW5jVGFnKCdVc3VhcmlvIGVsaW1pbmFkbycpO1xuICAgIGF3YWl0IG9wZW5BZG1pblBhbmVsKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVVc2VyUm9sZScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBhbmVsIGFkbWluOiBzZXR1cCAvIHJlc2V0IGRlIDJGQSBwb3IgdXN1YXJpb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgdG90cFNldHVwU3RhdGUgPSBudWxsOyAvLyB7dWlkLCBlbWFpbCwgc2VjcmV0LCBvdHBhdXRofVxuXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGNvbnNvbGUubG9nKCdbMkZBXSBvcGVuVG90cFNldHVwIGNhbGxlZCcsIHsgdWlkLCBlbWFpbCwgdXNlclJvbGUgfSk7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGVsIGFkbWluaXN0cmFkb3IgcHVlZGUgY29uZmlndXJhciAyRkEgcGFyYSBvdHJvcyB1c3Vhcmlvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRXJyb3I6IFVJRCBkZWwgdXN1YXJpbyBubyBkaXNwb25pYmxlLiBSZWNhcmdhIGxhIHBhZ2luYSB5IHJlaW50ZW50YS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xuICAvLyBNb2RhbCBleGlzdGU/XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkge1xuICAgIGFsZXJ0KCdFcnJvcjogbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8gZW4gZWwgRE9NLiBSZWNhcmdhIGxhIHBhZ2luYSAoQ3RybCtTaGlmdCtSKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc3VidEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtc3VidCcpO1xuICBpZiAoc3VidEVsKSBzdWJ0RWwudGV4dENvbnRlbnQgPSAnUGFyYTogJyArIChlbWFpbCB8fCB1aWQpO1xuICAvLyBMZWVyIGVzdGFkbyBhY3R1YWxcbiAgbGV0IGN1ckVuYWJsZWQgPSBmYWxzZTtcbiAgbGV0IGN1clNlY3JldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBzbmFwLmRhdGEoKSB8fCB7fTtcbiAgICAgIGN1ckVuYWJsZWQgPSAhIWQudG90cEVuYWJsZWQ7XG4gICAgICBjdXJTZWNyZXQgPSBkLnRvdHBTZWNyZXQgfHwgbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS53YXJuKCdbMkZBXSBkb2Mgcm9sZXMvJyArIHVpZCArICcgbm8gZXhpc3RlJyk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignWzJGQV0gZXJyb3IgbGV5ZW5kbyByb2xlcy8nICsgdWlkLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBlbCBlc3RhZG8gZGUgMkZBIGRlbCB1c3VhcmlvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XG4gIGlmICghYykge1xuICAgIGFsZXJ0KCdFcnJvcjogY29udGVuZWRvciBkZWwgbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8uIFJlY2FyZ2EgbGEgcGFnaW5hLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY3VyRW5hYmxlZCAmJiBjdXJTZWNyZXQpIHtcbiAgICBjLmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itc3VjY2Vzcy1iZyk7Ym9yZGVyOjFweCBzb2xpZCAjODZlZmFjO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzKTt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xuICAgICAgJzxiPiYjMTAwMDM7IDJGQSB5YSBlc3RcdTAwRTEgYWN0aXZvPC9iPiBwYXJhIGVzdGUgdXN1YXJpby4nICtcbiAgICAgICc8YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTFweFwiPlNpIGxvIHBlcmRpXHUwMEYzIG8gY2FtYmlcdTAwRjMgZGUgY2VsdWxhciwgcG9kXHUwMEU5cyBnZW5lcmFybGUgdW5vIG51ZXZvIChlbCBhbnRlcmlvciBxdWVkYSBpbnZhbGlkYWRvKS48L3NwYW4+JyArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O21hcmdpbi10b3A6MTRweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgXCInLCdcIiArXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiZGlzYWJsZVRvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+JyArXG4gICAgICAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBjLmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2VmZjZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMxZTQwYWY7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICdFc3RlIHVzdWFyaW8gdG9kYXZcdTAwRURhIG5vIHRpZW5lIDJGQSBjb25maWd1cmFkby4gR2VuZXJcdTAwRTEgdW4gbnVldm8gY1x1MDBGM2RpZ28gcGFyYSBxdWUgbG8gZXNjYW5lZSBjb24gR29vZ2xlIEF1dGhlbnRpY2F0b3IuJyArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi10b3A6MTRweFwiPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgIFwiJywnXCIgK1xuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xuICAgICAgJ1xcJylcIj5HZW5lcmFyIDJGQTwvYnV0dG9uPicgK1xuICAgICAgJzwvZGl2Pic7XG4gIH1cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlVG90cFNldHVwTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XG59O1xuXG53aW5kb3cuZ2VuZXJhdGVOZXdUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHNlY3JldCA9IHRvdHBHZW5lcmF0ZVNlY3JldCgpO1xuICBjb25zdCBvdHBhdXRoID0gdG90cEJ1aWxkT3RwYXV0aFVybChzZWNyZXQsIGVtYWlsIHx8IHVpZCk7XG4gIHRvdHBTZXR1cFN0YXRlID0geyB1aWQ6IHVpZCwgZW1haWw6IGVtYWlsLCBzZWNyZXQ6IHNlY3JldCwgb3RwYXV0aDogb3RwYXV0aCB9O1xuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xuICBjLmlubmVySFRNTCA9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXdhcm5pbmctYmcpO2JvcmRlcjoxcHggc29saWQgI2ZjZDM0ZDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6Izc4MzUwZjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGI+UGFzb3MgcGFyYSBhY3RpdmFyOjwvYj48YnI+JyArXG4gICAgJzEuIEVsIHVzdWFyaW8gaW5zdGFsYSA8Yj5Hb29nbGUgQXV0aGVudGljYXRvcjwvYj4gZW4gc3UgY2VsdWxhci48YnI+JyArXG4gICAgJzIuIFRvY2EgXCJBZ3JlZ2FyXCIgLyBcIitcIiBlbiBsYSBhcHAuPGJyPicgK1xuICAgICczLiBFbGlnZSBcIkVzY2FuZWFyIGNcdTAwRjNkaWdvIFFSXCIgeSBlc2NhbmVhIGVsIGNcdTAwRjNkaWdvIGFiYWpvIChvIHBlZ2EgZWwgc2VjcmV0IG1hbnVhbG1lbnRlKS48YnI+JyArXG4gICAgJzQuIEFwYXJlY2UgdW4gY1x1MDBGM2RpZ28gZGUgNiBkXHUwMEVEZ2l0b3MgZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IuPGJyPicgK1xuICAgICc1LiBMbyBlc2NyaWJlIGVuIGVsIGlucHV0IGRlIGFiYWpvIHBhcmEgY29uZmlybWFyIHkgYWN0aXZhci4nICtcbiAgICAnPC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7cGFkZGluZzoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4O3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjRweFwiPlNlY3JldCAoY2FyZ2EgbWFudWFsIHNpIGVsIFFSIGZhbGxhKTwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTt3b3JkLWJyZWFrOmJyZWFrLWFsbDtsZXR0ZXItc3BhY2luZzouMWVtXCI+JyArXG4gICAgZXNjYXBlSHRtbChzZWNyZXQpICtcbiAgICAnPC9kaXY+JyArXG4gICAgJzwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjEwcHhcIj48bGFiZWwgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo1cHhcIj5DXHUwMEYzZGlnbyBkZSB2ZXJpZmljYWNpXHUwMEYzbiBkZSBHb29nbGUgQXV0aGVudGljYXRvcjwvbGFiZWw+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwidG90cC1jb25maXJtLWlucHV0XCIgaW5wdXRtb2RlPVwibnVtZXJpY1wiIG1heGxlbmd0aD1cIjdcIiBwbGFjZWhvbGRlcj1cIjAwMDAwMFwiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjEwcHggMTJweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxOHB4O3RleHQtYWxpZ246Y2VudGVyO2xldHRlci1zcGFjaW5nOi4zZW07Zm9udC13ZWlnaHQ6ODAwXCIvPjwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJjb25maXJtVG90cFNldHVwKClcIj5WZXJpZmljYXIgeSBhY3RpdmFyPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiY2xvc2VUb3RwU2V0dXBNb2RhbCgpXCI+Q2FuY2VsYXI8L2J1dHRvbj48L2Rpdj4nO1xuICAvLyBMYXp5LWxvYWQgcXJjb2RlanMgeSBnZW5lcmFyLiBFc3RhIGxpYnJlcmlhIHBpbnRhIGVsIFFSIGRpcmVjdG8gZW4gZWxcbiAgLy8gY29udGVuZWRvciBET00gdmlhIGNhbnZhcy9pbWcgLSBubyBuZWNlc2l0YSBjYWxsYmFjayB0b0RhdGFVUkwuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZFFSQ29kZUxpYigpO1xuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xuICAgIGlmICghYm94KSByZXR1cm47XG4gICAgYm94LmlubmVySFRNTCA9ICcnOyAvLyBsaW1waWFyIGVsIFwiR2VuZXJhbmRvIFFSLi4uXCJcbiAgICBuZXcgUVJDb2RlKGJveCwge1xuICAgICAgdGV4dDogb3RwYXV0aCxcbiAgICAgIHdpZHRoOiAyMjAsXG4gICAgICBoZWlnaHQ6IDIyMCxcbiAgICAgIGNvbG9yRGFyazogJyMwMDAwMDAnLFxuICAgICAgY29sb3JMaWdodDogJyNmZmZmZmYnLFxuICAgICAgY29ycmVjdExldmVsOiBRUkNvZGUuQ29ycmVjdExldmVsLk0sXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1syRkFdIEVycm9yIGNhcmdhbmRvIFFSIGxpYjonLCBlKTtcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcbiAgICBpZiAoYm94KVxuICAgICAgYm94LmlubmVySFRNTCA9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7cGFkZGluZzoxNHB4XCI+Tm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyXHUwMEVEYSBRUi4gVXNhIGVsIHNlY3JldCBtYW51YWwgcGFyYSBjb25maWd1cmFyLjwvZGl2Pic7XG4gIH1cbn07XG5cbndpbmRvdy5jb25maXJtVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIXRvdHBTZXR1cFN0YXRlKSByZXR1cm47XG4gIGNvbnN0IGNvZGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtY29uZmlybS1pbnB1dCcpLnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXHMrL2csICcnKTtcbiAgaWYgKCEvXlxcZHs2fSQvLnRlc3QoY29kZSkpIHtcbiAgICBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xuICBpZiAoIW9rKSB7XG4gICAgYWxlcnQoXG4gICAgICAnQ1x1MDBGM2RpZ28gaW5jb3JyZWN0by4gQXNlZ3VyYXRlIGRlIHF1ZSBlbCBzZWNyZXQgc2UgY2FyZ1x1MDBGMyBiaWVuIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yIHkgcmVpbnRlbnRcdTAwRTEuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModG90cFNldHVwU3RhdGUudWlkKVxuICAgICAgLnVwZGF0ZSh7XG4gICAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcbiAgICAgICAgdG90cEVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHRvdHBFbmFibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIHNob3dTeW5jVGFnKCcyRkEgYWN0aXZhZG8gcGFyYSAnICsgKHRvdHBTZXR1cFN0YXRlLmVtYWlsIHx8ICd1c3VhcmlvJykpO1xuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmUgdG90cCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmRpc2FibGVUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKCFjb25maXJtKCdEZXNoYWJpbGl0YXIgMkZBIHBhcmEgZXN0ZSB1c3VhcmlvPyBWYSBhIGVudHJhciBzb2xvIGNvbiBwYXNzd29yZC4nKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHVpZClcbiAgICAgIC51cGRhdGUoe1xuICAgICAgICB0b3RwRW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHRvdHBTZWNyZXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLmRlbGV0ZSgpLFxuICAgICAgICB0b3RwRGlzYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgIHRvdHBEaXNhYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIH0pO1xuICAgIHNob3dTeW5jVGFnKCcyRkEgZGVzaGFiaWxpdGFkbycpO1xuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuY2hhbmdlVXNlclBhc3N3b3JkID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICghZW1haWwpIHtcbiAgICBhbGVydCgnRXN0ZSB1c3VhcmlvIG5vIHRpZW5lIGVtYWlsIHJlZ2lzdHJhZG8gLSBubyBzZSBwdWVkZSByZXNldGVhci4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY2hvaWNlID0gcHJvbXB0KFxuICAgICdSZXNldGVhciBjb250cmFzZVx1MDBGMWEgZGUgJyArXG4gICAgICBlbWFpbCArXG4gICAgICAnXFxuXFxuJyArXG4gICAgICAnRWxlZ2kgdW5hIG9wY2lvbiAoMSAvIDIpOlxcblxcbicgK1xuICAgICAgJzEpIEVOVklBUiBNQUlMIERFIFJFU0VURU8gKHJlY29tZW5kYWRvKVxcbicgK1xuICAgICAgJyBMZSBsbGVnYSBhICcgK1xuICAgICAgZW1haWwgK1xuICAgICAgJyB1biBtYWlsIGRlIEZpcmViYXNlIGNvbiB1biBsaW5rLlxcbicgK1xuICAgICAgJyBFbCB1c3VhcmlvIGNsaWNrZWEsIHNldGVhIHN1IG51ZXZhIHBhc3N3b3JkIHkgdnVlbHZlIGEgbGEgYXBwLlxcbicgK1xuICAgICAgJyBFcyBsbyBlc3RhbmRhciB5IGZ1bmNpb25hIHNlZ3Vyby5cXG5cXG4nICtcbiAgICAgICcyKSBSZXNldGVhciBTT0xPIGVsIHBhc3N3b3JkLWdhdGUgKHNlZ3VuZGEgY2FwYSkuXFxuJyArXG4gICAgICAnIE5vIGNhbWJpYSBsYSBwYXNzd29yZCByZWFsIGRlIEZpcmViYXNlLiBTaXJ2ZSBzaSBlbCB1c3VhcmlvXFxuJyArXG4gICAgICAnIGVudHJhIHBvciBHb29nbGUgeSBvbHZpZG8gbGEgcGFzc3dvcmQtZ2F0ZSBkZSBsYSBhcHAsIE5PIHNpXFxuJyArXG4gICAgICAnIG9sdmlkbyBsYSBwYXNzd29yZCBkZWwgbG9naW4gY29uIGVtYWlsLlxcblxcbicgK1xuICAgICAgJ0VzY3JpYmkgMSBvIDI6JyxcbiAgICAnMSdcbiAgKTtcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzEnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnT0sgLSBsZSBlbnZpZSB1biBtYWlsIGRlIHJlc2V0ZW8gYSAnICtcbiAgICAgICAgICBlbWFpbCArXG4gICAgICAgICAgJy4gRGVjaWxlIHF1ZSByZXZpc2UgaW5ib3ggeSBzcGFtLiBFbCBsaW5rIGV4cGlyYSBlbiAxIGhvcmEuJ1xuICAgICAgKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZiRGJcbiAgICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgICAgIC5kb2ModWlkKVxuICAgICAgICAgIC51cGRhdGUoe1xuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2ZpcmViYXNlX2VtYWlsJyxcbiAgICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ3NlbmRQYXNzd29yZFJlc2V0RW1haWwnLCBlKTtcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzInKSB7XG4gICAgY29uc3QgbmV3UHdkID0gcHJvbXB0KFxuICAgICAgJ051ZXZhIHBhc3N3b3JkLWdhdGUgcGFyYSAnICtcbiAgICAgICAgZW1haWwgK1xuICAgICAgICAnOlxcblxcbihTb2xvIGFmZWN0YSBsYSBzZWd1bmRhIGNhcGEgZGUgbGEgYXBwLCBOTyBlbCBsb2dpbiBjb24gZW1haWwpJyxcbiAgICAgICcnXG4gICAgKTtcbiAgICBpZiAobmV3UHdkID09PSBudWxsKSByZXR1cm47XG4gICAgY29uc3QgcHdkID0gKG5ld1B3ZCB8fCAnJykudHJpbSgpO1xuICAgIGlmIChwd2QubGVuZ3RoIDwgNCkge1xuICAgICAgYWxlcnQoJ0xhIGNvbnRyYXNlXHUwMEYxYSB0aWVuZSBxdWUgdGVuZXIgYWwgbWVub3MgNCBjYXJhY3RlcmVzLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgY3JlZHMgPSBhd2FpdCBidWlsZFBhc3N3b3JkQ3JlZGVudGlhbHMocHdkKTtcbiAgICAgIGF3YWl0IGZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgICAgLmRvYyh1aWQpXG4gICAgICAgIC51cGRhdGUoe1xuICAgICAgICAgIHBhc3N3b3JkSGFzaDogY3JlZHMucGFzc3dvcmRIYXNoLFxuICAgICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXG4gICAgICAgIH0pO1xuICAgICAgc2hvd1N5bmNUYWcoJ1Bhc3N3b3JkLWdhdGUgYWN0dWFsaXphZGEgcGFyYSAnICsgZW1haWwpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ2NoYW5nZVVzZXJQYXNzd29yZCBnYXRlJywgZSk7XG4gICAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xufTtcblxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGJ0bikge1xuICBjb25zdCBjb250YWluZXIgPSBidG4uY2xvc2VzdCgndHInKSB8fCBidG4uY2xvc2VzdCgnLnVzZXJzLWNhcmQnKTtcbiAgaWYgKCFjb250YWluZXIpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucm9sZS1zZWwnKS52YWx1ZTtcbiAgY29uc3QgdmVuZG9yID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy52ZW5kb3Itc2VsJykudmFsdWUgfHwgbnVsbDtcbiAgY29uc3QgaW50ZXJuYWxTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLmludGVybmFsLXNlbCcpO1xuICBjb25zdCBpbnRlcm5hbFBhcnRuZXJVaWQgPSBpbnRlcm5hbFNlbCA/IGludGVybmFsU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xuICAvLyBXaGF0c0FwcDogbGltcGlhciB0b2RvIGxvIHF1ZSBubyBzZWEgZGlnaXRvIChhY2VwdGEgKywgZXNwYWNpb3MsIHBhclx1MDBFOW50ZXNpcywgZXRjLilcbiAgY29uc3Qgd2FJbnB1dCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcud2EtaW5wdXQnKTtcbiAgY29uc3Qgd2hhdHNhcHAgPSB3YUlucHV0ID8gKHdhSW5wdXQudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcRC9nLCAnJykgOiAnJztcbiAgaWYgKHdoYXRzYXBwICYmIHdoYXRzYXBwLmxlbmd0aCA8IDgpIHtcbiAgICBhbGVydChcbiAgICAgICdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMgKHVpZCBkZWwgdXN1YXJpbyBxdWUgYXBydWViYSlcbiAgY29uc3QgcmVuZEFwcHJvdmVyU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yZW5kLWFwcHJvdmVyLXNlbCcpO1xuICBjb25zdCByZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZEFwcHJvdmVyU2VsID8gcmVuZEFwcHJvdmVyU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xuICAvLyBDYWNoZWFyIHRhbWJpZW4gZWwgZW1haWwgZGVsIGFwcm9iYWRvciBlbiBlbCBkb2MgZGVsIHZlbmRlZG9yOiBsb3NcbiAgLy8gdmVuZGVkb3JlcyBubyBwdWVkZW4gbGVlciAvcm9sZXMve290cm9VaWR9IHBvciBzZWN1cml0eSBydWxlcywgYXNpIHF1ZVxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxuICAvLyBsbyB1c2EgY29tbyBwcmltZXIgZmFzdC1wYXRoKS4gU2luIGVzdG8gZWwgZmx1am8gZGVwZW5kaWEgZGVsIGRpcmVjdG9yaW9cbiAgLy8gcHVibGljbyAodXNlcnNfZGlyZWN0b3J5KSBxdWUgc29sbyBzZSBzaW5jcm9uaXphIGN1YW5kbyBhZG1pbiBhYnJlIGVsIHBhbmVsLlxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcbiAgaWYgKHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpIHtcbiAgICBjb25zdCBhcHByb3ZlclVzZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSByZW5kaWNpb25lc0FwcHJvdmVyVWlkKTtcbiAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBhcHByb3ZlclVzZXIgPyBhcHByb3ZlclVzZXIuZW1haWwgfHwgbnVsbCA6IG51bGw7XG4gIH1cbiAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgYnRuLnRleHRDb250ZW50ID0gJy4uLic7XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModWlkKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgdmVuZG9yLFxuICAgICAgICAgIGludGVybmFsUGFydG5lclVpZCxcbiAgICAgICAgICB3aGF0c2FwcDogd2hhdHNhcHAgfHwgbnVsbCxcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyVWlkOiByZW5kaWNpb25lc0FwcHJvdmVyVWlkLFxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLFxuICAgICAgICAgIGFzc2lnbmVkQnk6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICBhc3NpZ25lZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIC8vIFNpIGVsIHVzdWFyaW8gZWRpdG8gc3UgcHJvcGlvIG51bWVybywgYWN0dWFsaXphciBlbCBjYWNoZSBsb2NhbFxuICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xuICAgICAgbXlXaGF0c2FwcE51bWJlciA9IHdoYXRzYXBwIHx8IG51bGw7XG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8IG51bGw7XG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCB8fCBudWxsO1xuICAgIH1cbiAgICBidG4udGV4dENvbnRlbnQgPSAnT0snO1xuICAgIC8vIFJlLXJlbmRlciBkZWwgcGFuZWwgYXNpIGxvcyBkcm9wZG93bnMgXCJQYXJlamEgaW50ZXJub1wiIG11ZXN0cmFuIGxvcyBpbnRlcm5vcyBhY3R1YWxpemFkb3NcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ3JlZnJlc2ggYWRtaW4gcGFuZWwnLCBlKTtcbiAgICAgIH1cbiAgICB9LCA0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignc2F2ZVVzZXJSb2xlJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFyJztcbiAgfVxufTtcblxuLy8gVG9kb3MgbG9zIGhhbmRsZXJzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBzb24gdmVyYmF0aW0uXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF1QkEsTUFBSSxPQUFPLE9BQU8sZUFBZSxZ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YyxXQUFXLEVBQUU7QUFDbEQsVUFBTSxTQUFTLFVBQVUsY0FBYyxhQUFhLEVBQUUsU0FBUztBQUMvRCxVQUFNLGNBQWMsVUFBVSxjQUFjLGVBQWU7QUFDM0QsVUFBTSxxQkFBcUIsY0FBYyxZQUFZLFNBQVMsT0FBTztBQUVyRSxVQUFNLFVBQVUsVUFBVSxjQUFjLFdBQVc7QUFDbkQsVUFBTSxXQUFXLFdBQVcsUUFBUSxTQUFTLElBQUksUUFBUSxPQUFPLEVBQUUsSUFBSTtBQUN0RSxRQUFJLFlBQVksU0FBUyxTQUFTLEdBQUc7QUFDbkM7QUFBQSxRQUNFO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sa0JBQWtCLFVBQVUsY0FBYyxvQkFBb0I7QUFDcEUsVUFBTSx5QkFBeUIsa0JBQWtCLGdCQUFnQixTQUFTLE9BQU87QUFNakYsUUFBSSwyQkFBMkI7QUFDL0IsUUFBSSx3QkFBd0I7QUFDMUIsWUFBTSxnQkFBZ0IsY0FBYyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxTQUFTLHNCQUFzQjtBQUNyRixpQ0FBMkIsZUFBZSxhQUFhLFNBQVMsT0FBTztBQUFBLElBQ3pFO0FBQ0EsUUFBSSxXQUFXO0FBQ2YsUUFBSSxjQUFjO0FBQ2xCLFFBQUk7QUFDRixZQUFNLEtBQ0gsV0FBVyxPQUFPLEVBQ2xCLElBQUksR0FBRyxFQUNQO0FBQUEsUUFDQztBQUFBLFVBQ0U7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0EsVUFBVSxZQUFZO0FBQUEsVUFDdEI7QUFBQSxVQUNBO0FBQUEsVUFDQSxZQUFZLFlBQVk7QUFBQSxVQUN4QixZQUFZLFNBQVMsVUFBVSxXQUFXLGdCQUFnQjtBQUFBLFFBQzVEO0FBQUEsUUFDQSxFQUFFLE9BQU8sS0FBSztBQUFBLE1BQ2hCO0FBRUYsVUFBSSxRQUFRLFlBQVksS0FBSztBQUMzQiwyQkFBbUIsWUFBWTtBQUMvQixtQ0FBMkIsMEJBQTBCO0FBQ3JELHFDQUE2Qiw0QkFBNEI7QUFBQSxNQUMzRDtBQUNBLFVBQUksY0FBYztBQUVsQixpQkFBVyxNQUFNO0FBQ2YsWUFBSTtBQUNGLHlCQUFlO0FBQUEsUUFDakIsU0FBUyxHQUFHO0FBQ1Ysa0JBQVEsTUFBTSx1QkFBdUIsQ0FBQztBQUFBLFFBQ3hDO0FBQUEsTUFDRixHQUFHLEdBQUc7QUFBQSxJQUNSLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSxnQkFBZ0IsQ0FBQztBQUMvQixZQUFNLHVCQUF1QixFQUFFLFdBQVcsRUFBRTtBQUM1QyxVQUFJLFdBQVc7QUFDZixVQUFJLGNBQWM7QUFBQSxJQUNwQjtBQUFBLEVBQ0Y7IiwKICAibmFtZXMiOiBbInZlbmRvcnNQYXJhSW50ZXJubyJdCn0K
