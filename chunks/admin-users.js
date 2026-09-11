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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjJweFwiPlNpIHVuIHZlbmRlZG9yIHVzYSBHbWFpbCBwZXJzb25hbCAobm8gQHNoaW1hbm8uY29tLmFyKSwgYWdyZWdhbG8gYWNhIGFudGVzIHF1ZSBpbnRlbnRlIGxvZ3VlYXIuIExvcyBlbWFpbHMgQHNoaW1hbm8uY29tLmFyIHkgbG9zIGFkbWlucyBoYXJkY29kZWQgeWEgZXN0YW4gYXV0b3JpemFkb3MgYXV0b21hdGljYW1lbnRlLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmICghYWxsb3dlZExpc3QubGVuZ3RoKSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gICAgYWxsb3dlZExpc3QuZm9yRWFjaCgoYWUpID0+IHtcbiAgICAgIGNvbnN0IGxhYmVsID0gZXNjYXBlSHRtbChhZS5lbWFpbCB8fCBhZS5faWQpO1xuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTppbmxpbmUtZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjZweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgICAgICBsYWJlbCArXG4gICAgICAgIG5vdGUgK1xuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVtb3ZlQWxsb3dlZEVtYWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiUXVpdGFyIGF1dG9yaXphY2lvblwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXIpO2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7Ym9yZGVyLXJhZGl1czo1MCU7d2lkdGg6MThweDtoZWlnaHQ6MThweDtmb250LXNpemU6MTFweDtjdXJzb3I6cG9pbnRlcjtsaW5lLWhlaWdodDoxXCI+JnRpbWVzOzwvYnV0dG9uPicgK1xuICAgICAgICAnPC9kaXY+JztcbiAgICB9KTtcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLWJsdWVcIiBvbmNsaWNrPVwiYWRkQWxsb3dlZEVtYWlsKClcIj4mIzQzOyBBZ3JlZ2FyIGVtYWlsPC9idXR0b24+PC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cblxud2luZG93LmFkZEFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHJhdyA9IHByb21wdCgnRW1haWwgYSBhdXRvcml6YXIgKGVqLiBhdXRvbWF0cml4Lm9maWNpYWxAZ21haWwuY29tKTonKTtcbiAgaWYgKCFyYXcpIHJldHVybjtcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XG4gIGlmICghL15bXlxcc0BdK0BbXlxcc0BdK1xcLlteXFxzQF0rJC8udGVzdChlbWFpbCkpIHtcbiAgICBhbGVydCgnRWwgZW1haWwgbm8gcGFyZWNlIHZhbGlkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgbm90ZSA9XG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XG4gIGNvbnN0IGRvY0lkID0gZW1haWxUb0RvY0lkKGVtYWlsKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKVxuICAgICAgLmRvYyhkb2NJZClcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBlbWFpbCxcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcbiAgICAgICAgICBhZGRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBzaG93U3luY1RhZygnRW1haWwgYXV0b3JpemFkbzogJyArIGVtYWlsKTtcbiAgICAvLyBSZWNhcmdhciBwYW5lbFxuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignYWRkQWxsb3dlZEVtYWlsJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdRdWl0YXIgbGEgYXV0b3JpemFjaW9uIGRlIGVzdGUgZW1haWw/IFNpIGVsIHVzdWFyaW8geWEgdGllbmUgcm9sIGFzaWduYWRvIGVuIGVsIHBhbmVsLCB2YSBhIHNlZ3VpciBlbnRyYW5kbyAobGEgcmVnbGEgcHJlLWFwcm9iYWRhIHBvciByb2wgdGFtYmllbiBhcGxpY2EpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XG4gICAgc2hvd1N5bmNUYWcoJ0F1dG9yaXphY2lvbiBxdWl0YWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuLy8gPT09IFNlY2Npb24gR2VtaW5pIEFQSSBLZXkgKGFkbWluKSA9PT1cbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ2VtaW5pLWNvbmZpZy1zZWN0aW9uJyk7XG4gIGlmICghZWwpIHJldHVybjtcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXG4gIC8vIHY2MzkgKDIwMjYtMDgtMjYpOiBVWCBzaW1wbGlmaWNhZG8gcG9yIHBlZGlkbyBNYXJpYW5vIFx1MjAxNCBzaW4gaW5zdHJ1Y2Npb25lc1xuICAvLyBDTEkgZW4gZWwgcGFuZWwsIHNvbG8gdW4gYmFubmVyIGV4cGxpY2FuZG8gZG9uZGUgdml2ZSBsYSBrZXkuXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cbiAgZWwudGV4dENvbnRlbnQgPSAnJztcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxuICAgICd0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE0cHggMTJweDtiYWNrZ3JvdW5kOiNmNWYzZmY7Ym9yZGVyOjFweCBzb2xpZCAjZGRkNmZlO2JvcmRlci1yYWRpdXM6NnB4JztcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTttYXJnaW4tYm90dG9tOjZweCc7XG4gIHRpdGxlLnRleHRDb250ZW50ID0gJ0dlbWluaSBBUEkgS2V5IChPQ1IgZGUgdGlja2V0cyknO1xuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbXNnLnN0eWxlLmNzc1RleHQgPSAnZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCknO1xuICAvLyBJY29ubyBjYW5kYWRvICsgdGV4dG8uIHRleHRDb250ZW50IGVzIHNhZmUgKG5vIEhUTUwgcGFyc2luZykuXG4gIG1zZy50ZXh0Q29udGVudCA9ICdHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XG4gIHdyYXAuYXBwZW5kQ2hpbGQodGl0bGUpO1xuICB3cmFwLmFwcGVuZENoaWxkKG1zZyk7XG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xufVxuXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXG4vLyBlbiBTZWNyZXQgTWFuYWdlciwgbm8gZW4gRmlyZXN0b3JlLiBTZSBhZG1pbmlzdHJhIHBvciBDTEkuIFZlclxuLy8gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbiBwYXJhIGxhcyBpbnN0cnVjY2lvbmVzLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEdPT0dMRSBNQVBTIEdlb2NvZGluZyBBUEkgLSBtZWpvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwgcXVlIE9TTVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMYSBrZXkgc2UgZ3VhcmRhIGVuIGFwcF9jb25maWcvZ29vZ2xlX21hcHMuIFNpIGVzdGEgc2V0ZWFkYSwgbGEgdXNhbW9zXG4vLyBjb21vIGdlb2NvZGVyIFBSSU1BUklPIGVuIGdlb2NvZGVDbGllbnRBZGRyZXNzOyBzaSBmYWxsYSBvIG5vIGVzdGFcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxubGV0IGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuYXN5bmMgZnVuY3Rpb24gZ2V0R21hcHNBcGlLZXkoKSB7XG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xuICAgIGlmIChzbmFwLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xuICAgICAgaWYgKGQuYXBpS2V5KSB7XG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcbiAgICAgICAgcmV0dXJuIGQuYXBpS2V5O1xuICAgICAgfVxuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBubyBzZSBwdWRvIGxlZXIgYXBpIGtleScsIGUpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ21hcHMtY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xuICBjb25zdCBtYXNrZWQgPSBoYXNLZXkgPyBkYXRhLmFwaUtleS5zbGljZSgwLCA0KSArICdcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjInICsgZGF0YS5hcGlLZXkuc2xpY2UoLTQpIDogJyc7XG4gIGNvbnN0IHVwZGF0ZWRCeSA9IChkYXRhICYmIGRhdGEudXBkYXRlZEJ5KSB8fCAnJztcbiAgY29uc3QgdXBkYXRlZEF0ID1cbiAgICBkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZVxuICAgICAgPyBkYXRhLnVwZGF0ZWRBdC50b0RhdGUoKS50b0xvY2FsZVN0cmluZygnZXMtQVInKVxuICAgICAgOiAnJztcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKGhhc0tleSkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O2ZsZXgtd3JhcDp3cmFwO21hcmdpbi1ib3R0b206MTBweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgICBodG1sICs9XG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjNmVlN2I3O2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6NHB4IDhweDtjb2xvcjojMDY1ZjQ2XCI+JyArXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xuICAgICAgJzwvc3Bhbj4nO1xuICAgIGh0bWwgKz1cbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+Q2FyZ2FkYSBwb3IgJyArXG4gICAgICBlc2NhcGVIdG1sKHVwZGF0ZWRCeSB8fCAnYWRtaW4nKSArXG4gICAgICAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcbiAgICAnPC9idXR0b24+JztcbiAgaWYgKGhhc0tleSlcbiAgICBodG1sICs9XG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCByYXcgPSBwcm9tcHQoXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXG4gICAgJydcbiAgKTtcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xuICBpZiAoIWtleSkge1xuICAgIGFsZXJ0KCdWYWNpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBhcGlLZXk6IGtleSxcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZUdtYXBzQXBpS2V5JywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQlVMSyBBUFBST1ZFUiAtIGFzaWduYXIgZWwgbWlzbW8gXCJSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lc1wiXG4vLyBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFV0aWwgY3VhbmRvIHVuIHNvbG8gYXByb2JhZG9yIChlai4gUGFibG8gZ2VyZW50ZSkgcmV2aXNhIGxhc1xuLy8gcmVuZGljaW9uZXMgZGUgVE9ET1MgbG9zIHZlbmRlZG9yZXMuIFNpbiBlc3RvIGVsIGFkbWluIHRpZW5lIHF1ZVxuLy8gYWJyaXIgY2FkYSBmaWxhIGRlbCBwYW5lbCBVc3VhcmlvcyB5IHNldGVhciBlbCBkcm9wZG93biB1bmEgYSB1bmEuXG5mdW5jdGlvbiByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjYW5kaWRhdGVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcihcbiAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICk7XG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiNhMjFjYWZcIj5BcHJvYmFkb3IgZGUgUmVuZGljaW9uZXMgLSBhc2lnbmFjaW9uIG1hc2l2YTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6MnB4XCI+QXBsaWNhIGVsIG1pc21vIHJlc3BvbnNhYmxlIGEgVE9ET1MgbG9zIHZlbmRlZG9yZXMgZGUgdW4gc29sbyBjbGljay4gVXRpbCBjdWFuZG8gdW4gZ2VyZW50ZSBjb21lcmNpYWwgY2VudHJhbGl6YSBsYSBhcHJvYmFjaW9uLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmICghY2FuZGlkYXRlcy5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCBhZG1pbiAvIGdlcmVudGUgLyBpbnRlcm5vLiBQcmltZXJvIGFzaWduYSB1biByb2wgYSBhbGd1aWVuLjwvZGl2Pic7XG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIHZlbmRlZG9yIHRvZGF2aWEuPC9kaXY+JztcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xuICAgIHJldHVybjtcbiAgfVxuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XG4gIGh0bWwgKz1cbiAgICAnPHNlbGVjdCBpZD1cImJ1bGstYXBwcm92ZXItc2VsZWN0XCIgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCAjZjBhYmZjO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZmxleDoxO21heC13aWR0aDozNDBweFwiPic7XG4gIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciBhcHJvYmFkb3IgLTwvb3B0aW9uPic7XG4gIGNhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xuICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyB1LnJvbGUgKyAnKSc7XG4gICAgaHRtbCArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBlc2NhcGVBdHRyKHUuX3VpZCkgKyAnXCI+JyArIGVzY2FwZUh0bWwobGJsKSArICc8L29wdGlvbj4nO1xuICB9KTtcbiAgaHRtbCArPSAnPC9zZWxlY3Q+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImJ1bGtBc3NpZ25BcHByb3ZlcigpXCI+QXNpZ25hciBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzICgnICtcbiAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgJyk8L2J1dHRvbj4nO1xuICBodG1sICs9ICc8L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxud2luZG93LmJ1bGtBc3NpZ25BcHByb3ZlciA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlbGVjdCcpO1xuICBjb25zdCB1aWQgPSBzZWwgJiYgc2VsLnZhbHVlO1xuICBpZiAoIXVpZCkge1xuICAgIGFsZXJ0KCdFbGVnJmlhY3V0ZTsgdW4gYXByb2JhZG9yIGRlbCBkcm9wZG93bi4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYXBwcm92ZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSB1aWQpO1xuICBpZiAoIWFwcHJvdmVyKSB7XG4gICAgYWxlcnQoJ0Fwcm9iYWRvciBubyBlbmNvbnRyYWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xuICAgIGFsZXJ0KCdObyBoYXkgdmVuZGVkb3JlcyBwYXJhIGFzaWduYXIuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyTGFiZWwgPSBhcHByb3Zlci5kaXNwbGF5TmFtZSB8fCBhcHByb3Zlci5lbWFpbCB8fCBhcHByb3Zlci5fdWlkO1xuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnQXNpZ25hciBhICcgK1xuICAgICAgICBhcHByb3ZlckxhYmVsICtcbiAgICAgICAgJyBjb21vIGFwcm9iYWRvciBkZSBsb3MgJyArXG4gICAgICAgIHZlbmRlZG9yZXMubGVuZ3RoICtcbiAgICAgICAgJyB2ZW5kZWRvcmVzP1xcblxcblZhIGEgc29icmVzY3JpYmlyIGN1YWxxdWllciBhcHJvYmFkb3IgcHJldmlvIGFzaWduYWRvIGEgY2FkYSB2ZW5kZWRvci4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICBsZXQgb2tDb3VudCA9IDAsXG4gICAgX2VyckNvdW50ID0gMDtcbiAgLy8gVXBkYXRlIGVuIGxvdGUuIFVzYW1vcyB1biBiYXRjaCBkZSBGaXJlc3RvcmUuXG4gIGNvbnN0IGJhdGNoID0gZmJEYi5iYXRjaCgpO1xuICB2ZW5kZWRvcmVzLmZvckVhY2goKHYpID0+IHtcbiAgICBjb25zdCByZWYgPSBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHYuX3VpZCk7XG4gICAgYmF0Y2gudXBkYXRlKHJlZiwge1xuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogdWlkLFxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgfSk7XG4gIH0pO1xuICB0cnkge1xuICAgIGF3YWl0IGJhdGNoLmNvbW1pdCgpO1xuICAgIG9rQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBpZiAodHlwZW9mIGxvZ09wID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBsb2dPcCgnYnVsa19hc3NpZ25fYXBwcm92ZXInLCAncm9sZXMnLCBhcHByb3ZlckxhYmVsLCB7XG4gICAgICAgIGFwcHJvdmVyVWlkOiB1aWQsXG4gICAgICAgIGFwcHJvdmVyRW1haWw6IGFwcHJvdmVyLmVtYWlsIHx8ICcnLFxuICAgICAgICB2ZW5kZWRvckNvdW50OiB2ZW5kZWRvcmVzLmxlbmd0aCxcbiAgICAgICAgdmVuZGVkb3JVaWRzOiB2ZW5kZWRvcmVzLm1hcCgodikgPT4gdi5fdWlkKSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2J1bGtBc3NpZ25BcHByb3ZlcicsIGUpO1xuICAgIF9lcnJDb3VudCA9IHZlbmRlZG9yZXMubGVuZ3RoO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG4gIGlmIChva0NvdW50KSB7XG4gICAgc2hvd1N5bmNUYWcob2tDb3VudCArICcgdmVuZGVkb3IoZXMpIGFzaWduYWRvKHMpIGEgJyArIGFwcHJvdmVyTGFiZWwpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fSAvLyByZWZyZXNjYXJcbiAgfVxufTtcblxuLy8gR2VvY29kaW5nIGNvbiBHb29nbGUgTWFwcyBBUEkuIERldnVlbHZlIHtsYXQsIGxuZywgZGlzcGxheSwgcHJlY2lzaW9ufVxuLy8gbyBudWxsIHNpIG5vIGVuY29udHJvIC8gc2luIGtleS5cbmFzeW5jIGZ1bmN0aW9uIF9nZW9jb2RlV2l0aEdvb2dsZU1hcHMoYWRkcmVzcywgbG9jYWxpdHksIHByb3ZpbmNlQ29kZSkge1xuICBjb25zdCBrZXkgPSBhd2FpdCBnZXRHbWFwc0FwaUtleSgpO1xuICBpZiAoIWtleSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHByb3YgPSB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlQ29kZSB8fCAnJykgOiBwcm92aW5jZUNvZGUgfHwgJyc7XG4gIGNvbnN0IGZ1bGxBZGRyID0gW2FkZHJlc3MsIGxvY2FsaXR5LCBwcm92LCAnQXJnZW50aW5hJ10uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJywgJyk7XG4gIC8vIHJlZ2lvbj1hciArIGNvbXBvbmVudHM9Y291bnRyeTpBUiBzZXNnYSBsb3MgcmVzdWx0YWRvcyBhIEFSLlxuICBjb25zdCB1cmwgPVxuICAgICdodHRwczovL21hcHMuZ29vZ2xlYXBpcy5jb20vbWFwcy9hcGkvZ2VvY29kZS9qc29uJyArXG4gICAgJz9hZGRyZXNzPScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChmdWxsQWRkcikgK1xuICAgICcmcmVnaW9uPWFyJyArXG4gICAgJyZjb21wb25lbnRzPWNvdW50cnk6QVInICtcbiAgICAnJmxhbmd1YWdlPWVzJyArXG4gICAgJyZrZXk9JyArXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSk7XG4gIHRyeSB7XG4gICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgci5qc29uKCk7XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT0snICYmIGRhdGEucmVzdWx0cyAmJiBkYXRhLnJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICBjb25zdCByZXMgPSBkYXRhLnJlc3VsdHNbMF07XG4gICAgICBjb25zdCBsb2MgPSByZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uO1xuICAgICAgaWYgKCFsb2MpIHJldHVybiBudWxsO1xuICAgICAgLy8gbG9jYXRpb25fdHlwZSBpbmRpY2EgcHJlY2lzaW9uOiBST09GVE9QID4gUkFOR0VfSU5URVJQT0xBVEVEID4gR0VPTUVUUklDX0NFTlRFUiA+IEFQUFJPWElNQVRFLlxuICAgICAgY29uc3QgbHQgPSAocmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbl90eXBlKSB8fCAnJztcbiAgICAgIGxldCBwcmVjaXNpb24gPSAnYWRkcmVzcyc7XG4gICAgICBpZiAobHQgPT09ICdBUFBST1hJTUFURScpIHByZWNpc2lvbiA9ICdsb2NhbGl0eSc7XG4gICAgICBlbHNlIGlmIChsdCA9PT0gJ0dFT01FVFJJQ19DRU5URVInKSBwcmVjaXNpb24gPSAnc3RyZWV0JztcbiAgICAgIC8vIEV4dHJhZXIgbG9jYWxpdHkgKyBhZG1pbl9hcmVhIGRlbCByZXNwb25zZSBwYXJhIGF1dG9jb21wbGV0YXIgY2FtcG9zXG4gICAgICAvLyBxdWUgU0FQIG5vIGV4cG9ydG8gKFNoaXAtdG8gQ2l0eSB2YWNpbyBlcyBtdXkgY29tdW4gZW4gQlBzIHZpZWpvcykuXG4gICAgICBjb25zdCBjb21wb25lbnRzID0gcmVzLmFkZHJlc3NfY29tcG9uZW50cyB8fCBbXTtcbiAgICAgIGNvbnN0IGJ5VHlwZSA9ICh0KSA9PiB7XG4gICAgICAgIGNvbnN0IGMgPSBjb21wb25lbnRzLmZpbmQoKGNjKSA9PiBBcnJheS5pc0FycmF5KGNjLnR5cGVzKSAmJiBjYy50eXBlcy5pbmNsdWRlcyh0KSk7XG4gICAgICAgIHJldHVybiBjID8gYy5sb25nX25hbWUgfHwgJycgOiAnJztcbiAgICAgIH07XG4gICAgICAvLyBQcmlvcmlkYWQgcGFyYSBsb2NhbGlkYWQ6IGxvY2FsaXR5ID4gc3VibG9jYWxpdHkgPiBhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzIuXG4gICAgICBjb25zdCBkZXRlY3RlZExvY2FsaXR5ID1cbiAgICAgICAgYnlUeXBlKCdsb2NhbGl0eScpIHx8IGJ5VHlwZSgnc3VibG9jYWxpdHknKSB8fCBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMicpIHx8ICcnO1xuICAgICAgY29uc3QgZGV0ZWN0ZWRQcm92aW5jZSA9IGJ5VHlwZSgnYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8xJykgfHwgJyc7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBsYXQ6IHBhcnNlRmxvYXQobG9jLmxhdCksXG4gICAgICAgIGxuZzogcGFyc2VGbG9hdChsb2MubG5nKSxcbiAgICAgICAgZGlzcGxheTogcmVzLmZvcm1hdHRlZF9hZGRyZXNzIHx8IGZ1bGxBZGRyLFxuICAgICAgICBwcmVjaXNpb246IHByZWNpc2lvbixcbiAgICAgICAgcHJvdmlkZXI6ICdnb29nbGUnLFxuICAgICAgICBsb2NhdGlvblR5cGU6IGx0LFxuICAgICAgICBsb2NhbGl0eTogZGV0ZWN0ZWRMb2NhbGl0eSxcbiAgICAgICAgcHJvdmluY2U6IGRldGVjdGVkUHJvdmluY2UsXG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdaRVJPX1JFU1VMVFMnKSB7XG4gICAgICBjb25zb2xlLmxvZygnW2dtYXBzXSBaRVJPX1JFU1VMVFMgZm9yOicsIGZ1bGxBZGRyKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdSRVFVRVNUX0RFTklFRCcpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICdbZ21hcHNdIFJFUVVFU1RfREVOSUVEOicsXG4gICAgICAgIGRhdGEuZXJyb3JfbWVzc2FnZSB8fFxuICAgICAgICAgICcoc2luIGRldGFsbGUpLiBSZXZpc2FyIHF1ZSBsYSBBUEkga2V5IHRlbmdhIGhhYmlsaXRhZGEgR2VvY29kaW5nIEFQSSB5IGVsIHJlZmVycmVyIHBlcm1pdGEgZXN0ZSBkb21pbmlvLidcbiAgICAgICk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT1ZFUl9RVUVSWV9MSU1JVCcpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gT1ZFUl9RVUVSWV9MSU1JVCAtIGV4Y2VkaW8gZWwgbGltaXRlLiBDYWVtb3MgYSBPU00uJyk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIHN0YXR1cyBpbmVzcGVyYWRvOicsIGRhdGEuc3RhdHVzLCBkYXRhLmVycm9yX21lc3NhZ2UpO1xuICAgIHJldHVybiBudWxsO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIGdlb2NvZGUgZXJyb3I6JywgZSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxud2luZG93Lm9wZW5BZG1pblBhbmVsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xuICAvLyBDYXJnYXIgYWxsb3dlZF9lbWFpbHMgcGFyYSBtb3N0cmFyIGFycmliYSBsYSBzZWNjaW9uIGRlIHByZS1hdXRvcml6YWNpb25lc1xuICB0cnkge1xuICAgIGNvbnN0IGFlUXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZ2V0KCk7XG4gICAgY29uc3QgYWxsb3dlZExpc3QgPSBbXTtcbiAgICBhZVFzLmZvckVhY2goKGQpID0+IHtcbiAgICAgIGFsbG93ZWRMaXN0LnB1c2goT2JqZWN0LmFzc2lnbih7IF9pZDogZC5pZCB9LCBkLmRhdGEoKSkpO1xuICAgIH0pO1xuICAgIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBhbGxvd2VkX2VtYWlscycsIGUpO1xuICB9XG4gIC8vIENhcmdhciBjb25maWcgR2VtaW5pIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXlcbiAgdHJ5IHtcbiAgICBjb25zdCBnU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ2VtaW5pJykuZ2V0KCk7XG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihnU25hcC5leGlzdHMgPyBnU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnZW1pbmkgY29uZmlnJywgZSk7XG4gICAgcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihudWxsKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdvb2dsZSBNYXBzIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXkuXG4gIHRyeSB7XG4gICAgY29uc3QgZ21TbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihnbVNuYXAuZXhpc3RzID8gZ21TbmFwLmRhdGEoKSA6IG51bGwpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdsb2FkIGdtYXBzIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihudWxsKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLm9yZGVyQnkoJ2VtYWlsJykuZ2V0KCk7XG4gICAgLy8gRTYgZml4IEMxOiB2YWNpYXIgZWwgQXJyYXkgaW4tcGxhY2UgKHByZXNlcnZhIHdpbmRvdy51c2Vyc0NhY2hlIHJlZikuXG4gICAgdXNlcnNDYWNoZS5sZW5ndGggPSAwO1xuICAgIHFzLmZvckVhY2goKGRvYykgPT4ge1xuICAgICAgdXNlcnNDYWNoZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBfdWlkOiBkb2MuaWQgfSwgZG9jLmRhdGEoKSkpO1xuICAgIH0pO1xuICAgIC8vIFJlbmRlciBkZWwgYmxvcXVlIFwiQXNpZ25hciBhcHJvYmFkb3IgYSB0b2RvcyBsb3MgdmVuZGVkb3Jlc1wiIGFycmliYSBkZSBsYSB0YWJsYS5cbiAgICB0cnkge1xuICAgICAgcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignYnVsayBhcHByb3ZlciBzZWN0aW9uJywgZSk7XG4gICAgfVxuICAgIC8vIFNpbmNyb25pemFyIGVsIGRpcmVjdG9yaW8gcHVibGljbyBkZSB1c3VhcmlvcyBwYXJhIHF1ZSBsb3MgdmVuZGVkb3Jlc1xuICAgIC8vIHB1ZWRhbiB2ZXIgZGVzdGluYXRhcmlvcyBhbCBjcmVhciB0YXJlYXMgZW4gTm90aWZpY2FjaW9uZXMuIFNpbiBlc3RvXG4gICAgLy8gbG9zIHZlbmRlZG9yZXMgdmVuIGVsIGRyb3Bkb3duIHZhY2lvIChzZWN1cml0eSBydWxlcyBibG9xdWVhbiAvcm9sZXMpLlxuICAgIHRyeSB7XG4gICAgICBzeW5jVXNlcnNEaXJlY3RvcnkoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ3N5bmNVc2Vyc0RpcmVjdG9yeScsIGUpO1xuICAgIH1cbiAgICAvLyBMaXN0YSBkZSBpbnRlcm5vcyBkaXNwb25pYmxlcyAocGFyYSBhc2lnbmFyIHBhcmVqYSBhIGxvcyB2ZW5kZWRvcmVzKVxuICAgIGNvbnN0IGludGVybm9zID0gdXNlcnNDYWNoZS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ2ludGVybm8nKTtcbiAgICBjb25zdCBfaW50ZXJub09wdHMgPVxuICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xuICAgICAgaW50ZXJub3NcbiAgICAgICAgLm1hcChcbiAgICAgICAgICAodSkgPT5cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICB1Ll91aWQgK1xuICAgICAgICAgICAgJ1wiPicgK1xuICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICApXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLXRhYmxlLWJvZHknKTtcbiAgICBjb25zdCBjYXJkc0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLWNhcmRzJyk7XG4gICAgbGV0IHRhYmxlSHRtbCA9ICcnO1xuICAgIGxldCBjYXJkc0h0bWwgPSAnJztcbiAgICBpZiAoIXVzZXJzQ2FjaGUubGVuZ3RoKSB7XG4gICAgICB0YWJsZUh0bWwgPVxuICAgICAgICAnPHRyPjx0ZCBjb2xzcGFuPVwiNlwiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XG4gICAgICBjYXJkc0h0bWwgPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc2l6ZToxMnB4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvZGl2Pic7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEFkbWlucyBwcmltYXJpb3MgcHJvdGVnaWRvczogbm8gc2UgcHVlZGVuIGVsaW1pbmFyIChNYXJpYW5vICsgYm90IGNvcnBvcmF0aXZvKVxuICAgICAgY29uc3QgUFJPVEVDVEVEX0FETUlOX0VNQUlMUyA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG4gICAgICAvLyBQYXJhIGxvcyBpbnRlcm5vcyBjYWxjdWxhbW9zIGxhIHJlbGFjaW9uIGludmVyc2E6IHF1aWVuZXMgbG9zIHRpZW5lbiBjb21vIHBhcmVqYVxuICAgICAgZnVuY3Rpb24gdmVuZG9yc1BhcmFJbnRlcm5vKGludGVybm9VaWQpIHtcbiAgICAgICAgcmV0dXJuIHVzZXJzQ2FjaGUuZmlsdGVyKFxuICAgICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicgJiYgdS5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IGludGVybm9VaWRcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIENhbmRpZGF0b3MgYSByZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczogYWRtaW4sIGdlcmVudGUgbyBpbnRlcm5vIChubyB2ZW5kZWRvcmVzIG5pIHZpZXdlcnMgbmkgdW5hc3NpZ25lZClcbiAgICAgIGNvbnN0IHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzID0gdXNlcnNDYWNoZS5maWx0ZXIoXG4gICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICdhZG1pbicgfHwgdS5yb2xlID09PSAnZ2VyZW50ZScgfHwgdS5yb2xlID09PSAnaW50ZXJubydcbiAgICAgICk7XG4gICAgICB1c2Vyc0NhY2hlLmZvckVhY2goKGQpID0+IHtcbiAgICAgICAgY29uc3QgZG9jSWQgPSBkLl91aWQ7XG4gICAgICAgIGNvbnN0IGlzU2VsZiA9IGRvY0lkID09PSBjdXJyZW50VXNlci51aWQ7XG4gICAgICAgIGNvbnN0IGlzUHJvdGVjdGVkID0gUFJPVEVDVEVEX0FETUlOX0VNQUlMUy5pbmRleE9mKChkLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpKSA+PSAwO1xuICAgICAgICBjb25zdCBpc0ludGVybm8gPSBkLnJvbGUgPT09ICdpbnRlcm5vJztcbiAgICAgICAgY29uc3Qgcm9sZU9wdGlvbnMgPSBbJ3VuYXNzaWduZWQnLCAnYWRtaW4nLCAnZ2VyZW50ZScsICd2ZW5kZWRvcicsICdpbnRlcm5vJywgJ3ZpZXdlciddXG4gICAgICAgICAgLm1hcChcbiAgICAgICAgICAgIChyKSA9PlxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICByICtcbiAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgIChkLnJvbGUgPT09IHIgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgIChpc1NlbGYgJiYgciAhPT0gJ2FkbWluJyA/ICcgZGlzYWJsZWQnIDogJycpICtcbiAgICAgICAgICAgICAgJz4nICtcbiAgICAgICAgICAgICAgciArXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICAgICAgKVxuICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgICAgY29uc3QgdmVuZG9yT3B0aW9ucyA9XG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tPC9vcHRpb24+JyArXG4gICAgICAgICAgVkVORE9SUy5tYXAoXG4gICAgICAgICAgICAodikgPT5cbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICAgICAgdi5rZXkgK1xuICAgICAgICAgICAgICAnXCInICtcbiAgICAgICAgICAgICAgKGQudmVuZG9yID09PSB2LmtleSA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICAgJz4nICtcbiAgICAgICAgICAgICAgdi56b25lICtcbiAgICAgICAgICAgICAgJyAnICtcbiAgICAgICAgICAgICAgdi5rZXkgK1xuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgICkuam9pbignJyk7XG4gICAgICAgIC8vIFNpIGVzIGludGVybm8sIG1vc3RyYXIgcmVsYWNpb24gaW52ZXJzYSAodmVuZGVkb3JlcyBxdWUgbG8gdGllbmVuIGNvbW8gcGFyZWphKSBlbiB2ZXogZGVsIGRyb3Bkb3duIGVkaXRhYmxlXG4gICAgICAgIGxldCBwYXJlamFDZWxsO1xuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XG4gICAgICAgICAgY29uc3QgdmluYyA9IHZlbmRvcnNQYXJhSW50ZXJubyhkb2NJZCk7XG4gICAgICAgICAgaWYgKHZpbmMubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBsaXN0ID0gdmluY1xuICAgICAgICAgICAgICAubWFwKCh1KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbGFiZWwgPSB1LmRpc3BsYXlOYW1lID8gdS5kaXNwbGF5TmFtZS5zcGxpdCgvXFxzKy8pWzBdIDogdS5lbWFpbCB8fCAnJztcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbChsYWJlbCkgK1xuICAgICAgICAgICAgICAgICAgJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLXRleHQtbXV0ZWQpXCI+KCcgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8ICcnKSArXG4gICAgICAgICAgICAgICAgICAnKTwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgLmpvaW4oJzxicj4nKTtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtcHJpbWFyeSk7bGluZS1oZWlnaHQ6MS41XCI+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjJweFwiPlZlbmRlZG9yZXMgZXh0ZXJub3MgdmluY3VsYWRvcyAoYXV0byk8L2Rpdj4nICtcbiAgICAgICAgICAgICAgbGlzdCArXG4gICAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXN0eWxlOml0YWxpY1wiPkF1biBuaW5ndW4gdmVuZGVkb3IgbG8gdGllbmUgY29tbyBwYXJlamE8L2Rpdj4nO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBpbnB1dCBvY3VsdG8gcGFyYSBxdWUgc2F2ZVVzZXJSb2xlIG5vIHBpc2UgZWwgdmFsb3IgZGVsIHJvbCA9IGludGVybm8gKG5vIGFwbGljYSBpbnRlcm5hbFBhcnRuZXJVaWQpXG4gICAgICAgICAgcGFyZWphQ2VsbCArPSAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIiBjbGFzcz1cImludGVybmFsLXNlbFwiIHZhbHVlPVwiXCIvPic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgaW50ZXJub09wdHNGb3JSb3cgPVxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xuICAgICAgICAgICAgaW50ZXJub3NcbiAgICAgICAgICAgICAgLm1hcChcbiAgICAgICAgICAgICAgICAodSkgPT5cbiAgICAgICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgICAgICB1Ll91aWQgK1xuICAgICAgICAgICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgICAgICAgICAoZC5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IHUuX3VpZCA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICAgICAgICc+JyArXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgdS5kaXNwbGF5TmFtZSB8fCB1Ll91aWQpICtcbiAgICAgICAgICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgLmpvaW4oJycpO1xuICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB0aXRsZT1cIlBhcmVqYSBpbnRlcm5vIChzb2xvIGFwbGljYSBzaSBlbCByb2wgZXMgdmVuZGVkb3IpXCI+JyArXG4gICAgICAgICAgICBpbnRlcm5vT3B0c0ZvclJvdyArXG4gICAgICAgICAgICAnPC9zZWxlY3Q+JztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB5b3VUYWcgPSBpc1NlbGZcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1hY2NlbnQtdmlvbGV0KTtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiPihWT1MpPC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCBwcm90ZWN0ZWRUYWcgPVxuICAgICAgICAgIGlzUHJvdGVjdGVkICYmICFpc1NlbGZcbiAgICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCIgdGl0bGU9XCJBZG1pbiBwcm90ZWdpZG8gLSBubyBzZSBwdWVkZSBlbGltaW5hclwiPlBST1RFR0lETzwvc3Bhbj4nXG4gICAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB3YVZhbCA9IGQud2hhdHNhcHAgfHwgJyc7XG4gICAgICAgIGNvbnN0IHdhSW5wdXRIdG1sID1cbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXG4gICAgICAgICAgZXNjYXBlQXR0cih3YVZhbCkgK1xuICAgICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo1cHggN3B4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItZGVmYXVsdCk7Ym9yZGVyLXJhZGl1czo0cHg7Zm9udC1zaXplOjExcHg7Zm9udC1mYW1pbHk6aW5oZXJpdDtvdXRsaW5lOm5vbmU7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZClcIiB0aXRsZT1cIk51bWVybyBXaGF0c0FwcCBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKHNpbiArIG5pIGVzcGFjaW9zKS4gU2UgdXNhIGFsIGVudmlhciBsYSBydXRhLlwiLz4nO1xuICAgICAgICAvLyBEcm9wZG93biAnUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMnXG4gICAgICAgIGNvbnN0IGN1ckFwcHJvdmVyVWlkID0gZC5yZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8ICcnO1xuICAgICAgICBsZXQgcmVuZEFwcHJvdmVyT3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gYXNpZ25hciAtPC9vcHRpb24+JztcbiAgICAgICAgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xuICAgICAgICAgIGlmICh1Ll91aWQgPT09IGRvY0lkKSByZXR1cm47IC8vIHVuIHVzdWFyaW8gbm8gcHVlZGUgc2VyIHN1IHByb3BpbyBhcHJvYmFkb3JcbiAgICAgICAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgKHUucm9sZSB8fCAnJykgKyAnKSc7XG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArPVxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICAgIGVzY2FwZUF0dHIodS5fdWlkKSArXG4gICAgICAgICAgICAnXCInICtcbiAgICAgICAgICAgIChjdXJBcHByb3ZlclVpZCA9PT0gdS5fdWlkID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgJz4nICtcbiAgICAgICAgICAgIGVzY2FwZUh0bWwobGJsKSArXG4gICAgICAgICAgICAnPC9vcHRpb24+JztcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHJlbmRBcHByb3Zlckh0bWwgPVxuICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwicmVuZC1hcHByb3Zlci1zZWxcIiB0aXRsZT1cIlF1aWVuIGFwcnVlYmEgbGFzIHJlbmRpY2lvbmVzIGRlIGVzdGUgdXN1YXJpb1wiPicgK1xuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgK1xuICAgICAgICAgICc8L3NlbGVjdD4nO1xuICAgICAgICAvLyBCb3RcdTAwRjNuIENhbWJpYXIgY29udHJhc2VcdTAwRjFhXG4gICAgICAgIGNvbnN0IHB3ZEJ0bkh0bWwgPVxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4XCIgb25jbGljaz1cImNoYW5nZVVzZXJQYXNzd29yZChcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgXCInLCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcbiAgICAgICAgICAnKVwiPkNvbnRyYXNlXHUwMEYxYTwvYnV0dG9uPic7XG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ29uZmlndXJhciAyRkFcbiAgICAgICAgY29uc3QgdG90cFN0YXR1c1RhZyA9IGQudG90cEVuYWJsZWRcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgICAoZC50b3RwRW5hYmxlZCA/ICcjMTBiOTgxJyA6ICcjNWIyMWI2JykgK1xuICAgICAgICAgICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgXCInLCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcbiAgICAgICAgICAnKVwiPjJGQScgK1xuICAgICAgICAgIHRvdHBTdGF0dXNUYWcgK1xuICAgICAgICAgICc8L2J1dHRvbj4nO1xuICAgICAgICAvLyBEZXNrdG9wIHJvd1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ciBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArIHlvdVRhZyArIHByb3RlY3RlZFRhZyArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUgfHwgJycpICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInJvbGUtc2VsXCI+JyArIHJvbGVPcHRpb25zICsgJzwvc2VsZWN0PjwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICsgdmVuZG9yT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwYXJlamFDZWxsICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQgY2xhc3M9XCJ3YS1jb2xcIj4nICsgd2FJbnB1dEh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcmVuZEFwcHJvdmVySHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBwd2RCdG5IdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHRvdHBCdG5IdG1sICsgJzwvdGQ+JztcbiAgICAgICAgY29uc3Qgc2hvd0RlbGV0ZSA9ICFpc1NlbGYgJiYgIWlzUHJvdGVjdGVkO1xuICAgICAgICBjb25zdCBkZWxCdG4gPSBzaG93RGVsZXRlXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgICAgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICB0YWJsZUh0bWwgKz1cbiAgICAgICAgICAnPHRkPicgK1xuICAgICAgICAgIGRlbEJ0biArXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8L3RyPic7XG4gICAgICAgIC8vIE1vYmlsZSBjYXJkXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVzZXJzLWNhcmRcIiBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdj48ZGl2IGNsYXNzPVwidWMtZW1haWxcIj4nICtcbiAgICAgICAgICBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICtcbiAgICAgICAgICB5b3VUYWcgK1xuICAgICAgICAgIHByb3RlY3RlZFRhZyArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGlmIChkLmRpc3BsYXlOYW1lKVxuICAgICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVjLW5hbWVcIj4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lKSArICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJvbDwvbGFiZWw+PHNlbGVjdCBjbGFzcz1cInJvbGUtc2VsXCI+JyArXG4gICAgICAgICAgcm9sZU9wdGlvbnMgK1xuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvciAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArXG4gICAgICAgICAgdmVuZG9yT3B0aW9ucyArXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yZXMgdmluY3VsYWRvcyAoYXV0byk8L2xhYmVsPicgK1xuICAgICAgICAgICAgcGFyZWphQ2VsbCArXG4gICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlBhcmVqYSBpbnRlcm5vIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+JyArXG4gICAgICAgICAgICBwYXJlamFDZWxsICtcbiAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPldoYXRzQXBwIChjb24gY29kaWdvIGRlIHBhaXMsIHNpbiArIG5pIGVzcGFjaW9zKTwvbGFiZWw+JyArXG4gICAgICAgICAgd2FJbnB1dEh0bWwgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5SZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczwvbGFiZWw+JyArXG4gICAgICAgICAgcmVuZEFwcHJvdmVySHRtbCArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCIgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjtkaXNwbGF5OmZsZXg7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+JyArXG4gICAgICAgICAgcHdkQnRuSHRtbCArXG4gICAgICAgICAgdG90cEJ0bkh0bWwgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBjb25zdCBkZWxCdG5DID0gc2hvd0RlbGV0ZVxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1hY3Rpb25zXCI+JyArXG4gICAgICAgICAgZGVsQnRuQyArXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0Ym9keS5pbm5lckhUTUwgPSB0YWJsZUh0bWw7XG4gICAgY2FyZHNFbC5pbm5lckhUTUwgPSBjYXJkc0h0bWw7XG4gICAgLy8gQWN0dWFsaXphIGhlYWRlciBkZSB0YWJsYSBjb24gbGEgY29sdW1uYSBudWV2YVxuICAgIGNvbnN0IHRoZWFkID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI3VzZXJzLXRhYmxlIHRoZWFkIHRyJyk7XG4gICAgaWYgKHRoZWFkKVxuICAgICAgdGhlYWQuaW5uZXJIVE1MID1cbiAgICAgICAgJzx0aD5FbWFpbDwvdGg+PHRoPk5vbWJyZTwvdGg+PHRoPlJvbDwvdGg+PHRoPlZlbmRlZG9yPC90aD48dGg+UGFyZWphIGludGVybm88L3RoPjx0aCBjbGFzcz1cIndhLWNvbFwiPldoYXRzQXBwPC90aD48dGg+UmVzcC4gcmVuZGljaW9uZXM8L3RoPjx0aD5QYXNzPC90aD48dGg+MkZBPC90aD48dGg+PC90aD4nO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gdXN1YXJpb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmNsb3NlQWRtaW5QYW5lbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IEYyOiBkZWxldGVVc2VyUm9sZSArIFRPVFAgKyBjaGFuZ2VVc2VyUGFzc3dvcmQgKyBzYXZlVXNlclJvbGUgKGlubGluZSBMMTQxMDUtMTQzOTApXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxud2luZG93LmRlbGV0ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XG4gICAgYWxlcnQoJ05vIHBvZGVzIGVsaW1pbmFyIHR1IHByb3BpbyBhY2Nlc28uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIERlZmVuc2EgYWRpY2lvbmFsOiBhZG1pbnMgcHJvdGVnaWRvcyBubyBzZSBwdWVkZW4gZWxpbWluYXIgbmkgZGVzZGUgY29uc29sYVxuICB0cnkge1xuICAgIGNvbnN0IHNuYXBQcmUgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgY29uc3QgZW1haWxQcmUgPSAoc25hcFByZS5leGlzdHMgPyBzbmFwUHJlLmRhdGEoKS5lbWFpbCB8fCAnJyA6ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IFBST1RFQ1RFRCA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG4gICAgaWYgKFBST1RFQ1RFRC5pbmRleE9mKGVtYWlsUHJlKSA+PSAwKSB7XG4gICAgICBhbGVydCgnRXN0ZSBlcyB1biBhZG1pbiBwcm90ZWdpZG8gKCcgKyBlbWFpbFByZSArICcpIHkgbm8gc2UgcHVlZGUgZWxpbWluYXIuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9IGNhdGNoIChfZSkge1xuICAgIC8qIHNpIGZhbGxhIGxhIGxlY3R1cmEgcHJldmlhLCBzaWd1ZSBjb24gY29uZmlybSAqL1xuICB9XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdFbGltaW5hciBhY2Nlc28gZGUgZXN0ZSB1c3VhcmlvP1xcblxcblBpZXJkZSBhY2Nlc28gZGUgaW5tZWRpYXRvLiBTaSB2dWVsdmUgYSBlbnRyYXIgY29uIEdvb2dsZSB2YSBhIHF1ZWRhciBjb21vIFwic2luIHJvbCBhc2lnbmFkb1wiIGhhc3RhIHF1ZSB2b3MgbG8gaGFiaWxpdGVzIGRlIG51ZXZvLlxcblxcblN1IGN1ZW50YSBHb29nbGUgc2lndWUgZXhpc3RpZW5kbywgbm8gc2UgYm9ycmEuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGNvbnN0IGRhdGEgPSBzbmFwLmV4aXN0cyA/IHNuYXAuZGF0YSgpIDoge307XG4gICAgbG9nT3AoJ2VsaW1pbmFyX3VzdWFyaW8nLCAndXNlcicsIGRhdGEuZW1haWwgfHwgdWlkLCB7XG4gICAgICB1aWQsXG4gICAgICBwcmV2aW91c1JvbGU6IGRhdGEucm9sZSxcbiAgICAgIHByZXZpb3VzVmVuZG9yOiBkYXRhLnZlbmRvcixcbiAgICB9KTtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZGVsZXRlKCk7XG4gICAgc2hvd1N5bmNUYWcoJ1VzdWFyaW8gZWxpbWluYWRvJyk7XG4gICAgYXdhaXQgb3BlbkFkbWluUGFuZWwoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVVzZXJSb2xlJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUGFuZWwgYWRtaW46IHNldHVwIC8gcmVzZXQgZGUgMkZBIHBvciB1c3VhcmlvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XG5cbndpbmRvdy5vcGVuVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgY29uc29sZS5sb2coJ1syRkFdIG9wZW5Ub3RwU2V0dXAgY2FsbGVkJywgeyB1aWQsIGVtYWlsLCB1c2VyUm9sZSB9KTtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XG4gICAgYWxlcnQoJ1NvbG8gZWwgYWRtaW5pc3RyYWRvciBwdWVkZSBjb25maWd1cmFyIDJGQSBwYXJhIG90cm9zIHVzdWFyaW9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXVpZCkge1xuICAgIGFsZXJ0KCdFcnJvcjogVUlEIGRlbCB1c3VhcmlvIG5vIGRpc3BvbmlibGUuIFJlY2FyZ2EgbGEgcGFnaW5hIHkgcmVpbnRlbnRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XG4gIC8vIE1vZGFsIGV4aXN0ZT9cbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkbyBlbiBlbCBET00uIFJlY2FyZ2EgbGEgcGFnaW5hIChDdHJsK1NoaWZ0K1IpLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzdWJ0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1zdWJ0Jyk7XG4gIGlmIChzdWJ0RWwpIHN1YnRFbC50ZXh0Q29udGVudCA9ICdQYXJhOiAnICsgKGVtYWlsIHx8IHVpZCk7XG4gIC8vIExlZXIgZXN0YWRvIGFjdHVhbFxuICBsZXQgY3VyRW5hYmxlZCA9IGZhbHNlO1xuICBsZXQgY3VyU2VjcmV0ID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGlmIChzbmFwLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xuICAgICAgY3VyRW5hYmxlZCA9ICEhZC50b3RwRW5hYmxlZDtcbiAgICAgIGN1clNlY3JldCA9IGQudG90cFNlY3JldCB8fCBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1syRkFdIGRvYyByb2xlcy8nICsgdWlkICsgJyBubyBleGlzdGUnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbMkZBXSBlcnJvciBsZXllbmRvIHJvbGVzLycgKyB1aWQsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGVsIGVzdGFkbyBkZSAyRkEgZGVsIHVzdWFyaW86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcbiAgaWYgKCFjKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBjb250ZW5lZG9yIGRlbCBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkby4gUmVjYXJnYSBsYSBwYWdpbmEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjdXJFbmFibGVkICYmIGN1clNlY3JldCkge1xuICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1zdWNjZXNzLWJnKTtib3JkZXI6MXB4IHNvbGlkICM4NmVmYWM7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAnPGI+JiMxMDAwMzsgMkZBIHlhIGVzdFx1MDBFMSBhY3Rpdm88L2I+IHBhcmEgZXN0ZSB1c3VhcmlvLicgK1xuICAgICAgJzxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4XCI+U2kgbG8gcGVyZGlcdTAwRjMgbyBjYW1iaVx1MDBGMyBkZSBjZWx1bGFyLCBwb2RcdTAwRTlzIGdlbmVyYXJsZSB1bm8gbnVldm8gKGVsIGFudGVyaW9yIHF1ZWRhIGludmFsaWRhZG8pLjwvc3Bhbj4nICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7bWFyZ2luLXRvcDoxNHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICBcIicsJ1wiICtcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcbiAgICAgICdcXCcpXCI+R2VuZXJhciBudWV2byAocmVzZXRlYXIpPC9idXR0b24+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICAnXFwnKVwiPkRlc2hhYmlsaXRhciAyRkE8L2J1dHRvbj4nICtcbiAgICAgICc8L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xuICAgICAgJ0VzdGUgdXN1YXJpbyB0b2Rhdlx1MDBFRGEgbm8gdGllbmUgMkZBIGNvbmZpZ3VyYWRvLiBHZW5lclx1MDBFMSB1biBudWV2byBjXHUwMEYzZGlnbyBwYXJhIHF1ZSBsbyBlc2NhbmVlIGNvbiBHb29nbGUgQXV0aGVudGljYXRvci4nICtcbiAgICAgICc8L2Rpdj4nICtcbiAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgXCInLCdcIiArXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgMkZBPC9idXR0b24+JyArXG4gICAgICAnPC9kaXY+JztcbiAgfVxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VUb3RwU2V0dXBNb2RhbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcbn07XG5cbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgY29uc3Qgc2VjcmV0ID0gdG90cEdlbmVyYXRlU2VjcmV0KCk7XG4gIGNvbnN0IG90cGF1dGggPSB0b3RwQnVpbGRPdHBhdXRoVXJsKHNlY3JldCwgZW1haWwgfHwgdWlkKTtcbiAgdG90cFNldHVwU3RhdGUgPSB7IHVpZDogdWlkLCBlbWFpbDogZW1haWwsIHNlY3JldDogc2VjcmV0LCBvdHBhdXRoOiBvdHBhdXRoIH07XG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XG4gIGMuaW5uZXJIVE1MID1cbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZyk7Ym9yZGVyOjFweCBzb2xpZCAjZmNkMzRkO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjojNzgzNTBmO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8Yj5QYXNvcyBwYXJhIGFjdGl2YXI6PC9iPjxicj4nICtcbiAgICAnMS4gRWwgdXN1YXJpbyBpbnN0YWxhIDxiPkdvb2dsZSBBdXRoZW50aWNhdG9yPC9iPiBlbiBzdSBjZWx1bGFyLjxicj4nICtcbiAgICAnMi4gVG9jYSBcIkFncmVnYXJcIiAvIFwiK1wiIGVuIGxhIGFwcC48YnI+JyArXG4gICAgJzMuIEVsaWdlIFwiRXNjYW5lYXIgY1x1MDBGM2RpZ28gUVJcIiB5IGVzY2FuZWEgZWwgY1x1MDBGM2RpZ28gYWJham8gKG8gcGVnYSBlbCBzZWNyZXQgbWFudWFsbWVudGUpLjxicj4nICtcbiAgICAnNC4gQXBhcmVjZSB1biBjXHUwMEYzZGlnbyBkZSA2IGRcdTAwRURnaXRvcyBlbiBHb29nbGUgQXV0aGVudGljYXRvci48YnI+JyArXG4gICAgJzUuIExvIGVzY3JpYmUgZW4gZWwgaW5wdXQgZGUgYWJham8gcGFyYSBjb25maXJtYXIgeSBhY3RpdmFyLicgK1xuICAgICc8L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+PGRpdiBpZD1cInRvdHAtcXItY29udGFpbmVyXCIgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtwYWRkaW5nOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweFwiPkdlbmVyYW5kbyBRUi4uLjwvZGl2PjwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206NHB4XCI+U2VjcmV0IChjYXJnYSBtYW51YWwgc2kgZWwgUVIgZmFsbGEpPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO3dvcmQtYnJlYWs6YnJlYWstYWxsO2xldHRlci1zcGFjaW5nOi4xZW1cIj4nICtcbiAgICBlc2NhcGVIdG1sKHNlY3JldCkgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTBweFwiPjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjVweFwiPkNcdTAwRjNkaWdvIGRlIHZlcmlmaWNhY2lcdTAwRjNuIGRlIEdvb2dsZSBBdXRoZW50aWNhdG9yPC9sYWJlbD4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJ0b3RwLWNvbmZpcm0taW5wdXRcIiBpbnB1dG1vZGU9XCJudW1lcmljXCIgbWF4bGVuZ3RoPVwiN1wiIHBsYWNlaG9sZGVyPVwiMDAwMDAwXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItZGVmYXVsdCk7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjE4cHg7dGV4dC1hbGlnbjpjZW50ZXI7bGV0dGVyLXNwYWNpbmc6LjNlbTtmb250LXdlaWdodDo4MDBcIi8+PC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImNvbmZpcm1Ub3RwU2V0dXAoKVwiPlZlcmlmaWNhciB5IGFjdGl2YXI8L2J1dHRvbj4nICtcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJjbG9zZVRvdHBTZXR1cE1vZGFsKClcIj5DYW5jZWxhcjwvYnV0dG9uPjwvZGl2Pic7XG4gIC8vIExhenktbG9hZCBxcmNvZGVqcyB5IGdlbmVyYXIuIEVzdGEgbGlicmVyaWEgcGludGEgZWwgUVIgZGlyZWN0byBlbiBlbFxuICAvLyBjb250ZW5lZG9yIERPTSB2aWEgY2FudmFzL2ltZyAtIG5vIG5lY2VzaXRhIGNhbGxiYWNrIHRvRGF0YVVSTC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBsb2FkUVJDb2RlTGliKCk7XG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XG4gICAgaWYgKCFib3gpIHJldHVybjtcbiAgICBib3guaW5uZXJIVE1MID0gJyc7IC8vIGxpbXBpYXIgZWwgXCJHZW5lcmFuZG8gUVIuLi5cIlxuICAgIG5ldyBRUkNvZGUoYm94LCB7XG4gICAgICB0ZXh0OiBvdHBhdXRoLFxuICAgICAgd2lkdGg6IDIyMCxcbiAgICAgIGhlaWdodDogMjIwLFxuICAgICAgY29sb3JEYXJrOiAnIzAwMDAwMCcsXG4gICAgICBjb2xvckxpZ2h0OiAnI2ZmZmZmZicsXG4gICAgICBjb3JyZWN0TGV2ZWw6IFFSQ29kZS5Db3JyZWN0TGV2ZWwuTSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignWzJGQV0gRXJyb3IgY2FyZ2FuZG8gUVIgbGliOicsIGUpO1xuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xuICAgIGlmIChib3gpXG4gICAgICBib3guaW5uZXJIVE1MID1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1jb2xvci1kYW5nZXItc3Ryb25nKTtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcbiAgfVxufTtcblxud2luZG93LmNvbmZpcm1Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghdG90cFNldHVwU3RhdGUpIHJldHVybjtcbiAgY29uc3QgY29kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1jb25maXJtLWlucHV0JykudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xuICBpZiAoIS9eXFxkezZ9JC8udGVzdChjb2RlKSkge1xuICAgIGFsZXJ0KCdJbmdyZXNcdTAwRTEgbG9zIDYgZFx1MDBFRGdpdG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGF3YWl0IHRvdHBWZXJpZnlDb2RlKHRvdHBTZXR1cFN0YXRlLnNlY3JldCwgY29kZSwgMSk7XG4gIGlmICghb2spIHtcbiAgICBhbGVydChcbiAgICAgICdDXHUwMEYzZGlnbyBpbmNvcnJlY3RvLiBBc2VndXJhdGUgZGUgcXVlIGVsIHNlY3JldCBzZSBjYXJnXHUwMEYzIGJpZW4gZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IgeSByZWludGVudFx1MDBFMS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpXG4gICAgICAudXBkYXRlKHtcbiAgICAgICAgdG90cFNlY3JldDogdG90cFNldHVwU3RhdGUuc2VjcmV0LFxuICAgICAgICB0b3RwRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgdG90cEVuYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIHRvdHBFbmFibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgc2hvd1N5bmNUYWcoJzJGQSBhY3RpdmFkbyBwYXJhICcgKyAodG90cFNldHVwU3RhdGUuZW1haWwgfHwgJ3VzdWFyaW8nKSk7XG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignc2F2ZSB0b3RwJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAoIWNvbmZpcm0oJ0Rlc2hhYmlsaXRhciAyRkEgcGFyYSBlc3RlIHVzdWFyaW8/IFZhIGEgZW50cmFyIHNvbG8gY29uIHBhc3N3b3JkLicpKSByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModWlkKVxuICAgICAgLnVwZGF0ZSh7XG4gICAgICAgIHRvdHBFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXG4gICAgICAgIHRvdHBEaXNhYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdG90cERpc2FibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgfSk7XG4gICAgc2hvd1N5bmNUYWcoJzJGQSBkZXNoYWJpbGl0YWRvJyk7XG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5jaGFuZ2VVc2VyUGFzc3dvcmQgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKCFlbWFpbCkge1xuICAgIGFsZXJ0KCdFc3RlIHVzdWFyaW8gbm8gdGllbmUgZW1haWwgcmVnaXN0cmFkbyAtIG5vIHNlIHB1ZWRlIHJlc2V0ZWFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBjaG9pY2UgPSBwcm9tcHQoXG4gICAgJ1Jlc2V0ZWFyIGNvbnRyYXNlXHUwMEYxYSBkZSAnICtcbiAgICAgIGVtYWlsICtcbiAgICAgICdcXG5cXG4nICtcbiAgICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXG4gICAgICAnMSkgRU5WSUFSIE1BSUwgREUgUkVTRVRFTyAocmVjb21lbmRhZG8pXFxuJyArXG4gICAgICAnIExlIGxsZWdhIGEgJyArXG4gICAgICBlbWFpbCArXG4gICAgICAnIHVuIG1haWwgZGUgRmlyZWJhc2UgY29uIHVuIGxpbmsuXFxuJyArXG4gICAgICAnIEVsIHVzdWFyaW8gY2xpY2tlYSwgc2V0ZWEgc3UgbnVldmEgcGFzc3dvcmQgeSB2dWVsdmUgYSBsYSBhcHAuXFxuJyArXG4gICAgICAnIEVzIGxvIGVzdGFuZGFyIHkgZnVuY2lvbmEgc2VndXJvLlxcblxcbicgK1xuICAgICAgJzIpIFJlc2V0ZWFyIFNPTE8gZWwgcGFzc3dvcmQtZ2F0ZSAoc2VndW5kYSBjYXBhKS5cXG4nICtcbiAgICAgICcgTm8gY2FtYmlhIGxhIHBhc3N3b3JkIHJlYWwgZGUgRmlyZWJhc2UuIFNpcnZlIHNpIGVsIHVzdWFyaW9cXG4nICtcbiAgICAgICcgZW50cmEgcG9yIEdvb2dsZSB5IG9sdmlkbyBsYSBwYXNzd29yZC1nYXRlIGRlIGxhIGFwcCwgTk8gc2lcXG4nICtcbiAgICAgICcgb2x2aWRvIGxhIHBhc3N3b3JkIGRlbCBsb2dpbiBjb24gZW1haWwuXFxuXFxuJyArXG4gICAgICAnRXNjcmliaSAxIG8gMjonLFxuICAgICcxJ1xuICApO1xuICBpZiAoY2hvaWNlID09PSBudWxsKSByZXR1cm47XG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZmJBdXRoLnNlbmRQYXNzd29yZFJlc2V0RW1haWwoZW1haWwpO1xuICAgICAgYWxlcnQoXG4gICAgICAgICdPSyAtIGxlIGVudmllIHVuIG1haWwgZGUgcmVzZXRlbyBhICcgK1xuICAgICAgICAgIGVtYWlsICtcbiAgICAgICAgICAnLiBEZWNpbGUgcXVlIHJldmlzZSBpbmJveCB5IHNwYW0uIEVsIGxpbmsgZXhwaXJhIGVuIDEgaG9yYS4nXG4gICAgICApO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZmJEYlxuICAgICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAgICAgLmRvYyh1aWQpXG4gICAgICAgICAgLnVwZGF0ZSh7XG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxuICAgICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignc2VuZFBhc3N3b3JkUmVzZXRFbWFpbCcsIGUpO1xuICAgICAgYWxlcnQoJ0Vycm9yIGVudmlhbmRvIGVsIG1haWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcbiAgICBjb25zdCBuZXdQd2QgPSBwcm9tcHQoXG4gICAgICAnTnVldmEgcGFzc3dvcmQtZ2F0ZSBwYXJhICcgK1xuICAgICAgICBlbWFpbCArXG4gICAgICAgICc6XFxuXFxuKFNvbG8gYWZlY3RhIGxhIHNlZ3VuZGEgY2FwYSBkZSBsYSBhcHAsIE5PIGVsIGxvZ2luIGNvbiBlbWFpbCknLFxuICAgICAgJydcbiAgICApO1xuICAgIGlmIChuZXdQd2QgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBwd2QgPSAobmV3UHdkIHx8ICcnKS50cmltKCk7XG4gICAgaWYgKHB3ZC5sZW5ndGggPCA0KSB7XG4gICAgICBhbGVydCgnTGEgY29udHJhc2VcdTAwRjFhIHRpZW5lIHF1ZSB0ZW5lciBhbCBtZW5vcyA0IGNhcmFjdGVyZXMuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjcmVkcyA9IGF3YWl0IGJ1aWxkUGFzc3dvcmRDcmVkZW50aWFscyhwd2QpO1xuICAgICAgYXdhaXQgZmJEYlxuICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgICAuZG9jKHVpZClcbiAgICAgICAgLnVwZGF0ZSh7XG4gICAgICAgICAgcGFzc3dvcmRIYXNoOiBjcmVkcy5wYXNzd29yZEhhc2gsXG4gICAgICAgICAgcGFzc3dvcmRTYWx0OiBjcmVkcy5wYXNzd29yZFNhbHQsXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZ2F0ZV9vbmx5JyxcbiAgICAgICAgfSk7XG4gICAgICBzaG93U3luY1RhZygnUGFzc3dvcmQtZ2F0ZSBhY3R1YWxpemFkYSBwYXJhICcgKyBlbWFpbCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGFsZXJ0KCdPcGNpb24gbm8gdmFsaWRhLiBDYW5jZWxhZG8uJyk7XG59O1xuXG53aW5kb3cuc2F2ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgYnRuKSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGJ0bi5jbG9zZXN0KCd0cicpIHx8IGJ0bi5jbG9zZXN0KCcudXNlcnMtY2FyZCcpO1xuICBpZiAoIWNvbnRhaW5lcikgcmV0dXJuO1xuICBjb25zdCByb2xlID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yb2xlLXNlbCcpLnZhbHVlO1xuICBjb25zdCB2ZW5kb3IgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnZlbmRvci1zZWwnKS52YWx1ZSB8fCBudWxsO1xuICBjb25zdCBpbnRlcm5hbFNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcuaW50ZXJuYWwtc2VsJyk7XG4gIGNvbnN0IGludGVybmFsUGFydG5lclVpZCA9IGludGVybmFsU2VsID8gaW50ZXJuYWxTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxuICBjb25zdCB3YUlucHV0ID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy53YS1pbnB1dCcpO1xuICBjb25zdCB3aGF0c2FwcCA9IHdhSW5wdXQgPyAod2FJbnB1dC52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxEL2csICcnKSA6ICcnO1xuICBpZiAod2hhdHNhcHAgJiYgd2hhdHNhcHAubGVuZ3RoIDwgOCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0VsIG51bWVybyBkZSBXaGF0c0FwcCBlcyBtdXkgY29ydG8uIFRpZW5lIHF1ZSBzZXIgZWwgbnVtZXJvIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoZWouIDU0OTExMjY3NjIwMzEgcGFyYSBBcmdlbnRpbmEpLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcyAodWlkIGRlbCB1c3VhcmlvIHF1ZSBhcHJ1ZWJhKVxuICBjb25zdCByZW5kQXBwcm92ZXJTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJlbmQtYXBwcm92ZXItc2VsJyk7XG4gIGNvbnN0IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kQXBwcm92ZXJTZWwgPyByZW5kQXBwcm92ZXJTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xuICAvLyB2ZW5kZWRvcmVzIG5vIHB1ZWRlbiBsZWVyIC9yb2xlcy97b3Ryb1VpZH0gcG9yIHNlY3VyaXR5IHJ1bGVzLCBhc2kgcXVlXG4gIC8vIG5lY2VzaXRhbiBlbCBlbWFpbCBhY2EgcGFyYSBwb2RlciBtYW5kYXIgbGEgcmVuZGljaW9uIChyZXNvbHZlTXlSZW5kaWNpb25lc0FwcHJvdmVyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xuICAvLyBwdWJsaWNvICh1c2Vyc19kaXJlY3RvcnkpIHF1ZSBzb2xvIHNlIHNpbmNyb25pemEgY3VhbmRvIGFkbWluIGFicmUgZWwgcGFuZWwuXG4gIGxldCByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBudWxsO1xuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xuICAgIGNvbnN0IGFwcHJvdmVyVXNlciA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maW5kKCh1KSA9PiB1Ll91aWQgPT09IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpO1xuICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IGFwcHJvdmVyVXNlciA/IGFwcHJvdmVyVXNlci5lbWFpbCB8fCBudWxsIDogbnVsbDtcbiAgfVxuICBidG4uZGlzYWJsZWQgPSB0cnVlO1xuICBidG4udGV4dENvbnRlbnQgPSAnLi4uJztcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh1aWQpXG4gICAgICAuc2V0KFxuICAgICAgICB7XG4gICAgICAgICAgcm9sZSxcbiAgICAgICAgICB2ZW5kb3IsXG4gICAgICAgICAgaW50ZXJuYWxQYXJ0bmVyVWlkLFxuICAgICAgICAgIHdoYXRzYXBwOiB3aGF0c2FwcCB8fCBudWxsLFxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQsXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwsXG4gICAgICAgICAgYXNzaWduZWRCeTogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIGFzc2lnbmVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICB9LFxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cbiAgICAgICk7XG4gICAgLy8gU2kgZWwgdXN1YXJpbyBlZGl0byBzdSBwcm9waW8gbnVtZXJvLCBhY3R1YWxpemFyIGVsIGNhY2hlIGxvY2FsXG4gICAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XG4gICAgICBteVdoYXRzYXBwTnVtYmVyID0gd2hhdHNhcHAgfHwgbnVsbDtcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgbnVsbDtcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsIHx8IG51bGw7XG4gICAgfVxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdPSyc7XG4gICAgLy8gUmUtcmVuZGVyIGRlbCBwYW5lbCBhc2kgbG9zIGRyb3Bkb3ducyBcIlBhcmVqYSBpbnRlcm5vXCIgbXVlc3RyYW4gbG9zIGludGVybm9zIGFjdHVhbGl6YWRvc1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcigncmVmcmVzaCBhZG1pbiBwYW5lbCcsIGUpO1xuICAgICAgfVxuICAgIH0sIDQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlVXNlclJvbGUnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xuICB9XG59O1xuXG4vLyBUb2RvcyBsb3MgaGFuZGxlcnMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIHNvbiB2ZXJiYXRpbS5cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXVCQSxNQUFJLE9BQU8sT0FBTyxlQUFlLFlBQWEsUUFBTyxhQUFhLENBQUM7QUFDbkUsTUFBTSxhQUFhLE9BQU87QUFFMUIsV0FBUywyQkFBMkIsYUFBYTtBQUMvQyxVQUFNLEtBQUssU0FBUyxlQUFlLHdCQUF3QjtBQUMzRCxRQUFJLENBQUMsR0FBSTtBQUNULG1CQUFlLGVBQWUsQ0FBQyxHQUM1QixNQUFNLEVBQ04sS0FBSyxDQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsSUFBSSxjQUFjLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDOUQsUUFBSSxPQUFPO0FBQ1gsWUFBUTtBQUNSLFlBQ0U7QUFDRixZQUFRO0FBQ1IsUUFBSSxDQUFDLFlBQVksUUFBUTtBQUN2QixjQUNFO0FBQUEsSUFDSixPQUFPO0FBQ0wsY0FDRTtBQUNGLGtCQUFZLFFBQVEsQ0FBQyxPQUFPO0FBQzFCLGNBQU0sUUFBUSxXQUFXLEdBQUcsU0FBUyxHQUFHLEdBQUc7QUFDM0MsY0FBTSxPQUFPLEdBQUcsT0FBTyxlQUFlLFdBQVcsR0FBRyxJQUFJLElBQUk7QUFD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
