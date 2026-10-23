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
          const pwdBtnHtml = `<button class="app-btn-pill app-btn-violet" style="padding:5px 6px;font-size:10px;width:100%;white-space:nowrap;box-sizing:border-box" title="Cambiar contrase\xF1a" onclick="changeUserPassword('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">Pass</button>';
          const totpStatusTag = d.totpEnabled ? ' <span style="color:#10b981;font-weight:800">&#10003;</span>' : "";
          const totpBtnHtml = '<button class="app-btn-pill app-btn-violet" style="padding:5px 6px;font-size:10px;width:100%;white-space:nowrap;box-sizing:border-box;background:' + (d.totpEnabled ? "#10b981" : "#5b21b6") + `" title="Configurar 2FA" onclick="openTotpSetup('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">2FA' + totpStatusTag + "</button>";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNpIHVuIHZlbmRlZG9yIHVzYSBHbWFpbCBwZXJzb25hbCAobm8gQHNoaW1hbm8uY29tLmFyKSwgYWdyZWdhbG8gYWNhIGFudGVzIHF1ZSBpbnRlbnRlIGxvZ3VlYXIuIExvcyBlbWFpbHMgQHNoaW1hbm8uY29tLmFyIHkgbG9zIGFkbWlucyBoYXJkY29kZWQgeWEgZXN0YW4gYXV0b3JpemFkb3MgYXV0b21hdGljYW1lbnRlLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmICghYWxsb3dlZExpc3QubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gICAgYWxsb3dlZExpc3QuZm9yRWFjaCgoYWUpID0+IHtcbiAgICAgIGNvbnN0IGxhYmVsID0gZXNjYXBlSHRtbChhZS5lbWFpbCB8fCBhZS5faWQpO1xuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBsYWJlbCArXG4gICAgICAgIG5vdGUgK1xuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVtb3ZlQWxsb3dlZEVtYWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiUXVpdGFyIGF1dG9yaXphY2lvblwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXIpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo1MCU7d2lkdGg6MThweDtoZWlnaHQ6MThweDtmb250LXNpemU6MTFweDtjdXJzb3I6cG9pbnRlcjtsaW5lLWhlaWdodDoxXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xuICAgICAgICAnPC9kaXY+JztcbiAgICB9KTtcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWJsdWVcIiBvbmNsaWNrPVwiYWRkQWxsb3dlZEVtYWlsKClcIj4mIzQzOyBBZ3JlZ2FyIGVtYWlsPC9idXR0b24+PC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cblxud2luZG93LmFkZEFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHJhdyA9IHByb21wdCgnRW1haWwgYSBhdXRvcml6YXIgKGVqLiBhdXRvbWF0cml4Lm9maWNpYWxAZ21haWwuY29tKTonKTtcbiAgaWYgKCFyYXcpIHJldHVybjtcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIGlmICghL15bXlxcc0BdK0BbXlxcc0BdK1xcLlteXFxzQF0rJC8udGVzdChlbWFpbCkpIHtcbiAgICBhbGVydCgnRWwgZW1haWwgbm8gcGFyZWNlIHZhbGlkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgbm90ZSA9XG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XG4gIGNvbnN0IGRvY0lkID0gZW1haWxUb0RvY0lkKGVtYWlsKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKVxuICAgICAgLmRvYyhkb2NJZClcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBlbWFpbCxcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcbiAgICAgICAgICBhZGRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBzaG93U3luY1RhZygnRW1haWwgYXV0b3JpemFkbzogJyArIGVtYWlsKTtcbiAgICAvLyBSZWNhcmdhciBwYW5lbFxuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignYWRkQWxsb3dlZEVtYWlsJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdRdWl0YXIgbGEgYXV0b3JpemFjaW9uIGRlIGVzdGUgZW1haWw/IFNpIGVsIHVzdWFyaW8geWEgdGllbmUgcm9sIGFzaWduYWRvIGVuIGVsIHBhbmVsLCB2YSBhIHNlZ3VpciBlbnRyYW5kbyAobGEgcmVnbGEgcHJlLWFwcm9iYWRhIHBvciByb2wgdGFtYmllbiBhcGxpY2EpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XG4gICAgc2hvd1N5bmNUYWcoJ0F1dG9yaXphY2lvbiBxdWl0YWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09IFNlY2Npb24gR2VtaW5pIEFQSSBLZXkgKGFkbWluKSA9PT1cbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ2VtaW5pLWNvbmZpZy1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXG4gIC8vIHY2MzkgKDIwMjYtMDgtMjYpOiBVWCBzaW1wbGlmaWNhZG8gcG9yIHBlZGlkbyBNYXJpYW5vIFx1MjAxNCBzaW4gaW5zdHJ1Y2Npb25lc1xuICAvLyBDTEkgZW4gZWwgcGFuZWwsIHNvbG8gdW4gYmFubmVyIGV4cGxpY2FuZG8gZG9uZGUgdml2ZSBsYSBrZXkuXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cbiAgZWwudGV4dENvbnRlbnQgPSAnJztcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxuICAgICd0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE0cHggMTJweDtiYWNrZ3JvdW5kOiNmNWYzZmY7Ym9yZGVyOjFweCBzb2xpZCAjZGRkNmZlO2JvcmRlci1yYWRpdXM6NnB4JztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTttYXJnaW4tYm90dG9tOjZweCc7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0dlbWluaSBBUEkgS2V5IChPQ1IgZGUgdGlja2V0cyknO1xuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbXNnLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xuICAvLyBJY29ubyBjYW5kYWRvICsgdGV4dG8uIHRleHRDb250ZW50IGVzIHNhZmUgKG5vIEhUTUwgcGFyc2luZykuXG4gIG1zZy50ZXh0Q29udGVudCA9ICdHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XG4gIHdyYXAuYXBwZW5kQ2hpbGQodGl0bGUpO1xuICB3cmFwLmFwcGVuZENoaWxkKG1zZyk7XG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXG4vLyBlbiBTZWNyZXQgTWFuYWdlciwgbm8gZW4gRmlyZXN0b3JlLiBTZSBhZG1pbmlzdHJhIHBvciBDTEkuIFZlclxuLy8gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbiBwYXJhIGxhcyBpbnN0cnVjY2lvbmVzLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdPT0dMRSBNQVBTIEdlb2NvZGluZyBBUEkgLSBtZWpvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwgcXVlIE9TTVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMYSBrZXkgc2UgZ3VhcmRhIGVuIGFwcF9jb25maWcvZ29vZ2xlX21hcHMuIFNpIGVzdGEgc2V0ZWFkYSwgbGEgdXNhbW9zXG4vLyBjb21vIGdlb2NvZGVyIFBSSU1BUklPIGVuIGdlb2NvZGVDbGllbnRBZGRyZXNzOyBzaSBmYWxsYSBvIG5vIGVzdGFcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxubGV0IGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuYXN5bmMgZnVuY3Rpb24gZ2V0R21hcHNBcGlLZXkoKSB7XG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xuICAgIGlmIChzbmFwLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKGQuYXBpS2V5KSB7XG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcbiAgICAgICAgcmV0dXJuIGQuYXBpS2V5O1xuICAgICAgfVxuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBubyBzZSBwdWRvIGxlZXIgYXBpIGtleScsIGUpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ21hcHMtY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xuICBjb25zdCBtYXNrZWQgPSBoYXNLZXkgPyBkYXRhLmFwaUtleS5zbGljZSgwLCA0KSArICdcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjInICsgZGF0YS5hcGlLZXkuc2xpY2UoLTQpIDogJyc7XG4gIGNvbnN0IHVwZGF0ZWRCeSA9IChkYXRhICYmIGRhdGEudXBkYXRlZEJ5KSB8fCAnJztcbiAgY29uc3QgdXBkYXRlZEF0ID1cbiAgICBkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZVxuICAgICAgPyBkYXRhLnVwZGF0ZWRBdC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxuICAgICAgOiAnJztcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKGhhc0tleSkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjNmVlN2I3O2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjb2xvcjojMDY1ZjQ2XCI+JyArXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xuICAgICAgJzwvc3Bhbj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Q2FyZ2FkYSBwb3IgJyArXG4gICAgICBlc2NhcGVIdG1sKHVwZGF0ZWRCeSB8fCAnYWRtaW4nKSArXG4gICAgICAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcbiAgICAnPC9idXR0b24+JztcbiAgaWYgKGhhc0tleSlcbiAgICBodG1sICs9XG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCByYXcgPSBwcm9tcHQoXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXG4gICAgJydcbiAgKTtcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xuICBpZiAoIWtleSkge1xuICAgIGFsZXJ0KCdWYWNpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBhcGlLZXk6IGtleSxcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xuICAgIC8vIHY5MjQ6IGludmFsaWRhciBlbCBjYWNoZSBpbmxpbmUgZGVsIHNoZWxsIChlbCBnZW9jb2RpbmcgcmVhbCB2aXZlIGFsbGkpLlxuICAgIGlmICh0eXBlb2Ygd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgd2luZG93Ll9pbnZhbGlkYXRlR21hcHNLZXlDYWNoZSgpO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuICAgIC8vIHY5MjQ6IGlkZW0gc2F2ZSBcdTIwMTQgaW52YWxpZGFyIGNhY2hlIGlubGluZS5cbiAgICBpZiAodHlwZW9mIHdpbmRvdy5faW52YWxpZGF0ZUdtYXBzS2V5Q2FjaGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHdpbmRvdy5faW52YWxpZGF0ZUdtYXBzS2V5Q2FjaGUoKTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH1cbiAgICBzaG93U3luY1RhZygnR29vZ2xlIE1hcHMgQVBJIGtleSBib3JyYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVHbWFwc0FwaUtleScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEJVTEsgQVBQUk9WRVIgLSBhc2lnbmFyIGVsIG1pc21vIFwiUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXNcIlxuLy8gYSB0b2RvcyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVdGlsIGN1YW5kbyB1biBzb2xvIGFwcm9iYWRvciAoZWouIFBhYmxvIGdlcmVudGUpIHJldmlzYSBsYXNcbi8vIHJlbmRpY2lvbmVzIGRlIFRPRE9TIGxvcyB2ZW5kZWRvcmVzLiBTaW4gZXN0byBlbCBhZG1pbiB0aWVuZSBxdWVcbi8vIGFicmlyIGNhZGEgZmlsYSBkZWwgcGFuZWwgVXN1YXJpb3MgeSBzZXRlYXIgZWwgZHJvcGRvd24gdW5hIGEgdW5hLlxuZnVuY3Rpb24gcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgY29uc3QgY2FuZGlkYXRlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoXG4gICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xuICApO1xuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojYTIxY2FmXCI+QXByb2JhZG9yIGRlIFJlbmRpY2lvbmVzIC0gYXNpZ25hY2lvbiBtYXNpdmE8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBpZiAoIWNhbmRpZGF0ZXMubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgYWRtaW4gLyBnZXJlbnRlIC8gaW50ZXJuby4gUHJpbWVybyBhc2lnbmEgdW4gcm9sIGEgYWxndWllbi48L2Rpdj4nO1xuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCB2ZW5kZWRvciB0b2RhdmlhLjwvZGl2Pic7XG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbiAgICByZXR1cm47XG4gIH1cbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xuICBodG1sICs9XG4gICAgJzxzZWxlY3QgaWQ9XCJidWxrLWFwcHJvdmVyLXNlbGVjdFwiIHN0eWxlPVwicGFkZGluZzo4cHggMTBweDtib3JkZXI6MS41cHggc29saWQgI2YwYWJmYztib3JkZXItcmFkaXVzOjZweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xuICBjYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcbiAgfSk7XG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJidWxrQXNzaWduQXBwcm92ZXIoKVwiPkFzaWduYXIgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyAoJyArXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xuICAgICcpPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcbiAgaWYgKCFhcHByb3Zlcikge1xuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZlbmRlZG9yZXMgcGFyYSBhc2lnbmFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHByb3ZlckxhYmVsID0gYXBwcm92ZXIuZGlzcGxheU5hbWUgfHwgYXBwcm92ZXIuZW1haWwgfHwgYXBwcm92ZXIuX3VpZDtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0FzaWduYXIgYSAnICtcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xuICAgICAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgbGV0IG9rQ291bnQgPSAwLFxuICAgIF9lcnJDb3VudCA9IDA7XG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcbiAgdmVuZGVkb3Jlcy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHVpZCxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBsb2dPcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxuICAgICAgICBhcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXG4gICAgICB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdidWxrQXNzaWduQXBwcm92ZXInLCBlKTtcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxuICBpZiAob2tDb3VudCkge1xuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXG4gIH1cbn07XG5cbi8vIEdlb2NvZGluZyBjb24gR29vZ2xlIE1hcHMgQVBJLiBEZXZ1ZWx2ZSB7bGF0LCBsbmcsIGRpc3BsYXksIHByZWNpc2lvbn1cbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcbiAgY29uc3Qga2V5ID0gYXdhaXQgZ2V0R21hcHNBcGlLZXkoKTtcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cbiAgY29uc3QgdXJsID1cbiAgICAnaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMuY29tL21hcHMvYXBpL2dlb2NvZGUvanNvbicgK1xuICAgICc/YWRkcmVzcz0nICtcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcbiAgICAnJnJlZ2lvbj1hcicgK1xuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXG4gICAgJyZsYW5ndWFnZT1lcycgK1xuICAgICcma2V5PScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XG4gICAgICBjb25zdCBieVR5cGUgPSAodCkgPT4ge1xuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XG4gICAgICB9O1xuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XG4gICAgICAgIGJ5VHlwZSgnbG9jYWxpdHknKSB8fCBieVR5cGUoJ3N1YmxvY2FsaXR5JykgfHwgYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzInKSB8fCAnJztcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGF0OiBwYXJzZUZsb2F0KGxvYy5sYXQpLFxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcbiAgICAgICAgcHJlY2lzaW9uOiBwcmVjaXNpb24sXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcbiAgICAgICAgbG9jYWxpdHk6IGRldGVjdGVkTG9jYWxpdHksXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcbiAgICAgICAgICAnKHNpbiBkZXRhbGxlKS4gUmV2aXNhciBxdWUgbGEgQVBJIGtleSB0ZW5nYSBoYWJpbGl0YWRhIEdlb2NvZGluZyBBUEkgeSBlbCByZWZlcnJlciBwZXJtaXRhIGVzdGUgZG9taW5pby4nXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcbiAgdHJ5IHtcbiAgICBjb25zdCBhZVFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmdldCgpO1xuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdlbWluaSBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5XG4gIHRyeSB7XG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZ1NuYXAuZXhpc3RzID8gZ1NuYXAuZGF0YSgpIDogbnVsbCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxuICB0cnkge1xuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xuICAgIC8vIEU2IGZpeCBDMTogdmFjaWFyIGVsIEFycmF5IGluLXBsYWNlIChwcmVzZXJ2YSB3aW5kb3cudXNlcnNDYWNoZSByZWYpLlxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIHVzZXJzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgX3VpZDogZG9jLmlkIH0sIGRvYy5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXG4gICAgdHJ5IHtcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpO1xuICAgIH1cbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcbiAgICAvLyBwdWVkYW4gdmVyIGRlc3RpbmF0YXJpb3MgYWwgY3JlYXIgdGFyZWFzIGVuIE5vdGlmaWNhY2lvbmVzLiBTaW4gZXN0b1xuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cbiAgICB0cnkge1xuICAgICAgc3luY1VzZXJzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcbiAgICB9XG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XG4gICAgY29uc3QgX2ludGVybm9PcHRzID1cbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgIGludGVybm9zXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICdcIj4nICtcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xuICAgICAgdGFibGVIdG1sID1cbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvdGQ+PC90cj4nO1xuICAgICAgY2FyZHNIdG1sID1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBZG1pbnMgcHJpbWFyaW9zIHByb3RlZ2lkb3M6IG5vIHNlIHB1ZWRlbiBlbGltaW5hciAoTWFyaWFubyArIGJvdCBjb3Jwb3JhdGl2bylcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuICAgICAgLy8gUGFyYSBsb3MgaW50ZXJub3MgY2FsY3VsYW1vcyBsYSByZWxhY2lvbiBpbnZlcnNhOiBxdWllbmVzIGxvcyB0aWVuZW4gY29tbyBwYXJlamFcbiAgICAgIGZ1bmN0aW9uIHZlbmRvcnNQYXJhSW50ZXJubyhpbnRlcm5vVWlkKSB7XG4gICAgICAgIHJldHVybiB1c2Vyc0NhY2hlLmZpbHRlcihcbiAgICAgICAgICAodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InICYmIHUuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSBpbnRlcm5vVWlkXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBDYW5kaWRhdG9zIGEgcmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM6IGFkbWluLCBnZXJlbnRlIG8gaW50ZXJubyAobm8gdmVuZGVkb3JlcyBuaSB2aWV3ZXJzIG5pIHVuYXNzaWduZWQpXG4gICAgICBjb25zdCByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKFxuICAgICAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICAgICApO1xuICAgICAgdXNlcnNDYWNoZS5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY0lkID0gZC5fdWlkO1xuICAgICAgICBjb25zdCBpc1NlbGYgPSBkb2NJZCA9PT0gY3VycmVudFVzZXIudWlkO1xuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcbiAgICAgICAgY29uc3QgaXNJbnRlcm5vID0gZC5yb2xlID09PSAnaW50ZXJubyc7XG4gICAgICAgIGNvbnN0IHJvbGVPcHRpb25zID0gWyd1bmFzc2lnbmVkJywgJ2FkbWluJywgJ2dlcmVudGUnLCAndmVuZGVkb3InLCAnaW50ZXJubycsICd2aWV3ZXInXVxuICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAocikgPT5cbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICAgICAgciArXG4gICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAoZC5yb2xlID09PSByID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAoaXNTZWxmICYmIHIgIT09ICdhZG1pbicgPyAnIGRpc2FibGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHIgK1xuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgIClcbiAgICAgICAgICAuam9pbignJyk7XG4gICAgICAgIGNvbnN0IHZlbmRvck9wdGlvbnMgPVxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LTwvb3B0aW9uPicgK1xuICAgICAgICAgIFZFTkRPUlMubWFwKFxuICAgICAgICAgICAgKHYpID0+XG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgIHYuem9uZSArXG4gICAgICAgICAgICAgICcgJyArXG4gICAgICAgICAgICAgIHYua2V5ICtcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgICApLmpvaW4oJycpO1xuICAgICAgICAvLyBTaSBlcyBpbnRlcm5vLCBtb3N0cmFyIHJlbGFjaW9uIGludmVyc2EgKHZlbmRlZG9yZXMgcXVlIGxvIHRpZW5lbiBjb21vIHBhcmVqYSkgZW4gdmV6IGRlbCBkcm9wZG93biBlZGl0YWJsZVxuICAgICAgICBsZXQgcGFyZWphQ2VsbDtcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xuICAgICAgICAgIGNvbnN0IHZpbmMgPSB2ZW5kb3JzUGFyYUludGVybm8oZG9jSWQpO1xuICAgICAgICAgIGlmICh2aW5jLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmNcbiAgICAgICAgICAgICAgLm1hcCgodSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6IHUuZW1haWwgfHwgJyc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwobGFiZWwpICtcbiAgICAgICAgICAgICAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPignICtcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XG4gICAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbToycHhcIj5WZW5kZWRvcmVzIGV4dGVybm9zIHZpbmN1bGFkb3MgKGF1dG8pPC9kaXY+JyArXG4gICAgICAgICAgICAgIGxpc3QgK1xuICAgICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZWphQ2VsbCA9XG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgICAgICAgIGludGVybm9zXG4gICAgICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAgICAgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xuICAgICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIj4oVk9TKTwvc3Bhbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3QgcHJvdGVjdGVkVGFnID1cbiAgICAgICAgICBpc1Byb3RlY3RlZCAmJiAhaXNTZWxmXG4gICAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiIHRpdGxlPVwiQWRtaW4gcHJvdGVnaWRvIC0gbm8gc2UgcHVlZGUgZWxpbWluYXJcIj5QUk9URUdJRE88L3NwYW4+J1xuICAgICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3Qgd2FWYWwgPSBkLndoYXRzYXBwIHx8ICcnO1xuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9XG4gICAgICAgICAgJzxpbnB1dCB0eXBlPVwidGVsXCIgY2xhc3M9XCJ3YS1pbnB1dFwiIHBsYWNlaG9sZGVyPVwiZWouIDU0OTExMjY3NjIwMzFcIiB2YWx1ZT1cIicgK1xuICAgICAgICAgIGVzY2FwZUF0dHIod2FWYWwpICtcbiAgICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpXCIgdGl0bGU9XCJOdW1lcm8gV2hhdHNBcHAgY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChzaW4gKyBuaSBlc3BhY2lvcykuIFNlIHVzYSBhbCBlbnZpYXIgbGEgcnV0YS5cIi8+JztcbiAgICAgICAgLy8gRHJvcGRvd24gJ1Jlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzJ1xuICAgICAgICBjb25zdCBjdXJBcHByb3ZlclVpZCA9IGQucmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCAnJztcbiAgICAgICAgbGV0IHJlbmRBcHByb3Zlck9wdGlvbnMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIGFzaWduYXIgLTwvb3B0aW9uPic7XG4gICAgICAgIHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICAgICAgICBpZiAodS5fdWlkID09PSBkb2NJZCkgcmV0dXJuOyAvLyB1biB1c3VhcmlvIG5vIHB1ZWRlIHNlciBzdSBwcm9waW8gYXByb2JhZG9yXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgKz1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICBlc2NhcGVBdHRyKHUuX3VpZCkgK1xuICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAoY3VyQXBwcm92ZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICBlc2NhcGVIdG1sKGxibCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZW5kQXBwcm92ZXJIdG1sID1cbiAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cInJlbmQtYXBwcm92ZXItc2VsXCIgdGl0bGU9XCJRdWllbiBhcHJ1ZWJhIGxhcyByZW5kaWNpb25lcyBkZSBlc3RlIHVzdWFyaW9cIj4nICtcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+JztcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDYW1iaWFyIGNvbnRyYXNlXHUwMEYxYSBcdTIwMTQgdjEzMDQgKDIwMjYtMTAtMTQpOiBsYWJlbCBjb3J0byBcIlBhc3NcIiArXG4gICAgICAgIC8vIHdpZHRoOjEwMCUgKyB3aGl0ZS1zcGFjZTpub3dyYXAgcGFyYSBxdWUgZW50cmUgZW4gY29sdW1uYSBjaGljYS5cbiAgICAgICAgY29uc3QgcHdkQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDZweDtmb250LXNpemU6MTBweDt3aWR0aDoxMDAlO3doaXRlLXNwYWNlOm5vd3JhcDtib3gtc2l6aW5nOmJvcmRlci1ib3hcIiB0aXRsZT1cIkNhbWJpYXIgY29udHJhc2VcdTAwRjFhXCIgb25jbGljaz1cImNoYW5nZVVzZXJQYXNzd29yZChcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgXCInLCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcbiAgICAgICAgICAnKVwiPlBhc3M8L2J1dHRvbj4nO1xuICAgICAgICAvLyBCb3RcdTAwRjNuIENvbmZpZ3VyYXIgMkZBIFx1MjAxNCB2MTMwNDogbWlzbW8gdHJhdGFtaWVudG8gY29tcGFjdG8uXG4gICAgICAgIGNvbnN0IHRvdHBTdGF0dXNUYWcgPSBkLnRvdHBFbmFibGVkXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzEwYjk4MTtmb250LXdlaWdodDo4MDBcIj4mIzEwMDAzOzwvc3Bhbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgY29uc3QgdG90cEJ0bkh0bWwgPVxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCA2cHg7Zm9udC1zaXplOjEwcHg7d2lkdGg6MTAwJTt3aGl0ZS1zcGFjZTpub3dyYXA7Ym94LXNpemluZzpib3JkZXItYm94O2JhY2tncm91bmQ6JyArXG4gICAgICAgICAgKGQudG90cEVuYWJsZWQgPyAnIzEwYjk4MScgOiAnIzViMjFiNicpICtcbiAgICAgICAgICAnXCIgdGl0bGU9XCJDb25maWd1cmFyIDJGQVwiIG9uY2xpY2s9XCJvcGVuVG90cFNldHVwKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICBcIicsIFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xuICAgICAgICAgICcpXCI+MkZBJyArXG4gICAgICAgICAgdG90cFN0YXR1c1RhZyArXG4gICAgICAgICAgJzwvYnV0dG9uPic7XG4gICAgICAgIC8vIERlc2t0b3Agcm93XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRyIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICsgeW91VGFnICsgcHJvdGVjdGVkVGFnICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSB8fCAnJykgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICsgcm9sZU9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgKyB2ZW5kb3JPcHRpb25zICsgJzwvc2VsZWN0PjwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHBhcmVqYUNlbGwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZCBjbGFzcz1cIndhLWNvbFwiPicgKyB3YUlucHV0SHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyByZW5kQXBwcm92ZXJIdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHB3ZEJ0bkh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgdG90cEJ0bkh0bWwgKyAnPC90ZD4nO1xuICAgICAgICBjb25zdCBzaG93RGVsZXRlID0gIWlzU2VsZiAmJiAhaXNQcm90ZWN0ZWQ7XG4gICAgICAgIGNvbnN0IGRlbEJ0biA9IHNob3dEZWxldGVcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIHRhYmxlSHRtbCArPVxuICAgICAgICAgICc8dGQ+JyArXG4gICAgICAgICAgZGVsQnRuICtcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzwvdHI+JztcbiAgICAgICAgLy8gTW9iaWxlIGNhcmRcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidXNlcnMtY2FyZFwiIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2PjxkaXYgY2xhc3M9XCJ1Yy1lbWFpbFwiPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgIHlvdVRhZyArXG4gICAgICAgICAgcHJvdGVjdGVkVGFnICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgaWYgKGQuZGlzcGxheU5hbWUpXG4gICAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtbmFtZVwiPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUpICsgJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+Um9sPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICtcbiAgICAgICAgICByb2xlT3B0aW9ucyArXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICtcbiAgICAgICAgICB2ZW5kb3JPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xuICAgICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3JlcyB2aW5jdWxhZG9zIChhdXRvKTwvbGFiZWw+JyArXG4gICAgICAgICAgICBwYXJlamFDZWxsICtcbiAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UGFyZWphIGludGVybm8gKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD4nICtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+V2hhdHNBcHAgKGNvbiBjb2RpZ28gZGUgcGFpcywgc2luICsgbmkgZXNwYWNpb3MpPC9sYWJlbD4nICtcbiAgICAgICAgICB3YUlucHV0SHRtbCArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzPC9sYWJlbD4nICtcbiAgICAgICAgICByZW5kQXBwcm92ZXJIdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcbiAgICAgICAgICBwd2RCdG5IdG1sICtcbiAgICAgICAgICB0b3RwQnRuSHRtbCArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGNvbnN0IGRlbEJ0bkMgPSBzaG93RGVsZXRlXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgICAgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLWFjdGlvbnNcIj4nICtcbiAgICAgICAgICBkZWxCdG5DICtcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHRib2R5LmlubmVySFRNTCA9IHRhYmxlSHRtbDtcbiAgICBjYXJkc0VsLmlubmVySFRNTCA9IGNhcmRzSHRtbDtcbiAgICAvLyBBY3R1YWxpemEgaGVhZGVyIGRlIHRhYmxhIGNvbiBsYSBjb2x1bW5hIG51ZXZhXG4gICAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjdXNlcnMtdGFibGUgdGhlYWQgdHInKTtcbiAgICBpZiAodGhlYWQpXG4gICAgICB0aGVhZC5pbm5lckhUTUwgPVxuICAgICAgICAnPHRoPkVtYWlsPC90aD48dGg+Tm9tYnJlPC90aD48dGg+Um9sPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5QYXJlamEgaW50ZXJubzwvdGg+PHRoIGNsYXNzPVwid2EtY29sXCI+V2hhdHNBcHA8L3RoPjx0aD5SZXNwLiByZW5kaWNpb25lczwvdGg+PHRoPlBhc3M8L3RoPjx0aD4yRkE8L3RoPjx0aD48L3RoPic7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdvcGVuQWRtaW5QYW5lbCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuY2xvc2VBZG1pblBhbmVsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjI6IGRlbGV0ZVVzZXJSb2xlICsgVE9UUCArIGNoYW5nZVVzZXJQYXNzd29yZCArIHNhdmVVc2VyUm9sZSAoaW5saW5lIEwxNDEwNS0xNDM5MClcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG53aW5kb3cuZGVsZXRlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcbiAgICBhbGVydCgnTm8gcG9kZXMgZWxpbWluYXIgdHUgcHJvcGlvIGFjY2Vzby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gRGVmZW5zYSBhZGljaW9uYWw6IGFkbWlucyBwcm90ZWdpZG9zIG5vIHNlIHB1ZWRlbiBlbGltaW5hciBuaSBkZXNkZSBjb25zb2xhXG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcFByZSA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBjb25zdCBlbWFpbFByZSA9IChzbmFwUHJlLmV4aXN0cyA/IHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnIDogJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgUFJPVEVDVEVEID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcbiAgICBpZiAoUFJPVEVDVEVELmluZGV4T2YoZW1haWxQcmUpID49IDApIHtcbiAgICAgIGFsZXJ0KCdFc3RlIGVzIHVuIGFkbWluIHByb3RlZ2lkbyAoJyArIGVtYWlsUHJlICsgJykgeSBubyBzZSBwdWVkZSBlbGltaW5hci4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH0gY2F0Y2ggKF9lKSB7XG4gICAgLyogc2kgZmFsbGEgbGEgbGVjdHVyYSBwcmV2aWEsIHNpZ3VlIGNvbiBjb25maXJtICovXG4gIH1cbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0VsaW1pbmFyIGFjY2VzbyBkZSBlc3RlIHVzdWFyaW8/XFxuXFxuUGllcmRlIGFjY2VzbyBkZSBpbm1lZGlhdG8uIFNpIHZ1ZWx2ZSBhIGVudHJhciBjb24gR29vZ2xlIHZhIGEgcXVlZGFyIGNvbW8gXCJzaW4gcm9sIGFzaWduYWRvXCIgaGFzdGEgcXVlIHZvcyBsbyBoYWJpbGl0ZXMgZGUgbnVldm8uXFxuXFxuU3UgY3VlbnRhIEdvb2dsZSBzaWd1ZSBleGlzdGllbmRvLCBubyBzZSBib3JyYS4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgY29uc3QgZGF0YSA9IHNuYXAuZXhpc3RzID8gc25hcC5kYXRhKCkgOiB7fTtcbiAgICBsb2dPcCgnZWxpbWluYXJfdXN1YXJpbycsICd1c2VyJywgZGF0YS5lbWFpbCB8fCB1aWQsIHtcbiAgICAgIHVpZCxcbiAgICAgIHByZXZpb3VzUm9sZTogZGF0YS5yb2xlLFxuICAgICAgcHJldmlvdXNWZW5kb3I6IGRhdGEudmVuZG9yLFxuICAgIH0pO1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5kZWxldGUoKTtcbiAgICBzaG93U3luY1RhZygnVXN1YXJpbyBlbGltaW5hZG8nKTtcbiAgICBhd2FpdCBvcGVuQWRtaW5QYW5lbCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxubGV0IHRvdHBTZXR1cFN0YXRlID0gbnVsbDsgLy8ge3VpZCwgZW1haWwsIHNlY3JldCwgb3RwYXV0aH1cblxud2luZG93Lm9wZW5Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBjb25zb2xlLmxvZygnWzJGQV0gb3BlblRvdHBTZXR1cCBjYWxsZWQnLCB7IHVpZCwgZW1haWwsIHVzZXJSb2xlIH0pO1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcbiAgICBhbGVydCgnU29sbyBlbCBhZG1pbmlzdHJhZG9yIHB1ZWRlIGNvbmZpZ3VyYXIgMkZBIHBhcmEgb3Ryb3MgdXN1YXJpb3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdWlkKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBVSUQgZGVsIHVzdWFyaW8gbm8gZGlzcG9uaWJsZS4gUmVjYXJnYSBsYSBwYWdpbmEgeSByZWludGVudGEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcbiAgLy8gTW9kYWwgZXhpc3RlP1xuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJyk7XG4gIGlmICghbW9kYWwpIHtcbiAgICBhbGVydCgnRXJyb3I6IG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvIGVuIGVsIERPTS4gUmVjYXJnYSBsYSBwYWdpbmEgKEN0cmwrU2hpZnQrUikuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHN1YnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLXN1YnQnKTtcbiAgaWYgKHN1YnRFbCkgc3VidEVsLnRleHRDb250ZW50ID0gJ1BhcmE6ICcgKyAoZW1haWwgfHwgdWlkKTtcbiAgLy8gTGVlciBlc3RhZG8gYWN0dWFsXG4gIGxldCBjdXJFbmFibGVkID0gZmFsc2U7XG4gIGxldCBjdXJTZWNyZXQgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgICBjdXJFbmFibGVkID0gISFkLnRvdHBFbmFibGVkO1xuICAgICAgY3VyU2VjcmV0ID0gZC50b3RwU2VjcmV0IHx8IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUud2FybignWzJGQV0gZG9jIHJvbGVzLycgKyB1aWQgKyAnIG5vIGV4aXN0ZScpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1syRkFdIGVycm9yIGxleWVuZG8gcm9sZXMvJyArIHVpZCwgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gZWwgZXN0YWRvIGRlIDJGQSBkZWwgdXN1YXJpbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xuICBpZiAoIWMpIHtcbiAgICBhbGVydCgnRXJyb3I6IGNvbnRlbmVkb3IgZGVsIG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvLiBSZWNhcmdhIGxhIHBhZ2luYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGN1ckVuYWJsZWQgJiYgY3VyU2VjcmV0KSB7XG4gICAgYy5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MtYmcpO2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICc8Yj4mIzEwMDAzOyAyRkEgeWEgZXN0XHUwMEUxIGFjdGl2bzwvYj4gcGFyYSBlc3RlIHVzdWFyaW8uJyArXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjExcHhcIj5TaSBsbyBwZXJkaVx1MDBGMyBvIGNhbWJpXHUwMEYzIGRlIGNlbHVsYXIsIHBvZFx1MDBFOXMgZ2VuZXJhcmxlIHVubyBudWV2byAoZWwgYW50ZXJpb3IgcXVlZGEgaW52YWxpZGFkbykuPC9zcGFuPicgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDttYXJnaW4tdG9wOjE0cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgIFwiJywnXCIgK1xuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xuICAgICAgJ1xcJylcIj5HZW5lcmFyIG51ZXZvIChyZXNldGVhcik8L2J1dHRvbj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRpc2FibGVUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgICdcXCcpXCI+RGVzaGFiaWxpdGFyIDJGQTwvYnV0dG9uPicgK1xuICAgICAgJzwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgYy5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNlZmY2ZmY7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjojMWU0MGFmO3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLicgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tdG9wOjE0cHhcIj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICBcIicsJ1wiICtcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcbiAgICAgICdcXCcpXCI+R2VuZXJhciAyRkE8L2J1dHRvbj4nICtcbiAgICAgICc8L2Rpdj4nO1xuICB9XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZVRvdHBTZXR1cE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xufTtcblxud2luZG93LmdlbmVyYXRlTmV3VG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCBzZWNyZXQgPSB0b3RwR2VuZXJhdGVTZWNyZXQoKTtcbiAgY29uc3Qgb3RwYXV0aCA9IHRvdHBCdWlsZE90cGF1dGhVcmwoc2VjcmV0LCBlbWFpbCB8fCB1aWQpO1xuICB0b3RwU2V0dXBTdGF0ZSA9IHsgdWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGggfTtcbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcbiAgYy5pbm5lckhUTUwgPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci13YXJuaW5nLWJnKTtib3JkZXI6MXB4IHNvbGlkICNmY2QzNGQ7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM3ODM1MGY7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXG4gICAgJzxiPlBhc29zIHBhcmEgYWN0aXZhcjo8L2I+PGJyPicgK1xuICAgICcxLiBFbCB1c3VhcmlvIGluc3RhbGEgPGI+R29vZ2xlIEF1dGhlbnRpY2F0b3I8L2I+IGVuIHN1IGNlbHVsYXIuPGJyPicgK1xuICAgICcyLiBUb2NhIFwiQWdyZWdhclwiIC8gXCIrXCIgZW4gbGEgYXBwLjxicj4nICtcbiAgICAnMy4gRWxpZ2UgXCJFc2NhbmVhciBjXHUwMEYzZGlnbyBRUlwiIHkgZXNjYW5lYSBlbCBjXHUwMEYzZGlnbyBhYmFqbyAobyBwZWdhIGVsIHNlY3JldCBtYW51YWxtZW50ZSkuPGJyPicgK1xuICAgICc0LiBBcGFyZWNlIHVuIGNcdTAwRjNkaWdvIGRlIDYgZFx1MDBFRGdpdG9zIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yLjxicj4nICtcbiAgICAnNS4gTG8gZXNjcmliZSBlbiBlbCBpbnB1dCBkZSBhYmFqbyBwYXJhIGNvbmZpcm1hciB5IGFjdGl2YXIuJyArXG4gICAgJzwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj48ZGl2IGlkPVwidG90cC1xci1jb250YWluZXJcIiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4XCI+R2VuZXJhbmRvIFFSLi4uPC9kaXY+PC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTBweDt0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbTo0cHhcIj5TZWNyZXQgKGNhcmdhIG1hbnVhbCBzaSBlbCBRUiBmYWxsYSk8L2Rpdj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7d29yZC1icmVhazpicmVhay1hbGw7bGV0dGVyLXNwYWNpbmc6LjFlbVwiPicgK1xuICAgIGVzY2FwZUh0bWwoc2VjcmV0KSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxMHB4XCI+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtkaXNwbGF5OmJsb2NrO21hcmdpbi1ib3R0b206NXB4XCI+Q1x1MDBGM2RpZ28gZGUgdmVyaWZpY2FjaVx1MDBGM24gZGUgR29vZ2xlIEF1dGhlbnRpY2F0b3I8L2xhYmVsPicgK1xuICAgICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInRvdHAtY29uZmlybS1pbnB1dFwiIGlucHV0bW9kZT1cIm51bWVyaWNcIiBtYXhsZW5ndGg9XCI3XCIgcGxhY2Vob2xkZXI9XCIwMDAwMDBcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzoxMHB4IDEycHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MThweDt0ZXh0LWFsaWduOmNlbnRlcjtsZXR0ZXItc3BhY2luZzouM2VtO2ZvbnQtd2VpZ2h0OjgwMFwiLz48L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiY29uZmlybVRvdHBTZXR1cCgpXCI+VmVyaWZpY2FyIHkgYWN0aXZhcjwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImNsb3NlVG90cFNldHVwTW9kYWwoKVwiPkNhbmNlbGFyPC9idXR0b24+PC9kaXY+JztcbiAgLy8gTGF6eS1sb2FkIHFyY29kZWpzIHkgZ2VuZXJhci4gRXN0YSBsaWJyZXJpYSBwaW50YSBlbCBRUiBkaXJlY3RvIGVuIGVsXG4gIC8vIGNvbnRlbmVkb3IgRE9NIHZpYSBjYW52YXMvaW1nIC0gbm8gbmVjZXNpdGEgY2FsbGJhY2sgdG9EYXRhVVJMLlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRRUkNvZGVMaWIoKTtcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgIGJveC5pbm5lckhUTUwgPSAnJzsgLy8gbGltcGlhciBlbCBcIkdlbmVyYW5kbyBRUi4uLlwiXG4gICAgbmV3IFFSQ29kZShib3gsIHtcbiAgICAgIHRleHQ6IG90cGF1dGgsXG4gICAgICB3aWR0aDogMjIwLFxuICAgICAgaGVpZ2h0OiAyMjAsXG4gICAgICBjb2xvckRhcms6ICcjMDAwMDAwJyxcbiAgICAgIGNvbG9yTGlnaHQ6ICcjZmZmZmZmJyxcbiAgICAgIGNvcnJlY3RMZXZlbDogUVJDb2RlLkNvcnJlY3RMZXZlbC5NLFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbMkZBXSBFcnJvciBjYXJnYW5kbyBRUiBsaWI6JywgZSk7XG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XG4gICAgaWYgKGJveClcbiAgICAgIGJveC5pbm5lckhUTUwgPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlci1zdHJvbmcpO3BhZGRpbmc6MTRweFwiPk5vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlclx1MDBFRGEgUVIuIFVzYSBlbCBzZWNyZXQgbWFudWFsIHBhcmEgY29uZmlndXJhci48L2Rpdj4nO1xuICB9XG59O1xuXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0b3RwU2V0dXBTdGF0ZSkgcmV0dXJuO1xuICBjb25zdCBjb2RlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLWNvbmZpcm0taW5wdXQnKS52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxzKy9nLCAnJyk7XG4gIGlmICghL15cXGR7Nn0kLy50ZXN0KGNvZGUpKSB7XG4gICAgYWxlcnQoJ0luZ3Jlc1x1MDBFMSBsb3MgNiBkXHUwMEVEZ2l0b3MuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IG9rID0gYXdhaXQgdG90cFZlcmlmeUNvZGUodG90cFNldHVwU3RhdGUuc2VjcmV0LCBjb2RlLCAxKTtcbiAgaWYgKCFvaykge1xuICAgIGFsZXJ0KFxuICAgICAgJ0NcdTAwRjNkaWdvIGluY29ycmVjdG8uIEFzZWd1cmF0ZSBkZSBxdWUgZWwgc2VjcmV0IHNlIGNhcmdcdTAwRjMgYmllbiBlbiBHb29nbGUgQXV0aGVudGljYXRvciB5IHJlaW50ZW50XHUwMEUxLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHRvdHBTZXR1cFN0YXRlLnVpZClcbiAgICAgIC51cGRhdGUoe1xuICAgICAgICB0b3RwU2VjcmV0OiB0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsXG4gICAgICAgIHRvdHBFbmFibGVkOiB0cnVlLFxuICAgICAgICB0b3RwRW5hYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgdG90cEVuYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICB9KTtcbiAgICBzaG93U3luY1RhZygnMkZBIGFjdGl2YWRvIHBhcmEgJyArICh0b3RwU2V0dXBTdGF0ZS5lbWFpbCB8fCAndXN1YXJpbycpKTtcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5kaXNhYmxlVG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICghY29uZmlybSgnRGVzaGFiaWxpdGFyIDJGQSBwYXJhIGVzdGUgdXN1YXJpbz8gVmEgYSBlbnRyYXIgc29sbyBjb24gcGFzc3dvcmQuJykpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh1aWQpXG4gICAgICAudXBkYXRlKHtcbiAgICAgICAgdG90cEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICB0b3RwU2VjcmV0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5kZWxldGUoKSxcbiAgICAgICAgdG90cERpc2FibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICB0b3RwRGlzYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICB9KTtcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmNoYW5nZVVzZXJQYXNzd29yZCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAoIWVtYWlsKSB7XG4gICAgYWxlcnQoJ0VzdGUgdXN1YXJpbyBubyB0aWVuZSBlbWFpbCByZWdpc3RyYWRvIC0gbm8gc2UgcHVlZGUgcmVzZXRlYXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGNob2ljZSA9IHByb21wdChcbiAgICAnUmVzZXRlYXIgY29udHJhc2VcdTAwRjFhIGRlICcgK1xuICAgICAgZW1haWwgK1xuICAgICAgJ1xcblxcbicgK1xuICAgICAgJ0VsZWdpIHVuYSBvcGNpb24gKDEgLyAyKTpcXG5cXG4nICtcbiAgICAgICcxKSBFTlZJQVIgTUFJTCBERSBSRVNFVEVPIChyZWNvbWVuZGFkbylcXG4nICtcbiAgICAgICcgTGUgbGxlZ2EgYSAnICtcbiAgICAgIGVtYWlsICtcbiAgICAgICcgdW4gbWFpbCBkZSBGaXJlYmFzZSBjb24gdW4gbGluay5cXG4nICtcbiAgICAgICcgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcbiAgICAgICcgRXMgbG8gZXN0YW5kYXIgeSBmdW5jaW9uYSBzZWd1cm8uXFxuXFxuJyArXG4gICAgICAnMikgUmVzZXRlYXIgU09MTyBlbCBwYXNzd29yZC1nYXRlIChzZWd1bmRhIGNhcGEpLlxcbicgK1xuICAgICAgJyBObyBjYW1iaWEgbGEgcGFzc3dvcmQgcmVhbCBkZSBGaXJlYmFzZS4gU2lydmUgc2kgZWwgdXN1YXJpb1xcbicgK1xuICAgICAgJyBlbnRyYSBwb3IgR29vZ2xlIHkgb2x2aWRvIGxhIHBhc3N3b3JkLWdhdGUgZGUgbGEgYXBwLCBOTyBzaVxcbicgK1xuICAgICAgJyBvbHZpZG8gbGEgcGFzc3dvcmQgZGVsIGxvZ2luIGNvbiBlbWFpbC5cXG5cXG4nICtcbiAgICAgICdFc2NyaWJpIDEgbyAyOicsXG4gICAgJzEnXG4gICk7XG4gIGlmIChjaG9pY2UgPT09IG51bGwpIHJldHVybjtcbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcxJykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmYkF1dGguc2VuZFBhc3N3b3JkUmVzZXRFbWFpbChlbWFpbCk7XG4gICAgICBhbGVydChcbiAgICAgICAgJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArXG4gICAgICAgICAgZW1haWwgK1xuICAgICAgICAgICcuIERlY2lsZSBxdWUgcmV2aXNlIGluYm94IHkgc3BhbS4gRWwgbGluayBleHBpcmEgZW4gMSBob3JhLidcbiAgICAgICk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmYkRiXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgICAgICAuZG9jKHVpZClcbiAgICAgICAgICAudXBkYXRlKHtcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdmaXJlYmFzZV9lbWFpbCcsXG4gICAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XG4gICAgICBhbGVydCgnRXJyb3IgZW52aWFuZG8gZWwgbWFpbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcyJykge1xuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdChcbiAgICAgICdOdWV2YSBwYXNzd29yZC1nYXRlIHBhcmEgJyArXG4gICAgICAgIGVtYWlsICtcbiAgICAgICAgJzpcXG5cXG4oU29sbyBhZmVjdGEgbGEgc2VndW5kYSBjYXBhIGRlIGxhIGFwcCwgTk8gZWwgbG9naW4gY29uIGVtYWlsKScsXG4gICAgICAnJ1xuICAgICk7XG4gICAgaWYgKG5ld1B3ZCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IHB3ZCA9IChuZXdQd2QgfHwgJycpLnRyaW0oKTtcbiAgICBpZiAocHdkLmxlbmd0aCA8IDQpIHtcbiAgICAgIGFsZXJ0KCdMYSBjb250cmFzZVx1MDBGMWEgdGllbmUgcXVlIHRlbmVyIGFsIG1lbm9zIDQgY2FyYWN0ZXJlcy4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNyZWRzID0gYXdhaXQgYnVpbGRQYXNzd29yZENyZWRlbnRpYWxzKHB3ZCk7XG4gICAgICBhd2FpdCBmYkRiXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAgIC5kb2ModWlkKVxuICAgICAgICAudXBkYXRlKHtcbiAgICAgICAgICBwYXNzd29yZEhhc2g6IGNyZWRzLnBhc3N3b3JkSGFzaCxcbiAgICAgICAgICBwYXNzd29yZFNhbHQ6IGNyZWRzLnBhc3N3b3JkU2FsdCxcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdnYXRlX29ubHknLFxuICAgICAgICB9KTtcbiAgICAgIHNob3dTeW5jVGFnKCdQYXNzd29yZC1nYXRlIGFjdHVhbGl6YWRhIHBhcmEgJyArIGVtYWlsKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdjaGFuZ2VVc2VyUGFzc3dvcmQgZ2F0ZScsIGUpO1xuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgYWxlcnQoJ09wY2lvbiBubyB2YWxpZGEuIENhbmNlbGFkby4nKTtcbn07XG5cbndpbmRvdy5zYXZlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBidG4pIHtcbiAgY29uc3QgY29udGFpbmVyID0gYnRuLmNsb3Nlc3QoJ3RyJykgfHwgYnRuLmNsb3Nlc3QoJy51c2Vycy1jYXJkJyk7XG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XG4gIGNvbnN0IHJvbGUgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJvbGUtc2VsJykudmFsdWU7XG4gIGNvbnN0IHZlbmRvciA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcudmVuZG9yLXNlbCcpLnZhbHVlIHx8IG51bGw7XG4gIGNvbnN0IGludGVybmFsU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5pbnRlcm5hbC1zZWwnKTtcbiAgY29uc3QgaW50ZXJuYWxQYXJ0bmVyVWlkID0gaW50ZXJuYWxTZWwgPyBpbnRlcm5hbFNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcbiAgLy8gV2hhdHNBcHA6IGxpbXBpYXIgdG9kbyBsbyBxdWUgbm8gc2VhIGRpZ2l0byAoYWNlcHRhICssIGVzcGFjaW9zLCBwYXJcdTAwRTludGVzaXMsIGV0Yy4pXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XG4gIGNvbnN0IHdoYXRzYXBwID0gd2FJbnB1dCA/ICh3YUlucHV0LnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXEQvZywgJycpIDogJyc7XG4gIGlmICh3aGF0c2FwcCAmJiB3aGF0c2FwcC5sZW5ndGggPCA4KSB7XG4gICAgYWxlcnQoXG4gICAgICAnRWwgbnVtZXJvIGRlIFdoYXRzQXBwIGVzIG11eSBjb3J0by4gVGllbmUgcXVlIHNlciBlbCBudW1lcm8gY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChlai4gNTQ5MTEyNjc2MjAzMSBwYXJhIEFyZ2VudGluYSkuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzICh1aWQgZGVsIHVzdWFyaW8gcXVlIGFwcnVlYmEpXG4gIGNvbnN0IHJlbmRBcHByb3ZlclNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucmVuZC1hcHByb3Zlci1zZWwnKTtcbiAgY29uc3QgcmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRBcHByb3ZlclNlbCA/IHJlbmRBcHByb3ZlclNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcbiAgLy8gQ2FjaGVhciB0YW1iaWVuIGVsIGVtYWlsIGRlbCBhcHJvYmFkb3IgZW4gZWwgZG9jIGRlbCB2ZW5kZWRvcjogbG9zXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcbiAgLy8gbmVjZXNpdGFuIGVsIGVtYWlsIGFjYSBwYXJhIHBvZGVyIG1hbmRhciBsYSByZW5kaWNpb24gKHJlc29sdmVNeVJlbmRpY2lvbmVzQXBwcm92ZXJcbiAgLy8gbG8gdXNhIGNvbW8gcHJpbWVyIGZhc3QtcGF0aCkuIFNpbiBlc3RvIGVsIGZsdWpvIGRlcGVuZGlhIGRlbCBkaXJlY3RvcmlvXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cbiAgbGV0IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IG51bGw7XG4gIGlmIChyZW5kaWNpb25lc0FwcHJvdmVyVWlkKSB7XG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCk7XG4gICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gYXBwcm92ZXJVc2VyID8gYXBwcm92ZXJVc2VyLmVtYWlsIHx8IG51bGwgOiBudWxsO1xuICB9XG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gIGJ0bi50ZXh0Q29udGVudCA9ICcuLi4nO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHVpZClcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIHZlbmRvcixcbiAgICAgICAgICBpbnRlcm5hbFBhcnRuZXJVaWQsXG4gICAgICAgICAgd2hhdHNhcHA6IHdoYXRzYXBwIHx8IG51bGwsXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogcmVuZGljaW9uZXNBcHByb3ZlclVpZCxcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCxcbiAgICAgICAgICBhc3NpZ25lZEJ5OiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgYXNzaWduZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICAvLyBTaSBlbCB1c3VhcmlvIGVkaXRvIHN1IHByb3BpbyBudW1lcm8sIGFjdHVhbGl6YXIgZWwgY2FjaGUgbG9jYWxcbiAgICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcbiAgICAgIG15V2hhdHNhcHBOdW1iZXIgPSB3aGF0c2FwcCB8fCBudWxsO1xuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCBudWxsO1xuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgfHwgbnVsbDtcbiAgICB9XG4gICAgYnRuLnRleHRDb250ZW50ID0gJ09LJztcbiAgICAvLyBSZS1yZW5kZXIgZGVsIHBhbmVsIGFzaSBsb3MgZHJvcGRvd25zIFwiUGFyZWphIGludGVybm9cIiBtdWVzdHJhbiBsb3MgaW50ZXJub3MgYWN0dWFsaXphZG9zXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdyZWZyZXNoIGFkbWluIHBhbmVsJywgZSk7XG4gICAgICB9XG4gICAgfSwgNDAwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVVc2VyUm9sZScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhcic7XG4gIH1cbn07XG5cbi8vIFRvZG9zIGxvcyBoYW5kbGVycyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgc29uIHZlcmJhdGltLlxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBdUJBLE1BQUksT0FBTyxPQUFPLGVBQWUsWUFBYSxRQUFPLGFBQWEsQ0FBQztBQUNuRSxNQUFNLGFBQWEsT0FBTztBQUUxQixXQUFTLDJCQUEyQixhQUFhO0FBQy9DLFVBQU0sS0FBSyxTQUFTLGVBQWUsd0JBQXdCO0FBQzNELFFBQUksQ0FBQyxHQUFJO0FBQ1QsbUJBQWUsZUFBZSxDQUFDLEdBQzVCLE1BQU0sRUFDTixLQUFLLENBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxJQUFJLGNBQWMsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUM5RCxRQUFJLE9BQU87QUFDWCxZQUFRO0FBQ1IsWUFDRTtBQUNGLFlBQVE7QUFDUixRQUFJLENBQUMsWUFBWSxRQUFRO0FBQ3ZCLGNBQ0U7QUFBQSxJQUNKLE9BQU87QUFDTCxjQUNFO0FBQ0Ysa0JBQVksUUFBUSxDQUFDLE9BQU87QUFDMUIsY0FBTSxRQUFRLFdBQVcsR0FBRyxTQUFTLEdBQUcsR0FBRztBQUMzQyxjQUFNLE9BQU8sR0FBRyxPQUFPLGVBQWUsV0FBVyxHQUFHLElBQUksSUFBSTtBQUM1RCxnQkFDRSxpTkFDQSxRQUNBLE9BQ0EsMENBQ0EsV0FBVyxHQUFHLEdBQUcsSUFDakI7QUFBQSxNQUVKLENBQUM7QUFDRCxjQUFRO0FBQUEsSUFDVjtBQUNBLFlBQ0U7QUFDRixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUVBLFNBQU8sa0JBQWtC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
