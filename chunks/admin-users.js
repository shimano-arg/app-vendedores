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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGVsaW1pbmFkbyBlbCBLTk9XTiBCVUcgZGVsIGdlbWluaUFwaUtleUNhY2hlXHJcbi8vIGNyb3NzLW1vZHVsZS4gTGEga2V5IHlhIG5vIHZpdmUgZW4gRmlyZXN0b3JlIG5pIGNhY2hlYSBuYWRhIGZyb250ZW5kIFx1MjAxNFxyXG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXHJcbi8vIGxlZSB1c2Vyc0NhY2hlIGNvbW8gaWRlbnRpZmllciBsaWJyZS4gRW4gYnVuZGxlIFwidXNlIHN0cmljdFwiIHVuIHJlYWQgYVxyXG4vLyBpZGVudGlmaWVyIG5vLWRlY2xhcmFkbyBuaSBlbiB3aW5kb3cgdGlyYSBSZWZlcmVuY2VFcnJvci4gUHJvbW9jaW9uYXIgYVxyXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcclxuLy8geSBidW5kbGUgbm90aWZpY2FjaW9uZXMgKHNoZWxsKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cudXNlcnNDYWNoZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51c2Vyc0NhY2hlID0gW107XHJcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSlcclxuICAgIC5zbGljZSgpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuZW1haWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5lbWFpbCB8fCAnJykpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TaSB1biB2ZW5kZWRvciB1c2EgR21haWwgcGVyc29uYWwgKG5vIEBzaGltYW5vLmNvbS5hciksIGFncmVnYWxvIGFjYSBhbnRlcyBxdWUgaW50ZW50ZSBsb2d1ZWFyLiBMb3MgZW1haWxzIEBzaGltYW5vLmNvbS5hciB5IGxvcyBhZG1pbnMgaGFyZGNvZGVkIHlhIGVzdGFuIGF1dG9yaXphZG9zIGF1dG9tYXRpY2FtZW50ZS48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgICBhbGxvd2VkTGlzdC5mb3JFYWNoKChhZSkgPT4ge1xyXG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcclxuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6MTRweDtwYWRkaW5nOjNweCA0cHggM3B4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6IzFlNDBhZjtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBsYWJlbCArXHJcbiAgICAgICAgbm90ZSArXHJcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cInJlbW92ZUFsbG93ZWRFbWFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXHJcbiAgICAgICAgJzwvZGl2Pic7XHJcbiAgICB9KTtcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbndpbmRvdy5hZGRBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xyXG4gIGlmICghcmF3KSByZXR1cm47XHJcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xyXG4gICAgYWxlcnQoJ0VsIGVtYWlsIG5vIHBhcmVjZSB2YWxpZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG5vdGUgPVxyXG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XHJcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXHJcbiAgICAgIC5kb2MoZG9jSWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgZW1haWwsXHJcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcclxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgYWRkZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xyXG4gICAgLy8gUmVjYXJnYXIgcGFuZWxcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBTZWNjaW9uIEdlbWluaSBBUEkgS2V5IChhZG1pbikgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXHJcbiAgLy8gdjYzOSAoMjAyNi0wOC0yNik6IFVYIHNpbXBsaWZpY2FkbyBwb3IgcGVkaWRvIE1hcmlhbm8gXHUyMDE0IHNpbiBpbnN0cnVjY2lvbmVzXHJcbiAgLy8gQ0xJIGVuIGVsIHBhbmVsLCBzb2xvIHVuIGJhbm5lciBleHBsaWNhbmRvIGRvbmRlIHZpdmUgbGEga2V5LlxyXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cclxuICBlbC50ZXh0Q29udGVudCA9ICcnO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MTRweCAxMnB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo2cHgnO1xyXG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO21hcmdpbi1ib3R0b206NnB4JztcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdHZW1pbmkgQVBJIEtleSAoT0NSIGRlIHRpY2tldHMpJztcclxuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgLy8gSWNvbm8gY2FuZGFkbyArIHRleHRvLiB0ZXh0Q29udGVudCBlcyBzYWZlIChubyBIVE1MIHBhcnNpbmcpLlxyXG4gIG1zZy50ZXh0Q29udGVudCA9ICdHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZCh0aXRsZSk7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZChtc2cpO1xyXG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xyXG59XHJcblxyXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXHJcbi8vIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuIFNlIGFkbWluaXN0cmEgcG9yIENMSS4gVmVyXHJcbi8vIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24gcGFyYSBsYXMgaW5zdHJ1Y2Npb25lcy5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHT09HTEUgTUFQUyBHZW9jb2RpbmcgQVBJIC0gbWVqb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsIHF1ZSBPU01cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3NcclxuLy8gY29tbyBnZW9jb2RlciBQUklNQVJJTyBlbiBnZW9jb2RlQ2xpZW50QWRkcmVzczsgc2kgZmFsbGEgbyBubyBlc3RhXHJcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxyXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbmFzeW5jIGZ1bmN0aW9uIGdldEdtYXBzQXBpS2V5KCkge1xyXG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcclxuICAgIGlmIChzbmFwLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XHJcbiAgICAgIGlmIChkLmFwaUtleSkge1xyXG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcclxuICAgICAgICByZXR1cm4gZC5hcGlLZXk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gbm8gc2UgcHVkbyBsZWVyIGFwaSBrZXknLCBlKTtcclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnbWFwcy1jb25maWctc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xyXG4gIGNvbnN0IG1hc2tlZCA9IGhhc0tleSA/IGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkgOiAnJztcclxuICBjb25zdCB1cGRhdGVkQnkgPSAoZGF0YSAmJiBkYXRhLnVwZGF0ZWRCeSkgfHwgJyc7XHJcbiAgY29uc3QgdXBkYXRlZEF0ID1cclxuICAgIGRhdGEgJiYgZGF0YS51cGRhdGVkQXQgJiYgZGF0YS51cGRhdGVkQXQudG9EYXRlXHJcbiAgICAgID8gZGF0YS51cGRhdGVkQXQudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcclxuICAgICAgOiAnJztcclxuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkNvbnZpZXJ0ZSBkaXJlY2Npb25lcyBhIGNvb3JkZW5hZGFzIGNvbiBtdWNoYSBtZWpvciBwcmVjaXNpXHUwMEYzbiBxdWUgT1NNIChzb2JyZSB0b2RvIGVuIGxvY2FsaWRhZGVzIGNoaWNhcykuIENvc3RvIGdyYXRpcyBoYXN0YSA0MC4wMDAgcmVxdWVzdHMvbWVzLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoaGFzS2V5KSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgIzZlZTdiNztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzA2NWY0NlwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Q2FyZ2FkYSBwb3IgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwodXBkYXRlZEJ5IHx8ICdhZG1pbicpICtcclxuICAgICAgKHVwZGF0ZWRBdCA/ICcgKCcgKyBlc2NhcGVIdG1sKHVwZGF0ZWRBdCkgKyAnKScgOiAnJykgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+U2luIEFQSSBrZXkuIEdlb2NvZGluZyB1c2EgT3BlblN0cmVldE1hcCAoZ3JhdGlzIHBlcm8gcGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLjwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWN5YW5cIiBvbmNsaWNrPVwic2F2ZUdtYXBzQXBpS2V5KClcIiBzdHlsZT1cImJhY2tncm91bmQ6IzEwYjk4MVwiPicgK1xyXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcclxuICAgICc8L2J1dHRvbj4nO1xyXG4gIGlmIChoYXNLZXkpXHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRlbGV0ZUdtYXBzQXBpS2V5KClcIj5Cb3JyYXI8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG53aW5kb3cuc2F2ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGNvbnN0IHJhdyA9IHByb21wdChcclxuICAgICdQZWdhIGFjYSBsYSBBUEkga2V5IGRlIEdvb2dsZSBNYXBzIChmb3JtYXRvIEFJemFTeS4uLikuXFxuXFxuSU1QT1JUQU5URTogZW4gR29vZ2xlIENsb3VkIENvbnNvbGUgcmVzdHJpbmdpIGxhIGtleSBwb3IgSFRUUCByZWZlcnJlciBhIGh0dHBzOi8vc2hpbWFuby1hcmcuZ2l0aHViLmlvLyogcGFyYSBxdWUgbmFkaWUgdGUgbGEgcm9iZS4nLFxyXG4gICAgJydcclxuICApO1xyXG4gIGlmIChyYXcgPT09IG51bGwpIHJldHVybjtcclxuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xyXG4gIGlmICgha2V5KSB7XHJcbiAgICBhbGVydCgnVmFjaWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChrZXkubGVuZ3RoIDwgMjApIHtcclxuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXHJcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcclxuICAgICAgLnNldChcclxuICAgICAgICB7XHJcbiAgICAgICAgICBhcGlLZXk6IGtleSxcclxuICAgICAgICAgIHVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICB1cGRhdGVkQnlVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcclxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBrZXk7XHJcbiAgICAvLyB2OTI0OiBpbnZhbGlkYXIgZWwgY2FjaGUgaW5saW5lIGRlbCBzaGVsbCAoZWwgZ2VvY29kaW5nIHJlYWwgdml2ZSBhbGxpKS5cclxuICAgIGlmICh0eXBlb2Ygd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICB0cnkgeyB3aW5kb3cuX2ludmFsaWRhdGVHbWFwc0tleUNhY2hlKCk7IH0gY2F0Y2goX2Upe31cclxuICAgIH1cclxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc2F2ZUdtYXBzQXBpS2V5JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ0JvcnJhciBsYSBBUEkga2V5IGRlIEdvb2dsZSBNYXBzPyBFbCBnZW9jb2RpbmcgdnVlbHZlIGEgT1NNIChwZW9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCkuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xyXG4gICAgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbiAgICAvLyB2OTI0OiBpZGVtIHNhdmUgXHUyMDE0IGludmFsaWRhciBjYWNoZSBpbmxpbmUuXHJcbiAgICBpZiAodHlwZW9mIHdpbmRvdy5faW52YWxpZGF0ZUdtYXBzS2V5Q2FjaGUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgdHJ5IHsgd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSgpOyB9IGNhdGNoKF9lKXt9XHJcbiAgICB9XHJcbiAgICBzaG93U3luY1RhZygnR29vZ2xlIE1hcHMgQVBJIGtleSBib3JyYWRhJyk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlR21hcHNBcGlLZXknLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBCVUxLIEFQUFJPVkVSIC0gYXNpZ25hciBlbCBtaXNtbyBcIlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzXCJcclxuLy8gYSB0b2RvcyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gVXRpbCBjdWFuZG8gdW4gc29sbyBhcHJvYmFkb3IgKGVqLiBQYWJsbyBnZXJlbnRlKSByZXZpc2EgbGFzXHJcbi8vIHJlbmRpY2lvbmVzIGRlIFRPRE9TIGxvcyB2ZW5kZWRvcmVzLiBTaW4gZXN0byBlbCBhZG1pbiB0aWVuZSBxdWVcclxuLy8gYWJyaXIgY2FkYSBmaWxhIGRlbCBwYW5lbCBVc3VhcmlvcyB5IHNldGVhciBlbCBkcm9wZG93biB1bmEgYSB1bmEuXHJcbmZ1bmN0aW9uIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWN0aW9uJyk7XHJcbiAgaWYgKCFlbCkgcmV0dXJuO1xyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKFxyXG4gICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xyXG4gICk7XHJcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6I2EyMWNhZlwiPkFwcm9iYWRvciBkZSBSZW5kaWNpb25lcyAtIGFzaWduYWNpb24gbWFzaXZhPC9kaXY+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QXBsaWNhIGVsIG1pc21vIHJlc3BvbnNhYmxlIGEgVE9ET1MgbG9zIHZlbmRlZG9yZXMgZGUgdW4gc29sbyBjbGljay4gVXRpbCBjdWFuZG8gdW4gZ2VyZW50ZSBjb21lcmNpYWwgY2VudHJhbGl6YSBsYSBhcHJvYmFjaW9uLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoIWNhbmRpZGF0ZXMubGVuZ3RoKSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIGFkbWluIC8gZ2VyZW50ZSAvIGludGVybm8uIFByaW1lcm8gYXNpZ25hIHVuIHJvbCBhIGFsZ3VpZW4uPC9kaXY+JztcclxuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgdmVuZGVkb3IgdG9kYXZpYS48L2Rpdj4nO1xyXG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxzZWxlY3QgaWQ9XCJidWxrLWFwcHJvdmVyLXNlbGVjdFwiIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtib3JkZXI6MS41cHggc29saWQgI2YwYWJmYztib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciBhcHJvYmFkb3IgLTwvb3B0aW9uPic7XHJcbiAgY2FuZGlkYXRlcy5mb3JFYWNoKCh1KSA9PiB7XHJcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xyXG4gICAgaHRtbCArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBlc2NhcGVBdHRyKHUuX3VpZCkgKyAnXCI+JyArIGVzY2FwZUh0bWwobGJsKSArICc8L29wdGlvbj4nO1xyXG4gIH0pO1xyXG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiYnVsa0Fzc2lnbkFwcHJvdmVyKClcIj5Bc2lnbmFyIGEgVE9ET1MgbG9zIHZlbmRlZG9yZXMgKCcgK1xyXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xyXG4gICAgJyk8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG53aW5kb3cuYnVsa0Fzc2lnbkFwcHJvdmVyID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlbGVjdCcpO1xyXG4gIGNvbnN0IHVpZCA9IHNlbCAmJiBzZWwudmFsdWU7XHJcbiAgaWYgKCF1aWQpIHtcclxuICAgIGFsZXJ0KCdFbGVnJmlhY3V0ZTsgdW4gYXByb2JhZG9yIGRlbCBkcm9wZG93bi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYXBwcm92ZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSB1aWQpO1xyXG4gIGlmICghYXBwcm92ZXIpIHtcclxuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XHJcbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2ZW5kZWRvcmVzIHBhcmEgYXNpZ25hci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYXBwcm92ZXJMYWJlbCA9IGFwcHJvdmVyLmRpc3BsYXlOYW1lIHx8IGFwcHJvdmVyLmVtYWlsIHx8IGFwcHJvdmVyLl91aWQ7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdBc2lnbmFyIGEgJyArXHJcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXHJcbiAgICAgICAgJyBjb21vIGFwcm9iYWRvciBkZSBsb3MgJyArXHJcbiAgICAgICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xyXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICBsZXQgb2tDb3VudCA9IDAsXHJcbiAgICBfZXJyQ291bnQgPSAwO1xyXG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxyXG4gIGNvbnN0IGJhdGNoID0gZmJEYi5iYXRjaCgpO1xyXG4gIHZlbmRlZG9yZXMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xyXG4gICAgYmF0Y2gudXBkYXRlKHJlZiwge1xyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVWlkOiB1aWQsXHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcclxuICAgIG9rQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcclxuICAgIGlmICh0eXBlb2YgbG9nT3AgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xyXG4gICAgICAgIGFwcHJvdmVyVWlkOiB1aWQsXHJcbiAgICAgICAgYXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXHJcbiAgICAgICAgdmVuZGVkb3JVaWRzOiB2ZW5kZWRvcmVzLm1hcCgodikgPT4gdi5fdWlkKSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignYnVsa0Fzc2lnbkFwcHJvdmVyJywgZSk7XHJcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxuICBpZiAob2tDb3VudCkge1xyXG4gICAgc2hvd1N5bmNUYWcob2tDb3VudCArICcgdmVuZGVkb3IoZXMpIGFzaWduYWRvKHMpIGEgJyArIGFwcHJvdmVyTGFiZWwpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fSAvLyByZWZyZXNjYXJcclxuICB9XHJcbn07XHJcblxyXG4vLyBHZW9jb2RpbmcgY29uIEdvb2dsZSBNYXBzIEFQSS4gRGV2dWVsdmUge2xhdCwgbG5nLCBkaXNwbGF5LCBwcmVjaXNpb259XHJcbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9nZW9jb2RlV2l0aEdvb2dsZU1hcHMoYWRkcmVzcywgbG9jYWxpdHksIHByb3ZpbmNlQ29kZSkge1xyXG4gIGNvbnN0IGtleSA9IGF3YWl0IGdldEdtYXBzQXBpS2V5KCk7XHJcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHByb3YgPSB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlQ29kZSB8fCAnJykgOiBwcm92aW5jZUNvZGUgfHwgJyc7XHJcbiAgY29uc3QgZnVsbEFkZHIgPSBbYWRkcmVzcywgbG9jYWxpdHksIHByb3YsICdBcmdlbnRpbmEnXS5maWx0ZXIoQm9vbGVhbikuam9pbignLCAnKTtcclxuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cclxuICBjb25zdCB1cmwgPVxyXG4gICAgJ2h0dHBzOi8vbWFwcy5nb29nbGVhcGlzLmNvbS9tYXBzL2FwaS9nZW9jb2RlL2pzb24nICtcclxuICAgICc/YWRkcmVzcz0nICtcclxuICAgIGVuY29kZVVSSUNvbXBvbmVudChmdWxsQWRkcikgK1xyXG4gICAgJyZyZWdpb249YXInICtcclxuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXHJcbiAgICAnJmxhbmd1YWdlPWVzJyArXHJcbiAgICAnJmtleT0nICtcclxuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2godXJsKTtcclxuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgci5qc29uKCk7XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdPSycgJiYgZGF0YS5yZXN1bHRzICYmIGRhdGEucmVzdWx0cy5sZW5ndGgpIHtcclxuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xyXG4gICAgICBjb25zdCBsb2MgPSByZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uO1xyXG4gICAgICBpZiAoIWxvYykgcmV0dXJuIG51bGw7XHJcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cclxuICAgICAgY29uc3QgbHQgPSAocmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbl90eXBlKSB8fCAnJztcclxuICAgICAgbGV0IHByZWNpc2lvbiA9ICdhZGRyZXNzJztcclxuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xyXG4gICAgICBlbHNlIGlmIChsdCA9PT0gJ0dFT01FVFJJQ19DRU5URVInKSBwcmVjaXNpb24gPSAnc3RyZWV0JztcclxuICAgICAgLy8gRXh0cmFlciBsb2NhbGl0eSArIGFkbWluX2FyZWEgZGVsIHJlc3BvbnNlIHBhcmEgYXV0b2NvbXBsZXRhciBjYW1wb3NcclxuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxyXG4gICAgICBjb25zdCBjb21wb25lbnRzID0gcmVzLmFkZHJlc3NfY29tcG9uZW50cyB8fCBbXTtcclxuICAgICAgY29uc3QgYnlUeXBlID0gKHQpID0+IHtcclxuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xyXG4gICAgICAgIHJldHVybiBjID8gYy5sb25nX25hbWUgfHwgJycgOiAnJztcclxuICAgICAgfTtcclxuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxyXG4gICAgICBjb25zdCBkZXRlY3RlZExvY2FsaXR5ID1cclxuICAgICAgICBieVR5cGUoJ2xvY2FsaXR5JykgfHwgYnlUeXBlKCdzdWJsb2NhbGl0eScpIHx8IGJ5VHlwZSgnYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yJykgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGxhdDogcGFyc2VGbG9hdChsb2MubGF0KSxcclxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXHJcbiAgICAgICAgZGlzcGxheTogcmVzLmZvcm1hdHRlZF9hZGRyZXNzIHx8IGZ1bGxBZGRyLFxyXG4gICAgICAgIHByZWNpc2lvbjogcHJlY2lzaW9uLFxyXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcclxuICAgICAgICBsb2NhdGlvblR5cGU6IGx0LFxyXG4gICAgICAgIGxvY2FsaXR5OiBkZXRlY3RlZExvY2FsaXR5LFxyXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xyXG4gICAgICBjb25zb2xlLmxvZygnW2dtYXBzXSBaRVJPX1JFU1VMVFMgZm9yOicsIGZ1bGxBZGRyKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdSRVFVRVNUX0RFTklFRCcpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihcclxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxyXG4gICAgICAgIGRhdGEuZXJyb3JfbWVzc2FnZSB8fFxyXG4gICAgICAgICAgJyhzaW4gZGV0YWxsZSkuIFJldmlzYXIgcXVlIGxhIEFQSSBrZXkgdGVuZ2EgaGFiaWxpdGFkYSBHZW9jb2RpbmcgQVBJIHkgZWwgcmVmZXJyZXIgcGVybWl0YSBlc3RlIGRvbWluaW8uJ1xyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gT1ZFUl9RVUVSWV9MSU1JVCAtIGV4Y2VkaW8gZWwgbGltaXRlLiBDYWVtb3MgYSBPU00uJyk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIHN0YXR1cyBpbmVzcGVyYWRvOicsIGRhdGEuc3RhdHVzLCBkYXRhLmVycm9yX21lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIGdlb2NvZGUgZXJyb3I6JywgZSk7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcclxuICB0cnkge1xyXG4gICAgY29uc3QgYWVRcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKS5nZXQoKTtcclxuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XHJcbiAgICBhZVFzLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgYWxsb3dlZExpc3QucHVzaChPYmplY3QuYXNzaWduKHsgX2lkOiBkLmlkIH0sIGQuZGF0YSgpKSk7XHJcbiAgICB9KTtcclxuICAgIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcclxuICB9XHJcbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHZW1pbmkgcGFyYSBtb3N0cmFyIGxhIHNlY2Npb24gZGUgQVBJIGtleVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBnU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ2VtaW5pJykuZ2V0KCk7XHJcbiAgICByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uKGdTbmFwLmV4aXN0cyA/IGdTbmFwLmRhdGEoKSA6IG51bGwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignbG9hZCBnZW1pbmkgY29uZmlnJywgZSk7XHJcbiAgICByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uKG51bGwpO1xyXG4gIH1cclxuICAvLyBDYXJnYXIgY29uZmlnIEdvb2dsZSBNYXBzIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXkuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcclxuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihnbVNuYXAuZXhpc3RzID8gZ21TbmFwLmRhdGEoKSA6IG51bGwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcclxuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihudWxsKTtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLm9yZGVyQnkoJ2VtYWlsJykuZ2V0KCk7XHJcbiAgICAvLyBFNiBmaXggQzE6IHZhY2lhciBlbCBBcnJheSBpbi1wbGFjZSAocHJlc2VydmEgd2luZG93LnVzZXJzQ2FjaGUgcmVmKS5cclxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcclxuICAgIHFzLmZvckVhY2goKGRvYykgPT4ge1xyXG4gICAgICB1c2Vyc0NhY2hlLnB1c2goT2JqZWN0LmFzc2lnbih7IF91aWQ6IGRvYy5pZCB9LCBkb2MuZGF0YSgpKSk7XHJcbiAgICB9KTtcclxuICAgIC8vIFJlbmRlciBkZWwgYmxvcXVlIFwiQXNpZ25hciBhcHJvYmFkb3IgYSB0b2RvcyBsb3MgdmVuZGVkb3Jlc1wiIGFycmliYSBkZSBsYSB0YWJsYS5cclxuICAgIHRyeSB7XHJcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdidWxrIGFwcHJvdmVyIHNlY3Rpb24nLCBlKTtcclxuICAgIH1cclxuICAgIC8vIFNpbmNyb25pemFyIGVsIGRpcmVjdG9yaW8gcHVibGljbyBkZSB1c3VhcmlvcyBwYXJhIHF1ZSBsb3MgdmVuZGVkb3Jlc1xyXG4gICAgLy8gcHVlZGFuIHZlciBkZXN0aW5hdGFyaW9zIGFsIGNyZWFyIHRhcmVhcyBlbiBOb3RpZmljYWNpb25lcy4gU2luIGVzdG9cclxuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cclxuICAgIHRyeSB7XHJcbiAgICAgIHN5bmNVc2Vyc0RpcmVjdG9yeSgpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ3N5bmNVc2Vyc0RpcmVjdG9yeScsIGUpO1xyXG4gICAgfVxyXG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcclxuICAgIGNvbnN0IGludGVybm9zID0gdXNlcnNDYWNoZS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ2ludGVybm8nKTtcclxuICAgIGNvbnN0IF9pbnRlcm5vT3B0cyA9XHJcbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcclxuICAgICAgaW50ZXJub3NcclxuICAgICAgICAubWFwKFxyXG4gICAgICAgICAgKHUpID0+XHJcbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgIHUuX3VpZCArXHJcbiAgICAgICAgICAgICdcIj4nICtcclxuICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXHJcbiAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XHJcbiAgICBjb25zdCBjYXJkc0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLWNhcmRzJyk7XHJcbiAgICBsZXQgdGFibGVIdG1sID0gJyc7XHJcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XHJcbiAgICBpZiAoIXVzZXJzQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICAgIHRhYmxlSHRtbCA9XHJcbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvdGQ+PC90cj4nO1xyXG4gICAgICBjYXJkc0h0bWwgPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zaXplOjEycHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC9kaXY+JztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIC8vIEFkbWlucyBwcmltYXJpb3MgcHJvdGVnaWRvczogbm8gc2UgcHVlZGVuIGVsaW1pbmFyIChNYXJpYW5vICsgYm90IGNvcnBvcmF0aXZvKVxyXG4gICAgICBjb25zdCBQUk9URUNURURfQURNSU5fRU1BSUxTID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcclxuICAgICAgLy8gUGFyYSBsb3MgaW50ZXJub3MgY2FsY3VsYW1vcyBsYSByZWxhY2lvbiBpbnZlcnNhOiBxdWllbmVzIGxvcyB0aWVuZW4gY29tbyBwYXJlamFcclxuICAgICAgZnVuY3Rpb24gdmVuZG9yc1BhcmFJbnRlcm5vKGludGVybm9VaWQpIHtcclxuICAgICAgICByZXR1cm4gdXNlcnNDYWNoZS5maWx0ZXIoXHJcbiAgICAgICAgICAodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InICYmIHUuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSBpbnRlcm5vVWlkXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBDYW5kaWRhdG9zIGEgcmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM6IGFkbWluLCBnZXJlbnRlIG8gaW50ZXJubyAobm8gdmVuZGVkb3JlcyBuaSB2aWV3ZXJzIG5pIHVuYXNzaWduZWQpXHJcbiAgICAgIGNvbnN0IHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzID0gdXNlcnNDYWNoZS5maWx0ZXIoXHJcbiAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xyXG4gICAgICApO1xyXG4gICAgICB1c2Vyc0NhY2hlLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgICBjb25zdCBkb2NJZCA9IGQuX3VpZDtcclxuICAgICAgICBjb25zdCBpc1NlbGYgPSBkb2NJZCA9PT0gY3VycmVudFVzZXIudWlkO1xyXG4gICAgICAgIGNvbnN0IGlzUHJvdGVjdGVkID0gUFJPVEVDVEVEX0FETUlOX0VNQUlMUy5pbmRleE9mKChkLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpKSA+PSAwO1xyXG4gICAgICAgIGNvbnN0IGlzSW50ZXJubyA9IGQucm9sZSA9PT0gJ2ludGVybm8nO1xyXG4gICAgICAgIGNvbnN0IHJvbGVPcHRpb25zID0gWyd1bmFzc2lnbmVkJywgJ2FkbWluJywgJ2dlcmVudGUnLCAndmVuZGVkb3InLCAnaW50ZXJubycsICd2aWV3ZXInXVxyXG4gICAgICAgICAgLm1hcChcclxuICAgICAgICAgICAgKHIpID0+XHJcbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgICByICtcclxuICAgICAgICAgICAgICAnXCInICtcclxuICAgICAgICAgICAgICAoZC5yb2xlID09PSByID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgIChpc1NlbGYgJiYgciAhPT0gJ2FkbWluJyA/ICcgZGlzYWJsZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICAgIHIgK1xyXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgICAuam9pbignJyk7XHJcbiAgICAgICAgY29uc3QgdmVuZG9yT3B0aW9ucyA9XHJcbiAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi08L29wdGlvbj4nICtcclxuICAgICAgICAgIFZFTkRPUlMubWFwKFxyXG4gICAgICAgICAgICAodikgPT5cclxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICAgIHYua2V5ICtcclxuICAgICAgICAgICAgICAnXCInICtcclxuICAgICAgICAgICAgICAoZC52ZW5kb3IgPT09IHYua2V5ID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgICAgdi56b25lICtcclxuICAgICAgICAgICAgICAnICcgK1xyXG4gICAgICAgICAgICAgIHYua2V5ICtcclxuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgICAgKS5qb2luKCcnKTtcclxuICAgICAgICAvLyBTaSBlcyBpbnRlcm5vLCBtb3N0cmFyIHJlbGFjaW9uIGludmVyc2EgKHZlbmRlZG9yZXMgcXVlIGxvIHRpZW5lbiBjb21vIHBhcmVqYSkgZW4gdmV6IGRlbCBkcm9wZG93biBlZGl0YWJsZVxyXG4gICAgICAgIGxldCBwYXJlamFDZWxsO1xyXG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcclxuICAgICAgICAgIGNvbnN0IHZpbmMgPSB2ZW5kb3JzUGFyYUludGVybm8oZG9jSWQpO1xyXG4gICAgICAgICAgaWYgKHZpbmMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGxpc3QgPSB2aW5jXHJcbiAgICAgICAgICAgICAgLm1hcCgodSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGFiZWwgPSB1LmRpc3BsYXlOYW1lID8gdS5kaXNwbGF5TmFtZS5zcGxpdCgvXFxzKy8pWzBdIDogdS5lbWFpbCB8fCAnJztcclxuICAgICAgICAgICAgICAgIHJldHVybiAoXHJcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwobGFiZWwpICtcclxuICAgICAgICAgICAgICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+KCcgK1xyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgJycpICtcclxuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtsaW5lLWhlaWdodDoxLjVcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206MnB4XCI+VmVuZGVkb3JlcyBleHRlcm5vcyB2aW5jdWxhZG9zIChhdXRvKTwvZGl2PicgK1xyXG4gICAgICAgICAgICAgIGxpc3QgK1xyXG4gICAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCA9XHJcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXN0eWxlOml0YWxpY1wiPkF1biBuaW5ndW4gdmVuZGVkb3IgbG8gdGllbmUgY29tbyBwYXJlamE8L2Rpdj4nO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxyXG4gICAgICAgICAgcGFyZWphQ2VsbCArPSAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIiBjbGFzcz1cImludGVybmFsLXNlbFwiIHZhbHVlPVwiXCIvPic7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xyXG4gICAgICAgICAgICBpbnRlcm5vc1xyXG4gICAgICAgICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAgICAgICAodSkgPT5cclxuICAgICAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcclxuICAgICAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgICAgIChkLmludGVybmFsUGFydG5lclVpZCA9PT0gdS5fdWlkID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgdS5kaXNwbGF5TmFtZSB8fCB1Ll91aWQpICtcclxuICAgICAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgICAgICApXHJcbiAgICAgICAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICAgICAgcGFyZWphQ2VsbCA9XHJcbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xyXG4gICAgICAgICAgICBpbnRlcm5vT3B0c0ZvclJvdyArXHJcbiAgICAgICAgICAgICc8L3NlbGVjdD4nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCB5b3VUYWcgPSBpc1NlbGZcclxuICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCI+KFZPUyk8L3NwYW4+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjb25zdCBwcm90ZWN0ZWRUYWcgPVxyXG4gICAgICAgICAgaXNQcm90ZWN0ZWQgJiYgIWlzU2VsZlxyXG4gICAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiIHRpdGxlPVwiQWRtaW4gcHJvdGVnaWRvIC0gbm8gc2UgcHVlZGUgZWxpbWluYXJcIj5QUk9URUdJRE88L3NwYW4+J1xyXG4gICAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHdhVmFsID0gZC53aGF0c2FwcCB8fCAnJztcclxuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9XHJcbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHdhVmFsKSArXHJcbiAgICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpXCIgdGl0bGU9XCJOdW1lcm8gV2hhdHNBcHAgY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChzaW4gKyBuaSBlc3BhY2lvcykuIFNlIHVzYSBhbCBlbnZpYXIgbGEgcnV0YS5cIi8+JztcclxuICAgICAgICAvLyBEcm9wZG93biAnUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMnXHJcbiAgICAgICAgY29uc3QgY3VyQXBwcm92ZXJVaWQgPSBkLnJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgJyc7XHJcbiAgICAgICAgbGV0IHJlbmRBcHByb3Zlck9wdGlvbnMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIGFzaWduYXIgLTwvb3B0aW9uPic7XHJcbiAgICAgICAgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xyXG4gICAgICAgICAgaWYgKHUuX3VpZCA9PT0gZG9jSWQpIHJldHVybjsgLy8gdW4gdXN1YXJpbyBubyBwdWVkZSBzZXIgc3UgcHJvcGlvIGFwcm9iYWRvclxyXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArPVxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICBlc2NhcGVBdHRyKHUuX3VpZCkgK1xyXG4gICAgICAgICAgICAnXCInICtcclxuICAgICAgICAgICAgKGN1ckFwcHJvdmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWwobGJsKSArXHJcbiAgICAgICAgICAgICc8L29wdGlvbj4nO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IHJlbmRBcHByb3Zlckh0bWwgPVxyXG4gICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJyZW5kLWFwcHJvdmVyLXNlbFwiIHRpdGxlPVwiUXVpZW4gYXBydWViYSBsYXMgcmVuZGljaW9uZXMgZGUgZXN0ZSB1c3VhcmlvXCI+JyArXHJcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD4nO1xyXG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ2FtYmlhciBjb250cmFzZVx1MDBGMWFcclxuICAgICAgICBjb25zdCBwd2RCdG5IdG1sID1cclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4XCIgb25jbGljaz1cImNoYW5nZVVzZXJQYXNzd29yZChcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgIFwiJywgXCIgK1xyXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcclxuICAgICAgICAgICcpXCI+Q29udHJhc2VcdTAwRjFhPC9idXR0b24+JztcclxuICAgICAgICAvLyBCb3RcdTAwRjNuIENvbmZpZ3VyYXIgMkZBXHJcbiAgICAgICAgY29uc3QgdG90cFN0YXR1c1RhZyA9IGQudG90cEVuYWJsZWRcclxuICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiMxMGI5ODE7Zm9udC13ZWlnaHQ6ODAwXCI+JiMxMDAwMzs8L3NwYW4+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9XHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweDtiYWNrZ3JvdW5kOicgK1xyXG4gICAgICAgICAgKGQudG90cEVuYWJsZWQgPyAnIzEwYjk4MScgOiAnIzViMjFiNicpICtcclxuICAgICAgICAgICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgIFwiJywgXCIgK1xyXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcclxuICAgICAgICAgICcpXCI+MkZBJyArXHJcbiAgICAgICAgICB0b3RwU3RhdHVzVGFnICtcclxuICAgICAgICAgICc8L2J1dHRvbj4nO1xyXG4gICAgICAgIC8vIERlc2t0b3Agcm93XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dHIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArIHlvdVRhZyArIHByb3RlY3RlZFRhZyArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSB8fCAnJykgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgKyByb2xlT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICsgdmVuZG9yT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHBhcmVqYUNlbGwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkIGNsYXNzPVwid2EtY29sXCI+JyArIHdhSW5wdXRIdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcmVuZEFwcHJvdmVySHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHB3ZEJ0bkh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB0b3RwQnRuSHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgY29uc3Qgc2hvd0RlbGV0ZSA9ICFpc1NlbGYgJiYgIWlzUHJvdGVjdGVkO1xyXG4gICAgICAgIGNvbnN0IGRlbEJ0biA9IHNob3dEZWxldGVcclxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICB0YWJsZUh0bWwgKz1cclxuICAgICAgICAgICc8dGQ+JyArXHJcbiAgICAgICAgICBkZWxCdG4gK1xyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8L3RyPic7XHJcbiAgICAgICAgLy8gTW9iaWxlIGNhcmRcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1c2Vycy1jYXJkXCIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2PjxkaXYgY2xhc3M9XCJ1Yy1lbWFpbFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArXHJcbiAgICAgICAgICB5b3VUYWcgK1xyXG4gICAgICAgICAgcHJvdGVjdGVkVGFnICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGlmIChkLmRpc3BsYXlOYW1lKVxyXG4gICAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtbmFtZVwiPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUpICsgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+Um9sPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICtcclxuICAgICAgICAgIHJvbGVPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgK1xyXG4gICAgICAgICAgdmVuZG9yT3B0aW9ucyArXHJcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcclxuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3JlcyB2aW5jdWxhZG9zIChhdXRvKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xyXG4gICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlBhcmVqYSBpbnRlcm5vIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xyXG4gICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgK1xyXG4gICAgICAgICAgd2FJbnB1dEh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5SZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczwvbGFiZWw+JyArXHJcbiAgICAgICAgICByZW5kQXBwcm92ZXJIdG1sICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcclxuICAgICAgICAgIHB3ZEJ0bkh0bWwgK1xyXG4gICAgICAgICAgdG90cEJ0bkh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGVcclxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgK1xyXG4gICAgICAgICAgZGVsQnRuQyArXHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIHRib2R5LmlubmVySFRNTCA9IHRhYmxlSHRtbDtcclxuICAgIGNhcmRzRWwuaW5uZXJIVE1MID0gY2FyZHNIdG1sO1xyXG4gICAgLy8gQWN0dWFsaXphIGhlYWRlciBkZSB0YWJsYSBjb24gbGEgY29sdW1uYSBudWV2YVxyXG4gICAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjdXNlcnMtdGFibGUgdGhlYWQgdHInKTtcclxuICAgIGlmICh0aGVhZClcclxuICAgICAgdGhlYWQuaW5uZXJIVE1MID1cclxuICAgICAgICAnPHRoPkVtYWlsPC90aD48dGg+Tm9tYnJlPC90aD48dGg+Um9sPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5QYXJlamEgaW50ZXJubzwvdGg+PHRoIGNsYXNzPVwid2EtY29sXCI+V2hhdHNBcHA8L3RoPjx0aD5SZXNwLiByZW5kaWNpb25lczwvdGg+PHRoPlBhc3M8L3RoPjx0aD4yRkE8L3RoPjx0aD48L3RoPic7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjI6IGRlbGV0ZVVzZXJSb2xlICsgVE9UUCArIGNoYW5nZVVzZXJQYXNzd29yZCArIHNhdmVVc2VyUm9sZSAoaW5saW5lIEwxNDEwNS0xNDM5MClcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZGVsZXRlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICBhbGVydCgnTm8gcG9kZXMgZWxpbWluYXIgdHUgcHJvcGlvIGFjY2Vzby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRGVmZW5zYSBhZGljaW9uYWw6IGFkbWlucyBwcm90ZWdpZG9zIG5vIHNlIHB1ZWRlbiBlbGltaW5hciBuaSBkZXNkZSBjb25zb2xhXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXBQcmUgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBjb25zdCBlbWFpbFByZSA9IChzbmFwUHJlLmV4aXN0cyA/IHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnIDogJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCBQUk9URUNURUQgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgaWYgKFBST1RFQ1RFRC5pbmRleE9mKGVtYWlsUHJlKSA+PSAwKSB7XHJcbiAgICAgIGFsZXJ0KCdFc3RlIGVzIHVuIGFkbWluIHByb3RlZ2lkbyAoJyArIGVtYWlsUHJlICsgJykgeSBubyBzZSBwdWVkZSBlbGltaW5hci4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAvKiBzaSBmYWxsYSBsYSBsZWN0dXJhIHByZXZpYSwgc2lndWUgY29uIGNvbmZpcm0gKi9cclxuICB9XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBhY2Nlc28gZGUgZXN0ZSB1c3VhcmlvP1xcblxcblBpZXJkZSBhY2Nlc28gZGUgaW5tZWRpYXRvLiBTaSB2dWVsdmUgYSBlbnRyYXIgY29uIEdvb2dsZSB2YSBhIHF1ZWRhciBjb21vIFwic2luIHJvbCBhc2lnbmFkb1wiIGhhc3RhIHF1ZSB2b3MgbG8gaGFiaWxpdGVzIGRlIG51ZXZvLlxcblxcblN1IGN1ZW50YSBHb29nbGUgc2lndWUgZXhpc3RpZW5kbywgbm8gc2UgYm9ycmEuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGNvbnN0IGRhdGEgPSBzbmFwLmV4aXN0cyA/IHNuYXAuZGF0YSgpIDoge307XHJcbiAgICBsb2dPcCgnZWxpbWluYXJfdXN1YXJpbycsICd1c2VyJywgZGF0YS5lbWFpbCB8fCB1aWQsIHtcclxuICAgICAgdWlkLFxyXG4gICAgICBwcmV2aW91c1JvbGU6IGRhdGEucm9sZSxcclxuICAgICAgcHJldmlvdXNWZW5kb3I6IGRhdGEudmVuZG9yLFxyXG4gICAgfSk7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnVXN1YXJpbyBlbGltaW5hZG8nKTtcclxuICAgIGF3YWl0IG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XHJcblxyXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XHJcbiAgY29uc29sZS5sb2coJ1syRkFdIG9wZW5Ub3RwU2V0dXAgY2FsbGVkJywgeyB1aWQsIGVtYWlsLCB1c2VyUm9sZSB9KTtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGVsIGFkbWluaXN0cmFkb3IgcHVlZGUgY29uZmlndXJhciAyRkEgcGFyYSBvdHJvcyB1c3Vhcmlvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCF1aWQpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogVUlEIGRlbCB1c3VhcmlvIG5vIGRpc3BvbmlibGUuIFJlY2FyZ2EgbGEgcGFnaW5hIHkgcmVpbnRlbnRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XHJcbiAgLy8gTW9kYWwgZXhpc3RlP1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKTtcclxuICBpZiAoIW1vZGFsKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvIGVuIGVsIERPTS4gUmVjYXJnYSBsYSBwYWdpbmEgKEN0cmwrU2hpZnQrUikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHN1YnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLXN1YnQnKTtcclxuICBpZiAoc3VidEVsKSBzdWJ0RWwudGV4dENvbnRlbnQgPSAnUGFyYTogJyArIChlbWFpbCB8fCB1aWQpO1xyXG4gIC8vIExlZXIgZXN0YWRvIGFjdHVhbFxyXG4gIGxldCBjdXJFbmFibGVkID0gZmFsc2U7XHJcbiAgbGV0IGN1clNlY3JldCA9IG51bGw7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBjdXJFbmFibGVkID0gISFkLnRvdHBFbmFibGVkO1xyXG4gICAgICBjdXJTZWNyZXQgPSBkLnRvdHBTZWNyZXQgfHwgbnVsbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignWzJGQV0gZG9jIHJvbGVzLycgKyB1aWQgKyAnIG5vIGV4aXN0ZScpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1syRkFdIGVycm9yIGxleWVuZG8gcm9sZXMvJyArIHVpZCwgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBlbCBlc3RhZG8gZGUgMkZBIGRlbCB1c3VhcmlvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XHJcbiAgaWYgKCFjKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IGNvbnRlbmVkb3IgZGVsIG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvLiBSZWNhcmdhIGxhIHBhZ2luYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGN1ckVuYWJsZWQgJiYgY3VyU2VjcmV0KSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzLWJnKTtib3JkZXI6MXB4IHNvbGlkICM4NmVmYWM7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO3RleHQtYWxpZ246Y2VudGVyXCI+JyArXHJcbiAgICAgICc8Yj4mIzEwMDAzOyAyRkEgeWEgZXN0XHUwMEUxIGFjdGl2bzwvYj4gcGFyYSBlc3RlIHVzdWFyaW8uJyArXHJcbiAgICAgICc8YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTFweFwiPlNpIGxvIHBlcmRpXHUwMEYzIG8gY2FtYmlcdTAwRjMgZGUgY2VsdWxhciwgcG9kXHUwMEU5cyBnZW5lcmFybGUgdW5vIG51ZXZvIChlbCBhbnRlcmlvciBxdWVkYSBpbnZhbGlkYWRvKS48L3NwYW4+JyArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDttYXJnaW4tdG9wOjE0cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXHJcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXHJcbiAgICAgIFwiJywnXCIgK1xyXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXHJcbiAgICAgICdcXCcpXCI+R2VuZXJhciBudWV2byAocmVzZXRlYXIpPC9idXR0b24+JyArXHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRpc2FibGVUb3RwKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICAnXFwnKVwiPkRlc2hhYmlsaXRhciAyRkE8L2J1dHRvbj4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGMuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNlZmY2ZmY7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjojMWU0MGFmO3RleHQtYWxpZ246Y2VudGVyXCI+JyArXHJcbiAgICAgICdFc3RlIHVzdWFyaW8gdG9kYXZcdTAwRURhIG5vIHRpZW5lIDJGQSBjb25maWd1cmFkby4gR2VuZXJcdTAwRTEgdW4gbnVldm8gY1x1MDBGM2RpZ28gcGFyYSBxdWUgbG8gZXNjYW5lZSBjb24gR29vZ2xlIEF1dGhlbnRpY2F0b3IuJyArXHJcbiAgICAgICc8L2Rpdj4nICtcclxuICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tdG9wOjE0cHhcIj4nICtcclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICBcIicsJ1wiICtcclxuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xyXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgMkZBPC9idXR0b24+JyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gIH1cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlVG90cFNldHVwTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xyXG59O1xyXG5cclxud2luZG93LmdlbmVyYXRlTmV3VG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgY29uc3Qgc2VjcmV0ID0gdG90cEdlbmVyYXRlU2VjcmV0KCk7XHJcbiAgY29uc3Qgb3RwYXV0aCA9IHRvdHBCdWlsZE90cGF1dGhVcmwoc2VjcmV0LCBlbWFpbCB8fCB1aWQpO1xyXG4gIHRvdHBTZXR1cFN0YXRlID0geyB1aWQ6IHVpZCwgZW1haWw6IGVtYWlsLCBzZWNyZXQ6IHNlY3JldCwgb3RwYXV0aDogb3RwYXV0aCB9O1xyXG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XHJcbiAgYy5pbm5lckhUTUwgPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXdhcm5pbmctYmcpO2JvcmRlcjoxcHggc29saWQgI2ZjZDM0ZDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6Izc4MzUwZjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcclxuICAgICc8Yj5QYXNvcyBwYXJhIGFjdGl2YXI6PC9iPjxicj4nICtcclxuICAgICcxLiBFbCB1c3VhcmlvIGluc3RhbGEgPGI+R29vZ2xlIEF1dGhlbnRpY2F0b3I8L2I+IGVuIHN1IGNlbHVsYXIuPGJyPicgK1xyXG4gICAgJzIuIFRvY2EgXCJBZ3JlZ2FyXCIgLyBcIitcIiBlbiBsYSBhcHAuPGJyPicgK1xyXG4gICAgJzMuIEVsaWdlIFwiRXNjYW5lYXIgY1x1MDBGM2RpZ28gUVJcIiB5IGVzY2FuZWEgZWwgY1x1MDBGM2RpZ28gYWJham8gKG8gcGVnYSBlbCBzZWNyZXQgbWFudWFsbWVudGUpLjxicj4nICtcclxuICAgICc0LiBBcGFyZWNlIHVuIGNcdTAwRjNkaWdvIGRlIDYgZFx1MDBFRGdpdG9zIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yLjxicj4nICtcclxuICAgICc1LiBMbyBlc2NyaWJlIGVuIGVsIGlucHV0IGRlIGFiYWpvIHBhcmEgY29uZmlybWFyIHkgYWN0aXZhci4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7cGFkZGluZzoxMHB4O2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTBweDt0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjRweFwiPlNlY3JldCAoY2FyZ2EgbWFudWFsIHNpIGVsIFFSIGZhbGxhKTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO3dvcmQtYnJlYWs6YnJlYWstYWxsO2xldHRlci1zcGFjaW5nOi4xZW1cIj4nICtcclxuICAgIGVzY2FwZUh0bWwoc2VjcmV0KSArXHJcbiAgICAnPC9kaXY+JyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOjEwcHhcIj48bGFiZWwgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo1cHhcIj5DXHUwMEYzZGlnbyBkZSB2ZXJpZmljYWNpXHUwMEYzbiBkZSBHb29nbGUgQXV0aGVudGljYXRvcjwvbGFiZWw+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJ0b3RwLWNvbmZpcm0taW5wdXRcIiBpbnB1dG1vZGU9XCJudW1lcmljXCIgbWF4bGVuZ3RoPVwiN1wiIHBsYWNlaG9sZGVyPVwiMDAwMDAwXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItZGVmYXVsdCk7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7bGV0dGVyLXNwYWNpbmc6LjNlbTtmb250LXdlaWdodDo4MDBcIi8+PC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJjb25maXJtVG90cFNldHVwKClcIj5WZXJpZmljYXIgeSBhY3RpdmFyPC9idXR0b24+JyArXHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJjbG9zZVRvdHBTZXR1cE1vZGFsKClcIj5DYW5jZWxhcjwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgLy8gTGF6eS1sb2FkIHFyY29kZWpzIHkgZ2VuZXJhci4gRXN0YSBsaWJyZXJpYSBwaW50YSBlbCBRUiBkaXJlY3RvIGVuIGVsXHJcbiAgLy8gY29udGVuZWRvciBET00gdmlhIGNhbnZhcy9pbWcgLSBubyBuZWNlc2l0YSBjYWxsYmFjayB0b0RhdGFVUkwuXHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGxvYWRRUkNvZGVMaWIoKTtcclxuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xyXG4gICAgaWYgKCFib3gpIHJldHVybjtcclxuICAgIGJveC5pbm5lckhUTUwgPSAnJzsgLy8gbGltcGlhciBlbCBcIkdlbmVyYW5kbyBRUi4uLlwiXHJcbiAgICBuZXcgUVJDb2RlKGJveCwge1xyXG4gICAgICB0ZXh0OiBvdHBhdXRoLFxyXG4gICAgICB3aWR0aDogMjIwLFxyXG4gICAgICBoZWlnaHQ6IDIyMCxcclxuICAgICAgY29sb3JEYXJrOiAnIzAwMDAwMCcsXHJcbiAgICAgIGNvbG9yTGlnaHQ6ICcjZmZmZmZmJyxcclxuICAgICAgY29ycmVjdExldmVsOiBRUkNvZGUuQ29ycmVjdExldmVsLk0sXHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1syRkFdIEVycm9yIGNhcmdhbmRvIFFSIGxpYjonLCBlKTtcclxuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xyXG4gICAgaWYgKGJveClcclxuICAgICAgYm94LmlubmVySFRNTCA9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1jb2xvci1kYW5nZXItc3Ryb25nKTtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIXRvdHBTZXR1cFN0YXRlKSByZXR1cm47XHJcbiAgY29uc3QgY29kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1jb25maXJtLWlucHV0JykudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xyXG4gIGlmICghL15cXGR7Nn0kLy50ZXN0KGNvZGUpKSB7XHJcbiAgICBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xyXG4gIGlmICghb2spIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnQ1x1MDBGM2RpZ28gaW5jb3JyZWN0by4gQXNlZ3VyYXRlIGRlIHF1ZSBlbCBzZWNyZXQgc2UgY2FyZ1x1MDBGMyBiaWVuIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yIHkgcmVpbnRlbnRcdTAwRTEuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpXHJcbiAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcclxuICAgICAgICB0b3RwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB0b3RwRW5hYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGFjdGl2YWRvIHBhcmEgJyArICh0b3RwU2V0dXBTdGF0ZS5lbWFpbCB8fCAndXN1YXJpbycpKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKCFjb25maXJtKCdEZXNoYWJpbGl0YXIgMkZBIHBhcmEgZXN0ZSB1c3VhcmlvPyBWYSBhIGVudHJhciBzb2xvIGNvbiBwYXNzd29yZC4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgIC5kb2ModWlkKVxyXG4gICAgICAudXBkYXRlKHtcclxuICAgICAgICB0b3RwRW5hYmxlZDogZmFsc2UsXHJcbiAgICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXHJcbiAgICAgICAgdG90cERpc2FibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHRvdHBEaXNhYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2hhbmdlVXNlclBhc3N3b3JkID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWVtYWlsKSB7XHJcbiAgICBhbGVydCgnRXN0ZSB1c3VhcmlvIG5vIHRpZW5lIGVtYWlsIHJlZ2lzdHJhZG8gLSBubyBzZSBwdWVkZSByZXNldGVhci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgY2hvaWNlID0gcHJvbXB0KFxyXG4gICAgJ1Jlc2V0ZWFyIGNvbnRyYXNlXHUwMEYxYSBkZSAnICtcclxuICAgICAgZW1haWwgK1xyXG4gICAgICAnXFxuXFxuJyArXHJcbiAgICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXHJcbiAgICAgICcxKSBFTlZJQVIgTUFJTCBERSBSRVNFVEVPIChyZWNvbWVuZGFkbylcXG4nICtcclxuICAgICAgJyBMZSBsbGVnYSBhICcgK1xyXG4gICAgICBlbWFpbCArXHJcbiAgICAgICcgdW4gbWFpbCBkZSBGaXJlYmFzZSBjb24gdW4gbGluay5cXG4nICtcclxuICAgICAgJyBFbCB1c3VhcmlvIGNsaWNrZWEsIHNldGVhIHN1IG51ZXZhIHBhc3N3b3JkIHkgdnVlbHZlIGEgbGEgYXBwLlxcbicgK1xyXG4gICAgICAnIEVzIGxvIGVzdGFuZGFyIHkgZnVuY2lvbmEgc2VndXJvLlxcblxcbicgK1xyXG4gICAgICAnMikgUmVzZXRlYXIgU09MTyBlbCBwYXNzd29yZC1nYXRlIChzZWd1bmRhIGNhcGEpLlxcbicgK1xyXG4gICAgICAnIE5vIGNhbWJpYSBsYSBwYXNzd29yZCByZWFsIGRlIEZpcmViYXNlLiBTaXJ2ZSBzaSBlbCB1c3VhcmlvXFxuJyArXHJcbiAgICAgICcgZW50cmEgcG9yIEdvb2dsZSB5IG9sdmlkbyBsYSBwYXNzd29yZC1nYXRlIGRlIGxhIGFwcCwgTk8gc2lcXG4nICtcclxuICAgICAgJyBvbHZpZG8gbGEgcGFzc3dvcmQgZGVsIGxvZ2luIGNvbiBlbWFpbC5cXG5cXG4nICtcclxuICAgICAgJ0VzY3JpYmkgMSBvIDI6JyxcclxuICAgICcxJ1xyXG4gICk7XHJcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcclxuICAgICAgYWxlcnQoXHJcbiAgICAgICAgJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArXHJcbiAgICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgICAnLiBEZWNpbGUgcXVlIHJldmlzZSBpbmJveCB5IHNwYW0uIEVsIGxpbmsgZXhwaXJhIGVuIDEgaG9yYS4nXHJcbiAgICAgICk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgICAgIC5kb2ModWlkKVxyXG4gICAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcclxuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdChcclxuICAgICAgJ051ZXZhIHBhc3N3b3JkLWdhdGUgcGFyYSAnICtcclxuICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgJzpcXG5cXG4oU29sbyBhZmVjdGEgbGEgc2VndW5kYSBjYXBhIGRlIGxhIGFwcCwgTk8gZWwgbG9naW4gY29uIGVtYWlsKScsXHJcbiAgICAgICcnXHJcbiAgICApO1xyXG4gICAgaWYgKG5ld1B3ZCA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gICAgY29uc3QgcHdkID0gKG5ld1B3ZCB8fCAnJykudHJpbSgpO1xyXG4gICAgaWYgKHB3ZC5sZW5ndGggPCA0KSB7XHJcbiAgICAgIGFsZXJ0KCdMYSBjb250cmFzZVx1MDBGMWEgdGllbmUgcXVlIHRlbmVyIGFsIG1lbm9zIDQgY2FyYWN0ZXJlcy4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZHMgPSBhd2FpdCBidWlsZFBhc3N3b3JkQ3JlZGVudGlhbHMocHdkKTtcclxuICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgICAgLmRvYyh1aWQpXHJcbiAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICBwYXNzd29yZEhhc2g6IGNyZWRzLnBhc3N3b3JkSGFzaCxcclxuICAgICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIHNob3dTeW5jVGFnKCdQYXNzd29yZC1nYXRlIGFjdHVhbGl6YWRhIHBhcmEgJyArIGVtYWlsKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGJ0bikge1xyXG4gIGNvbnN0IGNvbnRhaW5lciA9IGJ0bi5jbG9zZXN0KCd0cicpIHx8IGJ0bi5jbG9zZXN0KCcudXNlcnMtY2FyZCcpO1xyXG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XHJcbiAgY29uc3Qgcm9sZSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucm9sZS1zZWwnKS52YWx1ZTtcclxuICBjb25zdCB2ZW5kb3IgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnZlbmRvci1zZWwnKS52YWx1ZSB8fCBudWxsO1xyXG4gIGNvbnN0IGludGVybmFsU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5pbnRlcm5hbC1zZWwnKTtcclxuICBjb25zdCBpbnRlcm5hbFBhcnRuZXJVaWQgPSBpbnRlcm5hbFNlbCA/IGludGVybmFsU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxyXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XHJcbiAgY29uc3Qgd2hhdHNhcHAgPSB3YUlucHV0ID8gKHdhSW5wdXQudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcRC9nLCAnJykgOiAnJztcclxuICBpZiAod2hhdHNhcHAgJiYgd2hhdHNhcHAubGVuZ3RoIDwgOCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcyAodWlkIGRlbCB1c3VhcmlvIHF1ZSBhcHJ1ZWJhKVxyXG4gIGNvbnN0IHJlbmRBcHByb3ZlclNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucmVuZC1hcHByb3Zlci1zZWwnKTtcclxuICBjb25zdCByZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZEFwcHJvdmVyU2VsID8gcmVuZEFwcHJvdmVyU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xyXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcclxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xyXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cclxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcclxuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xyXG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCk7XHJcbiAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBhcHByb3ZlclVzZXIgPyBhcHByb3ZlclVzZXIuZW1haWwgfHwgbnVsbCA6IG51bGw7XHJcbiAgfVxyXG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgYnRuLnRleHRDb250ZW50ID0gJy4uLic7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh1aWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcm9sZSxcclxuICAgICAgICAgIHZlbmRvcixcclxuICAgICAgICAgIGludGVybmFsUGFydG5lclVpZCxcclxuICAgICAgICAgIHdoYXRzYXBwOiB3aGF0c2FwcCB8fCBudWxsLFxyXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogcmVuZGljaW9uZXNBcHByb3ZlclVpZCxcclxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLFxyXG4gICAgICAgICAgYXNzaWduZWRCeTogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYXNzaWduZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIC8vIFNpIGVsIHVzdWFyaW8gZWRpdG8gc3UgcHJvcGlvIG51bWVybywgYWN0dWFsaXphciBlbCBjYWNoZSBsb2NhbFxyXG4gICAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICAgIG15V2hhdHNhcHBOdW1iZXIgPSB3aGF0c2FwcCB8fCBudWxsO1xyXG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8IG51bGw7XHJcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsIHx8IG51bGw7XHJcbiAgICB9XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnT0snO1xyXG4gICAgLy8gUmUtcmVuZGVyIGRlbCBwYW5lbCBhc2kgbG9zIGRyb3Bkb3ducyBcIlBhcmVqYSBpbnRlcm5vXCIgbXVlc3RyYW4gbG9zIGludGVybm9zIGFjdHVhbGl6YWRvc1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ3JlZnJlc2ggYWRtaW4gcGFuZWwnLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSwgNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIFRvZG9zIGxvcyBoYW5kbGVycyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgc29uIHZlcmJhdGltLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF1QkEsTUFBSSxPQUFPLE9BQU8sZUFBZSxZQUFhLFFBQU8sYUFBYSxDQUFDO0FBQ25FLE1BQU0sYUFBYSxPQUFPO0FBRTFCLFdBQVMsMkJBQTJCLGFBQWE7QUFDL0MsVUFBTSxLQUFLLFNBQVMsZUFBZSx3QkFBd0I7QUFDM0QsUUFBSSxDQUFDLEdBQUk7QUFDVCxtQkFBZSxlQUFlLENBQUMsR0FDNUIsTUFBTSxFQUNOLEtBQUssQ0FBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksY0FBYyxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQzlELFFBQUksT0FBTztBQUNYLFlBQVE7QUFDUixZQUNFO0FBQ0YsWUFBUTtBQUNSLFFBQUksQ0FBQyxZQUFZLFFBQVE7QUFDdkIsY0FDRTtBQUFBLElBQ0osT0FBTztBQUNMLGNBQ0U7QUFDRixrQkFBWSxRQUFRLENBQUMsT0FBTztBQUMxQixjQUFNLFFB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
