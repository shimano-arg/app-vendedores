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
    msg.textContent = "\u{1F512} Guardado por seguridad en Google Secret Manager";
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
          const protectedTag = isProtected && !isSelf ? ' <span style="color:var(--color-accent-violet);font-size:9px;font-weight:800" title="Admin protegido - no se puede eliminar">&#128274; PROTEGIDO</span>' : "";
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
          const pwdBtnHtml = `<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px" onclick="changeUserPassword('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">&#128274; Contrase\xF1a</button>';
          const totpStatusTag = d.totpEnabled ? ' <span style="color:#10b981;font-weight:800">&#10003;</span>' : "";
          const totpBtnHtml = '<button class="app-btn-pill app-btn-violet" style="padding:5px 10px;font-size:10px;background:' + (d.totpEnabled ? "#10b981" : "#5b21b6") + `" onclick="openTotpSetup('` + docId + "', " + JSON.stringify(d.email || "").replace(/"/g, "&quot;") + ')">&#128272; 2FA' + totpStatusTag + "</button>";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGVsaW1pbmFkbyBlbCBLTk9XTiBCVUcgZGVsIGdlbWluaUFwaUtleUNhY2hlXHJcbi8vIGNyb3NzLW1vZHVsZS4gTGEga2V5IHlhIG5vIHZpdmUgZW4gRmlyZXN0b3JlIG5pIGNhY2hlYSBuYWRhIGZyb250ZW5kIFx1MjAxNFxyXG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXHJcbi8vIGxlZSB1c2Vyc0NhY2hlIGNvbW8gaWRlbnRpZmllciBsaWJyZS4gRW4gYnVuZGxlIFwidXNlIHN0cmljdFwiIHVuIHJlYWQgYVxyXG4vLyBpZGVudGlmaWVyIG5vLWRlY2xhcmFkbyBuaSBlbiB3aW5kb3cgdGlyYSBSZWZlcmVuY2VFcnJvci4gUHJvbW9jaW9uYXIgYVxyXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcclxuLy8geSBidW5kbGUgbm90aWZpY2FjaW9uZXMgKHNoZWxsKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cudXNlcnNDYWNoZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51c2Vyc0NhY2hlID0gW107XHJcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSlcclxuICAgIC5zbGljZSgpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuZW1haWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5lbWFpbCB8fCAnJykpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5TaSB1biB2ZW5kZWRvciB1c2EgR21haWwgcGVyc29uYWwgKG5vIEBzaGltYW5vLmNvbS5hciksIGFncmVnYWxvIGFjYSBhbnRlcyBxdWUgaW50ZW50ZSBsb2d1ZWFyLiBMb3MgZW1haWxzIEBzaGltYW5vLmNvbS5hciB5IGxvcyBhZG1pbnMgaGFyZGNvZGVkIHlhIGVzdGFuIGF1dG9yaXphZG9zIGF1dG9tYXRpY2FtZW50ZS48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwIDEwcHhcIj5ObyBoYXkgZW1haWxzIHByZS1hdXRvcml6YWRvcyB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjZweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgICBhbGxvd2VkTGlzdC5mb3JFYWNoKChhZSkgPT4ge1xyXG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcclxuICAgICAgY29uc3Qgbm90ZSA9IGFlLm5vdGUgPyAnICZtaWRkb3Q7ICcgKyBlc2NhcGVIdG1sKGFlLm5vdGUpIDogJyc7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6MTRweDtwYWRkaW5nOjNweCA0cHggM3B4IDEwcHg7Zm9udC1zaXplOjExcHg7Y29sb3I6IzFlNDBhZjtmb250LXdlaWdodDo2MDBcIj4nICtcclxuICAgICAgICBsYWJlbCArXHJcbiAgICAgICAgbm90ZSArXHJcbiAgICAgICAgJzxidXR0b24gb25jbGljaz1cInJlbW92ZUFsbG93ZWRFbWFpbChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKGFlLl9pZCkgK1xyXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlcik7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXHJcbiAgICAgICAgJzwvZGl2Pic7XHJcbiAgICB9KTtcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfVxyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxuXHJcbndpbmRvdy5hZGRBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xyXG4gIGlmICghcmF3KSByZXR1cm47XHJcbiAgY29uc3QgZW1haWwgPSByYXcudG9Mb3dlckNhc2UoKS50cmltKCk7XHJcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xyXG4gICAgYWxlcnQoJ0VsIGVtYWlsIG5vIHBhcmVjZSB2YWxpZG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG5vdGUgPVxyXG4gICAgcHJvbXB0KCdOb3RhIGNvcnRhIG9wY2lvbmFsIChlai4gXCJWZW5kZWRvciBaMSBHb256YWxvXCIgbyBcIlJlZW1wbGF6byBkZSBNYXVyaWNpb1wiKTonLCAnJykgfHwgJyc7XHJcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXHJcbiAgICAgIC5kb2MoZG9jSWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgZW1haWwsXHJcbiAgICAgICAgICBub3RlOiBub3RlLnRyaW0oKSxcclxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgYWRkZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYWRkZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xyXG4gICAgLy8gUmVjYXJnYXIgcGFuZWxcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5yZW1vdmVBbGxvd2VkRW1haWwgPSBhc3luYyBmdW5jdGlvbiAoZG9jSWQpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmRvYyhkb2NJZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdyZW1vdmVBbGxvd2VkRW1haWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PSBTZWNjaW9uIEdlbWluaSBBUEkgS2V5IChhZG1pbikgPT09XHJcbmZ1bmN0aW9uIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oX2RhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGxhIGtleSB2aXZlIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuXHJcbiAgLy8gdjYzOSAoMjAyNi0wOC0yNik6IFVYIHNpbXBsaWZpY2FkbyBwb3IgcGVkaWRvIE1hcmlhbm8gXHUyMDE0IHNpbiBpbnN0cnVjY2lvbmVzXHJcbiAgLy8gQ0xJIGVuIGVsIHBhbmVsLCBzb2xvIHVuIGJhbm5lciBleHBsaWNhbmRvIGRvbmRlIHZpdmUgbGEga2V5LlxyXG4gIC8vIFNlIGFkbWluaXN0cmEgcG9yIENMSSAoZmlyZWJhc2UgZnVuY3Rpb25zOnNlY3JldHM6c2V0IEdFTUlOSV9BUElfS0VZKS5cclxuICBlbC50ZXh0Q29udGVudCA9ICcnO1xyXG4gIGNvbnN0IHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB3cmFwLnN0eWxlLmNzc1RleHQgPVxyXG4gICAgJ3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MTRweCAxMnB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo2cHgnO1xyXG4gIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgdGl0bGUuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAnZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO21hcmdpbi1ib3R0b206NnB4JztcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdHZW1pbmkgQVBJIEtleSAoT0NSIGRlIHRpY2tldHMpJztcclxuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKSc7XHJcbiAgLy8gSWNvbm8gY2FuZGFkbyArIHRleHRvLiB0ZXh0Q29udGVudCBlcyBzYWZlIChubyBIVE1MIHBhcnNpbmcpLlxyXG4gIG1zZy50ZXh0Q29udGVudCA9ICdcdUQ4M0RcdUREMTIgR3VhcmRhZG8gcG9yIHNlZ3VyaWRhZCBlbiBHb29nbGUgU2VjcmV0IE1hbmFnZXInO1xyXG4gIHdyYXAuYXBwZW5kQ2hpbGQodGl0bGUpO1xyXG4gIHdyYXAuYXBwZW5kQ2hpbGQobXNnKTtcclxuICBlbC5hcHBlbmRDaGlsZCh3cmFwKTtcclxufVxyXG5cclxuLy8gdjU1MTogc2F2ZUdlbWluaUFwaUtleSArIGRlbGV0ZUdlbWluaUFwaUtleSBlbGltaW5hZG9zLiBMYSBrZXkgdml2ZVxyXG4vLyBlbiBTZWNyZXQgTWFuYWdlciwgbm8gZW4gRmlyZXN0b3JlLiBTZSBhZG1pbmlzdHJhIHBvciBDTEkuIFZlclxyXG4vLyByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uIHBhcmEgbGFzIGluc3RydWNjaW9uZXMuXHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gR09PR0xFIE1BUFMgR2VvY29kaW5nIEFQSSAtIG1lam9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCBxdWUgT1NNXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBMYSBrZXkgc2UgZ3VhcmRhIGVuIGFwcF9jb25maWcvZ29vZ2xlX21hcHMuIFNpIGVzdGEgc2V0ZWFkYSwgbGEgdXNhbW9zXHJcbi8vIGNvbW8gZ2VvY29kZXIgUFJJTUFSSU8gZW4gZ2VvY29kZUNsaWVudEFkZHJlc3M7IHNpIGZhbGxhIG8gbm8gZXN0YVxyXG4vLyBzZXRlYWRhLCBjYWVtb3MgYSBsYSBjYXNjYWRhIE9TTSBOb21pbmF0aW0gY29tbyBmYWxsYmFjay5cclxubGV0IGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xyXG5hc3luYyBmdW5jdGlvbiBnZXRHbWFwc0FwaUtleSgpIHtcclxuICBpZiAoZ21hcHNBcGlLZXlDYWNoZSkgcmV0dXJuIGdtYXBzQXBpS2V5Q2FjaGU7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XHJcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBpZiAoZC5hcGlLZXkpIHtcclxuICAgICAgICBnbWFwc0FwaUtleUNhY2hlID0gZC5hcGlLZXk7XHJcbiAgICAgICAgcmV0dXJuIGQuYXBpS2V5O1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIG5vIHNlIHB1ZG8gbGVlciBhcGkga2V5JywgZSk7XHJcbiAgfVxyXG4gIHJldHVybiBudWxsO1xyXG59XHJcbmZ1bmN0aW9uIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihkYXRhKSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ21hcHMtY29uZmlnLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgY29uc3QgaGFzS2V5ID0gZGF0YSAmJiBkYXRhLmFwaUtleTtcclxuICBjb25zdCBtYXNrZWQgPSBoYXNLZXkgPyBkYXRhLmFwaUtleS5zbGljZSgwLCA0KSArICdcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjInICsgZGF0YS5hcGlLZXkuc2xpY2UoLTQpIDogJyc7XHJcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xyXG4gIGNvbnN0IHVwZGF0ZWRBdCA9XHJcbiAgICBkYXRhICYmIGRhdGEudXBkYXRlZEF0ICYmIGRhdGEudXBkYXRlZEF0LnRvRGF0ZVxyXG4gICAgICA/IGRhdGEudXBkYXRlZEF0LnRvRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXHJcbiAgICAgIDogJyc7XHJcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzA2NWY0NlwiPkdvb2dsZSBNYXBzIEFQSSBLZXkgKGdlb2NvZGluZyk8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5Db252aWVydGUgZGlyZWNjaW9uZXMgYSBjb29yZGVuYWRhcyBjb24gbXVjaGEgbWVqb3IgcHJlY2lzaVx1MDBGM24gcXVlIE9TTSAoc29icmUgdG9kbyBlbiBsb2NhbGlkYWRlcyBjaGljYXMpLiBDb3N0byBncmF0aXMgaGFzdGEgNDAuMDAwIHJlcXVlc3RzL21lcy48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKGhhc0tleSkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDttYXJnaW4tYm90dG9tOjEwcHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTFweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtib3JkZXI6MXB4IHNvbGlkICM2ZWU3Yjc7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzo0cHggOHB4O2NvbG9yOiMwNjVmNDZcIj4nICtcclxuICAgICAgZXNjYXBlSHRtbChtYXNrZWQpICtcclxuICAgICAgJzwvc3Bhbj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKVwiPkNhcmdhZGEgcG9yICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKHVwZGF0ZWRCeSB8fCAnYWRtaW4nKSArXHJcbiAgICAgICh1cGRhdGVkQXQgPyAnICgnICsgZXNjYXBlSHRtbCh1cGRhdGVkQXQpICsgJyknIDogJycpICtcclxuICAgICAgJzwvc3Bhbj4nO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9IGVsc2Uge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xyXG4gIH1cclxuICBodG1sICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1jeWFuXCIgb25jbGljaz1cInNhdmVHbWFwc0FwaUtleSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiMxMGI5ODFcIj4nICtcclxuICAgIChoYXNLZXkgPyAnQ2FtYmlhciBrZXknIDogJ0NhcmdhciBrZXknKSArXHJcbiAgICAnPC9idXR0b24+JztcclxuICBpZiAoaGFzS2V5KVxyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxud2luZG93LnNhdmVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoXHJcbiAgICAnUGVnYSBhY2EgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcyAoZm9ybWF0byBBSXphU3kuLi4pLlxcblxcbklNUE9SVEFOVEU6IGVuIEdvb2dsZSBDbG91ZCBDb25zb2xlIHJlc3RyaW5naSBsYSBrZXkgcG9yIEhUVFAgcmVmZXJyZXIgYSBodHRwczovL3NoaW1hbm8tYXJnLmdpdGh1Yi5pby8qIHBhcmEgcXVlIG5hZGllIHRlIGxhIHJvYmUuJyxcclxuICAgICcnXHJcbiAgKTtcclxuICBpZiAocmF3ID09PSBudWxsKSByZXR1cm47XHJcbiAgY29uc3Qga2V5ID0gcmF3LnRyaW0oKTtcclxuICBpZiAoIWtleSkge1xyXG4gICAgYWxlcnQoJ1ZhY2lhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7XHJcbiAgICBhbGVydCgnTGEga2V5IHBhcmVjZSBtdXkgY29ydGEuIFJldmlzYSBxdWUgbGEgcGVnYXN0ZSBjb21wbGV0YS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgICAuZG9jKCdnb29nbGVfbWFwcycpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgYXBpS2V5OiBrZXksXHJcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgdXBkYXRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XHJcbiAgICAgICk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xyXG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgZ3VhcmRhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxud2luZG93LmRlbGV0ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnQm9ycmFyIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHM/IEVsIGdlb2NvZGluZyB2dWVsdmUgYSBPU00gKHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZGVsZXRlKCk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0gbnVsbDtcclxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVHbWFwc0FwaUtleScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEJVTEsgQVBQUk9WRVIgLSBhc2lnbmFyIGVsIG1pc21vIFwiUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXNcIlxyXG4vLyBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBVdGlsIGN1YW5kbyB1biBzb2xvIGFwcm9iYWRvciAoZWouIFBhYmxvIGdlcmVudGUpIHJldmlzYSBsYXNcclxuLy8gcmVuZGljaW9uZXMgZGUgVE9ET1MgbG9zIHZlbmRlZG9yZXMuIFNpbiBlc3RvIGVsIGFkbWluIHRpZW5lIHF1ZVxyXG4vLyBhYnJpciBjYWRhIGZpbGEgZGVsIHBhbmVsIFVzdWFyaW9zIHkgc2V0ZWFyIGVsIGRyb3Bkb3duIHVuYSBhIHVuYS5cclxuZnVuY3Rpb24gcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgY29uc3QgY2FuZGlkYXRlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoXHJcbiAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXHJcbiAgKTtcclxuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcclxuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojYTIxY2FmXCI+QXByb2JhZG9yIGRlIFJlbmRpY2lvbmVzIC0gYXNpZ25hY2lvbiBtYXNpdmE8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDoycHhcIj5BcGxpY2EgZWwgbWlzbW8gcmVzcG9uc2FibGUgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLiBVdGlsIGN1YW5kbyB1biBnZXJlbnRlIGNvbWVyY2lhbCBjZW50cmFsaXphIGxhIGFwcm9iYWNpb24uPC9kaXY+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGlmICghY2FuZGlkYXRlcy5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgYWRtaW4gLyBnZXJlbnRlIC8gaW50ZXJuby4gUHJpbWVybyBhc2lnbmEgdW4gcm9sIGEgYWxndWllbi48L2Rpdj4nO1xyXG4gICAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCB2ZW5kZWRvciB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPHNlbGVjdCBpZD1cImJ1bGstYXBwcm92ZXItc2VsZWN0XCIgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCAjZjBhYmZjO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpO2ZvbnQtZmFtaWx5OmluaGVyaXQ7ZmxleDoxO21heC13aWR0aDozNDBweFwiPic7XHJcbiAgaHRtbCArPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gRWxlZ2lyIGFwcm9iYWRvciAtPC9vcHRpb24+JztcclxuICBjYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcclxuICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyB1LnJvbGUgKyAnKSc7XHJcbiAgICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGVzY2FwZUF0dHIodS5fdWlkKSArICdcIj4nICsgZXNjYXBlSHRtbChsYmwpICsgJzwvb3B0aW9uPic7XHJcbiAgfSk7XHJcbiAgaHRtbCArPSAnPC9zZWxlY3Q+JztcclxuICBodG1sICs9XHJcbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJidWxrQXNzaWduQXBwcm92ZXIoKVwiPkFzaWduYXIgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyAoJyArXHJcbiAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXHJcbiAgICAnKTwvYnV0dG9uPic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG59XHJcbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XHJcbiAgICBhbGVydCgnU29sbyBhZG1pbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1bGstYXBwcm92ZXItc2VsZWN0Jyk7XHJcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcclxuICBpZiAoIXVpZCkge1xyXG4gICAgYWxlcnQoJ0VsZWcmaWFjdXRlOyB1biBhcHJvYmFkb3IgZGVsIGRyb3Bkb3duLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBhcHByb3ZlciA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maW5kKCh1KSA9PiB1Ll91aWQgPT09IHVpZCk7XHJcbiAgaWYgKCFhcHByb3Zlcikge1xyXG4gICAgYWxlcnQoJ0Fwcm9iYWRvciBubyBlbmNvbnRyYWRvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcclxuICBpZiAoIXZlbmRlZG9yZXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHZlbmRlZG9yZXMgcGFyYSBhc2lnbmFyLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBhcHByb3ZlckxhYmVsID0gYXBwcm92ZXIuZGlzcGxheU5hbWUgfHwgYXBwcm92ZXIuZW1haWwgfHwgYXBwcm92ZXIuX3VpZDtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ0FzaWduYXIgYSAnICtcclxuICAgICAgICBhcHByb3ZlckxhYmVsICtcclxuICAgICAgICAnIGNvbW8gYXByb2JhZG9yIGRlIGxvcyAnICtcclxuICAgICAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXHJcbiAgICAgICAgJyB2ZW5kZWRvcmVzP1xcblxcblZhIGEgc29icmVzY3JpYmlyIGN1YWxxdWllciBhcHJvYmFkb3IgcHJldmlvIGFzaWduYWRvIGEgY2FkYSB2ZW5kZWRvci4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIGxldCBva0NvdW50ID0gMCxcclxuICAgIF9lcnJDb3VudCA9IDA7XHJcbiAgLy8gVXBkYXRlIGVuIGxvdGUuIFVzYW1vcyB1biBiYXRjaCBkZSBGaXJlc3RvcmUuXHJcbiAgY29uc3QgYmF0Y2ggPSBmYkRiLmJhdGNoKCk7XHJcbiAgdmVuZGVkb3Jlcy5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICBjb25zdCByZWYgPSBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHYuX3VpZCk7XHJcbiAgICBiYXRjaC51cGRhdGUocmVmLCB7XHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHVpZCxcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcclxuICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgfSk7XHJcbiAgfSk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGJhdGNoLmNvbW1pdCgpO1xyXG4gICAgb2tDb3VudCA9IHZlbmRlZG9yZXMubGVuZ3RoO1xyXG4gICAgaWYgKHR5cGVvZiBsb2dPcCA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICBsb2dPcCgnYnVsa19hc3NpZ25fYXBwcm92ZXInLCAncm9sZXMnLCBhcHByb3ZlckxhYmVsLCB7XHJcbiAgICAgICAgYXBwcm92ZXJVaWQ6IHVpZCxcclxuICAgICAgICBhcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICB2ZW5kZWRvckNvdW50OiB2ZW5kZWRvcmVzLmxlbmd0aCxcclxuICAgICAgICB2ZW5kZWRvclVpZHM6IHZlbmRlZG9yZXMubWFwKCh2KSA9PiB2Ll91aWQpLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdidWxrQXNzaWduQXBwcm92ZXInLCBlKTtcclxuICAgIF9lcnJDb3VudCA9IHZlbmRlZG9yZXMubGVuZ3RoO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG4gIGlmIChva0NvdW50KSB7XHJcbiAgICBzaG93U3luY1RhZyhva0NvdW50ICsgJyB2ZW5kZWRvcihlcykgYXNpZ25hZG8ocykgYSAnICsgYXBwcm92ZXJMYWJlbCk7XHJcbiAgICB0cnkge1xyXG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgfSBjYXRjaCAoX2UpIHt9IC8vIHJlZnJlc2NhclxyXG4gIH1cclxufTtcclxuXHJcbi8vIEdlb2NvZGluZyBjb24gR29vZ2xlIE1hcHMgQVBJLiBEZXZ1ZWx2ZSB7bGF0LCBsbmcsIGRpc3BsYXksIHByZWNpc2lvbn1cclxuLy8gbyBudWxsIHNpIG5vIGVuY29udHJvIC8gc2luIGtleS5cclxuYXN5bmMgZnVuY3Rpb24gX2dlb2NvZGVXaXRoR29vZ2xlTWFwcyhhZGRyZXNzLCBsb2NhbGl0eSwgcHJvdmluY2VDb2RlKSB7XHJcbiAgY29uc3Qga2V5ID0gYXdhaXQgZ2V0R21hcHNBcGlLZXkoKTtcclxuICBpZiAoIWtleSkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgcHJvdiA9IHR5cGVvZiB0aXRsZUNhc2UgPT09ICdmdW5jdGlvbicgPyB0aXRsZUNhc2UocHJvdmluY2VDb2RlIHx8ICcnKSA6IHByb3ZpbmNlQ29kZSB8fCAnJztcclxuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xyXG4gIC8vIHJlZ2lvbj1hciArIGNvbXBvbmVudHM9Y291bnRyeTpBUiBzZXNnYSBsb3MgcmVzdWx0YWRvcyBhIEFSLlxyXG4gIGNvbnN0IHVybCA9XHJcbiAgICAnaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMuY29tL21hcHMvYXBpL2dlb2NvZGUvanNvbicgK1xyXG4gICAgJz9hZGRyZXNzPScgK1xyXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KGZ1bGxBZGRyKSArXHJcbiAgICAnJnJlZ2lvbj1hcicgK1xyXG4gICAgJyZjb21wb25lbnRzPWNvdW50cnk6QVInICtcclxuICAgICcmbGFuZ3VhZ2U9ZXMnICtcclxuICAgICcma2V5PScgK1xyXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KGtleSk7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xyXG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0hUVFAgJyArIHIuc3RhdHVzKTtcclxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByLmpzb24oKTtcclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xyXG4gICAgICBjb25zdCByZXMgPSBkYXRhLnJlc3VsdHNbMF07XHJcbiAgICAgIGNvbnN0IGxvYyA9IHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb247XHJcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcclxuICAgICAgLy8gbG9jYXRpb25fdHlwZSBpbmRpY2EgcHJlY2lzaW9uOiBST09GVE9QID4gUkFOR0VfSU5URVJQT0xBVEVEID4gR0VPTUVUUklDX0NFTlRFUiA+IEFQUFJPWElNQVRFLlxyXG4gICAgICBjb25zdCBsdCA9IChyZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uX3R5cGUpIHx8ICcnO1xyXG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xyXG4gICAgICBpZiAobHQgPT09ICdBUFBST1hJTUFURScpIHByZWNpc2lvbiA9ICdsb2NhbGl0eSc7XHJcbiAgICAgIGVsc2UgaWYgKGx0ID09PSAnR0VPTUVUUklDX0NFTlRFUicpIHByZWNpc2lvbiA9ICdzdHJlZXQnO1xyXG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xyXG4gICAgICAvLyBxdWUgU0FQIG5vIGV4cG9ydG8gKFNoaXAtdG8gQ2l0eSB2YWNpbyBlcyBtdXkgY29tdW4gZW4gQlBzIHZpZWpvcykuXHJcbiAgICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXMuYWRkcmVzc19jb21wb25lbnRzIHx8IFtdO1xyXG4gICAgICBjb25zdCBieVR5cGUgPSAodCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGMgPSBjb21wb25lbnRzLmZpbmQoKGNjKSA9PiBBcnJheS5pc0FycmF5KGNjLnR5cGVzKSAmJiBjYy50eXBlcy5pbmNsdWRlcyh0KSk7XHJcbiAgICAgICAgcmV0dXJuIGMgPyBjLmxvbmdfbmFtZSB8fCAnJyA6ICcnO1xyXG4gICAgICB9O1xyXG4gICAgICAvLyBQcmlvcmlkYWQgcGFyYSBsb2NhbGlkYWQ6IGxvY2FsaXR5ID4gc3VibG9jYWxpdHkgPiBhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzIuXHJcbiAgICAgIGNvbnN0IGRldGVjdGVkTG9jYWxpdHkgPVxyXG4gICAgICAgIGJ5VHlwZSgnbG9jYWxpdHknKSB8fCBieVR5cGUoJ3N1YmxvY2FsaXR5JykgfHwgYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzInKSB8fCAnJztcclxuICAgICAgY29uc3QgZGV0ZWN0ZWRQcm92aW5jZSA9IGJ5VHlwZSgnYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8xJykgfHwgJyc7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgbGF0OiBwYXJzZUZsb2F0KGxvYy5sYXQpLFxyXG4gICAgICAgIGxuZzogcGFyc2VGbG9hdChsb2MubG5nKSxcclxuICAgICAgICBkaXNwbGF5OiByZXMuZm9ybWF0dGVkX2FkZHJlc3MgfHwgZnVsbEFkZHIsXHJcbiAgICAgICAgcHJlY2lzaW9uOiBwcmVjaXNpb24sXHJcbiAgICAgICAgcHJvdmlkZXI6ICdnb29nbGUnLFxyXG4gICAgICAgIGxvY2F0aW9uVHlwZTogbHQsXHJcbiAgICAgICAgbG9jYWxpdHk6IGRldGVjdGVkTG9jYWxpdHksXHJcbiAgICAgICAgcHJvdmluY2U6IGRldGVjdGVkUHJvdmluY2UsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdaRVJPX1JFU1VMVFMnKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbZ21hcHNdIFpFUk9fUkVTVUxUUyBmb3I6JywgZnVsbEFkZHIpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ1JFUVVFU1RfREVOSUVEJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFxyXG4gICAgICAgICdbZ21hcHNdIFJFUVVFU1RfREVOSUVEOicsXHJcbiAgICAgICAgZGF0YS5lcnJvcl9tZXNzYWdlIHx8XHJcbiAgICAgICAgICAnKHNpbiBkZXRhbGxlKS4gUmV2aXNhciBxdWUgbGEgQVBJIGtleSB0ZW5nYSBoYWJpbGl0YWRhIEdlb2NvZGluZyBBUEkgeSBlbCByZWZlcnJlciBwZXJtaXRhIGVzdGUgZG9taW5pby4nXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnT1ZFUl9RVUVSWV9MSU1JVCcpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignW2dtYXBzXSBPVkVSX1FVRVJZX0xJTUlUIC0gZXhjZWRpbyBlbCBsaW1pdGUuIENhZW1vcyBhIE9TTS4nKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gc3RhdHVzIGluZXNwZXJhZG86JywgZGF0YS5zdGF0dXMsIGRhdGEuZXJyb3JfbWVzc2FnZSk7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gZ2VvY29kZSBlcnJvcjonLCBlKTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxufVxyXG5cclxud2luZG93Lm9wZW5BZG1pblBhbmVsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxuICAvLyBDYXJnYXIgYWxsb3dlZF9lbWFpbHMgcGFyYSBtb3N0cmFyIGFycmliYSBsYSBzZWNjaW9uIGRlIHByZS1hdXRvcml6YWNpb25lc1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBhZVFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmdldCgpO1xyXG4gICAgY29uc3QgYWxsb3dlZExpc3QgPSBbXTtcclxuICAgIGFlUXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKTtcclxuICAgIH0pO1xyXG4gICAgcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignbG9hZCBhbGxvd2VkX2VtYWlscycsIGUpO1xyXG4gIH1cclxuICAvLyBDYXJnYXIgY29uZmlnIEdlbWluaSBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGdTbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnZW1pbmknKS5nZXQoKTtcclxuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZ1NuYXAuZXhpc3RzID8gZ1NuYXAuZGF0YSgpIDogbnVsbCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdsb2FkIGdlbWluaSBjb25maWcnLCBlKTtcclxuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24obnVsbCk7XHJcbiAgfVxyXG4gIC8vIENhcmdhciBjb25maWcgR29vZ2xlIE1hcHMgcGFyYSBtb3N0cmFyIGxhIHNlY2Npb24gZGUgQVBJIGtleS5cclxuICB0cnkge1xyXG4gICAgY29uc3QgZ21TbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmdldCgpO1xyXG4gICAgcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGdtU25hcC5leGlzdHMgPyBnbVNuYXAuZGF0YSgpIDogbnVsbCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdsb2FkIGdtYXBzIGNvbmZpZycsIGUpO1xyXG4gICAgcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKG51bGwpO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgY29uc3QgcXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykub3JkZXJCeSgnZW1haWwnKS5nZXQoKTtcclxuICAgIC8vIEU2IGZpeCBDMTogdmFjaWFyIGVsIEFycmF5IGluLXBsYWNlIChwcmVzZXJ2YSB3aW5kb3cudXNlcnNDYWNoZSByZWYpLlxyXG4gICAgdXNlcnNDYWNoZS5sZW5ndGggPSAwO1xyXG4gICAgcXMuZm9yRWFjaCgoZG9jKSA9PiB7XHJcbiAgICAgIHVzZXJzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgX3VpZDogZG9jLmlkIH0sIGRvYy5kYXRhKCkpKTtcclxuICAgIH0pO1xyXG4gICAgLy8gUmVuZGVyIGRlbCBibG9xdWUgXCJBc2lnbmFyIGFwcm9iYWRvciBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzXCIgYXJyaWJhIGRlIGxhIHRhYmxhLlxyXG4gICAgdHJ5IHtcclxuICAgICAgcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpO1xyXG4gICAgfVxyXG4gICAgLy8gU2luY3Jvbml6YXIgZWwgZGlyZWN0b3JpbyBwdWJsaWNvIGRlIHVzdWFyaW9zIHBhcmEgcXVlIGxvcyB2ZW5kZWRvcmVzXHJcbiAgICAvLyBwdWVkYW4gdmVyIGRlc3RpbmF0YXJpb3MgYWwgY3JlYXIgdGFyZWFzIGVuIE5vdGlmaWNhY2lvbmVzLiBTaW4gZXN0b1xyXG4gICAgLy8gbG9zIHZlbmRlZG9yZXMgdmVuIGVsIGRyb3Bkb3duIHZhY2lvIChzZWN1cml0eSBydWxlcyBibG9xdWVhbiAvcm9sZXMpLlxyXG4gICAgdHJ5IHtcclxuICAgICAgc3luY1VzZXJzRGlyZWN0b3J5KCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybignc3luY1VzZXJzRGlyZWN0b3J5JywgZSk7XHJcbiAgICB9XHJcbiAgICAvLyBMaXN0YSBkZSBpbnRlcm5vcyBkaXNwb25pYmxlcyAocGFyYSBhc2lnbmFyIHBhcmVqYSBhIGxvcyB2ZW5kZWRvcmVzKVxyXG4gICAgY29uc3QgaW50ZXJub3MgPSB1c2Vyc0NhY2hlLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAnaW50ZXJubycpO1xyXG4gICAgY29uc3QgX2ludGVybm9PcHRzID1cclxuICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xyXG4gICAgICBpbnRlcm5vc1xyXG4gICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAodSkgPT5cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgdS5fdWlkICtcclxuICAgICAgICAgICAgJ1wiPicgK1xyXG4gICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgdS5kaXNwbGF5TmFtZSB8fCB1Ll91aWQpICtcclxuICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICApXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG5cclxuICAgIGNvbnN0IHRib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLXRhYmxlLWJvZHknKTtcclxuICAgIGNvbnN0IGNhcmRzRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndXNlcnMtY2FyZHMnKTtcclxuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcclxuICAgIGxldCBjYXJkc0h0bWwgPSAnJztcclxuICAgIGlmICghdXNlcnNDYWNoZS5sZW5ndGgpIHtcclxuICAgICAgdGFibGVIdG1sID1cclxuICAgICAgICAnPHRyPjx0ZCBjb2xzcGFuPVwiNlwiIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XHJcbiAgICAgIGNhcmRzSHRtbCA9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjE4cHhcIj5ObyBoYXkgdXN1YXJpb3MgdG9kYXZpYS4gRXNwZXJhbiBxdWUgaW5ncmVzZW4gY29uIEdvb2dsZS48L2Rpdj4nO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gQWRtaW5zIHByaW1hcmlvcyBwcm90ZWdpZG9zOiBubyBzZSBwdWVkZW4gZWxpbWluYXIgKE1hcmlhbm8gKyBib3QgY29ycG9yYXRpdm8pXHJcbiAgICAgIGNvbnN0IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgICAvLyBQYXJhIGxvcyBpbnRlcm5vcyBjYWxjdWxhbW9zIGxhIHJlbGFjaW9uIGludmVyc2E6IHF1aWVuZXMgbG9zIHRpZW5lbiBjb21vIHBhcmVqYVxyXG4gICAgICBmdW5jdGlvbiB2ZW5kb3JzUGFyYUludGVybm8oaW50ZXJub1VpZCkge1xyXG4gICAgICAgIHJldHVybiB1c2Vyc0NhY2hlLmZpbHRlcihcclxuICAgICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicgJiYgdS5pbnRlcm5hbFBhcnRuZXJVaWQgPT09IGludGVybm9VaWRcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIENhbmRpZGF0b3MgYSByZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczogYWRtaW4sIGdlcmVudGUgbyBpbnRlcm5vIChubyB2ZW5kZWRvcmVzIG5pIHZpZXdlcnMgbmkgdW5hc3NpZ25lZClcclxuICAgICAgY29uc3QgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMgPSB1c2Vyc0NhY2hlLmZpbHRlcihcclxuICAgICAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXHJcbiAgICAgICk7XHJcbiAgICAgIHVzZXJzQ2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGRvY0lkID0gZC5fdWlkO1xyXG4gICAgICAgIGNvbnN0IGlzU2VsZiA9IGRvY0lkID09PSBjdXJyZW50VXNlci51aWQ7XHJcbiAgICAgICAgY29uc3QgaXNQcm90ZWN0ZWQgPSBQUk9URUNURURfQURNSU5fRU1BSUxTLmluZGV4T2YoKGQuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpID49IDA7XHJcbiAgICAgICAgY29uc3QgaXNJbnRlcm5vID0gZC5yb2xlID09PSAnaW50ZXJubyc7XHJcbiAgICAgICAgY29uc3Qgcm9sZU9wdGlvbnMgPSBbJ3VuYXNzaWduZWQnLCAnYWRtaW4nLCAnZ2VyZW50ZScsICd2ZW5kZWRvcicsICdpbnRlcm5vJywgJ3ZpZXdlciddXHJcbiAgICAgICAgICAubWFwKFxyXG4gICAgICAgICAgICAocikgPT5cclxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICAgIHIgK1xyXG4gICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgIChkLnJvbGUgPT09IHIgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgKGlzU2VsZiAmJiByICE9PSAnYWRtaW4nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgICAgciArXHJcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5qb2luKCcnKTtcclxuICAgICAgICBjb25zdCB2ZW5kb3JPcHRpb25zID1cclxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LTwvb3B0aW9uPicgK1xyXG4gICAgICAgICAgVkVORE9SUy5tYXAoXHJcbiAgICAgICAgICAgICh2KSA9PlxyXG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgdi5rZXkgK1xyXG4gICAgICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgICAgIChkLnZlbmRvciA9PT0gdi5rZXkgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICB2LnpvbmUgK1xyXG4gICAgICAgICAgICAgICcgJyArXHJcbiAgICAgICAgICAgICAgdi5rZXkgK1xyXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgICApLmpvaW4oJycpO1xyXG4gICAgICAgIC8vIFNpIGVzIGludGVybm8sIG1vc3RyYXIgcmVsYWNpb24gaW52ZXJzYSAodmVuZGVkb3JlcyBxdWUgbG8gdGllbmVuIGNvbW8gcGFyZWphKSBlbiB2ZXogZGVsIGRyb3Bkb3duIGVkaXRhYmxlXHJcbiAgICAgICAgbGV0IHBhcmVqYUNlbGw7XHJcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xyXG4gICAgICAgICAgY29uc3QgdmluYyA9IHZlbmRvcnNQYXJhSW50ZXJubyhkb2NJZCk7XHJcbiAgICAgICAgICBpZiAodmluYy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgY29uc3QgbGlzdCA9IHZpbmNcclxuICAgICAgICAgICAgICAubWFwKCh1KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IHUuZGlzcGxheU5hbWUgPyB1LmRpc3BsYXlOYW1lLnNwbGl0KC9cXHMrLylbMF0gOiB1LmVtYWlsIHx8ICcnO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbChsYWJlbCkgK1xyXG4gICAgICAgICAgICAgICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tdGV4dC1tdXRlZClcIj4oJyArXHJcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCAnJykgK1xyXG4gICAgICAgICAgICAgICAgICAnKTwvc3Bhbj4nXHJcbiAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgICAgLmpvaW4oJzxicj4nKTtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCA9XHJcbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2xpbmUtaGVpZ2h0OjEuNVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi40cHg7bWFyZ2luLWJvdHRvbToycHhcIj5WZW5kZWRvcmVzIGV4dGVybm9zIHZpbmN1bGFkb3MgKGF1dG8pPC9kaXY+JyArXHJcbiAgICAgICAgICAgICAgbGlzdCArXHJcbiAgICAgICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBwYXJlamFDZWxsID1cclxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO2ZvbnQtc3R5bGU6aXRhbGljXCI+QXVuIG5pbmd1biB2ZW5kZWRvciBsbyB0aWVuZSBjb21vIHBhcmVqYTwvZGl2Pic7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICAvLyBpbnB1dCBvY3VsdG8gcGFyYSBxdWUgc2F2ZVVzZXJSb2xlIG5vIHBpc2UgZWwgdmFsb3IgZGVsIHJvbCA9IGludGVybm8gKG5vIGFwbGljYSBpbnRlcm5hbFBhcnRuZXJVaWQpXHJcbiAgICAgICAgICBwYXJlamFDZWxsICs9ICc8aW5wdXQgdHlwZT1cImhpZGRlblwiIGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdmFsdWU9XCJcIi8+JztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY29uc3QgaW50ZXJub09wdHNGb3JSb3cgPVxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIHBhcmVqYSAtPC9vcHRpb24+JyArXHJcbiAgICAgICAgICAgIGludGVybm9zXHJcbiAgICAgICAgICAgICAgLm1hcChcclxuICAgICAgICAgICAgICAgICh1KSA9PlxyXG4gICAgICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICAgICAgICB1Ll91aWQgK1xyXG4gICAgICAgICAgICAgICAgICAnXCInICtcclxuICAgICAgICAgICAgICAgICAgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xyXG4gICAgICAgICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgICAuam9pbignJyk7XHJcbiAgICAgICAgICBwYXJlamFDZWxsID1cclxuICAgICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB0aXRsZT1cIlBhcmVqYSBpbnRlcm5vIChzb2xvIGFwbGljYSBzaSBlbCByb2wgZXMgdmVuZGVkb3IpXCI+JyArXHJcbiAgICAgICAgICAgIGludGVybm9PcHRzRm9yUm93ICtcclxuICAgICAgICAgICAgJzwvc2VsZWN0Pic7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IHlvdVRhZyA9IGlzU2VsZlxyXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIj4oVk9TKTwvc3Bhbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHByb3RlY3RlZFRhZyA9XHJcbiAgICAgICAgICBpc1Byb3RlY3RlZCAmJiAhaXNTZWxmXHJcbiAgICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWFjY2VudC12aW9sZXQpO2ZvbnQtc2l6ZTo5cHg7Zm9udC13ZWlnaHQ6ODAwXCIgdGl0bGU9XCJBZG1pbiBwcm90ZWdpZG8gLSBubyBzZSBwdWVkZSBlbGltaW5hclwiPiYjMTI4Mjc0OyBQUk9URUdJRE88L3NwYW4+J1xyXG4gICAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHdhVmFsID0gZC53aGF0c2FwcCB8fCAnJztcclxuICAgICAgICBjb25zdCB3YUlucHV0SHRtbCA9XHJcbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHdhVmFsKSArXHJcbiAgICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6NXB4IDdweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpXCIgdGl0bGU9XCJOdW1lcm8gV2hhdHNBcHAgY29tcGxldG8gY29uIGNvZGlnbyBkZSBwYWlzIChzaW4gKyBuaSBlc3BhY2lvcykuIFNlIHVzYSBhbCBlbnZpYXIgbGEgcnV0YS5cIi8+JztcclxuICAgICAgICAvLyBEcm9wZG93biAnUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMnXHJcbiAgICAgICAgY29uc3QgY3VyQXBwcm92ZXJVaWQgPSBkLnJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgJyc7XHJcbiAgICAgICAgbGV0IHJlbmRBcHByb3Zlck9wdGlvbnMgPSAnPG9wdGlvbiB2YWx1ZT1cIlwiPi0gU2luIGFzaWduYXIgLTwvb3B0aW9uPic7XHJcbiAgICAgICAgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMuZm9yRWFjaCgodSkgPT4ge1xyXG4gICAgICAgICAgaWYgKHUuX3VpZCA9PT0gZG9jSWQpIHJldHVybjsgLy8gdW4gdXN1YXJpbyBubyBwdWVkZSBzZXIgc3UgcHJvcGlvIGFwcm9iYWRvclxyXG4gICAgICAgICAgY29uc3QgbGJsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1Ll91aWQpICsgJyAoJyArICh1LnJvbGUgfHwgJycpICsgJyknO1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArPVxyXG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xyXG4gICAgICAgICAgICBlc2NhcGVBdHRyKHUuX3VpZCkgK1xyXG4gICAgICAgICAgICAnXCInICtcclxuICAgICAgICAgICAgKGN1ckFwcHJvdmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICAgIGVzY2FwZUh0bWwobGJsKSArXHJcbiAgICAgICAgICAgICc8L29wdGlvbj4nO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IHJlbmRBcHByb3Zlckh0bWwgPVxyXG4gICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJyZW5kLWFwcHJvdmVyLXNlbFwiIHRpdGxlPVwiUXVpZW4gYXBydWViYSBsYXMgcmVuZGljaW9uZXMgZGUgZXN0ZSB1c3VhcmlvXCI+JyArXHJcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD4nO1xyXG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ2FtYmlhciBjb250cmFzZVx1MDBGMWFcclxuICAgICAgICBjb25zdCBwd2RCdG5IdG1sID1cclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4XCIgb25jbGljaz1cImNoYW5nZVVzZXJQYXNzd29yZChcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgIFwiJywgXCIgK1xyXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcclxuICAgICAgICAgICcpXCI+JiMxMjgyNzQ7IENvbnRyYXNlXHUwMEYxYTwvYnV0dG9uPic7XHJcbiAgICAgICAgLy8gQm90XHUwMEYzbiBDb25maWd1cmFyIDJGQVxyXG4gICAgICAgIGNvbnN0IHRvdHBTdGF0dXNUYWcgPSBkLnRvdHBFbmFibGVkXHJcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPidcclxuICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgY29uc3QgdG90cEJ0bkh0bWwgPVxyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHg7YmFja2dyb3VuZDonICtcclxuICAgICAgICAgIChkLnRvdHBFbmFibGVkID8gJyMxMGI5ODEnIDogJyM1YjIxYjYnKSArXHJcbiAgICAgICAgICAnXCIgb25jbGljaz1cIm9wZW5Ub3RwU2V0dXAoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICBcIicsIFwiICtcclxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXHJcbiAgICAgICAgICAnKVwiPiYjMTI4MjcyOyAyRkEnICtcclxuICAgICAgICAgIHRvdHBTdGF0dXNUYWcgK1xyXG4gICAgICAgICAgJzwvYnV0dG9uPic7XHJcbiAgICAgICAgLy8gRGVza3RvcCByb3dcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ciBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICsgeW91VGFnICsgcHJvdGVjdGVkVGFnICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lIHx8ICcnKSArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInJvbGUtc2VsXCI+JyArIHJvbGVPcHRpb25zICsgJzwvc2VsZWN0PjwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgKyB2ZW5kb3JPcHRpb25zICsgJzwvc2VsZWN0PjwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcGFyZWphQ2VsbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQgY2xhc3M9XCJ3YS1jb2xcIj4nICsgd2FJbnB1dEh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyByZW5kQXBwcm92ZXJIdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHRvdHBCdG5IdG1sICsgJzwvdGQ+JztcclxuICAgICAgICBjb25zdCBzaG93RGVsZXRlID0gIWlzU2VsZiAmJiAhaXNQcm90ZWN0ZWQ7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZVxyXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPVxyXG4gICAgICAgICAgJzx0ZD4nICtcclxuICAgICAgICAgIGRlbEJ0biArXHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzwvdHI+JztcclxuICAgICAgICAvLyBNb2JpbGUgY2FyZFxyXG4gICAgICAgIGNhcmRzSHRtbCArPSAnPGRpdiBjbGFzcz1cInVzZXJzLWNhcmRcIiBkYXRhLXVpZD1cIicgKyBkb2NJZCArICdcIj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXY+PGRpdiBjbGFzcz1cInVjLWVtYWlsXCI+JyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sKGQuZW1haWwgfHwgJycpICtcclxuICAgICAgICAgIHlvdVRhZyArXHJcbiAgICAgICAgICBwcm90ZWN0ZWRUYWcgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgaWYgKGQuZGlzcGxheU5hbWUpXHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1uYW1lXCI+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSkgKyAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5Sb2w8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgK1xyXG4gICAgICAgICAgcm9sZU9wdGlvbnMgK1xyXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvciAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArXHJcbiAgICAgICAgICB2ZW5kb3JPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xyXG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcclxuICAgICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvcmVzIHZpbmN1bGFkb3MgKGF1dG8pPC9sYWJlbD4nICtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCArXHJcbiAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UGFyZWphIGludGVybm8gKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD4nICtcclxuICAgICAgICAgICAgcGFyZWphQ2VsbCArXHJcbiAgICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPldoYXRzQXBwIChjb24gY29kaWdvIGRlIHBhaXMsIHNpbiArIG5pIGVzcGFjaW9zKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICB3YUlucHV0SHRtbCArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzPC9sYWJlbD4nICtcclxuICAgICAgICAgIHJlbmRBcHByb3Zlckh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiIHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7ZGlzcGxheTpmbGV4O2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xyXG4gICAgICAgICAgcHdkQnRuSHRtbCArXHJcbiAgICAgICAgICB0b3RwQnRuSHRtbCArXHJcbiAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICBjb25zdCBkZWxCdG5DID0gc2hvd0RlbGV0ZVxyXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1hY3Rpb25zXCI+JyArXHJcbiAgICAgICAgICBkZWxCdG5DICtcclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xyXG4gICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC9kaXY+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xyXG4gICAgY2FyZHNFbC5pbm5lckhUTUwgPSBjYXJkc0h0bWw7XHJcbiAgICAvLyBBY3R1YWxpemEgaGVhZGVyIGRlIHRhYmxhIGNvbiBsYSBjb2x1bW5hIG51ZXZhXHJcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xyXG4gICAgaWYgKHRoZWFkKVxyXG4gICAgICB0aGVhZC5pbm5lckhUTUwgPVxyXG4gICAgICAgICc8dGg+RW1haWw8L3RoPjx0aD5Ob21icmU8L3RoPjx0aD5Sb2w8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlBhcmVqYSBpbnRlcm5vPC90aD48dGggY2xhc3M9XCJ3YS1jb2xcIj5XaGF0c0FwcDwvdGg+PHRoPlJlc3AuIHJlbmRpY2lvbmVzPC90aD48dGg+UGFzczwvdGg+PHRoPjJGQTwvdGg+PHRoPjwvdGg+JztcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdvcGVuQWRtaW5QYW5lbCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIHVzdWFyaW9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LmNsb3NlQWRtaW5QYW5lbCA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gU0VDQ0lcdTAwRDNOOiBGMjogZGVsZXRlVXNlclJvbGUgKyBUT1RQICsgY2hhbmdlVXNlclBhc3N3b3JkICsgc2F2ZVVzZXJSb2xlIChpbmxpbmUgTDE0MTA1LTE0MzkwKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbndpbmRvdy5kZWxldGVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcclxuICAgIGFsZXJ0KCdObyBwb2RlcyBlbGltaW5hciB0dSBwcm9waW8gYWNjZXNvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBEZWZlbnNhIGFkaWNpb25hbDogYWRtaW5zIHByb3RlZ2lkb3Mgbm8gc2UgcHVlZGVuIGVsaW1pbmFyIG5pIGRlc2RlIGNvbnNvbGFcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcFByZSA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGNvbnN0IGVtYWlsUHJlID0gKHNuYXBQcmUuZXhpc3RzID8gc25hcFByZS5kYXRhKCkuZW1haWwgfHwgJycgOiAnJykudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IFBST1RFQ1RFRCA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XHJcbiAgICBpZiAoUFJPVEVDVEVELmluZGV4T2YoZW1haWxQcmUpID49IDApIHtcclxuICAgICAgYWxlcnQoJ0VzdGUgZXMgdW4gYWRtaW4gcHJvdGVnaWRvICgnICsgZW1haWxQcmUgKyAnKSB5IG5vIHNlIHB1ZWRlIGVsaW1pbmFyLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoX2UpIHtcclxuICAgIC8qIHNpIGZhbGxhIGxhIGxlY3R1cmEgcHJldmlhLCBzaWd1ZSBjb24gY29uZmlybSAqL1xyXG4gIH1cclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ0VsaW1pbmFyIGFjY2VzbyBkZSBlc3RlIHVzdWFyaW8/XFxuXFxuUGllcmRlIGFjY2VzbyBkZSBpbm1lZGlhdG8uIFNpIHZ1ZWx2ZSBhIGVudHJhciBjb24gR29vZ2xlIHZhIGEgcXVlZGFyIGNvbW8gXCJzaW4gcm9sIGFzaWduYWRvXCIgaGFzdGEgcXVlIHZvcyBsbyBoYWJpbGl0ZXMgZGUgbnVldm8uXFxuXFxuU3UgY3VlbnRhIEdvb2dsZSBzaWd1ZSBleGlzdGllbmRvLCBubyBzZSBib3JyYS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xyXG4gICAgY29uc3QgZGF0YSA9IHNuYXAuZXhpc3RzID8gc25hcC5kYXRhKCkgOiB7fTtcclxuICAgIGxvZ09wKCdlbGltaW5hcl91c3VhcmlvJywgJ3VzZXInLCBkYXRhLmVtYWlsIHx8IHVpZCwge1xyXG4gICAgICB1aWQsXHJcbiAgICAgIHByZXZpb3VzUm9sZTogZGF0YS5yb2xlLFxyXG4gICAgICBwcmV2aW91c1ZlbmRvcjogZGF0YS52ZW5kb3IsXHJcbiAgICB9KTtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5kZWxldGUoKTtcclxuICAgIHNob3dTeW5jVGFnKCdVc3VhcmlvIGVsaW1pbmFkbycpO1xyXG4gICAgYXdhaXQgb3BlbkFkbWluUGFuZWwoKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVVc2VyUm9sZScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFBhbmVsIGFkbWluOiBzZXR1cCAvIHJlc2V0IGRlIDJGQSBwb3IgdXN1YXJpb1xyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxubGV0IHRvdHBTZXR1cFN0YXRlID0gbnVsbDsgLy8ge3VpZCwgZW1haWwsIHNlY3JldCwgb3RwYXV0aH1cclxuXHJcbndpbmRvdy5vcGVuVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcclxuICBjb25zb2xlLmxvZygnWzJGQV0gb3BlblRvdHBTZXR1cCBjYWxsZWQnLCB7IHVpZCwgZW1haWwsIHVzZXJSb2xlIH0pO1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gZWwgYWRtaW5pc3RyYWRvciBwdWVkZSBjb25maWd1cmFyIDJGQSBwYXJhIG90cm9zIHVzdWFyaW9zLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIXVpZCkge1xyXG4gICAgYWxlcnQoJ0Vycm9yOiBVSUQgZGVsIHVzdWFyaW8gbm8gZGlzcG9uaWJsZS4gUmVjYXJnYSBsYSBwYWdpbmEgeSByZWludGVudGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxuICAvLyBNb2RhbCBleGlzdGU/XHJcbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpO1xyXG4gIGlmICghbW9kYWwpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8gZW4gZWwgRE9NLiBSZWNhcmdhIGxhIHBhZ2luYSAoQ3RybCtTaGlmdCtSKS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgc3VidEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtc3VidCcpO1xyXG4gIGlmIChzdWJ0RWwpIHN1YnRFbC50ZXh0Q29udGVudCA9ICdQYXJhOiAnICsgKGVtYWlsIHx8IHVpZCk7XHJcbiAgLy8gTGVlciBlc3RhZG8gYWN0dWFsXHJcbiAgbGV0IGN1ckVuYWJsZWQgPSBmYWxzZTtcclxuICBsZXQgY3VyU2VjcmV0ID0gbnVsbDtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGlmIChzbmFwLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XHJcbiAgICAgIGN1ckVuYWJsZWQgPSAhIWQudG90cEVuYWJsZWQ7XHJcbiAgICAgIGN1clNlY3JldCA9IGQudG90cFNlY3JldCB8fCBudWxsO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS53YXJuKCdbMkZBXSBkb2Mgcm9sZXMvJyArIHVpZCArICcgbm8gZXhpc3RlJyk7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignWzJGQV0gZXJyb3IgbGV5ZW5kbyByb2xlcy8nICsgdWlkLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGVsIGVzdGFkbyBkZSAyRkEgZGVsIHVzdWFyaW86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcclxuICBpZiAoIWMpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogY29udGVuZWRvciBkZWwgbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8uIFJlY2FyZ2EgbGEgcGFnaW5hLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoY3VyRW5hYmxlZCAmJiBjdXJTZWNyZXQpIHtcclxuICAgIGMuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MtYmcpO2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgJzxiPiYjMTAwMDM7IDJGQSB5YSBlc3RcdTAwRTEgYWN0aXZvPC9iPiBwYXJhIGVzdGUgdXN1YXJpby4nICtcclxuICAgICAgJzxicj48c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4XCI+U2kgbG8gcGVyZGlcdTAwRjMgbyBjYW1iaVx1MDBGMyBkZSBjZWx1bGFyLCBwb2RcdTAwRTlzIGdlbmVyYXJsZSB1bm8gbnVldm8gKGVsIGFudGVyaW9yIHF1ZWRhIGludmFsaWRhZG8pLjwvc3Bhbj4nICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O21hcmdpbi10b3A6MTRweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+JyArXHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgXCInLCdcIiArXHJcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcclxuICAgICAgJ1xcJylcIj5HZW5lcmFyIG51ZXZvIChyZXNldGVhcik8L2J1dHRvbj4nICtcclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiZGlzYWJsZVRvdHAoXFwnJyArXHJcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXHJcbiAgICAgICdcXCcpXCI+RGVzaGFiaWxpdGFyIDJGQTwvYnV0dG9uPicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICB9IGVsc2Uge1xyXG4gICAgYy5pbm5lckhUTUwgPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2VmZjZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMxZTQwYWY7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcclxuICAgICAgJ0VzdGUgdXN1YXJpbyB0b2Rhdlx1MDBFRGEgbm8gdGllbmUgMkZBIGNvbmZpZ3VyYWRvLiBHZW5lclx1MDBFMSB1biBudWV2byBjXHUwMEYzZGlnbyBwYXJhIHF1ZSBsbyBlc2NhbmVlIGNvbiBHb29nbGUgQXV0aGVudGljYXRvci4nICtcclxuICAgICAgJzwvZGl2PicgK1xyXG4gICAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi10b3A6MTRweFwiPicgK1xyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXHJcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXHJcbiAgICAgIFwiJywnXCIgK1xyXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXHJcbiAgICAgICdcXCcpXCI+R2VuZXJhciAyRkE8L2J1dHRvbj4nICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgfVxyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG59O1xyXG53aW5kb3cuY2xvc2VUb3RwU2V0dXBNb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XHJcbn07XHJcblxyXG53aW5kb3cuZ2VuZXJhdGVOZXdUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCBzZWNyZXQgPSB0b3RwR2VuZXJhdGVTZWNyZXQoKTtcclxuICBjb25zdCBvdHBhdXRoID0gdG90cEJ1aWxkT3RwYXV0aFVybChzZWNyZXQsIGVtYWlsIHx8IHVpZCk7XHJcbiAgdG90cFNldHVwU3RhdGUgPSB7IHVpZDogdWlkLCBlbWFpbDogZW1haWwsIHNlY3JldDogc2VjcmV0LCBvdHBhdXRoOiBvdHBhdXRoIH07XHJcbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcclxuICBjLmlubmVySFRNTCA9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6dmFyKC0tY29sb3Itd2FybmluZy1iZyk7Ym9yZGVyOjFweCBzb2xpZCAjZmNkMzRkO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjojNzgzNTBmO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xyXG4gICAgJzxiPlBhc29zIHBhcmEgYWN0aXZhcjo8L2I+PGJyPicgK1xyXG4gICAgJzEuIEVsIHVzdWFyaW8gaW5zdGFsYSA8Yj5Hb29nbGUgQXV0aGVudGljYXRvcjwvYj4gZW4gc3UgY2VsdWxhci48YnI+JyArXHJcbiAgICAnMi4gVG9jYSBcIkFncmVnYXJcIiAvIFwiK1wiIGVuIGxhIGFwcC48YnI+JyArXHJcbiAgICAnMy4gRWxpZ2UgXCJFc2NhbmVhciBjXHUwMEYzZGlnbyBRUlwiIHkgZXNjYW5lYSBlbCBjXHUwMEYzZGlnbyBhYmFqbyAobyBwZWdhIGVsIHNlY3JldCBtYW51YWxtZW50ZSkuPGJyPicgK1xyXG4gICAgJzQuIEFwYXJlY2UgdW4gY1x1MDBGM2RpZ28gZGUgNiBkXHUwMEVEZ2l0b3MgZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IuPGJyPicgK1xyXG4gICAgJzUuIExvIGVzY3JpYmUgZW4gZWwgaW5wdXQgZGUgYWJham8gcGFyYSBjb25maXJtYXIgeSBhY3RpdmFyLicgK1xyXG4gICAgJzwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+PGRpdiBpZD1cInRvdHAtcXItY29udGFpbmVyXCIgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtwYWRkaW5nOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweFwiPkdlbmVyYW5kbyBRUi4uLjwvZGl2PjwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1zZWNvbmRhcnkpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4O3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206NHB4XCI+U2VjcmV0IChjYXJnYSBtYW51YWwgc2kgZWwgUVIgZmFsbGEpPC9kaXY+JyArXHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTNweDtmb250LXdlaWdodDo4MDA7Y29sb3I6dmFyKC0tY29sb3ItYWNjZW50LXZpb2xldCk7d29yZC1icmVhazpicmVhay1hbGw7bGV0dGVyLXNwYWNpbmc6LjFlbVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbChzZWNyZXQpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTBweFwiPjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjVweFwiPkNcdTAwRjNkaWdvIGRlIHZlcmlmaWNhY2lcdTAwRjNuIGRlIEdvb2dsZSBBdXRoZW50aWNhdG9yPC9sYWJlbD4nICtcclxuICAgICc8aW5wdXQgdHlwZT1cInRleHRcIiBpZD1cInRvdHAtY29uZmlybS1pbnB1dFwiIGlucHV0bW9kZT1cIm51bWVyaWNcIiBtYXhsZW5ndGg9XCI3XCIgcGxhY2Vob2xkZXI9XCIwMDAwMDBcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzoxMHB4IDEycHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MThweDt0ZXh0LWFsaWduOmNlbnRlcjtsZXR0ZXItc3BhY2luZzouM2VtO2ZvbnQtd2VpZ2h0OjgwMFwiLz48L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImNvbmZpcm1Ub3RwU2V0dXAoKVwiPlZlcmlmaWNhciB5IGFjdGl2YXI8L2J1dHRvbj4nICtcclxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImNsb3NlVG90cFNldHVwTW9kYWwoKVwiPkNhbmNlbGFyPC9idXR0b24+PC9kaXY+JztcclxuICAvLyBMYXp5LWxvYWQgcXJjb2RlanMgeSBnZW5lcmFyLiBFc3RhIGxpYnJlcmlhIHBpbnRhIGVsIFFSIGRpcmVjdG8gZW4gZWxcclxuICAvLyBjb250ZW5lZG9yIERPTSB2aWEgY2FudmFzL2ltZyAtIG5vIG5lY2VzaXRhIGNhbGxiYWNrIHRvRGF0YVVSTC5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgbG9hZFFSQ29kZUxpYigpO1xyXG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XHJcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xyXG4gICAgYm94LmlubmVySFRNTCA9ICcnOyAvLyBsaW1waWFyIGVsIFwiR2VuZXJhbmRvIFFSLi4uXCJcclxuICAgIG5ldyBRUkNvZGUoYm94LCB7XHJcbiAgICAgIHRleHQ6IG90cGF1dGgsXHJcbiAgICAgIHdpZHRoOiAyMjAsXHJcbiAgICAgIGhlaWdodDogMjIwLFxyXG4gICAgICBjb2xvckRhcms6ICcjMDAwMDAwJyxcclxuICAgICAgY29sb3JMaWdodDogJyNmZmZmZmYnLFxyXG4gICAgICBjb3JyZWN0TGV2ZWw6IFFSQ29kZS5Db3JyZWN0TGV2ZWwuTSxcclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignWzJGQV0gRXJyb3IgY2FyZ2FuZG8gUVIgbGliOicsIGUpO1xyXG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XHJcbiAgICBpZiAoYm94KVxyXG4gICAgICBib3guaW5uZXJIVE1MID1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlci1zdHJvbmcpO3BhZGRpbmc6MTRweFwiPk5vIHNlIHB1ZG8gY2FyZ2FyIGxhIGxpYnJlclx1MDBFRGEgUVIuIFVzYSBlbCBzZWNyZXQgbWFudWFsIHBhcmEgY29uZmlndXJhci48L2Rpdj4nO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jb25maXJtVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICghdG90cFNldHVwU3RhdGUpIHJldHVybjtcclxuICBjb25zdCBjb2RlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLWNvbmZpcm0taW5wdXQnKS52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxzKy9nLCAnJyk7XHJcbiAgaWYgKCEvXlxcZHs2fSQvLnRlc3QoY29kZSkpIHtcclxuICAgIGFsZXJ0KCdJbmdyZXNcdTAwRTEgbG9zIDYgZFx1MDBFRGdpdG9zLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBvayA9IGF3YWl0IHRvdHBWZXJpZnlDb2RlKHRvdHBTZXR1cFN0YXRlLnNlY3JldCwgY29kZSwgMSk7XHJcbiAgaWYgKCFvaykge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdDXHUwMEYzZGlnbyBpbmNvcnJlY3RvLiBBc2VndXJhdGUgZGUgcXVlIGVsIHNlY3JldCBzZSBjYXJnXHUwMEYzIGJpZW4gZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IgeSByZWludGVudFx1MDBFMS4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxyXG4gICAgICAuZG9jKHRvdHBTZXR1cFN0YXRlLnVpZClcclxuICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgdG90cFNlY3JldDogdG90cFNldHVwU3RhdGUuc2VjcmV0LFxyXG4gICAgICAgIHRvdHBFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIHRvdHBFbmFibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgIHRvdHBFbmFibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICB9KTtcclxuICAgIHNob3dTeW5jVGFnKCcyRkEgYWN0aXZhZG8gcGFyYSAnICsgKHRvdHBTZXR1cFN0YXRlLmVtYWlsIHx8ICd1c3VhcmlvJykpO1xyXG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmUgdG90cCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5kaXNhYmxlVG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWNvbmZpcm0oJ0Rlc2hhYmlsaXRhciAyRkEgcGFyYSBlc3RlIHVzdWFyaW8/IFZhIGEgZW50cmFyIHNvbG8gY29uIHBhc3N3b3JkLicpKSByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh1aWQpXHJcbiAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgIHRvdHBFbmFibGVkOiBmYWxzZSxcclxuICAgICAgICB0b3RwU2VjcmV0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5kZWxldGUoKSxcclxuICAgICAgICB0b3RwRGlzYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgdG90cERpc2FibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICB9KTtcclxuICAgIHNob3dTeW5jVGFnKCcyRkEgZGVzaGFiaWxpdGFkbycpO1xyXG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jaGFuZ2VVc2VyUGFzc3dvcmQgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmICghZW1haWwpIHtcclxuICAgIGFsZXJ0KCdFc3RlIHVzdWFyaW8gbm8gdGllbmUgZW1haWwgcmVnaXN0cmFkbyAtIG5vIHNlIHB1ZWRlIHJlc2V0ZWFyLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBjaG9pY2UgPSBwcm9tcHQoXHJcbiAgICAnUmVzZXRlYXIgY29udHJhc2VcdTAwRjFhIGRlICcgK1xyXG4gICAgICBlbWFpbCArXHJcbiAgICAgICdcXG5cXG4nICtcclxuICAgICAgJ0VsZWdpIHVuYSBvcGNpb24gKDEgLyAyKTpcXG5cXG4nICtcclxuICAgICAgJzEpIEVOVklBUiBNQUlMIERFIFJFU0VURU8gKHJlY29tZW5kYWRvKVxcbicgK1xyXG4gICAgICAnICAgTGUgbGxlZ2EgYSAnICtcclxuICAgICAgZW1haWwgK1xyXG4gICAgICAnIHVuIG1haWwgZGUgRmlyZWJhc2UgY29uIHVuIGxpbmsuXFxuJyArXHJcbiAgICAgICcgICBFbCB1c3VhcmlvIGNsaWNrZWEsIHNldGVhIHN1IG51ZXZhIHBhc3N3b3JkIHkgdnVlbHZlIGEgbGEgYXBwLlxcbicgK1xyXG4gICAgICAnICAgRXMgbG8gZXN0YW5kYXIgeSBmdW5jaW9uYSBzZWd1cm8uXFxuXFxuJyArXHJcbiAgICAgICcyKSBSZXNldGVhciBTT0xPIGVsIHBhc3N3b3JkLWdhdGUgKHNlZ3VuZGEgY2FwYSkuXFxuJyArXHJcbiAgICAgICcgICBObyBjYW1iaWEgbGEgcGFzc3dvcmQgcmVhbCBkZSBGaXJlYmFzZS4gU2lydmUgc2kgZWwgdXN1YXJpb1xcbicgK1xyXG4gICAgICAnICAgZW50cmEgcG9yIEdvb2dsZSB5IG9sdmlkbyBsYSBwYXNzd29yZC1nYXRlIGRlIGxhIGFwcCwgTk8gc2lcXG4nICtcclxuICAgICAgJyAgIG9sdmlkbyBsYSBwYXNzd29yZCBkZWwgbG9naW4gY29uIGVtYWlsLlxcblxcbicgK1xyXG4gICAgICAnRXNjcmliaSAxIG8gMjonLFxyXG4gICAgJzEnXHJcbiAgKTtcclxuICBpZiAoY2hvaWNlID09PSBudWxsKSByZXR1cm47XHJcbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcxJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZmJBdXRoLnNlbmRQYXNzd29yZFJlc2V0RW1haWwoZW1haWwpO1xyXG4gICAgICBhbGVydChcclxuICAgICAgICAnT0sgLSBsZSBlbnZpZSB1biBtYWlsIGRlIHJlc2V0ZW8gYSAnICtcclxuICAgICAgICAgIGVtYWlsICtcclxuICAgICAgICAgICcuIERlY2lsZSBxdWUgcmV2aXNlIGluYm94IHkgc3BhbS4gRWwgbGluayBleHBpcmEgZW4gMSBob3JhLidcclxuICAgICAgKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBmYkRiXHJcbiAgICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxyXG4gICAgICAgICAgLmRvYyh1aWQpXHJcbiAgICAgICAgICAudXBkYXRlKHtcclxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgICAgIHBhc3N3b3JkUmVzZXRNZXRob2Q6ICdmaXJlYmFzZV9lbWFpbCcsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ3NlbmRQYXNzd29yZFJlc2V0RW1haWwnLCBlKTtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGVudmlhbmRvIGVsIG1haWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIH1cclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGNob2ljZS50cmltKCkgPT09ICcyJykge1xyXG4gICAgY29uc3QgbmV3UHdkID0gcHJvbXB0KFxyXG4gICAgICAnTnVldmEgcGFzc3dvcmQtZ2F0ZSBwYXJhICcgK1xyXG4gICAgICAgIGVtYWlsICtcclxuICAgICAgICAnOlxcblxcbihTb2xvIGFmZWN0YSBsYSBzZWd1bmRhIGNhcGEgZGUgbGEgYXBwLCBOTyBlbCBsb2dpbiBjb24gZW1haWwpJyxcclxuICAgICAgJydcclxuICAgICk7XHJcbiAgICBpZiAobmV3UHdkID09PSBudWxsKSByZXR1cm47XHJcbiAgICBjb25zdCBwd2QgPSAobmV3UHdkIHx8ICcnKS50cmltKCk7XHJcbiAgICBpZiAocHdkLmxlbmd0aCA8IDQpIHtcclxuICAgICAgYWxlcnQoJ0xhIGNvbnRyYXNlXHUwMEYxYSB0aWVuZSBxdWUgdGVuZXIgYWwgbWVub3MgNCBjYXJhY3RlcmVzLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjcmVkcyA9IGF3YWl0IGJ1aWxkUGFzc3dvcmRDcmVkZW50aWFscyhwd2QpO1xyXG4gICAgICBhd2FpdCBmYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgICAuZG9jKHVpZClcclxuICAgICAgICAudXBkYXRlKHtcclxuICAgICAgICAgIHBhc3N3b3JkSGFzaDogY3JlZHMucGFzc3dvcmRIYXNoLFxyXG4gICAgICAgICAgcGFzc3dvcmRTYWx0OiBjcmVkcy5wYXNzd29yZFNhbHQsXHJcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZ2F0ZV9vbmx5JyxcclxuICAgICAgICB9KTtcclxuICAgICAgc2hvd1N5bmNUYWcoJ1Bhc3N3b3JkLWdhdGUgYWN0dWFsaXphZGEgcGFyYSAnICsgZW1haWwpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdjaGFuZ2VVc2VyUGFzc3dvcmQgZ2F0ZScsIGUpO1xyXG4gICAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGFsZXJ0KCdPcGNpb24gbm8gdmFsaWRhLiBDYW5jZWxhZG8uJyk7XHJcbn07XHJcblxyXG53aW5kb3cuc2F2ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgYnRuKSB7XHJcbiAgY29uc3QgY29udGFpbmVyID0gYnRuLmNsb3Nlc3QoJ3RyJykgfHwgYnRuLmNsb3Nlc3QoJy51c2Vycy1jYXJkJyk7XHJcbiAgaWYgKCFjb250YWluZXIpIHJldHVybjtcclxuICBjb25zdCByb2xlID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yb2xlLXNlbCcpLnZhbHVlO1xyXG4gIGNvbnN0IHZlbmRvciA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcudmVuZG9yLXNlbCcpLnZhbHVlIHx8IG51bGw7XHJcbiAgY29uc3QgaW50ZXJuYWxTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLmludGVybmFsLXNlbCcpO1xyXG4gIGNvbnN0IGludGVybmFsUGFydG5lclVpZCA9IGludGVybmFsU2VsID8gaW50ZXJuYWxTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XHJcbiAgLy8gV2hhdHNBcHA6IGxpbXBpYXIgdG9kbyBsbyBxdWUgbm8gc2VhIGRpZ2l0byAoYWNlcHRhICssIGVzcGFjaW9zLCBwYXJcdTAwRTludGVzaXMsIGV0Yy4pXHJcbiAgY29uc3Qgd2FJbnB1dCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcud2EtaW5wdXQnKTtcclxuICBjb25zdCB3aGF0c2FwcCA9IHdhSW5wdXQgPyAod2FJbnB1dC52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxEL2csICcnKSA6ICcnO1xyXG4gIGlmICh3aGF0c2FwcCAmJiB3aGF0c2FwcC5sZW5ndGggPCA4KSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ0VsIG51bWVybyBkZSBXaGF0c0FwcCBlcyBtdXkgY29ydG8uIFRpZW5lIHF1ZSBzZXIgZWwgbnVtZXJvIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoZWouIDU0OTExMjY3NjIwMzEgcGFyYSBBcmdlbnRpbmEpLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIFJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzICh1aWQgZGVsIHVzdWFyaW8gcXVlIGFwcnVlYmEpXHJcbiAgY29uc3QgcmVuZEFwcHJvdmVyU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yZW5kLWFwcHJvdmVyLXNlbCcpO1xyXG4gIGNvbnN0IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kQXBwcm92ZXJTZWwgPyByZW5kQXBwcm92ZXJTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XHJcbiAgLy8gQ2FjaGVhciB0YW1iaWVuIGVsIGVtYWlsIGRlbCBhcHJvYmFkb3IgZW4gZWwgZG9jIGRlbCB2ZW5kZWRvcjogbG9zXHJcbiAgLy8gdmVuZGVkb3JlcyBubyBwdWVkZW4gbGVlciAvcm9sZXMve290cm9VaWR9IHBvciBzZWN1cml0eSBydWxlcywgYXNpIHF1ZVxyXG4gIC8vIG5lY2VzaXRhbiBlbCBlbWFpbCBhY2EgcGFyYSBwb2RlciBtYW5kYXIgbGEgcmVuZGljaW9uIChyZXNvbHZlTXlSZW5kaWNpb25lc0FwcHJvdmVyXHJcbiAgLy8gbG8gdXNhIGNvbW8gcHJpbWVyIGZhc3QtcGF0aCkuIFNpbiBlc3RvIGVsIGZsdWpvIGRlcGVuZGlhIGRlbCBkaXJlY3RvcmlvXHJcbiAgLy8gcHVibGljbyAodXNlcnNfZGlyZWN0b3J5KSBxdWUgc29sbyBzZSBzaW5jcm9uaXphIGN1YW5kbyBhZG1pbiBhYnJlIGVsIHBhbmVsLlxyXG4gIGxldCByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBudWxsO1xyXG4gIGlmIChyZW5kaWNpb25lc0FwcHJvdmVyVWlkKSB7XHJcbiAgICBjb25zdCBhcHByb3ZlclVzZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSByZW5kaWNpb25lc0FwcHJvdmVyVWlkKTtcclxuICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IGFwcHJvdmVyVXNlciA/IGFwcHJvdmVyVXNlci5lbWFpbCB8fCBudWxsIDogbnVsbDtcclxuICB9XHJcbiAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICBidG4udGV4dENvbnRlbnQgPSAnLi4uJztcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxyXG4gICAgICAuZG9jKHVpZClcclxuICAgICAgLnNldChcclxuICAgICAgICB7XHJcbiAgICAgICAgICByb2xlLFxyXG4gICAgICAgICAgdmVuZG9yLFxyXG4gICAgICAgICAgaW50ZXJuYWxQYXJ0bmVyVWlkLFxyXG4gICAgICAgICAgd2hhdHNhcHA6IHdoYXRzYXBwIHx8IG51bGwsXHJcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyVWlkOiByZW5kaWNpb25lc0FwcHJvdmVyVWlkLFxyXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwsXHJcbiAgICAgICAgICBhc3NpZ25lZEJ5OiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICBhc3NpZ25lZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxyXG4gICAgICApO1xyXG4gICAgLy8gU2kgZWwgdXN1YXJpbyBlZGl0byBzdSBwcm9waW8gbnVtZXJvLCBhY3R1YWxpemFyIGVsIGNhY2hlIGxvY2FsXHJcbiAgICBpZiAodWlkID09PSBjdXJyZW50VXNlci51aWQpIHtcclxuICAgICAgbXlXaGF0c2FwcE51bWJlciA9IHdoYXRzYXBwIHx8IG51bGw7XHJcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgbnVsbDtcclxuICAgICAgbXlSZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgfHwgbnVsbDtcclxuICAgIH1cclxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdPSyc7XHJcbiAgICAvLyBSZS1yZW5kZXIgZGVsIHBhbmVsIGFzaSBsb3MgZHJvcGRvd25zIFwiUGFyZWphIGludGVybm9cIiBtdWVzdHJhbiBsb3MgaW50ZXJub3MgYWN0dWFsaXphZG9zXHJcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBvcGVuQWRtaW5QYW5lbCgpO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcigncmVmcmVzaCBhZG1pbiBwYW5lbCcsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9LCA0MDApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmVVc2VyUm9sZScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhcic7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gVG9kb3MgbG9zIGhhbmRsZXJzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBzb24gdmVyYmF0aW0uXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXVCQSxNQUFJLE9BQU8sT0FBTyxlQUFlLFlBQWEsUUFBTyxhQUFhLENBQUM7QUFDbkUsTUFBTSxhQUFhLE9BQU87QUFFMUIsV0FBUywyQkFBMkIsYUFBYTtBQUMvQyxVQUFNLEtBQUssU0FBUyxlQUFlLHdCQUF3QjtBQUMzRCxRQUFJLENBQUMsR0FBSTtBQUNULG1CQUFlLGVBQWUsQ0FBQyxHQUM1QixNQUFNLEVBQ04sS0FBSyxDQUFDLEdBQUcsT0FBTyxFQUFFLFNBQVMsSUFBSSxjQUFjLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFDOUQsUUFBSSxPQUFPO0FBQ1gsWUFBUTtBQUNSLFlBQ0U7QUFDRixZQUFRO0FBQ1IsUUFBSSxDQUFDLFlBQVksUUFBUTtBQUN2QixjQUNFO0FBQUEsSUFDSixPQUFPO0FBQ0wsY0FDRTtBQUNGLGtCQUFZLFFBQVEsQ0FBQyxPQUFPO0FBQzFCLGNBQU0sUUFBUSxXQUFXLEdBQUcsU0FBUyxHQUFHLEdBQUc7QUFDM0MsY0FBTSxPQUFPLEdBQUcsT0FBTyxlQUFlLFdBQVcsR0FBRyxJQUFJLElBQUk7QUFDNUQsZ0JBQ0UsaU5BQ0EsUUFDQSxPQUNBLDBDQUNBLFdBQVcsR0FBRyxHQUFHLElBQ2pCO0FBQUEsTUFFSixDQUFDO0FBQ0QsY0FBUTtBQUFBLElBQ1Y7QUFDQSxZQUNFO0FBQ0YsT0FBRyxZQUFZO0FBQUEsRUFDakI7QUFFQSxTQUFPLGtCQUFrQixpQkFBa0I7QUFDekMsUUFBSSxhQUFhLFFBQVM7QUFDMUIsVUFBTSxNQUFNLE9BQU8sdURBQXVEO0FBQzFFLFFBQUksQ0FBQyxJQUFLO0FBQ1YsVUFBTSxRQUFRLElBQUksWUFBWSxFQUFFLEtBQUs7QUFDckMsUUFBSSxDQUFDLDZCQUE2QixLQUFLLEtBQUssR0FBRztBQUM3QyxZQUFNLDRCQUE0QjtBQUNsQztBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQ0osT0FBTyw4RUFBOEUsRUFBRSxLQUFLO0FBQzlGLFVBQU0sUUFBUSxhQUFhLEtBQUs7QUFDaEMsUUFBSTtBQUNGLFlBQU0sS0FDSCxXQUFXLGdCQUFnQixFQUMzQixJQUFJLEtBQUssRUFDVDtBQUFBLFFBQ0M7QUFBQSxVQUNFO0FBQUEsVUFDQSxNQUFNLEtBQUssS0FBSztBQUFBLFVBQ2hCLFNBQVMsWUFBWSxTQUFTO0FBQUEsVUFDOUIsWUFBWSxZQUFZO0FBQUEsVUFDeEIsU0FBUyxTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxRQUN6RDtBQUFBLFFBQ0EsRUFBRSxPQUFPLEtBQUs7QUFBQSxNQUNoQjtBQUNGLGtCQUFZLHVCQUF1QixLQUFLO0FBRXhDLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sbUJBQW1CLENBQUM7QUFDbEMsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBRUEsU0FBTyxxQkFBcUIsZUFBZ0IsT0FBTztBQUNqRCxRQUFJLGFBQWEsUUFBUztBQUMxQixRQUNFLENBQUM7QUFBQSxNQUNDO0FBQUEsSUFDRjtBQUVBO0FBQ0YsUUFBSTtBQUNGLFlBQU0sS0FBSyxXQUFXLGdCQUFnQixFQUFFLElBQUksS0FBSyxFQUFFLE9BQU87QUFDMUQsa0JBQVksc0JBQXNCO0FBQ2xDLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sc0JBQXNCLENBQUM7QUFDckMsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBR0EsV0FBUywwQkFBMEIsT0FBTztBQUN4QyxVQUFNLEtBQUssU0FBUyxlQUFlLHVCQUF1QjtBQUMxRCxRQUFJLENBQUMsR0FBSTtBQUtULE9BQUcsY0FBYztBQUNqQixVQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsU0FBSyxNQUFNLFVBQ1Q7QUFDRixVQUFNLFFBQVEsU0FBUyxjQUFjLEtBQUs7QUFDMUMsVUFBTSxNQUFNLFVBQ1Y7QUFDRixVQUFNLGNBQWM7QUFDcEIsVUFBTSxNQUFNLFNBQVMsY0FBYyxLQUFLO0FBQ3hDLFFBQUksTUFBTSxVQUFVO0FBRXBCLFFBQUksY0FBYztBQUNsQixTQUFLLFlBQVksS0FBSztBQUN0QixTQUFLLFlBQVksR0FBRztBQUNwQixPQUFHLFlBQVksSUFBSTtBQUFBLEVBQ3JCO0FBWUEsTUFBSSxtQkFBbUI7QUFpQnZCLFdBQVMseUJBQXlCLE1BQU07QUFDdEMsVUFBTSxLQUFLLFNBQVMsZUFBZSxzQkFBc0I7QUFDekQsUUFBSSxDQUFDLEdBQUk7QUFDVCxVQUFNLFNBQVMsUUFBUSxLQUFLO0FBQzVCLFVBQU0sU0FBUyxTQUFTLEtBQUssT0FBTyxNQUFNLEdBQUcsQ0FBQyxJQUFJLGlFQUFlLEtBQUssT0FBTyxNQUFNLEVBQUUsSUFBSTtBQUN6RixVQUFNLFlBQWEsUUFBUSxLQUFLLGFBQWM7QUFDOUMsVUFBTSxZQUNKLFFBQVEsS0FBSyxhQUFhLEtBQUssVUFBVSxTQUNyQyxLQUFLLFVBQVUsT0FBTyxFQUFFLGVBQWUsT0FBTyxJQUM5QztBQUNOLFFBQUksT0FBTztBQUNYLFlBQ0U7QUFDRixZQUNFO0FBQ0YsWUFBUTtBQUNSLFFBQUksUUFBUTtBQUNWLGNBQ0U7QUFDRixjQUNFLHdLQUNBLFdBQVcsTUFBTSxJQUNqQjtBQUNGLGNBQ0Usc0VBQ0EsV0FBVyxhQUFhLE9BQU8sS0FDOUIsWUFBWSxPQUFPLFdBQVcsU0FBUyxJQUFJLE1BQU0sTUFDbEQ7QUFDRixjQUFRO0FBQUEsSUFDVixPQUFPO0FBQ0wsY0FDRTtBQUFBLElBQ0o7QUFDQSxZQUFRO0FBQ1IsWUFDRSx1R0FDQyxTQUFTLGdCQUFnQixnQkFDMUI7QUFDRixRQUFJO0FBQ0YsY0FDRTtBQUNKLFlBQVE7QUFDUixPQUFHLFlBQVk7QUFBQSxFQUNqQjtBQUNBLFNBQU8sa0JBQWtCLGlCQUFrQjtBQUN6QyxRQUFJLGFBQWEsUUFBUztBQUMxQixVQUFNLE1BQU07QUFBQSxNQUNWO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFDQSxRQUFJLFFBQVEsS0FBTTtBQUNsQixVQUFNLE1BQU0sSUFBSSxLQUFLO0FBQ3JCLFFBQUksQ0FBQyxLQUFLO0FBQ1IsWUFBTSxRQUFRO0FBQ2Q7QUFBQSxJQUNGO0FBQ0EsUUFBSSxJQUFJLFNBQVMsSUFBSTtBQUNuQixZQUFNLDBEQUEwRDtBQUNoRTtBQUFBLElBQ0Y7QUFDQSxRQUFJO0FBQ0YsWUFBTSxLQUNILFdBQVcsWUFBWSxFQUN2QixJQUFJLGFBQWEsRUFDakI7QUFBQSxRQUNDO0FBQUEsVUFDRSxRQUFRO0FBQUEsVUFDUixXQUFXLFlBQVksU0FBUztBQUFBLFVBQ2hDLGNBQWMsWUFBWTtBQUFBLFVBQzFCLFdBQVcsU0FBUyxVQUFVLFdBQVcsZ0JBQWdCO0FBQUEsUUFDM0Q7QUFBQSxRQUNBLEVBQUUsT0FBTyxLQUFLO0FBQUEsTUFDaEI7QUFDRix5QkFBbUI7QUFDbkIsa0JBQVksOEJBQThCO0FBQzFDLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sbUJBQW1CLENBQUM7QUFDbEMsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBQ0EsU0FBTyxvQkFBb0IsaUJBQWtCO0FBQzNDLFFBQUksYUFBYSxRQUFTO0FBQzFCLFFBQ0UsQ0FBQztBQUFBLE1BQ0M7QUFBQSxJQUNGO0FBRUE7QUFDRixRQUFJO0FBQ0YsWUFBTSxLQUFLLFdBQVcsWUFBWSxFQUFFLElBQUksYUFBYSxFQUFFLE9BQU87QUFDOUQseUJBQW1CO0FBQ25CLGtCQUFZLDZCQUE2QjtBQUN6QyxVQUFJO0FBQ0YsdUJBQWU7QUFBQSxNQUNqQixTQUFTLElBQUk7QUFBQSxNQUFDO0FBQUEsSUFDaEIsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLHFCQUFxQixDQUFDO0FBQ3BDLFlBQU0sYUFBYSxFQUFFLFdBQVcsRUFBRTtBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQVNBLFdBQVMsNEJBQTRCO0FBQ25DLFVBQU0sS0FBSyxTQUFTLGVBQWUsdUJBQXVCO0FBQzFELFFBQUksQ0FBQyxHQUFJO0FBQ1QsVUFBTSxjQUFjLGNBQWMsQ0FBQyxHQUFHO0FBQUEsTUFDcEMsQ0FBQyxNQUFNLEVBQUUsU0FBUyxXQUFXLEVBQUUsU0FBUyxhQUFhLEVBQUUsU0FBUztBQUFBLElBQ2xFO0FBQ0EsVUFBTSxjQUFjLGNBQWMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxVQUFVO0FBQ3pFLFFBQUksT0FBTztBQUNYLFlBQ0U7QUFDRixZQUNFO0FBQ0YsWUFBUTtBQUNSLFFBQUksQ0FBQyxXQUFXLFFBQVE7QUFDdEIsY0FDRTtBQUNGLFNBQUcsWUFBWTtBQUNmO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxXQUFXLFFBQVE7QUFDdEIsY0FDRTtBQUNGLFNBQUcsWUFBWTtBQUNmO0FBQUEsSUFDRjtBQUNBLFlBQ0U7QUFDRixZQUNFO0FBQ0YsWUFBUTtBQUNSLGVBQVcsUUFBUSxDQUFDLE1BQU07QUFDeEIsWUFBTSxPQUFPLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxRQUFRLE9BQU8sRUFBRSxPQUFPO0FBQ25FLGNBQVEsb0JBQW9CLFdBQVcsRUFBRSxJQUFJLElBQUksT0FBTyxXQUFXLEdBQUcsSUFBSTtBQUFBLElBQzVFLENBQUM7QUFDRCxZQUFRO0FBQ1IsWUFDRSxnSEFDQSxXQUFXLFNBQ1g7QUFDRixZQUFRO0FBQ1IsT0FBRyxZQUFZO0FBQUEsRUFDakI7QUFDQSxTQUFPLHFCQUFxQixpQkFBa0I7QUFDNUMsUUFBSSxhQUFhLFNBQVM7QUFDeEIsWUFBTSxhQUFhO0FBQ25CO0FBQUEsSUFDRjtBQUNBLFVBQU0sTUFBTSxTQUFTLGVBQWUsc0JBQXNCO0FBQzFELFVBQU0sTUFBTSxPQUFPLElBQUk7QUFDdkIsUUFBSSxDQUFDLEtBQUs7QUFDUixZQUFNLHlDQUF5QztBQUMvQztBQUFBLElBQ0Y7QUFDQSxVQUFNLFlBQVksY0FBYyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxTQUFTLEdBQUc7QUFDOUQsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLDBCQUEwQjtBQUNoQztBQUFBLElBQ0Y7QUFDQSxVQUFNLGNBQWMsY0FBYyxDQUFDLEdBQUcsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLFVBQVU7QUFDekUsUUFBSSxDQUFDLFdBQVcsUUFBUTtBQUN0QixZQUFNLGlDQUFpQztBQUN2QztBQUFBLElBQ0Y7QUFDQSxVQUFNLGdCQUFnQixTQUFTLGVBQWUsU0FBUyxTQUFTLFNBQVM7QUFDekUsUUFDRSxDQUFDO0FBQUEsTUFDQyxlQUNFLGdCQUNBLDRCQUNBLFdBQVcsU0FDWDtBQUFBLElBQ0o7QUFFQTtBQUNGLFFBQUksVUFBVSxHQUNaLFlBQVk7QUFFZCxVQUFNLFFBQVEsS0FBSyxNQUFNO0FBQ3pCLGVBQVcsUUFBUSxDQUFDLE1BQU07QUFDeEIsWUFBTSxNQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUk7QUFDL0MsWUFBTSxPQUFPLEtBQUs7QUFBQSxRQUNoQix3QkFBd0I7QUFBQSxRQUN4QiwwQkFBMEIsU0FBUyxTQUFTO0FBQUEsUUFDNUMsOEJBQThCLFNBQVMsVUFBVSxXQUFXLGdCQUFnQjtBQUFBLFFBQzVFLDhCQUE4QixZQUFZLFNBQVM7QUFBQSxNQUNyRCxDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQ0QsUUFBSTtBQUNGLFlBQU0sTUFBTSxPQUFPO0FBQ25CLGdCQUFVLFdBQVc7QUFDckIsVUFBSSxPQUFPLFVBQVUsWUFBWTtBQUMvQixjQUFNLHdCQUF3QixTQUFTLGVBQWU7QUFBQSxVQUNwRCxhQUFhO0FBQUEsVUFDYixlQUFlLFNBQVMsU0FBUztBQUFBLFVBQ2pDLGVBQWUsV0FBVztBQUFBLFVBQzFCLGNBQWMsV0FBVyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUk7QUFBQSxRQUM1QyxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0YsU0FBUyxHQUFHO0FBQ1YsY0FBUSxNQUFNLHNCQUFzQixDQUFDO0FBQ3JDLGtCQUFZLFdBQVc7QUFDdkIsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFDQSxRQUFJLFNBQVM7QUFDWCxrQkFBWSxVQUFVLGlDQUFpQyxhQUFhO0FBQ3BFLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQjtBQUFBLEVBQ0Y7QUE4RUEsU0FBTyxpQkFBaUIsaUJBQWtCO0FBQ3hDLFFBQUksYUFBYSxRQUFTO0FBQzFCLGFBQVMsZUFBZSxhQUFhLEVBQUUsVUFBVSxJQUFJLE1BQU07QUFFM0QsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLEtBQUssV0FBVyxnQkFBZ0IsRUFBRSxJQUFJO0FBQ3pELFlBQU0sY0FBYyxDQUFDO0FBQ3JCLFdBQUssUUFBUSxDQUFDLE1BQU07QUFDbEIsb0JBQVksS0FBSyxPQUFPLE9BQU8sRUFBRSxLQUFLLEVBQUUsR0FBRyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFBQSxNQUN6RCxDQUFDO0FBQ0QsaUNBQTJCLFdBQVc7QUFBQSxJQUN4QyxTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssdUJBQXVCLENBQUM7QUFBQSxJQUN2QztBQUVBLFFBQUk7QUFDRixZQUFNLFFBQVEsTUFBTSxLQUFLLFdBQVcsWUFBWSxFQUFFLElBQUksUUFBUSxFQUFFLElBQUk7QUFDcEUsZ0NBQTBCLE1BQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxJQUFJO0FBQUEsSUFDOUQsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLHNCQUFzQixDQUFDO0FBQ3BDLGdDQUEwQixJQUFJO0FBQUEsSUFDaEM7QUFFQSxRQUFJO0FBQ0YsWUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXLFlBQVksRUFBRSxJQUFJLGFBQWEsRUFBRSxJQUFJO0FBQzFFLCtCQUF5QixPQUFPLFNBQVMsT0FBTyxLQUFLLElBQUksSUFBSTtBQUFBLElBQy9ELFNBQVMsR0FBRztBQUNWLGNBQVEsS0FBSyxxQkFBcUIsQ0FBQztBQUNuQywrQkFBeUIsSUFBSTtBQUFBLElBQy9CO0FBQ0EsUUFBSTtBQUNGLFlBQU0sS0FBSyxNQUFNLEtBQUssV0FBVyxPQUFPLEVBQUUsUUFBUSxPQUFPLEVBQUUsSUFBSTtBQUUvRCxpQkFBVyxTQUFTO0FBQ3BCLFNBQUcsUUFBUSxDQUFDLFFBQVE7QUFDbEIsbUJBQVcsS0FBSyxPQUFPLE9BQU8sRUFBRSxNQUFNLElBQUksR0FBRyxHQUFHLElBQUksS0FBSyxDQUFDLENBQUM7QUFBQSxNQUM3RCxDQUFDO0FBRUQsVUFBSTtBQUNGLGtDQUEwQjtBQUFBLE1BQzVCLFNBQVMsR0FBRztBQUNWLGdCQUFRLEtBQUsseUJBQXlCLENBQUM7QUFBQSxNQUN6QztBQUlBLFVBQUk7QUFDRiwyQkFBbUI7QUFBQSxNQUNyQixTQUFTLEdBQUc7QUFDVixnQkFBUSxLQUFLLHNCQUFzQixDQUFDO0FBQUEsTUFDdEM7QUFFQSxZQUFNLFdBQVcsV0FBVyxPQUFPLENBQUMsTUFBTSxFQUFFLFNBQVMsU0FBUztBQUM5RCxZQUFNLGVBQ0osNkNBQ0EsU0FDRztBQUFBLFFBQ0MsQ0FBQyxNQUNDLG9CQUNBLEVBQUUsT0FDRixPQUNBLFdBQVcsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLElBQUksSUFDN0M7QUFBQSxNQUNKLEVBQ0MsS0FBSyxFQUFFO0FBRVosWUFBTSxRQUFRLFNBQVMsZUFBZSxrQkFBa0I7QUFDeEQsWUFBTSxVQUFVLFNBQVMsZUFBZSxhQUFhO0FBQ3JELFVBQUksWUFBWTtBQUNoQixVQUFJLFlBQVk7QUFDaEIsVUFBSSxDQUFDLFdBQVcsUUFBUTtBQUN0QixvQkFDRTtBQUNGLG9CQUNFO0FBQUEsTUFDSixPQUFPO0FBSUwsWUFBU0Esc0JBQVQsU0FBNEIsWUFBWTtBQUN0QyxpQkFBTyxXQUFXO0FBQUEsWUFDaEIsQ0FBQyxNQUFNLEVBQUUsU0FBUyxjQUFjLEVBQUUsdUJBQXVCO0FBQUEsVUFDM0Q7QUFBQSxRQUNGO0FBSlMsaUNBQUFBO0FBRlQsY0FBTSx5QkFBeUIsQ0FBQywrQkFBK0IseUJBQXlCO0FBUXhGLGNBQU0sMEJBQTBCLFdBQVc7QUFBQSxVQUN6QyxDQUFDLE1BQU0sRUFBRSxTQUFTLFdBQVcsRUFBRSxTQUFTLGFBQWEsRUFBRSxTQUFTO0FBQUEsUUFDbEU7QUFDQSxtQkFBVyxRQUFRLENBQUMsTUFBTTtBQUN4QixnQkFBTSxRQUFRLEVBQUU7QUFDaEIsZ0JBQU0sU0FBUyxVQUFVLFlBQVk7QUFDckMsZ0JBQU0sY0FBYyx1QkFBdUIsU0FBUyxFQUFFLFNBQVMsSUFBSSxZQUFZLENBQUMsS0FBSztBQUNyRixnQkFBTSxZQUFZLEVBQUUsU0FBUztBQUM3QixnQkFBTSxjQUFjLENBQUMsY0FBYyxTQUFTLFdBQVcsWUFBWSxXQUFXLFFBQVEsRUFDbkY7QUFBQSxZQUNDLENBQUMsTUFDQyxvQkFDQSxJQUNBLE9BQ0MsRUFBRSxTQUFTLElBQUksY0FBYyxPQUM3QixVQUFVLE1BQU0sVUFBVSxjQUFjLE1BQ3pDLE1BQ0EsSUFDQTtBQUFBLFVBQ0osRUFDQyxLQUFLLEVBQUU7QUFDVixnQkFBTSxnQkFDSixnQ0FDQSxRQUFRO0FBQUEsWUFDTixDQUFDLE1BQ0Msb0JBQ0EsRUFBRSxNQUNGLE9BQ0MsRUFBRSxXQUFXLEVBQUUsTUFBTSxjQUFjLE1BQ3BDLE1BQ0EsRUFBRSxPQUNGLE1BQ0EsRUFBRSxNQUNGO0FBQUEsVUFDSixFQUFFLEtBQUssRUFBRTtBQUVYLGNBQUk7QUFDSixjQUFJLFdBQVc7QUFDYixrQkFBTSxPQUFPQSxvQkFBbUIsS0FBSztBQUNyQyxnQkFBSSxLQUFLLFFBQVE7QUFDZixvQkFBTSxPQUFPLEtBQ1YsSUFBSSxDQUFDLE1BQU07QUFDVixzQkFBTSxRQUFRLEVBQUUsY0FBYyxFQUFFLFlBQVksTUFBTSxLQUFLLEVBQUUsQ0FBQyxJQUFJLEVBQUUsU0FBUztBQUN6RSx1QkFDRSxXQUFXLEtBQUssSUFDaEIsNkNBQ0EsV0FBVyxFQUFFLFNBQVMsRUFBRSxJQUN4QjtBQUFBLGNBRUosQ0FBQyxFQUNBLEtBQUssTUFBTTtBQUNkLDJCQUNFLDRQQUNBLE9BQ0E7QUFBQSxZQUNKLE9BQU87QUFDTCwyQkFDRTtBQUFBLFlBQ0o7QUFFQSwwQkFBYztBQUFBLFVBQ2hCLE9BQU87QUFDTCxrQkFBTSxvQkFDSiw2Q0FDQSxTQUNHO0FBQUEsY0FDQyxDQUFDLE1BQ0Msb0JBQ0EsRUFBRSxPQUNGLE9BQ0MsRUFBRSx1QkFBdUIsRUFBRSxPQUFPLGNBQWMsTUFDakQsTUFDQSxXQUFXLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSxJQUFJLElBQzdDO0FBQUEsWUFDSixFQUNDLEtBQUssRUFBRTtBQUNaLHlCQUNFLDZGQUNBLG9CQUNBO0FBQUEsVUFDSjtBQUNBLGdCQUFNLFNBQVMsU0FDWCwrRkFDQTtBQUNKLGdCQUFNLGVBQ0osZUFBZSxDQUFDLFNBQ1osNEpBQ0E7QUFDTixnQkFBTSxRQUFRLEVBQUUsWUFBWTtBQUM1QixnQkFBTSxjQUNKLCtFQUNBLFdBQVcsS0FBSyxJQUNoQjtBQUVGLGdCQUFNLGlCQUFpQixFQUFFLDBCQUEwQjtBQUNuRCxjQUFJLHNCQUFzQjtBQUMxQixrQ0FBd0IsUUFBUSxDQUFDLE1BQU07QUFDckMsZ0JBQUksRUFBRSxTQUFTLE1BQU87QUFDdEIsa0JBQU0sT0FBTyxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsUUFBUSxRQUFRLEVBQUUsUUFBUSxNQUFNO0FBQzNFLG1DQUNFLG9CQUNBLFdBQVcsRUFBRSxJQUFJLElBQ2pCLE9BQ0MsbUJBQW1CLEVBQUUsT0FBTyxjQUFjLE1BQzNDLE1BQ0EsV0FBVyxHQUFHLElBQ2Q7QUFBQSxVQUNKLENBQUM7QUFDRCxnQkFBTSxtQkFDSiw2RkFDQSxzQkFDQTtBQUVGLGdCQUFNLGFBQ0osc0hBQ0EsUUFDQSxRQUNBLEtBQUssVUFBVSxFQUFFLFNBQVMsRUFBRSxFQUFFLFFBQVEsTUFBTSxRQUFRLElBQ3BEO0FBRUYsZ0JBQU0sZ0JBQWdCLEVBQUUsY0FDcEIsaUVBQ0E7QUFDSixnQkFBTSxjQUNKLG9HQUNDLEVBQUUsY0FBYyxZQUFZLGFBQzdCLCtCQUNBLFFBQ0EsUUFDQSxLQUFLLFVBQVUsRUFBRSxTQUFTLEVBQUUsRUFBRSxRQUFRLE1BQU0sUUFBUSxJQUNwRCxxQkFDQSxnQkFDQTtBQUVGLHVCQUFhLG1CQUFtQixRQUFRO0FBQ3hDLHVCQUFhLFNBQVMsV0FBVyxFQUFFLFNBQVMsRUFBRSxJQUFJLFNBQVMsZUFBZTtBQUMxRSx1QkFBYSxTQUFTLFdBQVcsRUFBRSxlQUFlLEVBQUUsSUFBSTtBQUN4RCx1QkFBYSxrQ0FBa0MsY0FBYztBQUM3RCx1QkFBYSxvQ0FBb0MsZ0JBQWdCO0FBQ2pFLHVCQUFhLFNBQVMsYUFBYTtBQUNuQyx1QkFBYSx3QkFBd0IsY0FBYztBQUNuRCx1QkFBYSxTQUFTLG1CQUFtQjtBQUN6Qyx1QkFBYSxTQUFTLGFBQWE7QUFDbkMsdUJBQWEsU0FBUyxjQUFjO0FBQ3BDLGdCQUFNLGFBQWEsQ0FBQyxVQUFVLENBQUM7QUFDL0IsZ0JBQU0sU0FBUyxhQUNYLDBEQUNBLFFBQ0EsMEJBQ0E7QUFDSix1QkFDRSxTQUNBLFNBQ0EscURBQ0EsUUFDQTtBQUNGLHVCQUFhO0FBRWIsdUJBQWEsdUNBQXVDLFFBQVE7QUFDNUQsdUJBQ0UsZ0NBQ0EsV0FBVyxFQUFFLFNBQVMsRUFBRSxJQUN4QixTQUNBLGVBQ0E7QUFDRixjQUFJLEVBQUU7QUFDSix5QkFBYSwwQkFBMEIsV0FBVyxFQUFFLFdBQVcsSUFBSTtBQUNyRSx1QkFBYTtBQUNiLHVCQUNFLG9FQUNBLGNBQ0E7QUFDRix1QkFDRSxvR0FDQSxnQkFDQTtBQUNGLGNBQUksV0FBVztBQUNiLHlCQUNFLG9FQUNBLGFBQ0E7QUFBQSxVQUNKLE9BQU87QUFDTCx5QkFDRSwrRUFDQSxhQUNBO0FBQUEsVUFDSjtBQUNBLHVCQUNFLHdGQUNBLGNBQ0E7QUFDRix1QkFDRSxrRUFDQSxtQkFDQTtBQUNGLHVCQUNFLDhHQUNBLGFBQ0EsY0FDQTtBQUNGLGdCQUFNLFVBQVUsYUFDWiwwREFDQSxRQUNBLDBCQUNBO0FBQ0osdUJBQ0UsNkJBQ0EsVUFDQSxxREFDQSxRQUNBO0FBQ0YsdUJBQWE7QUFBQSxRQUNmLENBQUM7QUFBQSxNQUNIO0FBQ0EsWUFBTSxZQUFZO0FBQ2xCLGNBQVEsWUFBWTtBQUVwQixZQUFNLFFBQVEsU0FBUyxjQUFjLHVCQUF1QjtBQUM1RCxVQUFJO0FBQ0YsY0FBTSxZQUNKO0FBQUEsSUFDTixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sa0JBQWtCLENBQUM7QUFDakMsWUFBTSwrQkFBK0IsRUFBRSxXQUFXLEVBQUU7QUFBQSxJQUN0RDtBQUFBLEVBQ0Y7QUFFQSxTQUFPLGtCQUFrQixXQUFZO0FBQ25DLGFBQVMsZUFBZSxhQUFhLEVBQUUsVUFBVSxPQUFPLE1BQU07QUFBQSxFQUNoRTtBQU1BLFNBQU8saUJBQWlCLGVBQWdCLEtBQUs7QUFDM0MsUUFBSSxhQUFhLFFBQVM7QUFDMUIsUUFBSSxRQUFRLFlBQVksS0FBSztBQUMzQixZQUFNLHFDQUFxQztBQUMzQztBQUFBLElBQ0Y7QUFFQSxRQUFJO0FBQ0YsWUFBTSxVQUFVLE1BQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxJQUFJLEdBQUcsRUFBRSxJQUFJO0FBQzVELFlBQU0sWUFBWSxRQUFRLFNBQVMsUUFBUSxLQUFLLEVBQUUsU0FBUyxLQUFLLElBQUksWUFBWTtBQUNoRixZQUFNLFlBQVksQ0FBQywrQkFBK0IseUJBQXlCO0FBQzNFLFVBQUksVUFBVSxRQUFRLFFBQVEsS0FBSyxHQUFHO0FBQ3BDLGNBQU0saUNBQWlDLFdBQVcsMkJBQTJCO0FBQzdFO0FBQUEsTUFDRjtBQUFBLElBQ0YsU0FBUyxJQUFJO0FBQUEsSUFFYjtBQUNBLFFBQ0UsQ0FBQztBQUFBLE1BQ0M7QUFBQSxJQUNGO0FBRUE7QUFDRixRQUFJO0FBQ0YsWUFBTSxPQUFPLE1BQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxJQUFJLEdBQUcsRUFBRSxJQUFJO0FBQ3pELFlBQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxLQUFLLElBQUksQ0FBQztBQUMxQyxZQUFNLG9CQUFvQixRQUFRLEtBQUssU0FBUyxLQUFLO0FBQUEsUUFDbkQ7QUFBQSxRQUNBLGNBQWMsS0FBSztBQUFBLFFBQ25CLGdCQUFnQixLQUFLO0FBQUEsTUFDdkIsQ0FBQztBQUNELFlBQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxJQUFJLEdBQUcsRUFBRSxPQUFPO0FBQy9DLGtCQUFZLG1CQUFtQjtBQUMvQixZQUFNLGVBQWU7QUFBQSxJQUN2QixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sa0JBQWtCLENBQUM7QUFDakMsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBS0EsTUFBSSxpQkFBaUI7QUFFckIsU0FBTyxnQkFBZ0IsZUFBZ0IsS0FBSyxPQUFPO0FBQ2pELFlBQVEsSUFBSSw4QkFBOEIsRUFBRSxLQUFLLE9BQU8sU0FBUyxDQUFDO0FBQ2xFLFFBQUksYUFBYSxTQUFTO0FBQ3hCLFlBQU0saUVBQWlFO0FBQ3ZFO0FBQUEsSUFDRjtBQUNBLFFBQUksQ0FBQyxLQUFLO0FBQ1IsWUFBTSxzRUFBc0U7QUFDNUU7QUFBQSxJQUNGO0FBQ0EscUJBQWlCO0FBRWpCLFVBQU0sUUFBUSxTQUFTLGVBQWUsa0JBQWtCO0FBQ3hELFFBQUksQ0FBQyxPQUFPO0FBQ1YsWUFBTSxnRkFBZ0Y7QUFDdEY7QUFBQSxJQUNGO0FBQ0EsVUFBTSxTQUFTLFNBQVMsZUFBZSxpQkFBaUI7QUFDeEQsUUFBSSxPQUFRLFFBQU8sY0FBYyxZQUFZLFNBQVM7QUFFdEQsUUFBSSxhQUFhO0FBQ2pCLFFBQUksWUFBWTtBQUNoQixRQUFJO0FBQ0YsWUFBTSxPQUFPLE1BQU0sS0FBSyxXQUFXLE9BQU8sRUFBRSxJQUFJLEdBQUcsRUFBRSxJQUFJO0FBQ3pELFVBQUksS0FBSyxRQUFRO0FBQ2YsY0FBTSxJQUFJLEtBQUssS0FBSyxLQUFLLENBQUM7QUFDMUIscUJBQWEsQ0FBQyxDQUFDLEVBQUU7QUFDakIsb0JBQVksRUFBRSxjQUFjO0FBQUEsTUFDOUIsT0FBTztBQUNMLGdCQUFRLEtBQUsscUJBQXFCLE1BQU0sWUFBWTtBQUFBLE1BQ3REO0FBQUEsSUFDRixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sK0JBQStCLEtBQUssQ0FBQztBQUNuRCxZQUFNLGtEQUFrRCxFQUFFLFdBQVcsRUFBRTtBQUN2RTtBQUFBLElBQ0Y7QUFDQSxVQUFNLElBQUksU0FBUyxlQUFlLG9CQUFvQjtBQUN0RCxRQUFJLENBQUMsR0FBRztBQUNOLFlBQU0sc0VBQXNFO0FBQzVFO0FBQUEsSUFDRjtBQUNBLFFBQUksY0FBYyxXQUFXO0FBQzNCLFFBQUUsWUFDQSxpaEJBTUEsV0FBVyxHQUFHLElBQ2QsUUFDQSxXQUFXLFNBQVMsRUFBRSxJQUN0Qix5R0FFQSxXQUFXLEdBQUcsSUFDZDtBQUFBLElBRUosT0FBTztBQUNMLFFBQUUsWUFDQSxtWUFLQSxXQUFXLEdBQUcsSUFDZCxRQUNBLFdBQVcsU0FBUyxFQUFFLElBQ3RCO0FBQUEsSUFFSjtBQUNBLGFBQVMsZUFBZSxrQkFBa0IsRUFBRSxVQUFVLElBQUksTUFBTTtBQUFBLEVBQ2xFO0FBQ0EsU0FBTyxzQkFBc0IsV0FBWTtBQUN2QyxhQUFTLGVBQWUsa0JBQWtCLEVBQUUsVUFBVSxPQUFPLE1BQU07QUFDbkUscUJBQWlCO0FBQUEsRUFDbkI7QUFFQSxTQUFPLGtCQUFrQixlQUFnQixLQUFLLE9BQU87QUFDbkQsUUFBSSxhQUFhLFFBQVM7QUFDMUIsVUFBTSxTQUFTLG1CQUFtQjtBQUNsQyxVQUFNLFVBQVUsb0JBQW9CLFFBQVEsU0FBUyxHQUFHO0FBQ3hELHFCQUFpQixFQUFFLEtBQVUsT0FBYyxRQUFnQixRQUFpQjtBQUM1RSxVQUFNLElBQUksU0FBUyxlQUFlLG9CQUFvQjtBQUN0RCxNQUFFLFlBQ0E7QUFRRixNQUFFLGFBQ0E7QUFDRixNQUFFLGFBQ0EsaWVBR0EsV0FBVyxNQUFNLElBQ2pCO0FBRUYsTUFBRSxhQUNBO0FBRUYsTUFBRSxhQUNBO0FBSUYsUUFBSTtBQUNGLFlBQU0sY0FBYztBQUNwQixZQUFNLE1BQU0sU0FBUyxlQUFlLG1CQUFtQjtBQUN2RCxVQUFJLENBQUMsSUFBSztBQUNWLFVBQUksWUFBWTtBQUNoQixVQUFJLE9BQU8sS0FBSztBQUFBLFFBQ2QsTUFBTTtBQUFBLFFBQ04sT0FBTztBQUFBLFFBQ1AsUUFBUTtBQUFBLFFBQ1IsV0FBVztBQUFBLFFBQ1gsWUFBWTtBQUFBLFFBQ1osY0FBYyxPQUFPLGFBQWE7QUFBQSxNQUNwQyxDQUFDO0FBQUEsSUFDSCxTQUFTLEdBQUc7QUFDVixjQUFRLEtBQUssZ0NBQWdDLENBQUM7QUFDOUMsWUFBTSxNQUFNLFNBQVMsZUFBZSxtQkFBbUI7QUFDdkQsVUFBSTtBQUNGLFlBQUksWUFDRjtBQUFBLElBQ047QUFBQSxFQUNGO0FBRUEsU0FBTyxtQkFBbUIsaUJBQWtCO0FBQzFDLFFBQUksQ0FBQyxlQUFnQjtBQUNyQixVQUFNLFFBQVEsU0FBUyxlQUFlLG9CQUFvQixFQUFFLFNBQVMsSUFBSSxRQUFRLFFBQVEsRUFBRTtBQUMzRixRQUFJLENBQUMsVUFBVSxLQUFLLElBQUksR0FBRztBQUN6QixZQUFNLDhCQUF3QjtBQUM5QjtBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssTUFBTSxlQUFlLGVBQWUsUUFBUSxNQUFNLENBQUM7QUFDOUQsUUFBSSxDQUFDLElBQUk7QUFDUDtBQUFBLFFBQ0U7QUFBQSxNQUNGO0FBQ0E7QUFBQSxJQUNGO0FBQ0EsUUFBSTtBQUNGLFlBQU0sS0FDSCxXQUFXLE9BQU8sRUFDbEIsSUFBSSxlQUFlLEdBQUcsRUFDdEIsT0FBTztBQUFBLFFBQ04sWUFBWSxlQUFlO0FBQUEsUUFDM0IsYUFBYTtBQUFBLFFBQ2IsZUFBZSxTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxRQUM3RCxlQUFlLFlBQVksU0FBUztBQUFBLE1BQ3RDLENBQUM7QUFDSCxrQkFBWSx3QkFBd0IsZUFBZSxTQUFTLFVBQVU7QUFDdEUsMEJBQW9CO0FBQ3BCLFVBQUk7QUFDRix1QkFBZTtBQUFBLE1BQ2pCLFNBQVMsSUFBSTtBQUFBLE1BQUM7QUFBQSxJQUNoQixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sYUFBYSxDQUFDO0FBQzVCLFlBQU0sdUJBQXVCLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDOUM7QUFBQSxFQUNGO0FBRUEsU0FBTyxjQUFjLGVBQWdCLEtBQUs7QUFDeEMsUUFBSSxhQUFhLFFBQVM7QUFDMUIsUUFBSSxDQUFDLFFBQVEsb0VBQW9FLEVBQUc7QUFDcEYsUUFBSTtBQUNGLFlBQU0sS0FDSCxXQUFXLE9BQU8sRUFDbEIsSUFBSSxHQUFHLEVBQ1AsT0FBTztBQUFBLFFBQ04sYUFBYTtBQUFBLFFBQ2IsWUFBWSxTQUFTLFVBQVUsV0FBVyxPQUFPO0FBQUEsUUFDakQsZ0JBQWdCLFlBQVksU0FBUztBQUFBLFFBQ3JDLGdCQUFnQixTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxNQUNoRSxDQUFDO0FBQ0gsa0JBQVksbUJBQW1CO0FBQy9CLDBCQUFvQjtBQUNwQixVQUFJO0FBQ0YsdUJBQWU7QUFBQSxNQUNqQixTQUFTLElBQUk7QUFBQSxNQUFDO0FBQUEsSUFDaEIsU0FBUyxHQUFHO0FBQ1YsWUFBTSxhQUFhLEVBQUUsV0FBVyxFQUFFO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBRUEsU0FBTyxxQkFBcUIsZUFBZ0IsS0FBSyxPQUFPO0FBQ3RELFFBQUksYUFBYSxRQUFTO0FBQzFCLFFBQUksQ0FBQyxPQUFPO0FBQ1YsWUFBTSxnRUFBZ0U7QUFDdEU7QUFBQSxJQUNGO0FBQ0EsVUFBTSxTQUFTO0FBQUEsTUFDYiwrQkFDRSxRQUNBLDZGQUlBLFFBQ0E7QUFBQSxNQVFGO0FBQUEsSUFDRjtBQUNBLFFBQUksV0FBVyxLQUFNO0FBQ3JCLFFBQUksT0FBTyxLQUFLLE1BQU0sS0FBSztBQUN6QixVQUFJO0FBQ0YsY0FBTSxPQUFPLHVCQUF1QixLQUFLO0FBQ3pDO0FBQUEsVUFDRSx3Q0FDRSxRQUNBO0FBQUEsUUFDSjtBQUNBLFlBQUk7QUFDRixnQkFBTSxLQUNILFdBQVcsT0FBTyxFQUNsQixJQUFJLEdBQUcsRUFDUCxPQUFPO0FBQUEsWUFDTixtQkFBbUIsWUFBWSxTQUFTO0FBQUEsWUFDeEMsbUJBQW1CLFNBQVMsVUFBVSxXQUFXLGdCQUFnQjtBQUFBLFlBQ2pFLHFCQUFxQjtBQUFBLFVBQ3ZCLENBQUM7QUFBQSxRQUNMLFNBQVMsSUFBSTtBQUFBLFFBQUM7QUFBQSxNQUNoQixTQUFTLEdBQUc7QUFDVixnQkFBUSxNQUFNLDBCQUEwQixDQUFDO0FBQ3pDLGNBQU0sOEJBQThCLEVBQUUsV0FBVyxFQUFFO0FBQUEsTUFDckQ7QUFDQTtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sS0FBSyxNQUFNLEtBQUs7QUFDekIsWUFBTSxTQUFTO0FBQUEsUUFDYiw4QkFDRSxRQUNBO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxVQUFJLFdBQVcsS0FBTTtBQUNyQixZQUFNLE9BQU8sVUFBVSxJQUFJLEtBQUs7QUFDaEMsVUFBSSxJQUFJLFNBQVMsR0FBRztBQUNsQixjQUFNLHlEQUFzRDtBQUM1RDtBQUFBLE1BQ0Y7QUFDQSxVQUFJO0FBQ0YsY0FBTSxRQUFRLE1BQU0seUJBQXlCLEdBQUc7QUFDaEQsY0FBTSxLQUNILFdBQVcsT0FBTyxFQUNsQixJQUFJLEdBQUcsRUFDUCxPQUFPO0FBQUEsVUFDTixjQUFjLE1BQU07QUFBQSxVQUNwQixjQUFjLE1BQU07QUFBQSxVQUNwQixtQkFBbUIsWUFBWSxTQUFTO0FBQUEsVUFDeEMsbUJBQW1CLFNBQVMsVUFBVSxXQUFXLGdCQUFnQjtBQUFBLFVBQ2pFLHFCQUFxQjtBQUFBLFFBQ3ZCLENBQUM7QUFDSCxvQkFBWSxvQ0FBb0MsS0FBSztBQUFBLE1BQ3ZELFNBQVMsR0FBRztBQUNWLGdCQUFRLE1BQU0sMkJBQTJCLENBQUM7QUFDMUMsY0FBTSx1QkFBdUIsRUFBRSxXQUFXLEVBQUU7QUFBQSxNQUM5QztBQUNBO0FBQUEsSUFDRjtBQUNBLFVBQU0sOEJBQThCO0FBQUEsRUFDdEM7QUFFQSxTQUFPLGVBQWUsZUFBZ0IsS0FBSyxLQUFLO0FBQzlDLFVBQU0sWUFBWSxJQUFJLFFBQVEsSUFBSSxLQUFLLElBQUksUUFBUSxhQUFhO0FBQ2hFLFFBQUksQ0FBQyxVQUFXO0FBQ2hCLFVBQU0sT0FBTyxVQUFVLGNBQWMsV0FBVyxFQUFFO0FBQ2xELFVBQU0sU0FBUyxVQUFVLGNBQWMsYUFBYSxFQUFFLFNBQVM7QUFDL0QsVUFBTSxjQUFjLFVBQVUsY0FBYyxlQUFlO0FBQzNELFVBQU0scUJBQXFCLGNBQWMsWUFBWSxTQUFTLE9BQU87QUFFckUsVUFBTSxVQUFVLFVBQVUsY0FBYyxXQUFXO0FBQ25ELFVBQU0sV0FBVyxXQUFXLFFBQVEsU0FBUyxJQUFJLFFBQVEsT0FBTyxFQUFFLElBQUk7QUFDdEUsUUFBSSxZQUFZLFNBQVMsU0FBUyxHQUFHO0FBQ25DO0FBQUEsUUFDRTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFFQSxVQUFNLGtCQUFrQixVQUFVLGNBQWMsb0JBQW9CO0FBQ3BFLFVBQU0seUJBQXlCLGtCQUFrQixnQkFBZ0IsU0FBUyxPQUFPO0FBTWpGLFFBQUksMkJBQTJCO0FBQy9CLFFBQUksd0JBQXdCO0FBQzFCLFlBQU0sZ0JBQWdCLGNBQWMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxzQkFBc0I7QUFDckYsaUNBQTJCLGVBQWUsYUFBYSxTQUFTLE9BQU87QUFBQSxJQUN6RTtBQUNBLFFBQUksV0FBVztBQUNmLFFBQUksY0FBYztBQUNsQixRQUFJO0FBQ0YsWUFBTSxLQUNILFdBQVcsT0FBTyxFQUNsQixJQUFJLEdBQUcsRUFDUDtBQUFBLFFBQ0M7QUFBQSxVQUNFO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBLFVBQVUsWUFBWTtBQUFBLFVBQ3RCO0FBQUEsVUFDQTtBQUFBLFVBQ0EsWUFBWSxZQUFZO0FBQUEsVUFDeEIsWUFBWSxTQUFTLFVBQVUsV0FBVyxnQkFBZ0I7QUFBQSxRQUM1RDtBQUFBLFFBQ0EsRUFBRSxPQUFPLEtBQUs7QUFBQSxNQUNoQjtBQUVGLFVBQUksUUFBUSxZQUFZLEtBQUs7QUFDM0IsMkJBQW1CLFlBQVk7QUFDL0IsbUNBQTJCLDBCQUEwQjtBQUNyRCxxQ0FBNkIsNEJBQTRCO0FBQUEsTUFDM0Q7QUFDQSxVQUFJLGNBQWM7QUFFbEIsaUJBQVcsTUFBTTtBQUNmLFlBQUk7QUFDRix5QkFBZTtBQUFBLFFBQ2pCLFNBQVMsR0FBRztBQUNWLGtCQUFRLE1BQU0sdUJBQXVCLENBQUM7QUFBQSxRQUN4QztBQUFBLE1BQ0YsR0FBRyxHQUFHO0FBQUEsSUFDUixTQUFTLEdBQUc7QUFDVixjQUFRLE1BQU0sZ0JBQWdCLENBQUM7QUFDL0IsWUFBTSx1QkFBdUIsRUFBRSxXQUFXLEVBQUU7QUFDNUMsVUFBSSxXQUFXO0FBQ2YsVUFBSSxjQUFjO0FBQUEsSUFDcEI7QUFBQSxFQUNGOyIsCiAgIm5hbWVzIjogWyJ2ZW5kb3JzUGFyYUludGVybm8iXQp9Cg==
