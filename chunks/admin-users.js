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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGVsaW1pbmFkbyBlbCBLTk9XTiBCVUcgZGVsIGdlbWluaUFwaUtleUNhY2hlXHJcbi8vIGNyb3NzLW1vZHVsZS4gTGEga2V5IHlhIG5vIHZpdmUgZW4gRmlyZXN0b3JlIG5pIGNhY2hlYSBuYWRhIGZyb250ZW5kIFx1MjAxNFxyXG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXHJcbi8vIGxlZSB1c2Vyc0NhY2hlIGNvbW8gaWRlbnRpZmllciBsaWJyZS4gRW4gYnVuZGxlIFwidXNlIHN0cmljdFwiIHVuIHJlYWQgYVxyXG4vLyBpZGVudGlmaWVyIG5vLWRlY2xhcmFkbyBuaSBlbiB3aW5kb3cgdGlyYSBSZWZlcmVuY2VFcnJvci4gUHJvbW9jaW9uYXIgYVxyXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcclxuLy8geSBidW5kbGUgbm90aWZpY2FjaW9uZXMgKHNoZWxsKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cudXNlcnNDYWNoZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51c2Vyc0NhY2hlID0gW107XHJcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSlcclxuICAgIC5zbGljZSgpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuZW1haWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5lbWFpbCB8fCAnJykpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TaSB1biB2ZW5kZWRvciB1c2EgR21haWwgcGVyc29uYWwgKG5vIEBzaGltYW5vLmNvbS5hciksIGFncmVnYWxvIGFjYSBhbnRlcyBxdWUgaW50ZW50ZSBsb2d1ZWFyLiBMb3MgZW1haWxzIEBzaGltYW5vLmNvbS5hciB5IGxvcyBhZG1pbnMgaGFyZGNvZGVkIHlhIGVzdGFuIGF1dG9yaXphZG9zIGF1dG9tYXRpY2FtZW50ZS48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgICBhbGxvd2VkTGlzdC5mb3JFYWNoKChhZSkgPT4ge1xyXG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcclxuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6MTRweDtwYWRkaW5nOjNweCA0cHggM3B4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6IzFlNDBhZjtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBsYWJlbCArXHJcbiAgICAgICAgbm90ZSArXHJcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cInJlbW92ZUFsbG93ZWRFbWFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXHJcbiAgICAgICAgJzwvZGl2Pic7XHJcbiAgICB9KTtcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbndpbmRvdy5hZGRBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xyXG4gIGlmICghcmF3KSByZXR1cm47XHJcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xyXG4gICAgYWxlcnQoJ0VsIGVtYWlsIG5vIHBhcmVjZSB2YWxpZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG5vdGUgPVxyXG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XHJcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXHJcbiAgICAgIC5kb2MoZG9jSWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgZW1haWwsXHJcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcclxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgYWRkZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xyXG4gICAgLy8gUmVjYXJnYXIgcGFuZWxcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBTZWNjaW9uIEdlbWluaSBBUEkgS2V5IChhZG1pbikgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXHJcbiAgLy8gdjYzOSAoMjAyNi0wOC0yNik6IFVYIHNpbXBsaWZpY2FkbyBwb3IgcGVkaWRvIE1hcmlhbm8gXHUyMDE0IHNpbiBpbnN0cnVjY2lvbmVzXHJcbiAgLy8gQ0xJIGVuIGVsIHBhbmVsLCBzb2xvIHVuIGJhbm5lciBleHBsaWNhbmRvIGRvbmRlIHZpdmUgbGEga2V5LlxyXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cclxuICBlbC50ZXh0Q29udGVudCA9ICcnO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MTRweCAxMnB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo2cHgnO1xyXG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO21hcmdpbi1ib3R0b206NnB4JztcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdHZW1pbmkgQVBJIEtleSAoT0NSIGRlIHRpY2tldHMpJztcclxuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgLy8gSWNvbm8gY2FuZGFkbyArIHRleHRvLiB0ZXh0Q29udGVudCBlcyBzYWZlIChubyBIVE1MIHBhcnNpbmcpLlxyXG4gIG1zZy50ZXh0Q29udGVudCA9ICdHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZCh0aXRsZSk7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZChtc2cpO1xyXG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xyXG59XHJcblxyXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXHJcbi8vIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuIFNlIGFkbWluaXN0cmEgcG9yIENMSS4gVmVyXHJcbi8vIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24gcGFyYSBsYXMgaW5zdHJ1Y2Npb25lcy5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHT09HTEUgTUFQUyBHZW9jb2RpbmcgQVBJIC0gbWVqb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsIHF1ZSBPU01cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3NcclxuLy8gY29tbyBnZW9jb2RlciBQUklNQVJJTyBlbiBnZW9jb2RlQ2xpZW50QWRkcmVzczsgc2kgZmFsbGEgbyBubyBlc3RhXHJcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxyXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbmFzeW5jIGZ1bmN0aW9uIGdldEdtYXBzQXBpS2V5KCkge1xyXG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcclxuICAgIGlmIChzbmFwLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XHJcbiAgICAgIGlmIChkLmFwaUtleSkge1xyXG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcclxuICAgICAgICByZXR1cm4gZC5hcGlLZXk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gbm8gc2UgcHVkbyBsZWVyIGFwaSBrZXknLCBlKTtcclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnbWFwcy1jb25maWctc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xyXG4gIGNvbnN0IG1hc2tlZCA9IGhhc0tleSA/IGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkgOiAnJztcclxuICBjb25zdCB1cGRhdGVkQnkgPSAoZGF0YSAmJiBkYXRhLnVwZGF0ZWRCeSkgfHwgJyc7XHJcbiAgY29uc3QgdXBkYXRlZEF0ID1cclxuICAgIGRhdGEgJiYgZGF0YS51cGRhdGVkQXQgJiYgZGF0YS51cGRhdGVkQXQudG9EYXRlXHJcbiAgICAgID8gZGF0YS51cGRhdGVkQXQudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcclxuICAgICAgOiAnJztcclxuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkNvbnZpZXJ0ZSBkaXJlY2Npb25lcyBhIGNvb3JkZW5hZGFzIGNvbiBtdWNoYSBtZWpvciBwcmVjaXNpXHUwMEYzbiBxdWUgT1NNIChzb2JyZSB0b2RvIGVuIGxvY2FsaWRhZGVzIGNoaWNhcykuIENvc3RvIGdyYXRpcyBoYXN0YSA0MC4wMDAgcmVxdWVzdHMvbWVzLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoaGFzS2V5KSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2JvcmRlcjoxcHggc29saWQgIzZlZTdiNztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzA2NWY0NlwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Q2FyZ2FkYSBwb3IgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwodXBkYXRlZEJ5IHx8ICdhZG1pbicpICtcclxuICAgICAgKHVwZGF0ZWRBdCA/ICcgKCcgKyBlc2NhcGVIdG1sKHVwZGF0ZWRBdCkgKyAnKScgOiAnJykgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWJvdHRvbToxMHB4O3RleHQtYWxpZ246Y2VudGVyXCI+U2luIEFQSSBrZXkuIEdlb2NvZGluZyB1c2EgT3BlblN0cmVldE1hcCAoZ3JhdGlzIHBlcm8gcGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLjwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWN5YW5cIiBvbmNsaWNrPVwic2F2ZUdtYXBzQXBpS2V5KClcIiBzdHlsZT1cImJhY2tncm91bmQ6IzEwYjk4MVwiPicgK1xyXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcclxuICAgICc8L2J1dHRvbj4nO1xyXG4gIGlmIChoYXNLZXkpXHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRlbGV0ZUdtYXBzQXBpS2V5KClcIj5Cb3JyYXI8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG53aW5kb3cuc2F2ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGNvbnN0IHJhdyA9IHByb21wdChcclxuICAgICdQZWdhIGFjYSBsYSBBUEkga2V5IGRlIEdvb2dsZSBNYXBzIChmb3JtYXRvIEFJemFTeS4uLikuXFxuXFxuSU1QT1JUQU5URTogZW4gR29vZ2xlIENsb3VkIENvbnNvbGUgcmVzdHJpbmdpIGxhIGtleSBwb3IgSFRUUCByZWZlcnJlciBhIGh0dHBzOi8vc2hpbWFuby1hcmcuZ2l0aHViLmlvLyogcGFyYSBxdWUgbmFkaWUgdGUgbGEgcm9iZS4nLFxyXG4gICAgJydcclxuICApO1xyXG4gIGlmIChyYXcgPT09IG51bGwpIHJldHVybjtcclxuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xyXG4gIGlmICgha2V5KSB7XHJcbiAgICBhbGVydCgnVmFjaWEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChrZXkubGVuZ3RoIDwgMjApIHtcclxuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXHJcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcclxuICAgICAgLnNldChcclxuICAgICAgICB7XHJcbiAgICAgICAgICBhcGlLZXk6IGtleSxcclxuICAgICAgICAgIHVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICB1cGRhdGVkQnlVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcclxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBrZXk7XHJcbiAgICBzaG93U3luY1RhZygnR29vZ2xlIE1hcHMgQVBJIGtleSBndWFyZGFkYScpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVHbWFwc0FwaUtleScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG53aW5kb3cuZGVsZXRlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5kZWxldGUoKTtcclxuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgYm9ycmFkYScpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZUdtYXBzQXBpS2V5JywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQlVMSyBBUFBST1ZFUiAtIGFzaWduYXIgZWwgbWlzbW8gXCJSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lc1wiXHJcbi8vIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXMgZGUgdW4gc29sbyBjbGljay5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFV0aWwgY3VhbmRvIHVuIHNvbG8gYXByb2JhZG9yIChlai4gUGFibG8gZ2VyZW50ZSkgcmV2aXNhIGxhc1xyXG4vLyByZW5kaWNpb25lcyBkZSBUT0RPUyBsb3MgdmVuZGVkb3Jlcy4gU2luIGVzdG8gZWwgYWRtaW4gdGllbmUgcXVlXHJcbi8vIGFicmlyIGNhZGEgZmlsYSBkZWwgcGFuZWwgVXN1YXJpb3MgeSBzZXRlYXIgZWwgZHJvcGRvd24gdW5hIGEgdW5hLlxyXG5mdW5jdGlvbiByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1bGstYXBwcm92ZXItc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBjYW5kaWRhdGVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcihcclxuICAgICh1KSA9PiB1LnJvbGUgPT09ICdhZG1pbicgfHwgdS5yb2xlID09PSAnZ2VyZW50ZScgfHwgdS5yb2xlID09PSAnaW50ZXJubydcclxuICApO1xyXG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiNhMjFjYWZcIj5BcHJvYmFkb3IgZGUgUmVuZGljaW9uZXMgLSBhc2lnbmFjaW9uIG1hc2l2YTwvZGl2Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFjYW5kaWRhdGVzLmxlbmd0aCkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCBhZG1pbiAvIGdlcmVudGUgLyBpbnRlcm5vLiBQcmltZXJvIGFzaWduYSB1biByb2wgYSBhbGd1aWVuLjwvZGl2Pic7XHJcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXZlbmRlZG9yZXMubGVuZ3RoKSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIHZlbmRlZG9yIHRvZGF2aWEuPC9kaXY+JztcclxuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8c2VsZWN0IGlkPVwiYnVsay1hcHByb3Zlci1zZWxlY3RcIiBzdHlsZT1cInBhZGRpbmc6OHB4IDEwcHg7Ym9yZGVyOjEuNXB4IHNvbGlkICNmMGFiZmM7Ym9yZGVyLXJhZGl1czo2cHg7Zm9udC1zaXplOjEycHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Zm9udC1mYW1pbHk6aW5oZXJpdDtmbGV4OjE7bWF4LXdpZHRoOjM0MHB4XCI+JztcclxuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xyXG4gIGNhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xyXG4gICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArIHUucm9sZSArICcpJztcclxuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcclxuICB9KTtcclxuICBodG1sICs9ICc8L3NlbGVjdD4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImJ1bGtBc3NpZ25BcHByb3ZlcigpXCI+QXNpZ25hciBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzICgnICtcclxuICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcclxuICAgICcpPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxud2luZG93LmJ1bGtBc3NpZ25BcHByb3ZlciA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcclxuICBjb25zdCB1aWQgPSBzZWwgJiYgc2VsLnZhbHVlO1xyXG4gIGlmICghdWlkKSB7XHJcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcclxuICBpZiAoIWFwcHJvdmVyKSB7XHJcbiAgICBhbGVydCgnQXByb2JhZG9yIG5vIGVuY29udHJhZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xyXG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcclxuICAgIGFsZXJ0KCdObyBoYXkgdmVuZGVkb3JlcyBwYXJhIGFzaWduYXIuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGFwcHJvdmVyTGFiZWwgPSBhcHByb3Zlci5kaXNwbGF5TmFtZSB8fCBhcHByb3Zlci5lbWFpbCB8fCBhcHByb3Zlci5fdWlkO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnQXNpZ25hciBhICcgK1xyXG4gICAgICAgIGFwcHJvdmVyTGFiZWwgK1xyXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xyXG4gICAgICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcclxuICAgICAgICAnIHZlbmRlZG9yZXM/XFxuXFxuVmEgYSBzb2JyZXNjcmliaXIgY3VhbHF1aWVyIGFwcm9iYWRvciBwcmV2aW8gYXNpZ25hZG8gYSBjYWRhIHZlbmRlZG9yLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgbGV0IG9rQ291bnQgPSAwLFxyXG4gICAgX2VyckNvdW50ID0gMDtcclxuICAvLyBVcGRhdGUgZW4gbG90ZS4gVXNhbW9zIHVuIGJhdGNoIGRlIEZpcmVzdG9yZS5cclxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcclxuICB2ZW5kZWRvcmVzLmZvckVhY2goKHYpID0+IHtcclxuICAgIGNvbnN0IHJlZiA9IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2Modi5fdWlkKTtcclxuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICB9KTtcclxuICB9KTtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgYmF0Y2guY29tbWl0KCk7XHJcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XHJcbiAgICBpZiAodHlwZW9mIGxvZ09wID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIGxvZ09wKCdidWxrX2Fzc2lnbl9hcHByb3ZlcicsICdyb2xlcycsIGFwcHJvdmVyTGFiZWwsIHtcclxuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxyXG4gICAgICAgIGFwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHZlbmRlZG9yQ291bnQ6IHZlbmRlZG9yZXMubGVuZ3RoLFxyXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2J1bGtBc3NpZ25BcHByb3ZlcicsIGUpO1xyXG4gICAgX2VyckNvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbiAgaWYgKG9rQ291bnQpIHtcclxuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXHJcbiAgfVxyXG59O1xyXG5cclxuLy8gR2VvY29kaW5nIGNvbiBHb29nbGUgTWFwcyBBUEkuIERldnVlbHZlIHtsYXQsIGxuZywgZGlzcGxheSwgcHJlY2lzaW9ufVxyXG4vLyBvIG51bGwgc2kgbm8gZW5jb250cm8gLyBzaW4ga2V5LlxyXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcclxuICBjb25zdCBrZXkgPSBhd2FpdCBnZXRHbWFwc0FwaUtleSgpO1xyXG4gIGlmICgha2V5KSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xyXG4gIGNvbnN0IGZ1bGxBZGRyID0gW2FkZHJlc3MsIGxvY2FsaXR5LCBwcm92LCAnQXJnZW50aW5hJ10uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJywgJyk7XHJcbiAgLy8gcmVnaW9uPWFyICsgY29tcG9uZW50cz1jb3VudHJ5OkFSIHNlc2dhIGxvcyByZXN1bHRhZG9zIGEgQVIuXHJcbiAgY29uc3QgdXJsID1cclxuICAgICdodHRwczovL21hcHMuZ29vZ2xlYXBpcy5jb20vbWFwcy9hcGkvZ2VvY29kZS9qc29uJyArXHJcbiAgICAnP2FkZHJlc3M9JyArXHJcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcclxuICAgICcmcmVnaW9uPWFyJyArXHJcbiAgICAnJmNvbXBvbmVudHM9Y291bnRyeTpBUicgK1xyXG4gICAgJyZsYW5ndWFnZT1lcycgK1xyXG4gICAgJyZrZXk9JyArXHJcbiAgICBlbmNvZGVVUklDb21wb25lbnQoa2V5KTtcclxuICB0cnkge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHVybCk7XHJcbiAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcignSFRUUCAnICsgci5zdGF0dXMpO1xyXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT0snICYmIGRhdGEucmVzdWx0cyAmJiBkYXRhLnJlc3VsdHMubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnN0IHJlcyA9IGRhdGEucmVzdWx0c1swXTtcclxuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcclxuICAgICAgaWYgKCFsb2MpIHJldHVybiBudWxsO1xyXG4gICAgICAvLyBsb2NhdGlvbl90eXBlIGluZGljYSBwcmVjaXNpb246IFJPT0ZUT1AgPiBSQU5HRV9JTlRFUlBPTEFURUQgPiBHRU9NRVRSSUNfQ0VOVEVSID4gQVBQUk9YSU1BVEUuXHJcbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XHJcbiAgICAgIGxldCBwcmVjaXNpb24gPSAnYWRkcmVzcyc7XHJcbiAgICAgIGlmIChsdCA9PT0gJ0FQUFJPWElNQVRFJykgcHJlY2lzaW9uID0gJ2xvY2FsaXR5JztcclxuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XHJcbiAgICAgIC8vIEV4dHJhZXIgbG9jYWxpdHkgKyBhZG1pbl9hcmVhIGRlbCByZXNwb25zZSBwYXJhIGF1dG9jb21wbGV0YXIgY2FtcG9zXHJcbiAgICAgIC8vIHF1ZSBTQVAgbm8gZXhwb3J0byAoU2hpcC10byBDaXR5IHZhY2lvIGVzIG11eSBjb211biBlbiBCUHMgdmllam9zKS5cclxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XHJcbiAgICAgIGNvbnN0IGJ5VHlwZSA9ICh0KSA9PiB7XHJcbiAgICAgICAgY29uc3QgYyA9IGNvbXBvbmVudHMuZmluZCgoY2MpID0+IEFycmF5LmlzQXJyYXkoY2MudHlwZXMpICYmIGNjLnR5cGVzLmluY2x1ZGVzKHQpKTtcclxuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XHJcbiAgICAgIH07XHJcbiAgICAgIC8vIFByaW9yaWRhZCBwYXJhIGxvY2FsaWRhZDogbG9jYWxpdHkgPiBzdWJsb2NhbGl0eSA+IGFkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMi5cclxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XHJcbiAgICAgICAgYnlUeXBlKCdsb2NhbGl0eScpIHx8IGJ5VHlwZSgnc3VibG9jYWxpdHknKSB8fCBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMicpIHx8ICcnO1xyXG4gICAgICBjb25zdCBkZXRlY3RlZFByb3ZpbmNlID0gYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzEnKSB8fCAnJztcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBsYXQ6IHBhcnNlRmxvYXQobG9jLmxhdCksXHJcbiAgICAgICAgbG5nOiBwYXJzZUZsb2F0KGxvYy5sbmcpLFxyXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcclxuICAgICAgICBwcmVjaXNpb246IHByZWNpc2lvbixcclxuICAgICAgICBwcm92aWRlcjogJ2dvb2dsZScsXHJcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcclxuICAgICAgICBsb2NhbGl0eTogZGV0ZWN0ZWRMb2NhbGl0eSxcclxuICAgICAgICBwcm92aW5jZTogZGV0ZWN0ZWRQcm92aW5jZSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ1pFUk9fUkVTVUxUUycpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXHJcbiAgICAgICAgJ1tnbWFwc10gUkVRVUVTVF9ERU5JRUQ6JyxcclxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcclxuICAgICAgICAgICcoc2luIGRldGFsbGUpLiBSZXZpc2FyIHF1ZSBsYSBBUEkga2V5IHRlbmdhIGhhYmlsaXRhZGEgR2VvY29kaW5nIEFQSSB5IGVsIHJlZmVycmVyIHBlcm1pdGEgZXN0ZSBkb21pbmlvLidcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdPVkVSX1FVRVJZX0xJTUlUJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcblxyXG53aW5kb3cub3BlbkFkbWluUGFuZWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIC8vIENhcmdhciBhbGxvd2VkX2VtYWlscyBwYXJhIG1vc3RyYXIgYXJyaWJhIGxhIHNlY2Npb24gZGUgcHJlLWF1dG9yaXphY2lvbmVzXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGFlUXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZ2V0KCk7XHJcbiAgICBjb25zdCBhbGxvd2VkTGlzdCA9IFtdO1xyXG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgIGFsbG93ZWRMaXN0LnB1c2goT2JqZWN0LmFzc2lnbih7IF9pZDogZC5pZCB9LCBkLmRhdGEoKSkpO1xyXG4gICAgfSk7XHJcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdsb2FkIGFsbG93ZWRfZW1haWxzJywgZSk7XHJcbiAgfVxyXG4gIC8vIENhcmdhciBjb25maWcgR2VtaW5pIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXlcclxuICB0cnkge1xyXG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xyXG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihnU25hcC5leGlzdHMgPyBnU25hcC5kYXRhKCkgOiBudWxsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xyXG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihudWxsKTtcclxuICB9XHJcbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBnbVNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XHJcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ21hcHMgY29uZmlnJywgZSk7XHJcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xyXG4gICAgLy8gRTYgZml4IEMxOiB2YWNpYXIgZWwgQXJyYXkgaW4tcGxhY2UgKHByZXNlcnZhIHdpbmRvdy51c2Vyc0NhY2hlIHJlZikuXHJcbiAgICB1c2Vyc0NhY2hlLmxlbmd0aCA9IDA7XHJcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcclxuICAgICAgdXNlcnNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBfdWlkOiBkb2MuaWQgfSwgZG9jLmRhdGEoKSkpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXHJcbiAgICB0cnkge1xyXG4gICAgICByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignYnVsayBhcHByb3ZlciBzZWN0aW9uJywgZSk7XHJcbiAgICB9XHJcbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcclxuICAgIC8vIHB1ZWRhbiB2ZXIgZGVzdGluYXRhcmlvcyBhbCBjcmVhciB0YXJlYXMgZW4gTm90aWZpY2FjaW9uZXMuIFNpbiBlc3RvXHJcbiAgICAvLyBsb3MgdmVuZGVkb3JlcyB2ZW4gZWwgZHJvcGRvd24gdmFjaW8gKHNlY3VyaXR5IHJ1bGVzIGJsb3F1ZWFuIC9yb2xlcykuXHJcbiAgICB0cnkge1xyXG4gICAgICBzeW5jVXNlcnNEaXJlY3RvcnkoKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcclxuICAgIH1cclxuICAgIC8vIExpc3RhIGRlIGludGVybm9zIGRpc3BvbmlibGVzIChwYXJhIGFzaWduYXIgcGFyZWphIGEgbG9zIHZlbmRlZG9yZXMpXHJcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XHJcbiAgICBjb25zdCBfaW50ZXJub09wdHMgPVxyXG4gICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIHBhcmVqYSAtPC9vcHRpb24+JyArXHJcbiAgICAgIGludGVybm9zXHJcbiAgICAgICAgLm1hcChcclxuICAgICAgICAgICh1KSA9PlxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICB1Ll91aWQgK1xyXG4gICAgICAgICAgICAnXCI+JyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xyXG4gICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgIClcclxuICAgICAgICAuam9pbignJyk7XHJcblxyXG4gICAgY29uc3QgdGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXNlcnMtdGFibGUtYm9keScpO1xyXG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xyXG4gICAgbGV0IHRhYmxlSHRtbCA9ICcnO1xyXG4gICAgbGV0IGNhcmRzSHRtbCA9ICcnO1xyXG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xyXG4gICAgICB0YWJsZUh0bWwgPVxyXG4gICAgICAgICc8dHI+PHRkIGNvbHNwYW49XCI2XCIgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L3RkPjwvdHI+JztcclxuICAgICAgY2FyZHNIdG1sID1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMnB4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvZGl2Pic7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBBZG1pbnMgcHJpbWFyaW9zIHByb3RlZ2lkb3M6IG5vIHNlIHB1ZWRlbiBlbGltaW5hciAoTWFyaWFubyArIGJvdCBjb3Jwb3JhdGl2bylcclxuICAgICAgY29uc3QgUFJPVEVDVEVEX0FETUlOX0VNQUlMUyA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XHJcbiAgICAgIC8vIFBhcmEgbG9zIGludGVybm9zIGNhbGN1bGFtb3MgbGEgcmVsYWNpb24gaW52ZXJzYTogcXVpZW5lcyBsb3MgdGllbmVuIGNvbW8gcGFyZWphXHJcbiAgICAgIGZ1bmN0aW9uIHZlbmRvcnNQYXJhSW50ZXJubyhpbnRlcm5vVWlkKSB7XHJcbiAgICAgICAgcmV0dXJuIHVzZXJzQ2FjaGUuZmlsdGVyKFxyXG4gICAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyAmJiB1LmludGVybmFsUGFydG5lclVpZCA9PT0gaW50ZXJub1VpZFxyXG4gICAgICAgICk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gQ2FuZGlkYXRvcyBhIHJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzOiBhZG1pbiwgZ2VyZW50ZSBvIGludGVybm8gKG5vIHZlbmRlZG9yZXMgbmkgdmlld2VycyBuaSB1bmFzc2lnbmVkKVxyXG4gICAgICBjb25zdCByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKFxyXG4gICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICdhZG1pbicgfHwgdS5yb2xlID09PSAnZ2VyZW50ZScgfHwgdS5yb2xlID09PSAnaW50ZXJubydcclxuICAgICAgKTtcclxuICAgICAgdXNlcnNDYWNoZS5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZG9jSWQgPSBkLl91aWQ7XHJcbiAgICAgICAgY29uc3QgaXNTZWxmID0gZG9jSWQgPT09IGN1cnJlbnRVc2VyLnVpZDtcclxuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcclxuICAgICAgICBjb25zdCBpc0ludGVybm8gPSBkLnJvbGUgPT09ICdpbnRlcm5vJztcclxuICAgICAgICBjb25zdCByb2xlT3B0aW9ucyA9IFsndW5hc3NpZ25lZCcsICdhZG1pbicsICdnZXJlbnRlJywgJ3ZlbmRlZG9yJywgJ2ludGVybm8nLCAndmlld2VyJ11cclxuICAgICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAgIChyKSA9PlxyXG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgciArXHJcbiAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgKGQucm9sZSA9PT0gciA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAoaXNTZWxmICYmIHIgIT09ICdhZG1pbicgPyAnIGRpc2FibGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICByICtcclxuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICAgIGNvbnN0IHZlbmRvck9wdGlvbnMgPVxyXG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tPC9vcHRpb24+JyArXHJcbiAgICAgICAgICBWRU5ET1JTLm1hcChcclxuICAgICAgICAgICAgKHYpID0+XHJcbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgICB2LmtleSArXHJcbiAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgKGQudmVuZG9yID09PSB2LmtleSA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICAgIHYuem9uZSArXHJcbiAgICAgICAgICAgICAgJyAnICtcclxuICAgICAgICAgICAgICB2LmtleSArXHJcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgICkuam9pbignJyk7XHJcbiAgICAgICAgLy8gU2kgZXMgaW50ZXJubywgbW9zdHJhciByZWxhY2lvbiBpbnZlcnNhICh2ZW5kZWRvcmVzIHF1ZSBsbyB0aWVuZW4gY29tbyBwYXJlamEpIGVuIHZleiBkZWwgZHJvcGRvd24gZWRpdGFibGVcclxuICAgICAgICBsZXQgcGFyZWphQ2VsbDtcclxuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XHJcbiAgICAgICAgICBjb25zdCB2aW5jID0gdmVuZG9yc1BhcmFJbnRlcm5vKGRvY0lkKTtcclxuICAgICAgICAgIGlmICh2aW5jLmxlbmd0aCkge1xyXG4gICAgICAgICAgICBjb25zdCBsaXN0ID0gdmluY1xyXG4gICAgICAgICAgICAgIC5tYXAoKHUpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6IHUuZW1haWwgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKGxhYmVsKSArXHJcbiAgICAgICAgICAgICAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPignICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8ICcnKSArXHJcbiAgICAgICAgICAgICAgICAgICcpPC9zcGFuPidcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAuam9pbignPGJyPicpO1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsID1cclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bGluZS1oZWlnaHQ6MS41XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjJweFwiPlZlbmRlZG9yZXMgZXh0ZXJub3MgdmluY3VsYWRvcyAoYXV0byk8L2Rpdj4nICtcclxuICAgICAgICAgICAgICBsaXN0ICtcclxuICAgICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIC8vIGlucHV0IG9jdWx0byBwYXJhIHF1ZSBzYXZlVXNlclJvbGUgbm8gcGlzZSBlbCB2YWxvciBkZWwgcm9sID0gaW50ZXJubyAobm8gYXBsaWNhIGludGVybmFsUGFydG5lclVpZClcclxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zdCBpbnRlcm5vT3B0c0ZvclJvdyA9XHJcbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcclxuICAgICAgICAgICAgaW50ZXJub3NcclxuICAgICAgICAgICAgICAubWFwKFxyXG4gICAgICAgICAgICAgICAgKHUpID0+XHJcbiAgICAgICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgICAgIHUuX3VpZCArXHJcbiAgICAgICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgICAgICAoZC5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXHJcbiAgICAgICAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAnPHNlbGVjdCBjbGFzcz1cImludGVybmFsLXNlbFwiIHRpdGxlPVwiUGFyZWphIGludGVybm8gKHNvbG8gYXBsaWNhIHNpIGVsIHJvbCBlcyB2ZW5kZWRvcilcIj4nICtcclxuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xyXG4gICAgICAgICAgICAnPC9zZWxlY3Q+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXHJcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiPihWT1MpPC9zcGFuPidcclxuICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgY29uc3QgcHJvdGVjdGVkVGFnID1cclxuICAgICAgICAgIGlzUHJvdGVjdGVkICYmICFpc1NlbGZcclxuICAgICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIiB0aXRsZT1cIkFkbWluIHByb3RlZ2lkbyAtIG5vIHNlIHB1ZWRlIGVsaW1pbmFyXCI+UFJPVEVHSURPPC9zcGFuPidcclxuICAgICAgICAgICAgOiAnJztcclxuICAgICAgICBjb25zdCB3YVZhbCA9IGQud2hhdHNhcHAgfHwgJyc7XHJcbiAgICAgICAgY29uc3Qgd2FJbnB1dEh0bWwgPVxyXG4gICAgICAgICAgJzxpbnB1dCB0eXBlPVwidGVsXCIgY2xhc3M9XCJ3YS1pbnB1dFwiIHBsYWNlaG9sZGVyPVwiZWouIDU0OTExMjY3NjIwMzFcIiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cih3YVZhbCkgK1xyXG4gICAgICAgICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjVweCA3cHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjRweDtmb250LXNpemU6MTFweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZTtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKVwiIHRpdGxlPVwiTnVtZXJvIFdoYXRzQXBwIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoc2luICsgbmkgZXNwYWNpb3MpLiBTZSB1c2EgYWwgZW52aWFyIGxhIHJ1dGEuXCIvPic7XHJcbiAgICAgICAgLy8gRHJvcGRvd24gJ1Jlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzJ1xyXG4gICAgICAgIGNvbnN0IGN1ckFwcHJvdmVyVWlkID0gZC5yZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8ICcnO1xyXG4gICAgICAgIGxldCByZW5kQXBwcm92ZXJPcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBhc2lnbmFyIC08L29wdGlvbj4nO1xyXG4gICAgICAgIHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcclxuICAgICAgICAgIGlmICh1Ll91aWQgPT09IGRvY0lkKSByZXR1cm47IC8vIHVuIHVzdWFyaW8gbm8gcHVlZGUgc2VyIHN1IHByb3BpbyBhcHJvYmFkb3JcclxuICAgICAgICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyAodS5yb2xlIHx8ICcnKSArICcpJztcclxuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgKz1cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgZXNjYXBlQXR0cih1Ll91aWQpICtcclxuICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgIChjdXJBcHByb3ZlclVpZCA9PT0gdS5fdWlkID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICBlc2NhcGVIdG1sKGxibCkgK1xyXG4gICAgICAgICAgICAnPC9vcHRpb24+JztcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCByZW5kQXBwcm92ZXJIdG1sID1cclxuICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwicmVuZC1hcHByb3Zlci1zZWxcIiB0aXRsZT1cIlF1aWVuIGFwcnVlYmEgbGFzIHJlbmRpY2lvbmVzIGRlIGVzdGUgdXN1YXJpb1wiPicgK1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArXHJcbiAgICAgICAgICAnPC9zZWxlY3Q+JztcclxuICAgICAgICAvLyBCb3RcdTAwRjNuIENhbWJpYXIgY29udHJhc2VcdTAwRjFhXHJcbiAgICAgICAgY29uc3QgcHdkQnRuSHRtbCA9XHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweFwiIG9uY2xpY2s9XCJjaGFuZ2VVc2VyUGFzc3dvcmQoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICBcIicsIFwiICtcclxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXHJcbiAgICAgICAgICAnKVwiPkNvbnRyYXNlXHUwMEYxYTwvYnV0dG9uPic7XHJcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDb25maWd1cmFyIDJGQVxyXG4gICAgICAgIGNvbnN0IHRvdHBTdGF0dXNUYWcgPSBkLnRvdHBFbmFibGVkXHJcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPidcclxuICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgY29uc3QgdG90cEJ0bkh0bWwgPVxyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICAgIChkLnRvdHBFbmFibGVkID8gJyMxMGI5ODEnIDogJyM1YjIxYjYnKSArXHJcbiAgICAgICAgICAnXCIgb25jbGljaz1cIm9wZW5Ub3RwU2V0dXAoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICBcIicsIFwiICtcclxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXHJcbiAgICAgICAgICAnKVwiPjJGQScgK1xyXG4gICAgICAgICAgdG90cFN0YXR1c1RhZyArXHJcbiAgICAgICAgICAnPC9idXR0b24+JztcclxuICAgICAgICAvLyBEZXNrdG9wIHJvd1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRyIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUgfHwgJycpICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICsgcm9sZU9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwYXJlamFDZWxsICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZCBjbGFzcz1cIndhLWNvbFwiPicgKyB3YUlucHV0SHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHJlbmRBcHByb3Zlckh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwd2RCdG5IdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgdG90cEJ0bkh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIGNvbnN0IHNob3dEZWxldGUgPSAhaXNTZWxmICYmICFpc1Byb3RlY3RlZDtcclxuICAgICAgICBjb25zdCBkZWxCdG4gPSBzaG93RGVsZXRlXHJcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXHJcbiAgICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICAgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPidcclxuICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgdGFibGVIdG1sICs9XHJcbiAgICAgICAgICAnPHRkPicgK1xyXG4gICAgICAgICAgZGVsQnRuICtcclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPC90cj4nO1xyXG4gICAgICAgIC8vIE1vYmlsZSBjYXJkXHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidXNlcnMtY2FyZFwiIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdj48ZGl2IGNsYXNzPVwidWMtZW1haWxcIj4nICtcclxuICAgICAgICAgIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgK1xyXG4gICAgICAgICAgeW91VGFnICtcclxuICAgICAgICAgIHByb3RlY3RlZFRhZyArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBpZiAoZC5kaXNwbGF5TmFtZSlcclxuICAgICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLW5hbWVcIj4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lKSArICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJvbDwvbGFiZWw+PHNlbGVjdCBjbGFzcz1cInJvbGUtc2VsXCI+JyArXHJcbiAgICAgICAgICByb2xlT3B0aW9ucyArXHJcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICtcclxuICAgICAgICAgIHZlbmRvck9wdGlvbnMgK1xyXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XHJcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xyXG4gICAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yZXMgdmluY3VsYWRvcyAoYXV0byk8L2xhYmVsPicgK1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsICtcclxuICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5QYXJlamEgaW50ZXJubyAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPicgK1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsICtcclxuICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+V2hhdHNBcHAgKGNvbiBjb2RpZ28gZGUgcGFpcywgc2luICsgbmkgZXNwYWNpb3MpPC9sYWJlbD4nICtcclxuICAgICAgICAgIHdhSW5wdXRIdG1sICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM8L2xhYmVsPicgK1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVySHRtbCArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCIgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjtkaXNwbGF5OmZsZXg7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+JyArXHJcbiAgICAgICAgICBwd2RCdG5IdG1sICtcclxuICAgICAgICAgIHRvdHBCdG5IdG1sICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGNvbnN0IGRlbEJ0bkMgPSBzaG93RGVsZXRlXHJcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXHJcbiAgICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICAgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPidcclxuICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLWFjdGlvbnNcIj4nICtcclxuICAgICAgICAgIGRlbEJ0bkMgK1xyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICB0Ym9keS5pbm5lckhUTUwgPSB0YWJsZUh0bWw7XHJcbiAgICBjYXJkc0VsLmlubmVySFRNTCA9IGNhcmRzSHRtbDtcclxuICAgIC8vIEFjdHVhbGl6YSBoZWFkZXIgZGUgdGFibGEgY29uIGxhIGNvbHVtbmEgbnVldmFcclxuICAgIGNvbnN0IHRoZWFkID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI3VzZXJzLXRhYmxlIHRoZWFkIHRyJyk7XHJcbiAgICBpZiAodGhlYWQpXHJcbiAgICAgIHRoZWFkLmlubmVySFRNTCA9XHJcbiAgICAgICAgJzx0aD5FbWFpbDwvdGg+PHRoPk5vbWJyZTwvdGg+PHRoPlJvbDwvdGg+PHRoPlZlbmRlZG9yPC90aD48dGg+UGFyZWphIGludGVybm88L3RoPjx0aCBjbGFzcz1cIndhLWNvbFwiPldoYXRzQXBwPC90aD48dGg+UmVzcC4gcmVuZGljaW9uZXM8L3RoPjx0aD5QYXNzPC90aD48dGg+MkZBPC90aD48dGg+PC90aD4nO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ29wZW5BZG1pblBhbmVsJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gdXN1YXJpb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2xvc2VBZG1pblBhbmVsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBTRUNDSVx1MDBEM046IEYyOiBkZWxldGVVc2VyUm9sZSArIFRPVFAgKyBjaGFuZ2VVc2VyUGFzc3dvcmQgKyBzYXZlVXNlclJvbGUgKGlubGluZSBMMTQxMDUtMTQzOTApXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxud2luZG93LmRlbGV0ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xyXG4gICAgYWxlcnQoJ05vIHBvZGVzIGVsaW1pbmFyIHR1IHByb3BpbyBhY2Nlc28uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIERlZmVuc2EgYWRpY2lvbmFsOiBhZG1pbnMgcHJvdGVnaWRvcyBubyBzZSBwdWVkZW4gZWxpbWluYXIgbmkgZGVzZGUgY29uc29sYVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwUHJlID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xyXG4gICAgY29uc3QgZW1haWxQcmUgPSAoc25hcFByZS5leGlzdHMgPyBzbmFwUHJlLmRhdGEoKS5lbWFpbCB8fCAnJyA6ICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgY29uc3QgUFJPVEVDVEVEID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcclxuICAgIGlmIChQUk9URUNURUQuaW5kZXhPZihlbWFpbFByZSkgPj0gMCkge1xyXG4gICAgICBhbGVydCgnRXN0ZSBlcyB1biBhZG1pbiBwcm90ZWdpZG8gKCcgKyBlbWFpbFByZSArICcpIHkgbm8gc2UgcHVlZGUgZWxpbWluYXIuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICB9IGNhdGNoIChfZSkge1xyXG4gICAgLyogc2kgZmFsbGEgbGEgbGVjdHVyYSBwcmV2aWEsIHNpZ3VlIGNvbiBjb25maXJtICovXHJcbiAgfVxyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnRWxpbWluYXIgYWNjZXNvIGRlIGVzdGUgdXN1YXJpbz9cXG5cXG5QaWVyZGUgYWNjZXNvIGRlIGlubWVkaWF0by4gU2kgdnVlbHZlIGEgZW50cmFyIGNvbiBHb29nbGUgdmEgYSBxdWVkYXIgY29tbyBcInNpbiByb2wgYXNpZ25hZG9cIiBoYXN0YSBxdWUgdm9zIGxvIGhhYmlsaXRlcyBkZSBudWV2by5cXG5cXG5TdSBjdWVudGEgR29vZ2xlIHNpZ3VlIGV4aXN0aWVuZG8sIG5vIHNlIGJvcnJhLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBjb25zdCBkYXRhID0gc25hcC5leGlzdHMgPyBzbmFwLmRhdGEoKSA6IHt9O1xyXG4gICAgbG9nT3AoJ2VsaW1pbmFyX3VzdWFyaW8nLCAndXNlcicsIGRhdGEuZW1haWwgfHwgdWlkLCB7XHJcbiAgICAgIHVpZCxcclxuICAgICAgcHJldmlvdXNSb2xlOiBkYXRhLnJvbGUsXHJcbiAgICAgIHByZXZpb3VzVmVuZG9yOiBkYXRhLnZlbmRvcixcclxuICAgIH0pO1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmRlbGV0ZSgpO1xyXG4gICAgc2hvd1N5bmNUYWcoJ1VzdWFyaW8gZWxpbWluYWRvJyk7XHJcbiAgICBhd2FpdCBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVVzZXJSb2xlJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gUGFuZWwgYWRtaW46IHNldHVwIC8gcmVzZXQgZGUgMkZBIHBvciB1c3VhcmlvXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5sZXQgdG90cFNldHVwU3RhdGUgPSBudWxsOyAvLyB7dWlkLCBlbWFpbCwgc2VjcmV0LCBvdHBhdXRofVxyXG5cclxud2luZG93Lm9wZW5Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xyXG4gIGNvbnNvbGUubG9nKCdbMkZBXSBvcGVuVG90cFNldHVwIGNhbGxlZCcsIHsgdWlkLCBlbWFpbCwgdXNlclJvbGUgfSk7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XHJcbiAgICBhbGVydCgnU29sbyBlbCBhZG1pbmlzdHJhZG9yIHB1ZWRlIGNvbmZpZ3VyYXIgMkZBIHBhcmEgb3Ryb3MgdXN1YXJpb3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghdWlkKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IFVJRCBkZWwgdXN1YXJpbyBubyBkaXNwb25pYmxlLiBSZWNhcmdhIGxhIHBhZ2luYSB5IHJlaW50ZW50YS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xyXG4gIC8vIE1vZGFsIGV4aXN0ZT9cclxuICBjb25zdCBtb2RhbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJyk7XHJcbiAgaWYgKCFtb2RhbCkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkbyBlbiBlbCBET00uIFJlY2FyZ2EgbGEgcGFnaW5hIChDdHJsK1NoaWZ0K1IpLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBzdWJ0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1zdWJ0Jyk7XHJcbiAgaWYgKHN1YnRFbCkgc3VidEVsLnRleHRDb250ZW50ID0gJ1BhcmE6ICcgKyAoZW1haWwgfHwgdWlkKTtcclxuICAvLyBMZWVyIGVzdGFkbyBhY3R1YWxcclxuICBsZXQgY3VyRW5hYmxlZCA9IGZhbHNlO1xyXG4gIGxldCBjdXJTZWNyZXQgPSBudWxsO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xyXG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBzbmFwLmRhdGEoKSB8fCB7fTtcclxuICAgICAgY3VyRW5hYmxlZCA9ICEhZC50b3RwRW5hYmxlZDtcclxuICAgICAgY3VyU2VjcmV0ID0gZC50b3RwU2VjcmV0IHx8IG51bGw7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ1syRkFdIGRvYyByb2xlcy8nICsgdWlkICsgJyBubyBleGlzdGUnKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdbMkZBXSBlcnJvciBsZXllbmRvIHJvbGVzLycgKyB1aWQsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGxleWVuZG8gZWwgZXN0YWRvIGRlIDJGQSBkZWwgdXN1YXJpbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xyXG4gIGlmICghYykge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiBjb250ZW5lZG9yIGRlbCBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkby4gUmVjYXJnYSBsYSBwYWdpbmEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjdXJFbmFibGVkICYmIGN1clNlY3JldCkge1xyXG4gICAgYy5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itc3VjY2Vzcy1iZyk7Ym9yZGVyOjFweCBzb2xpZCAjODZlZmFjO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzKTt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnPGI+JiMxMDAwMzsgMkZBIHlhIGVzdFx1MDBFMSBhY3Rpdm88L2I+IHBhcmEgZXN0ZSB1c3VhcmlvLicgK1xyXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjExcHhcIj5TaSBsbyBwZXJkaVx1MDBGMyBvIGNhbWJpXHUwMEYzIGRlIGNlbHVsYXIsIHBvZFx1MDBFOXMgZ2VuZXJhcmxlIHVubyBudWV2byAoZWwgYW50ZXJpb3IgcXVlZGEgaW52YWxpZGFkbykuPC9zcGFuPicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7bWFyZ2luLXRvcDoxNHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICBcIicsJ1wiICtcclxuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xyXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPicgK1xyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+JyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+JyArXHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgXCInLCdcIiArXHJcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcclxuICAgICAgJ1xcJylcIj5HZW5lcmFyIDJGQTwvYnV0dG9uPicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICB9XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZVRvdHBTZXR1cE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGNvbnN0IHNlY3JldCA9IHRvdHBHZW5lcmF0ZVNlY3JldCgpO1xyXG4gIGNvbnN0IG90cGF1dGggPSB0b3RwQnVpbGRPdHBhdXRoVXJsKHNlY3JldCwgZW1haWwgfHwgdWlkKTtcclxuICB0b3RwU2V0dXBTdGF0ZSA9IHsgdWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGggfTtcclxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xyXG4gIGMuaW5uZXJIVE1MID1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci13YXJuaW5nLWJnKTtib3JkZXI6MXB4IHNvbGlkICNmY2QzNGQ7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM3ODM1MGY7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXHJcbiAgICAnPGI+UGFzb3MgcGFyYSBhY3RpdmFyOjwvYj48YnI+JyArXHJcbiAgICAnMS4gRWwgdXN1YXJpbyBpbnN0YWxhIDxiPkdvb2dsZSBBdXRoZW50aWNhdG9yPC9iPiBlbiBzdSBjZWx1bGFyLjxicj4nICtcclxuICAgICcyLiBUb2NhIFwiQWdyZWdhclwiIC8gXCIrXCIgZW4gbGEgYXBwLjxicj4nICtcclxuICAgICczLiBFbGlnZSBcIkVzY2FuZWFyIGNcdTAwRjNkaWdvIFFSXCIgeSBlc2NhbmVhIGVsIGNcdTAwRjNkaWdvIGFiYWpvIChvIHBlZ2EgZWwgc2VjcmV0IG1hbnVhbG1lbnRlKS48YnI+JyArXHJcbiAgICAnNC4gQXBhcmVjZSB1biBjXHUwMEYzZGlnbyBkZSA2IGRcdTAwRURnaXRvcyBlbiBHb29nbGUgQXV0aGVudGljYXRvci48YnI+JyArXHJcbiAgICAnNS4gTG8gZXNjcmliZSBlbiBlbCBpbnB1dCBkZSBhYmFqbyBwYXJhIGNvbmZpcm1hciB5IGFjdGl2YXIuJyArXHJcbiAgICAnPC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj48ZGl2IGlkPVwidG90cC1xci1jb250YWluZXJcIiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4XCI+R2VuZXJhbmRvIFFSLi4uPC9kaXY+PC9kaXY+JztcclxuICBjLmlubmVySFRNTCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbTo0cHhcIj5TZWNyZXQgKGNhcmdhIG1hbnVhbCBzaSBlbCBRUiBmYWxsYSk8L2Rpdj4nICtcclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTt3b3JkLWJyZWFrOmJyZWFrLWFsbDtsZXR0ZXItc3BhY2luZzouMWVtXCI+JyArXHJcbiAgICBlc2NhcGVIdG1sKHNlY3JldCkgK1xyXG4gICAgJzwvZGl2PicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxMHB4XCI+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtkaXNwbGF5OmJsb2NrO21hcmdpbi1ib3R0b206NXB4XCI+Q1x1MDBGM2RpZ28gZGUgdmVyaWZpY2FjaVx1MDBGM24gZGUgR29vZ2xlIEF1dGhlbnRpY2F0b3I8L2xhYmVsPicgK1xyXG4gICAgJzxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwidG90cC1jb25maXJtLWlucHV0XCIgaW5wdXRtb2RlPVwibnVtZXJpY1wiIG1heGxlbmd0aD1cIjdcIiBwbGFjZWhvbGRlcj1cIjAwMDAwMFwiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjEwcHggMTJweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxOHB4O3RleHQtYWxpZ246Y2VudGVyO2xldHRlci1zcGFjaW5nOi4zZW07Zm9udC13ZWlnaHQ6ODAwXCIvPjwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiY29uZmlybVRvdHBTZXR1cCgpXCI+VmVyaWZpY2FyIHkgYWN0aXZhcjwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiY2xvc2VUb3RwU2V0dXBNb2RhbCgpXCI+Q2FuY2VsYXI8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIC8vIExhenktbG9hZCBxcmNvZGVqcyB5IGdlbmVyYXIuIEVzdGEgbGlicmVyaWEgcGludGEgZWwgUVIgZGlyZWN0byBlbiBlbFxyXG4gIC8vIGNvbnRlbmVkb3IgRE9NIHZpYSBjYW52YXMvaW1nIC0gbm8gbmVjZXNpdGEgY2FsbGJhY2sgdG9EYXRhVVJMLlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkUVJDb2RlTGliKCk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmICghYm94KSByZXR1cm47XHJcbiAgICBib3guaW5uZXJIVE1MID0gJyc7IC8vIGxpbXBpYXIgZWwgXCJHZW5lcmFuZG8gUVIuLi5cIlxyXG4gICAgbmV3IFFSQ29kZShib3gsIHtcclxuICAgICAgdGV4dDogb3RwYXV0aCxcclxuICAgICAgd2lkdGg6IDIyMCxcclxuICAgICAgaGVpZ2h0OiAyMjAsXHJcbiAgICAgIGNvbG9yRGFyazogJyMwMDAwMDAnLFxyXG4gICAgICBjb2xvckxpZ2h0OiAnI2ZmZmZmZicsXHJcbiAgICAgIGNvcnJlY3RMZXZlbDogUVJDb2RlLkNvcnJlY3RMZXZlbC5NLFxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbMkZBXSBFcnJvciBjYXJnYW5kbyBRUiBsaWI6JywgZSk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmIChib3gpXHJcbiAgICAgIGJveC5pbm5lckhUTUwgPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7cGFkZGluZzoxNHB4XCI+Tm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyXHUwMEVEYSBRUi4gVXNhIGVsIHNlY3JldCBtYW51YWwgcGFyYSBjb25maWd1cmFyLjwvZGl2Pic7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmNvbmZpcm1Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKCF0b3RwU2V0dXBTdGF0ZSkgcmV0dXJuO1xyXG4gIGNvbnN0IGNvZGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtY29uZmlybS1pbnB1dCcpLnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXHMrL2csICcnKTtcclxuICBpZiAoIS9eXFxkezZ9JC8udGVzdChjb2RlKSkge1xyXG4gICAgYWxlcnQoJ0luZ3Jlc1x1MDBFMSBsb3MgNiBkXHUwMEVEZ2l0b3MuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG9rID0gYXdhaXQgdG90cFZlcmlmeUNvZGUodG90cFNldHVwU3RhdGUuc2VjcmV0LCBjb2RlLCAxKTtcclxuICBpZiAoIW9rKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ0NcdTAwRjNkaWdvIGluY29ycmVjdG8uIEFzZWd1cmF0ZSBkZSBxdWUgZWwgc2VjcmV0IHNlIGNhcmdcdTAwRjMgYmllbiBlbiBHb29nbGUgQXV0aGVudGljYXRvciB5IHJlaW50ZW50XHUwMEUxLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgIC5kb2ModG90cFNldHVwU3RhdGUudWlkKVxyXG4gICAgICAudXBkYXRlKHtcclxuICAgICAgICB0b3RwU2VjcmV0OiB0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsXHJcbiAgICAgICAgdG90cEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgdG90cEVuYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgdG90cEVuYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIH0pO1xyXG4gICAgc2hvd1N5bmNUYWcoJzJGQSBhY3RpdmFkbyBwYXJhICcgKyAodG90cFNldHVwU3RhdGUuZW1haWwgfHwgJ3VzdWFyaW8nKSk7XHJcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc2F2ZSB0b3RwJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmRpc2FibGVUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmICghY29uZmlybSgnRGVzaGFiaWxpdGFyIDJGQSBwYXJhIGVzdGUgdXN1YXJpbz8gVmEgYSBlbnRyYXIgc29sbyBjb24gcGFzc3dvcmQuJykpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxyXG4gICAgICAuZG9jKHVpZClcclxuICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgdG90cEVuYWJsZWQ6IGZhbHNlLFxyXG4gICAgICAgIHRvdHBTZWNyZXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLmRlbGV0ZSgpLFxyXG4gICAgICAgIHRvdHBEaXNhYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICB0b3RwRGlzYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgIH0pO1xyXG4gICAgc2hvd1N5bmNUYWcoJzJGQSBkZXNoYWJpbGl0YWRvJyk7XHJcbiAgICBjbG9zZVRvdHBTZXR1cE1vZGFsKCk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmNoYW5nZVVzZXJQYXNzd29yZCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKCFlbWFpbCkge1xyXG4gICAgYWxlcnQoJ0VzdGUgdXN1YXJpbyBubyB0aWVuZSBlbWFpbCByZWdpc3RyYWRvIC0gbm8gc2UgcHVlZGUgcmVzZXRlYXIuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGNob2ljZSA9IHByb21wdChcclxuICAgICdSZXNldGVhciBjb250cmFzZVx1MDBGMWEgZGUgJyArXHJcbiAgICAgIGVtYWlsICtcclxuICAgICAgJ1xcblxcbicgK1xyXG4gICAgICAnRWxlZ2kgdW5hIG9wY2lvbiAoMSAvIDIpOlxcblxcbicgK1xyXG4gICAgICAnMSkgRU5WSUFSIE1BSUwgREUgUkVTRVRFTyAocmVjb21lbmRhZG8pXFxuJyArXHJcbiAgICAgICcgTGUgbGxlZ2EgYSAnICtcclxuICAgICAgZW1haWwgK1xyXG4gICAgICAnIHVuIG1haWwgZGUgRmlyZWJhc2UgY29uIHVuIGxpbmsuXFxuJyArXHJcbiAgICAgICcgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcclxuICAgICAgJyBFcyBsbyBlc3RhbmRhciB5IGZ1bmNpb25hIHNlZ3Vyby5cXG5cXG4nICtcclxuICAgICAgJzIpIFJlc2V0ZWFyIFNPTE8gZWwgcGFzc3dvcmQtZ2F0ZSAoc2VndW5kYSBjYXBhKS5cXG4nICtcclxuICAgICAgJyBObyBjYW1iaWEgbGEgcGFzc3dvcmQgcmVhbCBkZSBGaXJlYmFzZS4gU2lydmUgc2kgZWwgdXN1YXJpb1xcbicgK1xyXG4gICAgICAnIGVudHJhIHBvciBHb29nbGUgeSBvbHZpZG8gbGEgcGFzc3dvcmQtZ2F0ZSBkZSBsYSBhcHAsIE5PIHNpXFxuJyArXHJcbiAgICAgICcgb2x2aWRvIGxhIHBhc3N3b3JkIGRlbCBsb2dpbiBjb24gZW1haWwuXFxuXFxuJyArXHJcbiAgICAgICdFc2NyaWJpIDEgbyAyOicsXHJcbiAgICAnMSdcclxuICApO1xyXG4gIGlmIChjaG9pY2UgPT09IG51bGwpIHJldHVybjtcclxuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzEnKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBmYkF1dGguc2VuZFBhc3N3b3JkUmVzZXRFbWFpbChlbWFpbCk7XHJcbiAgICAgIGFsZXJ0KFxyXG4gICAgICAgICdPSyAtIGxlIGVudmllIHVuIG1haWwgZGUgcmVzZXRlbyBhICcgK1xyXG4gICAgICAgICAgZW1haWwgK1xyXG4gICAgICAgICAgJy4gRGVjaWxlIHF1ZSByZXZpc2UgaW5ib3ggeSBzcGFtLiBFbCBsaW5rIGV4cGlyYSBlbiAxIGhvcmEuJ1xyXG4gICAgICApO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGZiRGJcclxuICAgICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgICAgICAuZG9jKHVpZClcclxuICAgICAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2ZpcmViYXNlX2VtYWlsJyxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChfZSkge31cclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignc2VuZFBhc3N3b3JkUmVzZXRFbWFpbCcsIGUpO1xyXG4gICAgICBhbGVydCgnRXJyb3IgZW52aWFuZG8gZWwgbWFpbDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzInKSB7XHJcbiAgICBjb25zdCBuZXdQd2QgPSBwcm9tcHQoXHJcbiAgICAgICdOdWV2YSBwYXNzd29yZC1nYXRlIHBhcmEgJyArXHJcbiAgICAgICAgZW1haWwgK1xyXG4gICAgICAgICc6XFxuXFxuKFNvbG8gYWZlY3RhIGxhIHNlZ3VuZGEgY2FwYSBkZSBsYSBhcHAsIE5PIGVsIGxvZ2luIGNvbiBlbWFpbCknLFxyXG4gICAgICAnJ1xyXG4gICAgKTtcclxuICAgIGlmIChuZXdQd2QgPT09IG51bGwpIHJldHVybjtcclxuICAgIGNvbnN0IHB3ZCA9IChuZXdQd2QgfHwgJycpLnRyaW0oKTtcclxuICAgIGlmIChwd2QubGVuZ3RoIDwgNCkge1xyXG4gICAgICBhbGVydCgnTGEgY29udHJhc2VcdTAwRjFhIHRpZW5lIHF1ZSB0ZW5lciBhbCBtZW5vcyA0IGNhcmFjdGVyZXMuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNyZWRzID0gYXdhaXQgYnVpbGRQYXNzd29yZENyZWRlbnRpYWxzKHB3ZCk7XHJcbiAgICAgIGF3YWl0IGZiRGJcclxuICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxyXG4gICAgICAgIC5kb2ModWlkKVxyXG4gICAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgICAgcGFzc3dvcmRIYXNoOiBjcmVkcy5wYXNzd29yZEhhc2gsXHJcbiAgICAgICAgICBwYXNzd29yZFNhbHQ6IGNyZWRzLnBhc3N3b3JkU2FsdCxcclxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdnYXRlX29ubHknLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICBzaG93U3luY1RhZygnUGFzc3dvcmQtZ2F0ZSBhY3R1YWxpemFkYSBwYXJhICcgKyBlbWFpbCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ2NoYW5nZVVzZXJQYXNzd29yZCBnYXRlJywgZSk7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIH1cclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgYWxlcnQoJ09wY2lvbiBubyB2YWxpZGEuIENhbmNlbGFkby4nKTtcclxufTtcclxuXHJcbndpbmRvdy5zYXZlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBidG4pIHtcclxuICBjb25zdCBjb250YWluZXIgPSBidG4uY2xvc2VzdCgndHInKSB8fCBidG4uY2xvc2VzdCgnLnVzZXJzLWNhcmQnKTtcclxuICBpZiAoIWNvbnRhaW5lcikgcmV0dXJuO1xyXG4gIGNvbnN0IHJvbGUgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJvbGUtc2VsJykudmFsdWU7XHJcbiAgY29uc3QgdmVuZG9yID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy52ZW5kb3Itc2VsJykudmFsdWUgfHwgbnVsbDtcclxuICBjb25zdCBpbnRlcm5hbFNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcuaW50ZXJuYWwtc2VsJyk7XHJcbiAgY29uc3QgaW50ZXJuYWxQYXJ0bmVyVWlkID0gaW50ZXJuYWxTZWwgPyBpbnRlcm5hbFNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcclxuICAvLyBXaGF0c0FwcDogbGltcGlhciB0b2RvIGxvIHF1ZSBubyBzZWEgZGlnaXRvIChhY2VwdGEgKywgZXNwYWNpb3MsIHBhclx1MDBFOW50ZXNpcywgZXRjLilcclxuICBjb25zdCB3YUlucHV0ID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy53YS1pbnB1dCcpO1xyXG4gIGNvbnN0IHdoYXRzYXBwID0gd2FJbnB1dCA/ICh3YUlucHV0LnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXEQvZywgJycpIDogJyc7XHJcbiAgaWYgKHdoYXRzYXBwICYmIHdoYXRzYXBwLmxlbmd0aCA8IDgpIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnRWwgbnVtZXJvIGRlIFdoYXRzQXBwIGVzIG11eSBjb3J0by4gVGllbmUgcXVlIHNlciBlbCBudW1lcm8gY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChlai4gNTQ5MTEyNjc2MjAzMSBwYXJhIEFyZ2VudGluYSkuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMgKHVpZCBkZWwgdXN1YXJpbyBxdWUgYXBydWViYSlcclxuICBjb25zdCByZW5kQXBwcm92ZXJTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJlbmQtYXBwcm92ZXItc2VsJyk7XHJcbiAgY29uc3QgcmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRBcHByb3ZlclNlbCA/IHJlbmRBcHByb3ZlclNlbC52YWx1ZSB8fCBudWxsIDogbnVsbDtcclxuICAvLyBDYWNoZWFyIHRhbWJpZW4gZWwgZW1haWwgZGVsIGFwcm9iYWRvciBlbiBlbCBkb2MgZGVsIHZlbmRlZG9yOiBsb3NcclxuICAvLyB2ZW5kZWRvcmVzIG5vIHB1ZWRlbiBsZWVyIC9yb2xlcy97b3Ryb1VpZH0gcG9yIHNlY3VyaXR5IHJ1bGVzLCBhc2kgcXVlXHJcbiAgLy8gbmVjZXNpdGFuIGVsIGVtYWlsIGFjYSBwYXJhIHBvZGVyIG1hbmRhciBsYSByZW5kaWNpb24gKHJlc29sdmVNeVJlbmRpY2lvbmVzQXBwcm92ZXJcclxuICAvLyBsbyB1c2EgY29tbyBwcmltZXIgZmFzdC1wYXRoKS4gU2luIGVzdG8gZWwgZmx1am8gZGVwZW5kaWEgZGVsIGRpcmVjdG9yaW9cclxuICAvLyBwdWJsaWNvICh1c2Vyc19kaXJlY3RvcnkpIHF1ZSBzb2xvIHNlIHNpbmNyb25pemEgY3VhbmRvIGFkbWluIGFicmUgZWwgcGFuZWwuXHJcbiAgbGV0IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IG51bGw7XHJcbiAgaWYgKHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpIHtcclxuICAgIGNvbnN0IGFwcHJvdmVyVXNlciA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maW5kKCh1KSA9PiB1Ll91aWQgPT09IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpO1xyXG4gICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gYXBwcm92ZXJVc2VyID8gYXBwcm92ZXJVc2VyLmVtYWlsIHx8IG51bGwgOiBudWxsO1xyXG4gIH1cclxuICBidG4uZGlzYWJsZWQgPSB0cnVlO1xyXG4gIGJ0bi50ZXh0Q29udGVudCA9ICcuLi4nO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgIC5kb2ModWlkKVxyXG4gICAgICAuc2V0KFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIHJvbGUsXHJcbiAgICAgICAgICB2ZW5kb3IsXHJcbiAgICAgICAgICBpbnRlcm5hbFBhcnRuZXJVaWQsXHJcbiAgICAgICAgICB3aGF0c2FwcDogd2hhdHNhcHAgfHwgbnVsbCxcclxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQsXHJcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWw6IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCxcclxuICAgICAgICAgIGFzc2lnbmVkQnk6IGN1cnJlbnRVc2VyLnVpZCxcclxuICAgICAgICAgIGFzc2lnbmVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XHJcbiAgICAgICk7XHJcbiAgICAvLyBTaSBlbCB1c3VhcmlvIGVkaXRvIHN1IHByb3BpbyBudW1lcm8sIGFjdHVhbGl6YXIgZWwgY2FjaGUgbG9jYWxcclxuICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xyXG4gICAgICBteVdoYXRzYXBwTnVtYmVyID0gd2hhdHNhcHAgfHwgbnVsbDtcclxuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCB8fCBudWxsO1xyXG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCB8fCBudWxsO1xyXG4gICAgfVxyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ09LJztcclxuICAgIC8vIFJlLXJlbmRlciBkZWwgcGFuZWwgYXNpIGxvcyBkcm9wZG93bnMgXCJQYXJlamEgaW50ZXJub1wiIG11ZXN0cmFuIGxvcyBpbnRlcm5vcyBhY3R1YWxpemFkb3NcclxuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdyZWZyZXNoIGFkbWluIHBhbmVsJywgZSk7XHJcbiAgICAgIH1cclxuICAgIH0sIDQwMCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc2F2ZVVzZXJSb2xlJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFyJztcclxuICB9XHJcbn07XHJcblxyXG4vLyBUb2RvcyBsb3MgaGFuZGxlcnMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIHNvbiB2ZXJiYXRpbS5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBdUJBLE1BQUksT0FBTyxPQUFPLGVBQWUsWUFBYSxRQUFPLGFBQWEsQ0FBQztBQUNuRSxNQUFNLGFBQWEsT0FBTztBQUUxQixXQUFTLDJCQUEyQixhQUFhO0FBQy9DLFVBQU0sS0FBSyxTQUFTLGVBQWUsd0JBQXdCO0FBQzNELFFBQUksQ0FBQyxHQUFJO0FBQ1QsbUJBQWUsZUFBZSxDQUFDLEdBQzVCLE1BQU0sRUFDTixLQUFLLENBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxJQUFJLGNBQWMsRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUM5RCxRQUFJLE9BQU87QUFDWCxZQUFRO0FBQ1IsWUFDRTtBQUNGLFlBQVE7QUFDUixRQUFJLENBQUMsWUFBWSxRQUFRO0FBQ3ZCLGNBQ0U7QUFBQSxJQUNKLE9BQU87QUFDTCxjQUNFO0FBQ0Ysa0JBQVksUUFBUSxDQUFDLE9BQU87QUFDMUIsY0FBTSxRQUFRLFdBQVcsR0FBRyxTQUFTLEdBQUcsR0FBRztBQUMzQyxjQUFNLE9BQU8sR0FBRyxPQUFPLGVBQWUsV0FBVyxHQUFHLElBQUksSUFBSTtBQUM1RCxnQkFDRSxpTkFDQSxRQUNBLE9BQ0EsMENBQ0EsV0FBVyxHQUFHLEdBQUcsSUFDakI7QUFBQSxNQUVKLENBQUM7QUFDRCxjQUFRO0FBQUEsSUFDVjtBQUNBLFlBQ0U7QUFDRixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUVBLFNBQU8sa0JBQWtCLGlCQUFrQjtBQUN6QyxRQUFJLGFBQWEsUUFBUztBQUMxQixVQUFNLE1BQU0sT0FBTyx1REFBdUQ7QUFDMUUsUUFBSSxDQUFDLElBQUs7QUFDVixVQUFNLFFBQVEsSUFBSSxZQUFZLEVBQUUsS0FBSztBQUNyQyxRQUFJLENBQUMsNkJBQTZCLEtBQUssS0FBSyxHQUFHO0FBQzdDLFlBQU0sNEJBQTRCO0FBQ2xDO0FBQUEsSUFDRjtBQUNBLFVBQU0sT0FDSixPQUFPLDhFQUE4RSxFQUFFLEtBQUs7QUFDOUYsVUFBTSxRQUFRLGFBQWEsS0FBSztBQUNoQyxRQUFJO0FBQ0YsWUFBTSxLQUNILFdBQVcsZ0JBQWdCLEVBQzNCLElBQUksS0FBSyxFQUNUO0FBQUEsUUFDQztBQUFBLFVBQ0U7QUFBQSxVQUNBLE1BQU0sS0FBSyxLQUFLO0FBQUEsVUFDaEIsU0FBUyxZQUFZLFNBQVM7QUFBQSxVQUM5QixZQUFZLFlBQVk7QUFBQSxVQUN4QixTQUFTLFNBQVMsVUFBVSxXQUFXLGdCQUFnQjtBQUFBLFFBQ3pEO0FBQUEsUUFDQSxFQUFFLE9BQU8sS0FBSztBQUFBLE1BQ2hCO0FBQ0Ysa0JBQVksdUJBQXVCLEtBQUs7QUFFeEMsVUFBSTtBQUNGLHVCQUFlO0FBQUEsTUFDakIsU0FBUyxJQUFJO0FBQUEsTUFBQztBQUFBLElBQ2hCLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSxtQkFBbUIsQ0FBQztBQUNsQyxZQUFNLGFBQWEsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFFQSxTQUFPLHFCQUFxQixlQUFnQixPQUFPO0FBQ2pELFFBQUksYUFBYSxRQUFTO0FBQzFCLFFBQ0UsQ0FBQztBQUFBLE1BQ0M7QUFBQSxJQUNGO0FBRUE7QUFDRixRQUFJO0FBQ0YsWUFBTSxLQUFLLFdBQVcsZ0JBQWdCLEVBQUUsSUFBSSxLQUFLLEVBQUUsT0FBTztBQUMxRCxrQkFBWSxzQkFBc0I7QUFDbEMsVUFBSTtBQUNGLHVCQUFlO0FBQUEsTUFDakIsU0FBUyxJQUFJO0FBQUEsTUFBQztBQUFBLElBQ2hCLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSxzQkFBc0IsQ0FBQztBQUNyQyxZQUFNLGFBQWEsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFHQSxXQUFTLDBCQUEwQixPQUFPO0FBQ3hDLFVBQU0sS0FBSyxTQUFTLGVBQWUsdUJBQXVCO0FBQzFELFFBQUksQ0FBQyxHQUFJO0FBS1QsT0FBRyxjQUFjO0FBQ2pCLFVBQU0sT0FBTyxTQUFTLGNBQWMsS0FBSztBQUN6QyxTQUFLLE1BQU0sVUFDVDtBQUNGLFVBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxVQUFNLE1BQU0sVUFDVjtBQUNGLFVBQU0sY0FBYztBQUNwQixVQUFNLE1BQU0sU0FBUyxjQUFjLEtBQUs7QUFDeEMsUUFBSSxNQUFNLFVBQVU7QUFFcEIsUUFBSSxjQUFjO0FBQ2xCLFNBQUssWUFBWSxLQUFLO0FBQ3RCLFNBQUssWUFBWSxHQUFHO0FBQ3BCLE9BQUcsWUFBWSxJQUFJO0FBQUEsRUFDckI7QUFZQSxNQUFJLG1CQUFtQjtBQWlCdkIsV0FBUyx5QkFBeUIsTUFBTTtBQUN0QyxVQUFNLEtBQUssU0FBUyxlQUFlLHNCQUFzQjtBQUN6RCxRQUFJLENBQUMsR0FBSTtBQUNULFVBQU0sU0FBUyxRQUFRLEtBQUs7QUFDNUIsVUFBTSxTQUFTLFNBQVMsS0FBSyxPQUFPLE1BQU0sR0FBRyxDQUFDLElBQUksaUVBQWUsS0FBSyxPQUFPLE1BQU0sRUFBRSxJQUFJO0FBQ3pGLFVBQU0sWUFBYSxRQUFRLEtBQUssYUFBYztBQUM5QyxVQUFNLFlBQ0osUUFBUSxLQUFLLGFBQWEsS0FBSyxVQUFVLFNBQ3JDLEtBQUssVUFBVSxPQUFPLEVBQUUsZUFBZSxPQUFPLElBQzlDO0FBQ04sUUFBSSxPQUFPO0FBQ1gsWUFDRTtBQUNGLFlBQ0U7QUFDRixZQUFRO0FBQ1IsUUFBSSxRQUFRO0FBQ1YsY0FDRTtBQUNGLGNBQ0Usd0tBQ0EsV0FBVyxNQUFNLElBQ2pCO0FBQ0YsY0FDRSxzRUFDQSxXQUFXLGFBQWEsT0FBTyxLQUM5QixZQUFZLE9BQU8sV0FBVyxTQUFTLElBQUksTUFBTSxNQUNsRDtBQUNGLGNBQVE7QUFBQSxJQUNWLE9BQU87QUFDTCxjQUNFO0FBQUEsSUFDSjtBQUNBLFlBQVE7QUFDUixZQUNFLHVHQUNDLFNBQVMsZ0JBQWdCLGdCQUMxQjtBQUNGLFFBQUk7QUFDRixjQUNFO0FBQ0osWUFBUTtBQUNSLE9BQUcsWUFBWTtBQUFBLEVBQ2pCO0FBQ0EsU0FBTyxrQkFBa0IsaUJBQWtCO0FBQ3pDLFFBQUksYUFBYSxRQUFTO0FBQzFCLFVBQU0sTUFBTTtBQUFBLE1BQ1Y7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUNBLFFBQUksUUFBUSxLQUFNO0FBQ2xCLFVBQU0sTUFBTSxJQUFJLEtBQUs7QUFDckIsUUFBSSxDQUFDLEtBQUs7QUFDUixZQUFNLFFBQVE7QUFDZDtBQUFBLElBQ0Y7QUFDQSxRQUFJLElBQUksU0FBUyxJQUFJO0FBQ25CLFlBQU0sMERBQTBEO0FBQ2hFO0FBQUEsSUFDRjtBQUNBLFFBQUk7QUFDRixZQUFNLEtBQ0gsV0FBVyxZQUFZLEVBQ3ZCLElBQUksYUFBYSxFQUNqQjtBQUFBLFFBQ0M7QUFBQSxVQUNFLFFBQVE7QUFBQSxVQUNSLFdBQVcsWUFBWSxTQUFTO0FBQUEsVUFDaEMsY0FBYyxZQUFZO0FBQUEsVUFDMUIsV0FBVyxTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxRQUMzRDtBQUFBLFFBQ0EsRUFBRSxPQUFPLEtBQUs7QUFBQSxNQUNoQjtBQUNGLHlCQUFtQjtBQUNuQixrQkFBWSw4QkFBOEI7QUFDMUMsVUFBSTtBQUNGLHVCQUFlO0FBQUEsTUFDakIsU0FBUyxJQUFJO0FBQUEsTUFBQztBQUFBLElBQ2hCLFNBQVMsR0FBRztBQUNWLGNBQVEsTUFBTSxtQkFBbUIsQ0FBQztBQUNsQyxZQUFNLGFBQWEsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFDQSxTQUFPLG9CQUFvQixpQkFBa0I7QUFDM0MsUUFBSSxhQUFhLFFBQVM7QUFDMUIsUUFDRSxDQUFDO0FBQUEsTUFDQztBQUFBLElBQ0Y7QUFFQTtBQUNGLFFBQUk7QUFDRixZQUFNLEtBQUssV0FBVyxZQUFZLEVBQUUsSUFBSSxhQUFhLEVBQUUsT0FBTztBQUM5RCx5QkFBbUI7QUFDbkIsa0JBQVksNkJBQTZCO0FBQ3pDLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0scUJBQXFCLENBQUM7QUFDcEMsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBU0EsV0FBUyw0QkFBNEI7QUFDbkMsVUFBTSxLQUFLLFNBQVMsZUFBZSx1QkFBdUI7QUFDMUQsUUFBSSxDQUFDLEdBQUk7QUFDVCxVQUFNLGNBQWMsY0FBYyxDQUFDLEdBQUc7QUFBQSxNQUNwQyxDQUFDLE1BQU0sRUFBRSxTQUFTLFdBQVcsRUFBRSxTQUFTLGFBQWEsRUFBRSxTQUFTO0FBQUEsSUFDbEU7QUFDQSxVQUFNLGNBQWMsY0FBYyxDQUFDLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLFVBQVU7QUFDekUsUUFBSSxPQUFPO0FBQ1gsWUFDRTtBQUNGLFlBQ0U7QUFDRixZQUFRO0FBQ1IsUUFBSSxDQUFDLFdBQVcsUUFBUTtBQUN0QixjQUNFO0FBQ0YsU0FBRyxZQUFZO0FBQ2Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxDQUFDLFdBQVcsUUFBUTtBQUN0QixjQUNFO0FBQ0YsU0FBRyxZQUFZO0FBQ2Y7QUFBQSxJQUNGO0FBQ0EsWUFDRTtBQUNGLFlBQ0U7QUFDRixZQUFRO0FBQ1IsZUFBVyxRQUFRLENBQUMsTUFBTTtBQUN4QixZQUFNLE9BQU8sRUFBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLFFBQVEsT0FBTyxFQUFFLE9BQU87QUFDbkUsY0FBUSxvQkFBb0IsV0FBVyxFQUFFLElBQUksSUFBSSxPQUFPLFdBQVcsR0FBRyxJQUFJO0FBQUEsSUFDNUUsQ0FBQztBQUNELFlBQVE7QUFDUixZQUNFLGdIQUNBLFdBQVcsU0FDWDtBQUNGLFlBQVE7QUFDUixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUNBLFNBQU8scUJBQXFCLGlCQUFrQjtBQUM1QyxRQUFJLGFBQWEsU0FBUztBQUN4QixZQUFNLGFBQWE7QUFDbkI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxNQUFNLFNBQVMsZUFBZSxzQkFBc0I7QUFDMUQsVUFBTSxNQUFNLE9BQU8sSUFBSTtBQUN2QixRQUFJLENBQUMsS0FBSztBQUNSLFlBQU0seUNBQXlDO0FBQy9DO0FBQUEsSUFDRjtBQUNBLFVBQU0sWUFBWSxjQUFjLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsR0FBRztBQUM5RCxRQUFJLENBQUMsVUFBVTtBQUNiLFlBQU0sMEJBQTBCO0FBQ2hDO0FBQUEsSUFDRjtBQUNBLFVBQU0sY0FBYyxjQUFjLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsVUFBVTtBQUN6RSxRQUFJLENBQUMsV0FBVyxRQUFRO0FBQ3RCLFlBQU0saUNBQWlDO0FBQ3ZDO0FBQUEsSUFDRjtBQUNBLFVBQU0sZ0JBQWdCLFNBQVMsZUFBZSxTQUFTLFNBQVMsU0FBUztBQUN6RSxRQUNFLENBQUM7QUFBQSxNQUNDLGVBQ0UsZ0JBQ0EsNEJBQ0EsV0FBVyxTQUNYO0FBQUEsSUFDSjtBQUVBO0FBQ0YsUUFBSSxVQUFVLEdBQ1osWUFBWTtBQUVkLFVBQU0sUUFBUSxLQUFLLE1BQU07QUFDekIsZUFBVyxRQUFRLENBQUMsTUFBTTtBQUN4QixZQUFNLE1BQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSTtBQUMvQyxZQUFNLE9BQU8sS0FBSztBQUFBLFFBQ2hCLHdCQUF3QjtBQUFBLFFBQ3hCLDBCQUEwQixTQUFTLFNBQVM7QUFBQSxRQUM1Qyw4QkFBOEIsU0FBUyxVQUFVLFdBQVcsZ0JBQWdCO0FBQUEsUUFDNUUsOEJBQThCLFlBQVksU0FBUztBQUFBLE1BQ3JELENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxRQUFJO0FBQ0YsWUFBTSxNQUFNLE9BQU87QUFDbkIsZ0JBQVUsV0FBVztBQUNyQixVQUFJLE9BQU8sVUFBVSxZQUFZO0FBQy9CLGNBQU0sd0JBQXdCLFNBQVMsZUFBZTtBQUFBLFVBQ3BELGFBQWE7QUFBQSxVQUNiLGVBQWUsU0FBUyxTQUFTO0FBQUEsVUFDakMsZUFBZSxXQUFXO0FBQUEsVUFDMUIsY0FBYyxXQUFXLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSTtBQUFBLFFBQzVDLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sc0JBQXNCLENBQUM7QUFDckMsa0JBQVksV0FBVztBQUN2QixZQUFNLGFBQWEsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUNwQztBQUNBLFFBQUksU0FBUztBQUNYLGtCQUFZLFVBQVUsaUNBQWlDLGFBQWE7QUFDcEUsVUFBSTtBQUNGLHVCQUFlO0FBQUEsTUFDakIsU0FBUyxJQUFJO0FBQUEsTUFBQztBQUFBLElBQ2hCO0FBQUEsRUFDRjtBQThFQSxTQUFPLGlCQUFpQixpQkFBa0I7QUFDeEMsUUFBSSxhQUFhLFFBQVM7QUFDMUIsYUFBUyxlQUFlLGFBQWEsRUFBRSxVQUFVLElBQUksTUFBTTtBQUUzRCxRQUFJO0FBQ0YsWUFBTSxPQUFPLE1BQU0sS0FBSyxXQUFXLGdCQUFnQixFQUFFLElBQUk7QUFDekQsWUFBTSxjQUFjLENBQUM7QUFDckIsV0FBSyxRQUFRLENBQUMsTUFBTTtBQUNsQixvQkFBWSxLQUFLLE9BQU8sT0FBTyxFQUFFLEtBQUssRUFBRSxHQUFHLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQ3pELENBQUM7QUFDRCxpQ0FBMkIsV0FBVztBQUFBLElBQ3hDLFNBQVMsR0FBRztBQUNWLGNBQVEsS0FBSyx1QkFBdUIsQ0FBQztBQUFBLElBQ3ZDO0FBRUEsUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLEtBQUssV0FBVyxZQUFZLEVBQUUsSUFBSSxRQUFRLEVBQUUsSUFBSTtBQUNwRSxnQ0FBMEIsTUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJLElBQUk7QUFBQSxJQUM5RCxTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssc0JBQXNCLENBQUM7QUFDcEMsZ0NBQTBCLElBQUk7QUFBQSxJQUNoQztBQUVBLFFBQUk7QUFDRixZQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVcsWUFBWSxFQUFFLElBQUksYUFBYSxFQUFFLElBQUk7QUFDMUUsK0JBQXlCLE9BQU8sU0FBUyxPQUFPLEtBQUssSUFBSSxJQUFJO0FBQUEsSUFDL0QsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLHFCQUFxQixDQUFDO0FBQ25DLCtCQUF5QixJQUFJO0FBQUEsSUFDL0I7QUFDQSxRQUFJO0FBQ0YsWUFBTSxLQUFLLE1BQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxRQUFRLE9BQU8sRUFBRSxJQUFJO0FBRS9ELGlCQUFXLFNBQVM7QUFDcEIsU0FBRyxRQUFRLENBQUMsUUFBUTtBQUNsQixtQkFBVyxLQUFLLE9BQU8sT0FBTyxFQUFFLE1BQU0sSUFBSSxHQUFHLEdBQUcsSUFBSSxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQzdELENBQUM7QUFFRCxVQUFJO0FBQ0Ysa0NBQTBCO0FBQUEsTUFDNUIsU0FBUyxHQUFHO0FBQ1YsZ0JBQVEsS0FBSyx5QkFBeUIsQ0FBQztBQUFBLE1BQ3pDO0FBSUEsVUFBSTtBQUNGLDJCQUFtQjtBQUFBLE1BQ3JCLFNBQVMsR0FBRztBQUNWLGdCQUFRLEtBQUssc0JBQXNCLENBQUM7QUFBQSxNQUN0QztBQUVBLFlBQU0sV0FBVyxXQUFXLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxTQUFTO0FBQzlELFlBQU0sZUFDSiw2Q0FDQSxTQUNHO0FBQUEsUUFDQyxDQUFDLE1BQ0Msb0JBQ0EsRUFBRSxPQUNGLE9BQ0EsV0FBVyxFQUFFLFNBQVMsRUFBRSxlQUFlLEVBQUUsSUFBSSxJQUM3QztBQUFBLE1BQ0osRUFDQyxLQUFLLEVBQUU7QUFFWixZQUFNLFFBQVEsU0FBUyxlQUFlLGtCQUFrQjtBQUN4RCxZQUFNLFVBQVUsU0FBUyxlQUFlLGFBQWE7QUFDckQsVUFBSSxZQUFZO0FBQ2hCLFVBQUksWUFBWTtBQUNoQixVQUFJLENBQUMsV0FBVyxRQUFRO0FBQ3RCLG9CQUNFO0FBQ0Ysb0JBQ0U7QUFBQSxNQUNKLE9BQU87QUFJTCxZQUFTQSxzQkFBVCxTQUE0QixZQUFZO0FBQ3RDLGlCQUFPLFdBQVc7QUFBQSxZQUNoQixDQUFDLE1BQU0sRUFBRSxTQUFTLGNBQWMsRUFBRSx1QkFBdUI7QUFBQSxVQUMzRDtBQUFBLFFBQ0Y7QUFKUyxpQ0FBQUE7QUFGVCxjQUFNLHlCQUF5QixDQUFDLCtCQUErQix5QkFBeUI7QUFReEYsY0FBTSwwQkFBMEIsV0FBVztBQUFBLFVBQ3pDLENBQUMsTUFBTSxFQUFFLFNBQVMsV0FBVyxFQUFFLFNBQVMsYUFBYSxFQUFFLFNBQVM7QUFBQSxRQUNsRTtBQUNBLG1CQUFXLFFBQVEsQ0FBQyxNQUFNO0FBQ3hCLGdCQUFNLFFBQVEsRUFBRTtBQUNoQixnQkFBTSxTQUFTLFVBQVUsWUFBWTtBQUNyQyxnQkFBTSxjQUFjLHVCQUF1QixTQUFTLEVBQUUsU0FBUyxJQUFJLFlBQVksQ0FBQyxLQUFLO0FBQ3JGLGdCQUFNLFlBQVksRUFBRSxTQUFTO0FBQzdCLGdCQUFNLGNBQWMsQ0FBQyxjQUFjLFNBQVMsV0FBVyxZQUFZLFdBQVcsUUFBUSxFQUNuRjtBQUFBLFlBQ0MsQ0FBQyxNQUNDLG9CQUNBLElBQ0EsT0FDQyxFQUFFLFNBQVMsSUFBSSxjQUFjLE9BQzdCLFVBQVUsTUFBTSxVQUFVLGNBQWMsTUFDekMsTUFDQSxJQUNBO0FBQUEsVUFDSixFQUNDLEtBQUssRUFBRTtBQUNWLGdCQUFNLGdCQUNKLGdDQUNBLFFBQVE7QUFBQSxZQUNOLENBQUMsTUFDQyxvQkFDQSxFQUFFLE1BQ0YsT0FDQyxFQUFFLFdBQVcsRUFBRSxNQUFNLGNBQWMsTUFDcEMsTUFDQSxFQUFFLE9BQ0YsTUFDQSxFQUFFLE1BQ0Y7QUFBQSxVQUNKLEVBQUUsS0FBSyxFQUFFO0FBRVgsY0FBSTtBQUNKLGNBQUksV0FBVztBQUNiLGtCQUFNLE9BQU9BLG9CQUFtQixLQUFLO0FBQ3JDLGdCQUFJLEtBQUssUUFBUTtBQUNmLG9CQUFNLE9BQU8sS0FDVixJQUFJLENBQUMsTUFBTTtBQUNWLHNCQUFNLFFBQVEsRUFBRSxjQUFjLEVBQUUsWUFBWSxNQUFNLEtBQUssRUFBRSxDQUFDLElBQUksRUFBRSxTQUFTO0FBQ3pFLHVCQUNFLFdBQVcsS0FBSyxJQUNoQiw2Q0FDQSxXQUFXLEVBQUUsU0FBUyxFQUFFLElBQ3hCO0FBQUEsY0FFSixDQUFDLEVBQ0EsS0FBSyxNQUFNO0FBQ2QsMkJBQ0UsNFBBQ0EsT0FDQTtBQUFBLFlBQ0osT0FBTztBQUNMLDJCQUNFO0FBQUEsWUFDSjtBQUVBLDBCQUFjO0FBQUEsVUFDaEIsT0FBTztBQUNMLGtCQUFNLG9CQUNKLDZDQUNBLFNBQ0c7QUFBQSxjQUNDLENBQUMsTUFDQyxvQkFDQSxFQUFFLE9BQ0YsT0FDQyxFQUFFLHVCQUF1QixFQUFFLE9BQU8sY0FBYyxNQUNqRCxNQUNBLFdBQVcsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLElBQUksSUFDN0M7QUFBQSxZQUNKLEVBQ0MsS0FBSyxFQUFFO0FBQ1oseUJBQ0UsNkZBQ0Esb0JBQ0E7QUFBQSxVQUNKO0FBQ0EsZ0JBQU0sU0FBUyxTQUNYLCtGQUNBO0FBQ0osZ0JBQU0sZUFDSixlQUFlLENBQUMsU0FDWixrSkFDQTtBQUNOLGdCQUFNLFFBQVEsRUFBRSxZQUFZO0FBQzVCLGdCQUFNLGNBQ0osK0VBQ0EsV0FBVyxLQUFLLElBQ2hCO0FBRUYsZ0JBQU0saUJBQWlCLEVBQUUsMEJBQTBCO0FBQ25ELGNBQUksc0JBQXNCO0FBQzFCLGtDQUF3QixRQUFRLENBQUMsTUFBTTtBQUNyQyxnQkFBSSxFQUFFLFNBQVMsTUFBTztBQUN0QixrQkFBTSxPQUFPLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxRQUFRLFFBQVEsRUFBRSxRQUFRLE1BQU07QUFDM0UsbUNBQ0Usb0JBQ0EsV0FBVyxFQUFFLElBQUksSUFDakIsT0FDQyxtQkFBbUIsRUFBRSxPQUFPLGNBQWMsTUFDM0MsTUFDQSxXQUFXLEdBQUcsSUFDZDtBQUFBLFVBQ0osQ0FBQztBQUNELGdCQUFNLG1CQUNKLDZGQUNBLHNCQUNBO0FBRUYsZ0JBQU0sYUFDSixzSEFDQSxRQUNBLFFBQ0EsS0FBSyxVQUFVLEVBQUUsU0FBUyxFQUFFLEVBQUUsUUFBUSxNQUFNLFFBQVEsSUFDcEQ7QUFFRixnQkFBTSxnQkFBZ0IsRUFBRSxjQUNwQixpRUFDQTtBQUNKLGdCQUFNLGNBQ0osb0dBQ0MsRUFBRSxjQUFjLFlBQVksYUFDN0IsK0JBQ0EsUUFDQSxRQUNBLEtBQUssVUFBVSxFQUFFLFNBQVMsRUFBRSxFQUFFLFFBQVEsTUFBTSxRQUFRLElBQ3BELFdBQ0EsZ0JBQ0E7QUFFRix1QkFBYSxtQkFBbUIsUUFBUTtBQUN4Qyx1QkFBYSxTQUFTLFdBQVcsRUFBRSxTQUFTLEVBQUUsSUFBSSxTQUFTLGVBQWU7QUFDMUUsdUJBQWEsU0FBUyxXQUFXLEVBQUUsZUFBZSxFQUFFLElBQUk7QUFDeEQsdUJBQWEsa0NBQWtDLGNBQWM7QUFDN0QsdUJBQWEsb0NBQW9DLGdCQUFnQjtBQUNqRSx1QkFBYSxTQUFTLGFBQWE7QUFDbkMsdUJBQWEsd0JBQXdCLGNBQWM7QUFDbkQsdUJBQWEsU0FBUyxtQkFBbUI7QUFDekMsdUJBQWEsU0FBUyxhQUFhO0FBQ25DLHVCQUFhLFNBQVMsY0FBYztBQUNwQyxnQkFBTSxhQUFhLENBQUMsVUFBVSxDQUFDO0FBQy9CLGdCQUFNLFNBQVMsYUFDWCwwREFDQSxRQUNBLDBCQUNBO0FBQ0osdUJBQ0UsU0FDQSxTQUNBLHFEQUNBLFFBQ0E7QUFDRix1QkFBYTtBQUViLHVCQUFhLHVDQUF1QyxRQUFRO0FBQzVELHVCQUNFLGdDQUNBLFdBQVcsRUFBRSxTQUFTLEVBQUUsSUFDeEIsU0FDQSxlQUNBO0FBQ0YsY0FBSSxFQUFFO0FBQ0oseUJBQWEsMEJBQTBCLFdBQVcsRUFBRSxXQUFXLElBQUk7QUFDckUsdUJBQWE7QUFDYix1QkFDRSxvRUFDQSxjQUNBO0FBQ0YsdUJBQ0Usb0dBQ0EsZ0JBQ0E7QUFDRixjQUFJLFdBQVc7QUFDYix5QkFDRSxvRUFDQSxhQUNBO0FBQUEsVUFDSixPQUFPO0FBQ0wseUJBQ0UsK0VBQ0EsYUFDQTtBQUFBLFVBQ0o7QUFDQSx1QkFDRSx3RkFDQSxjQUNBO0FBQ0YsdUJBQ0Usa0VBQ0EsbUJBQ0E7QUFDRix1QkFDRSw4R0FDQSxhQUNBLGNBQ0E7QUFDRixnQkFBTSxVQUFVLGFBQ1osMERBQ0EsUUFDQSwwQkFDQTtBQUNKLHVCQUNFLDZCQUNBLFVBQ0EscURBQ0EsUUFDQTtBQUNGLHVCQUFhO0FBQUEsUUFDZixDQUFDO0FBQUEsTUFDSDtBQUNBLFlBQU0sWUFBWTtBQUNsQixjQUFRLFlBQVk7QUFFcEIsWUFBTSxRQUFRLFNBQVMsY0FBYyx1QkFBdUI7QUFDNUQsVUFBSTtBQUNGLGNBQU0sWUFDSjtBQUFBLElBQ04sU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGtCQUFrQixDQUFDO0FBQ2pDLFlBQU0sK0JBQStCLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDdEQ7QUFBQSxFQUNGO0FBRUEsU0FBTyxrQkFBa0IsV0FBWTtBQUNuQyxhQUFTLGVBQWUsYUFBYSxFQUFFLFVBQVUsT0FBTyxNQUFNO0FBQUEsRUFDaEU7QUFNQSxTQUFPLGlCQUFpQixlQUFnQixLQUFLO0FBQzNDLFFBQUksYUFBYSxRQUFTO0FBQzFCLFFBQUksUUFBUSxZQUFZLEtBQUs7QUFDM0IsWUFBTSxxQ0FBcUM7QUFDM0M7QUFBQSxJQUNGO0FBRUEsUUFBSTtBQUNGLFlBQU0sVUFBVSxNQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUUsSUFBSTtBQUM1RCxZQUFNLFlBQVksUUFBUSxTQUFTLFFBQVEsS0FBSyxFQUFFLFNBQVMsS0FBSyxJQUFJLFlBQVk7QUFDaEYsWUFBTSxZQUFZLENBQUMsK0JBQStCLHlCQUF5QjtBQUMzRSxVQUFJLFVBQVUsUUFBUSxRQUFRLEtBQUssR0FBRztBQUNwQyxjQUFNLGlDQUFpQyxXQUFXLDJCQUEyQjtBQUM3RTtBQUFBLE1BQ0Y7QUFBQSxJQUNGLFNBQVMsSUFBSTtBQUFBLElBRWI7QUFDQSxRQUNFLENBQUM7QUFBQSxNQUNDO0FBQUEsSUFDRjtBQUVBO0FBQ0YsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUUsSUFBSTtBQUN6RCxZQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDMUMsWUFBTSxvQkFBb0IsUUFBUSxLQUFLLFNBQVMsS0FBSztBQUFBLFFBQ25EO0FBQUEsUUFDQSxjQUFjLEtBQUs7QUFBQSxRQUNuQixnQkFBZ0IsS0FBSztBQUFBLE1BQ3ZCLENBQUM7QUFDRCxZQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUUsT0FBTztBQUMvQyxrQkFBWSxtQkFBbUI7QUFDL0IsWUFBTSxlQUFlO0FBQUEsSUFDdkIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGtCQUFrQixDQUFDO0FBQ2pDLFlBQU0sYUFBYSxFQUFFLFdBQVcsRUFBRTtBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUtBLE1BQUksaUJBQWlCO0FBRXJCLFNBQU8sZ0JBQWdCLGVBQWdCLEtBQUssT0FBTztBQUNqRCxZQUFRLElBQUksOEJBQThCLEVBQUUsS0FBSyxPQUFPLFNBQVMsQ0FBQztBQUNsRSxRQUFJLGFBQWEsU0FBUztBQUN4QixZQUFNLGlFQUFpRTtBQUN2RTtBQUFBLElBQ0Y7QUFDQSxRQUFJLENBQUMsS0FBSztBQUNSLFlBQU0sc0VBQXNFO0FBQzVFO0FBQUEsSUFDRjtBQUNBLHFCQUFpQjtBQUVqQixVQUFNLFFBQVEsU0FBUyxlQUFlLGtCQUFrQjtBQUN4RCxRQUFJLENBQUMsT0FBTztBQUNWLFlBQU0sZ0ZBQWdGO0FBQ3RGO0FBQUEsSUFDRjtBQUNBLFVBQU0sU0FBUyxTQUFTLGVBQWUsaUJBQWlCO0FBQ3hELFFBQUksT0FBUSxRQUFPLGNBQWMsWUFBWSxTQUFTO0FBRXRELFFBQUksYUFBYTtBQUNqQixRQUFJLFlBQVk7QUFDaEIsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUUsSUFBSTtBQUN6RCxVQUFJLEtBQUssUUFBUTtBQUNmLGNBQU0sSUFBSSxLQUFLLEtBQUssS0FBSyxDQUFDO0FBQzFCLHFCQUFhLENBQUMsQ0FBQyxFQUFFO0FBQ2pCLG9CQUFZLEVBQUUsY0FBYztBQUFBLE1BQzlCLE9BQU87QUFDTCxnQkFBUSxLQUFLLHFCQUFxQixNQUFNLFlBQVk7QUFBQSxNQUN0RDtBQUFBLElBQ0YsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLCtCQUErQixLQUFLLENBQUM7QUFDbkQsWUFBTSxrREFBa0QsRUFBRSxXQUFXLEVBQUU7QUFDdkU7QUFBQSxJQUNGO0FBQ0EsVUFBTSxJQUFJLFNBQVMsZUFBZSxvQkFBb0I7QUFDdEQsUUFBSSxDQUFDLEdBQUc7QUFDTixZQUFNLHNFQUFzRTtBQUM1RTtBQUFBLElBQ0Y7QUFDQSxRQUFJLGNBQWMsV0FBVztBQUMzQixRQUFFLFlBQ0EsaWhCQU1BLFdBQVcsR0FBRyxJQUNkLFFBQ0EsV0FBVyxTQUFTLEVBQUUsSUFDdEIseUdBRUEsV0FBVyxHQUFHLElBQ2Q7QUFBQSxJQUVKLE9BQU87QUFDTCxRQUFFLFlBQ0EsbVlBS0EsV0FBVyxHQUFHLElBQ2QsUUFDQSxXQUFXLFNBQVMsRUFBRSxJQUN0QjtBQUFBLElBRUo7QUFDQSxhQUFTLGVBQWUsa0JBQWtCLEVBQUUsVUFBVSxJQUFJLE1BQU07QUFBQSxFQUNsRTtBQUNBLFNBQU8sc0JBQXNCLFdBQVk7QUFDdkMsYUFBUyxlQUFlLGtCQUFrQixFQUFFLFVBQVUsT0FBTyxNQUFNO0FBQ25FLHFCQUFpQjtBQUFBLEVBQ25CO0FBRUEsU0FBTyxrQkFBa0IsZUFBZ0IsS0FBSyxPQUFPO0FBQ25ELFFBQUksYUFBYSxRQUFTO0FBQzFCLFVBQU0sU0FBUyxtQkFBbUI7QUFDbEMsVUFBTSxVQUFVLG9CQUFvQixRQUFRLFNBQVMsR0FBRztBQUN4RCxxQkFBaUIsRUFBRSxLQUFVLE9BQWMsUUFBZ0IsUUFBaUI7QUFDNUUsVUFBTSxJQUFJLFNBQVMsZUFBZSxvQkFBb0I7QUFDdEQsTUFBRSxZQUNBO0FBUUYsTUFBRSxhQUNBO0FBQ0YsTUFBRSxhQUNBLGllQUdBLFdBQVcsTUFBTSxJQUNqQjtBQUVGLE1BQUUsYUFDQTtBQUVGLE1BQUUsYUFDQTtBQUlGLFFBQUk7QUFDRixZQUFNLGNBQWM7QUFDcEIsWUFBTSxNQUFNLFNBQVMsZUFBZSxtQkFBbUI7QUFDdkQsVUFBSSxDQUFDLElBQUs7QUFDVixVQUFJLFlBQVk7QUFDaEIsVUFBSSxPQUFPLEtBQUs7QUFBQSxRQUNkLE1BQU07QUFBQSxRQUNOLE9BQU87QUFBQSxRQUNQLFFBQVE7QUFBQSxRQUNSLFdBQVc7QUFBQSxRQUNYLFlBQVk7QUFBQSxRQUNaLGNBQWMsT0FBTyxhQUFhO0FBQUEsTUFDcEMsQ0FBQztBQUFBLElBQ0gsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLGdDQUFnQyxDQUFDO0FBQzlDLFlBQU0sTUFBTSxTQUFTLGVBQWUsbUJBQW1CO0FBQ3ZELFVBQUk7QUFDRixZQUFJLFlBQ0Y7QUFBQSxJQUNOO0FBQUEsRUFDRjtBQUVBLFNBQU8sbUJBQW1CLGlCQUFrQjtBQUMxQyxRQUFJLENBQUMsZUFBZ0I7QUFDckIsVUFBTSxRQUFRLFNBQVMsZUFBZSxvQkFBb0IsRUFBRSxTQUFTLElBQUksUUFBUSxRQUFRLEVBQUU7QUFDM0YsUUFBSSxDQUFDLFVBQVUsS0FBSyxJQUFJLEdBQUc7QUFDekIsWUFBTSw4QkFBd0I7QUFDOUI7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLLE1BQU0sZUFBZSxlQUFlLFFBQVEsTUFBTSxDQUFDO0FBQzlELFFBQUksQ0FBQyxJQUFJO0FBQ1A7QUFBQSxRQUNFO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFFBQUk7QUFDRixZQUFNLEtBQ0gsV0FBVyxPQUFPLEVBQ2xCLElBQUksZUFBZSxHQUFHLEVBQ3RCLE9BQU87QUFBQSxRQUNOLFlBQVksZUFBZTtBQUFBLFFBQzNCLGFBQWE7QUFBQSxRQUNiLGVBQWUsU0FBUyxVQUFVLFdBQVcsZ0JBQWdCO0FBQUEsUUFDN0QsZUFBZSxZQUFZLFNBQVM7QUFBQSxNQUN0QyxDQUFDO0FBQ0gsa0JBQVksd0JBQXdCLGVBQWUsU0FBUyxVQUFVO0FBQ3RFLDBCQUFvQjtBQUNwQixVQUFJO0FBQ0YsdUJBQWU7QUFBQSxNQUNqQixTQUFTLElBQUk7QUFBQSxNQUFDO0FBQUEsSUFDaEIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGFBQWEsQ0FBQztBQUM1QixZQUFNLHVCQUF1QixFQUFFLFdBQVcsRUFBRTtBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUVBLFNBQU8sY0FBYyxlQUFnQixLQUFLO0FBQ3hDLFFBQUksYUFBYSxRQUFTO0FBQzFCLFFBQUksQ0FBQyxRQUFRLG9FQUFvRSxFQUFHO0FBQ3BGLFFBQUk7QUFDRixZQUFNLEtBQ0gsV0FBVyxPQUFPLEVBQ2xCLElBQUksR0FBRyxFQUNQLE9BQU87QUFBQSxRQUNOLGFBQWE7QUFBQSxRQUNiLFlBQVksU0FBUyxVQUFVLFdBQVcsT0FBTztBQUFBLFFBQ2pELGdCQUFnQixZQUFZLFNBQVM7QUFBQSxRQUNyQyxnQkFBZ0IsU0FBUyxVQUFVLFdBQVcsZ0JBQWdCO0FBQUEsTUFDaEUsQ0FBQztBQUNILGtCQUFZLG1CQUFtQjtBQUMvQiwwQkFBb0I7QUFDcEIsVUFBSTtBQUNGLHVCQUFlO0FBQUEsTUFDakIsU0FBUyxJQUFJO0FBQUEsTUFBQztBQUFBLElBQ2hCLFNBQVMsR0FBRztBQUNWLFlBQU0sYUFBYSxFQUFFLFdBQVcsRUFBRTtBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUVBLFNBQU8scUJBQXFCLGVBQWdCLEtBQUssT0FBTztBQUN0RCxRQUFJLGFBQWEsUUFBUztBQUMxQixRQUFJLENBQUMsT0FBTztBQUNWLFlBQU0sZ0VBQWdFO0FBQ3RFO0FBQUEsSUFDRjtBQUNBLFVBQU0sU0FBUztBQUFBLE1BQ2IsK0JBQ0UsUUFDQSwyRkFJQSxRQUNBO0FBQUEsTUFRRjtBQUFBLElBQ0Y7QUFDQSxRQUFJLFdBQVcsS0FBTTtBQUNyQixRQUFJLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDekIsVUFBSTtBQUNGLGNBQU0sT0FBTyx1QkFBdUIsS0FBSztBQUN6QztBQUFBLFVBQ0Usd0NBQ0UsUUFDQTtBQUFBLFFBQ0o7QUFDQSxZQUFJO0FBQ0YsZ0JBQU0sS0FDSCxXQUFXLE9BQU8sRUFDbEIsSUFBSSxHQUFHLEVBQ1AsT0FBTztBQUFBLFlBQ04sbUJBQW1CLFlBQVksU0FBUztBQUFBLFlBQ3hDLG1CQUFtQixTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxZQUNqRSxxQkFBcUI7QUFBQSxVQUN2QixDQUFDO0FBQUEsUUFDTCxTQUFTLElBQUk7QUFBQSxRQUFDO0FBQUEsTUFDaEIsU0FBUyxHQUFHO0FBQ1YsZ0JBQVEsTUFBTSwwQkFBMEIsQ0FBQztBQUN6QyxjQUFNLDhCQUE4QixFQUFFLFdBQVcsRUFBRTtBQUFBLE1BQ3JEO0FBQ0E7QUFBQSxJQUNGO0FBQ0EsUUFBSSxPQUFPLEtBQUssTUFBTSxLQUFLO0FBQ3pCLFlBQU0sU0FBUztBQUFBLFFBQ2IsOEJBQ0UsUUFDQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsVUFBSSxXQUFXLEtBQU07QUFDckIsWUFBTSxPQUFPLFVBQVUsSUFBSSxLQUFLO0FBQ2hDLFVBQUksSUFBSSxTQUFTLEdBQUc7QUFDbEIsY0FBTSx5REFBc0Q7QUFDNUQ7QUFBQSxNQUNGO0FBQ0EsVUFBSTtBQUNGLGNBQU0sUUFBUSxNQUFNLHlCQUF5QixHQUFHO0FBQ2hELGNBQU0sS0FDSCxXQUFXLE9BQU8sRUFDbEIsSUFBSSxHQUFHLEVBQ1AsT0FBTztBQUFBLFVBQ04sY0FBYyxNQUFNO0FBQUEsVUFDcEIsY0FBYyxNQUFNO0FBQUEsVUFDcEIsbUJBQW1CLFlBQVksU0FBUztBQUFBLFVBQ3hDLG1CQUFtQixTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxVQUNqRSxxQkFBcUI7QUFBQSxRQUN2QixDQUFDO0FBQ0gsb0JBQVksb0NBQW9DLEtBQUs7QUFBQSxNQUN2RCxTQUFTLEdBQUc7QUFDVixnQkFBUSxNQUFNLDJCQUEyQixDQUFDO0FBQzFDLGNBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQUEsTUFDOUM7QUFDQTtBQUFBLElBQ0Y7QUFDQSxVQUFNLDhCQUE4QjtBQUFBLEVBQ3RDO0FBRUEsU0FBTyxlQUFlLGVBQWdCLEtBQUssS0FBSztBQUM5QyxVQUFNLFlBQVksSUFBSSxRQUFRLElBQUksS0FBSyxJQUFJLFFBQVEsYUFBYTtBQUNoRSxRQUFJLENBQUMsVUFBVztBQUNoQixVQUFNLE9BQU8sVUFBVSxjQUFjLFdBQVcsRUFBRTtBQUNsRCxVQUFNLFNBQVMsVUFBVSxjQUFjLGFBQWEsRUFBRSxTQUFTO0FBQy9ELFVBQU0sY0FBYyxVQUFVLGNBQWMsZUFBZTtBQUMzRCxVQUFNLHFCQUFxQixjQUFjLFlBQVksU0FBUyxPQUFPO0FBRXJFLFVBQU0sVUFBVSxVQUFVLGNBQWMsV0FBVztBQUNuRCxVQUFNLFdBQVcsV0FBVyxRQUFRLFNBQVMsSUFBSSxRQUFRLE9BQU8sRUFBRSxJQUFJO0FBQ3RFLFFBQUksWUFBWSxTQUFTLFNBQVMsR0FBRztBQUNuQztBQUFBLFFBQ0U7QUFBQSxNQUNGO0FBQ0E7QUFBQSxJQUNGO0FBRUEsVUFBTSxrQkFBa0IsVUFBVSxjQUFjLG9CQUFvQjtBQUNwRSxVQUFNLHlCQUF5QixrQkFBa0IsZ0JBQWdCLFNBQVMsT0FBTztBQU1qRixRQUFJLDJCQUEyQjtBQUMvQixRQUFJLHdCQUF3QjtBQUMxQixZQUFNLGdCQUFnQixjQUFjLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsc0JBQXNCO0FBQ3JGLGlDQUEyQixlQUFlLGFBQWEsU0FBUyxPQUFPO0FBQUEsSUFDekU7QUFDQSxRQUFJLFdBQVc7QUFDZixRQUFJLGNBQWM7QUFDbEIsUUFBSTtBQUNGLFlBQU0sS0FDSCxXQUFXLE9BQU8sRUFDbEIsSUFBSSxHQUFHLEVBQ1A7QUFBQSxRQUNDO0FBQUEsVUFDRTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxVQUFVLFlBQVk7QUFBQSxVQUN0QjtBQUFBLFVBQ0E7QUFBQSxVQUNBLFlBQVksWUFBWTtBQUFBLFVBQ3hCLFlBQVksU0FBUyxVQUFVLFdBQVcsZ0JBQWdCO0FBQUEsUUFDNUQ7QUFBQSxRQUNBLEVBQUUsT0FBTyxLQUFLO0FBQUEsTUFDaEI7QUFFRixVQUFJLFFBQVEsWUFBWSxLQUFLO0FBQzNCLDJCQUFtQixZQUFZO0FBQy9CLG1DQUEyQiwwQkFBMEI7QUFDckQscUNBQTZCLDRCQUE0QjtBQUFBLE1BQzNEO0FBQ0EsVUFBSSxjQUFjO0FBRWxCLGlCQUFXLE1BQU07QUFDZixZQUFJO0FBQ0YseUJBQWU7QUFBQSxRQUNqQixTQUFTLEdBQUc7QUFDVixrQkFBUSxNQUFNLHVCQUF1QixDQUFDO0FBQUEsUUFDeEM7QUFBQSxNQUNGLEdBQUcsR0FBRztBQUFBLElBQ1IsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLGdCQUFnQixDQUFDO0FBQy9CLFlBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQzVDLFVBQUksV0FBVztBQUNmLFVBQUksY0FBYztBQUFBLElBQ3BCO0FBQUEsRUFDRjsiLAogICJuYW1lcyI6IFsidmVuZG9yc1BhcmFJbnRlcm5vIl0KfQo=
