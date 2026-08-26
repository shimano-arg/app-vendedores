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
    el.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "text-align:center;padding:14px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px";
    const title = document.createElement("div");
    title.style.cssText = "font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:6px";
    title.textContent = "Gemini API Key (OCR de tickets)";
    const msg = document.createElement("div");
    msg.style.cssText = "font-size:11px;color:#64748b";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+U2kgdW4gdmVuZGVkb3IgdXNhIEdtYWlsIHBlcnNvbmFsIChubyBAc2hpbWFuby5jb20uYXIpLCBhZ3JlZ2FsbyBhY2EgYW50ZXMgcXVlIGludGVudGUgbG9ndWVhci4gTG9zIGVtYWlscyBAc2hpbWFuby5jb20uYXIgeSBsb3MgYWRtaW5zIGhhcmRjb2RlZCB5YSBlc3RhbiBhdXRvcml6YWRvcyBhdXRvbWF0aWNhbWVudGUuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMCAxMHB4XCI+Tm8gaGF5IGVtYWlscyBwcmUtYXV0b3JpemFkb3MgdG9kYXZpYS48L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xuICAgIGFsbG93ZWRMaXN0LmZvckVhY2goKGFlKSA9PiB7XG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcbiAgICAgIGNvbnN0IG5vdGUgPSBhZS5ub3RlID8gJyAmbWlkZG90OyAnICsgZXNjYXBlSHRtbChhZS5ub3RlKSA6ICcnO1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzozcHggNHB4IDNweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiMxZTQwYWY7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXG4gICAgICAgIGxhYmVsICtcbiAgICAgICAgbm90ZSArXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJyZW1vdmVBbGxvd2VkRW1haWwoXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIoYWUuX2lkKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXG4gICAgICAgICc8L2Rpdj4nO1xuICAgIH0pO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxuXG53aW5kb3cuYWRkQWxsb3dlZEVtYWlsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xuICBpZiAoIXJhdykgcmV0dXJuO1xuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xuICAgIGFsZXJ0KCdFbCBlbWFpbCBubyBwYXJlY2UgdmFsaWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBub3RlID1cbiAgICBwcm9tcHQoJ05vdGEgY29ydGEgb3BjaW9uYWwgKGVqLiBcIlZlbmRlZG9yIFoxIEdvbnphbG9cIiBvIFwiUmVlbXBsYXpvIGRlIE1hdXJpY2lvXCIpOicsICcnKSB8fCAnJztcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXG4gICAgICAuZG9jKGRvY0lkKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIG5vdGU6IG5vdGUudHJpbSgpLFxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIGFkZGVkQnlVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICBhZGRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xuICAgIC8vIFJlY2FyZ2FyIHBhbmVsXG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnJlbW92ZUFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uIChkb2NJZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5kZWxldGUoKTtcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3JlbW92ZUFsbG93ZWRFbWFpbCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT0gU2VjY2lvbiBHZW1pbmkgQVBJIEtleSAoYWRtaW4pID09PVxuZnVuY3Rpb24gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihfZGF0YSkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICAvLyB2NTUxICgyMDI2LTA4LTE5KSBTRUNVUklUWTogbGEga2V5IHZpdmUgZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuIEZpcmVzdG9yZS5cbiAgLy8gdjYzOSAoMjAyNi0wOC0yNik6IFVYIHNpbXBsaWZpY2FkbyBwb3IgcGVkaWRvIE1hcmlhbm8gXHUyMDE0IHNpbiBpbnN0cnVjY2lvbmVzXG4gIC8vIENMSSBlbiBlbCBwYW5lbCwgc29sbyB1biBiYW5uZXIgZXhwbGljYW5kbyBkb25kZSB2aXZlIGxhIGtleS5cbiAgLy8gU2UgYWRtaW5pc3RyYSBwb3IgQ0xJIChmaXJlYmFzZSBmdW5jdGlvbnM6c2VjcmV0czpzZXQgR0VNSU5JX0FQSV9LRVkpLlxuICBlbC50ZXh0Q29udGVudCA9ICcnO1xuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHdyYXAuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MTRweCAxMnB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo2cHgnO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0aXRsZS5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNWIyMWI2O21hcmdpbi1ib3R0b206NnB4JztcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnR2VtaW5pIEFQSSBLZXkgKE9DUiBkZSB0aWNrZXRzKSc7XG4gIGNvbnN0IG1zZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiJztcbiAgLy8gSWNvbm8gY2FuZGFkbyArIHRleHRvLiB0ZXh0Q29udGVudCBlcyBzYWZlIChubyBIVE1MIHBhcnNpbmcpLlxuICBtc2cudGV4dENvbnRlbnQgPSAnXHVEODNEXHVERDEyIEd1YXJkYWRvIHBvciBzZWd1cmlkYWQgZW4gR29vZ2xlIFNlY3JldCBNYW5hZ2VyJztcbiAgd3JhcC5hcHBlbmRDaGlsZCh0aXRsZSk7XG4gIHdyYXAuYXBwZW5kQ2hpbGQobXNnKTtcbiAgZWwuYXBwZW5kQ2hpbGQod3JhcCk7XG59XG5cbi8vIHY1NTE6IHNhdmVHZW1pbmlBcGlLZXkgKyBkZWxldGVHZW1pbmlBcGlLZXkgZWxpbWluYWRvcy4gTGEga2V5IHZpdmVcbi8vIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuIFNlIGFkbWluaXN0cmEgcG9yIENMSS4gVmVyXG4vLyByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uIHBhcmEgbGFzIGluc3RydWNjaW9uZXMuXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR09PR0xFIE1BUFMgR2VvY29kaW5nIEFQSSAtIG1lam9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCBxdWUgT1NNXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3Ncbi8vIGNvbW8gZ2VvY29kZXIgUFJJTUFSSU8gZW4gZ2VvY29kZUNsaWVudEFkZHJlc3M7IHNpIGZhbGxhIG8gbm8gZXN0YVxuLy8gc2V0ZWFkYSwgY2FlbW9zIGEgbGEgY2FzY2FkYSBPU00gTm9taW5hdGltIGNvbW8gZmFsbGJhY2suXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XG5hc3luYyBmdW5jdGlvbiBnZXRHbWFwc0FwaUtleSgpIHtcbiAgaWYgKGdtYXBzQXBpS2V5Q2FjaGUpIHJldHVybiBnbWFwc0FwaUtleUNhY2hlO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgICBpZiAoZC5hcGlLZXkpIHtcbiAgICAgICAgZ21hcHNBcGlLZXlDYWNoZSA9IGQuYXBpS2V5O1xuICAgICAgICByZXR1cm4gZC5hcGlLZXk7XG4gICAgICB9XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIG5vIHNlIHB1ZG8gbGVlciBhcGkga2V5JywgZSk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5mdW5jdGlvbiByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZGF0YSkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnbWFwcy1jb25maWctc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGNvbnN0IGhhc0tleSA9IGRhdGEgJiYgZGF0YS5hcGlLZXk7XG4gIGNvbnN0IG1hc2tlZCA9IGhhc0tleSA/IGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkgOiAnJztcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xuICBjb25zdCB1cGRhdGVkQXQgPVxuICAgIGRhdGEgJiYgZGF0YS51cGRhdGVkQXQgJiYgZGF0YS51cGRhdGVkQXQudG9EYXRlXG4gICAgICA/IGRhdGEudXBkYXRlZEF0LnRvRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXG4gICAgICA6ICcnO1xuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMwNjVmNDZcIj5Hb29nbGUgTWFwcyBBUEkgS2V5IChnZW9jb2RpbmcpPC9kaXY+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkNvbnZpZXJ0ZSBkaXJlY2Npb25lcyBhIGNvb3JkZW5hZGFzIGNvbiBtdWNoYSBtZWpvciBwcmVjaXNpXHUwMEYzbiBxdWUgT1NNIChzb2JyZSB0b2RvIGVuIGxvY2FsaWRhZGVzIGNoaWNhcykuIENvc3RvIGdyYXRpcyBoYXN0YSA0MC4wMDAgcmVxdWVzdHMvbWVzLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmIChoYXNLZXkpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDttYXJnaW4tYm90dG9tOjEwcHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XG4gICAgaHRtbCArPVxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICM2ZWU3Yjc7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzo0cHggOHB4O2NvbG9yOiMwNjVmNDZcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwobWFza2VkKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPVxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YlwiPkNhcmdhZGEgcG9yICcgK1xuICAgICAgZXNjYXBlSHRtbCh1cGRhdGVkQnkgfHwgJ2FkbWluJykgK1xuICAgICAgKHVwZGF0ZWRBdCA/ICcgKCcgKyBlc2NhcGVIdG1sKHVwZGF0ZWRBdCkgKyAnKScgOiAnJykgK1xuICAgICAgJzwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcbiAgICAnPC9idXR0b24+JztcbiAgaWYgKGhhc0tleSlcbiAgICBodG1sICs9XG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCByYXcgPSBwcm9tcHQoXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXG4gICAgJydcbiAgKTtcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xuICBpZiAoIWtleSkge1xuICAgIGFsZXJ0KCdWYWNpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBhcGlLZXk6IGtleSxcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZUdtYXBzQXBpS2V5JywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQlVMSyBBUFBST1ZFUiAtIGFzaWduYXIgZWwgbWlzbW8gXCJSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lc1wiXG4vLyBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFV0aWwgY3VhbmRvIHVuIHNvbG8gYXByb2JhZG9yIChlai4gUGFibG8gZ2VyZW50ZSkgcmV2aXNhIGxhc1xuLy8gcmVuZGljaW9uZXMgZGUgVE9ET1MgbG9zIHZlbmRlZG9yZXMuIFNpbiBlc3RvIGVsIGFkbWluIHRpZW5lIHF1ZVxuLy8gYWJyaXIgY2FkYSBmaWxhIGRlbCBwYW5lbCBVc3VhcmlvcyB5IHNldGVhciBlbCBkcm9wZG93biB1bmEgYSB1bmEuXG5mdW5jdGlvbiByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjYW5kaWRhdGVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcihcbiAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICk7XG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiNhMjFjYWZcIj5BcHJvYmFkb3IgZGUgUmVuZGljaW9uZXMgLSBhc2lnbmFjaW9uIG1hc2l2YTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj5BcGxpY2EgZWwgbWlzbW8gcmVzcG9uc2FibGUgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLiBVdGlsIGN1YW5kbyB1biBnZXJlbnRlIGNvbWVyY2lhbCBjZW50cmFsaXphIGxhIGFwcm9iYWNpb24uPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKCFjYW5kaWRhdGVzLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgYWRtaW4gLyBnZXJlbnRlIC8gaW50ZXJuby4gUHJpbWVybyBhc2lnbmEgdW4gcm9sIGEgYWxndWllbi48L2Rpdj4nO1xuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIHZlbmRlZG9yIHRvZGF2aWEuPC9kaXY+JztcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xuICAgIHJldHVybjtcbiAgfVxuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XG4gIGh0bWwgKz1cbiAgICAnPHNlbGVjdCBpZD1cImJ1bGstYXBwcm92ZXItc2VsZWN0XCIgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCAjZjBhYmZjO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6I2ZmZjtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xuICBjYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcbiAgfSk7XG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJidWxrQXNzaWduQXBwcm92ZXIoKVwiPkFzaWduYXIgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyAoJyArXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xuICAgICcpPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcbiAgaWYgKCFhcHByb3Zlcikge1xuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZlbmRlZG9yZXMgcGFyYSBhc2lnbmFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHByb3ZlckxhYmVsID0gYXBwcm92ZXIuZGlzcGxheU5hbWUgfHwgYXBwcm92ZXIuZW1haWwgfHwgYXBwcm92ZXIuX3VpZDtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0FzaWduYXIgYSAnICtcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xuICAgICAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgbGV0IG9rQ291bnQgPSAwLFxuICAgIF9lcnJDb3VudCA9IDA7XG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcbiAgdmVuZGVkb3Jlcy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHVpZCxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBsb2dPcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxuICAgICAgICBhcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXG4gICAgICB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdidWxrQXNzaWduQXBwcm92ZXInLCBlKTtcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxuICBpZiAob2tDb3VudCkge1xuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXG4gIH1cbn07XG5cbi8vIEdlb2NvZGluZyBjb24gR29vZ2xlIE1hcHMgQVBJLiBEZXZ1ZWx2ZSB7bGF0LCBsbmcsIGRpc3BsYXksIHByZWNpc2lvbn1cbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcbiAgY29uc3Qga2V5ID0gYXdhaXQgZ2V0R21hcHNBcGlLZXkoKTtcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cbiAgY29uc3QgdXJsID1cbiAgICAnaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMuY29tL21hcHMvYXBpL2dlb2NvZGUvanNvbicgK1xuICAgICc/YWRkcmVzcz0nICtcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcbiAgICAnJnJlZ2lvbj1hcicgK1xuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXG4gICAgJyZsYW5ndWFnZT1lcycgK1xuICAgICcma2V5PScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XG4gICAgICBjb25zdCBieVR5cGUgPSAodCkgPT4ge1xuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XG4gICAgICB9O1xuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XG4gICAgICAgIGJ5VHlwZSgnbG9jYWxpdHknKSB8fCBieVR5cGUoJ3N1YmxvY2FsaXR5JykgfHwgYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzInKSB8fCAnJztcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGF0OiBwYXJzZUZsb2F0KGxvYy5sYXQpLFxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcbiAgICAgICAgcHJlY2lzaW9uOiBwcmVjaXNpb24sXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcbiAgICAgICAgbG9jYWxpdHk6IGRldGVjdGVkTG9jYWxpdHksXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcbiAgICAgICAgICAnKHNpbiBkZXRhbGxlKS4gUmV2aXNhciBxdWUgbGEgQVBJIGtleSB0ZW5nYSBoYWJpbGl0YWRhIEdlb2NvZGluZyBBUEkgeSBlbCByZWZlcnJlciBwZXJtaXRhIGVzdGUgZG9taW5pby4nXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcbiAgdHJ5IHtcbiAgICBjb25zdCBhZVFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmdldCgpO1xuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdlbWluaSBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5XG4gIHRyeSB7XG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZ1NuYXAuZXhpc3RzID8gZ1NuYXAuZGF0YSgpIDogbnVsbCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxuICB0cnkge1xuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xuICAgIC8vIEU2IGZpeCBDMTogdmFjaWFyIGVsIEFycmF5IGluLXBsYWNlIChwcmVzZXJ2YSB3aW5kb3cudXNlcnNDYWNoZSByZWYpLlxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIHVzZXJzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgX3VpZDogZG9jLmlkIH0sIGRvYy5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXG4gICAgdHJ5IHtcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpO1xuICAgIH1cbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcbiAgICAvLyBwdWVkYW4gdmVyIGRlc3RpbmF0YXJpb3MgYWwgY3JlYXIgdGFyZWFzIGVuIE5vdGlmaWNhY2lvbmVzLiBTaW4gZXN0b1xuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cbiAgICB0cnkge1xuICAgICAgc3luY1VzZXJzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcbiAgICB9XG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XG4gICAgY29uc3QgX2ludGVybm9PcHRzID1cbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgIGludGVybm9zXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICdcIj4nICtcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xuICAgICAgdGFibGVIdG1sID1cbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XG4gICAgICBjYXJkc0h0bWwgPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7Zm9udC1zaXplOjEycHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC9kaXY+JztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWRtaW5zIHByaW1hcmlvcyBwcm90ZWdpZG9zOiBubyBzZSBwdWVkZW4gZWxpbWluYXIgKE1hcmlhbm8gKyBib3QgY29ycG9yYXRpdm8pXG4gICAgICBjb25zdCBQUk9URUNURURfQURNSU5fRU1BSUxTID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcbiAgICAgIC8vIFBhcmEgbG9zIGludGVybm9zIGNhbGN1bGFtb3MgbGEgcmVsYWNpb24gaW52ZXJzYTogcXVpZW5lcyBsb3MgdGllbmVuIGNvbW8gcGFyZWphXG4gICAgICBmdW5jdGlvbiB2ZW5kb3JzUGFyYUludGVybm8oaW50ZXJub1VpZCkge1xuICAgICAgICByZXR1cm4gdXNlcnNDYWNoZS5maWx0ZXIoXG4gICAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyAmJiB1LmludGVybmFsUGFydG5lclVpZCA9PT0gaW50ZXJub1VpZFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gQ2FuZGlkYXRvcyBhIHJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzOiBhZG1pbiwgZ2VyZW50ZSBvIGludGVybm8gKG5vIHZlbmRlZG9yZXMgbmkgdmlld2VycyBuaSB1bmFzc2lnbmVkKVxuICAgICAgY29uc3QgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMgPSB1c2Vyc0NhY2hlLmZpbHRlcihcbiAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xuICAgICAgKTtcbiAgICAgIHVzZXJzQ2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICBjb25zdCBkb2NJZCA9IGQuX3VpZDtcbiAgICAgICAgY29uc3QgaXNTZWxmID0gZG9jSWQgPT09IGN1cnJlbnRVc2VyLnVpZDtcbiAgICAgICAgY29uc3QgaXNQcm90ZWN0ZWQgPSBQUk9URUNURURfQURNSU5fRU1BSUxTLmluZGV4T2YoKGQuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpID49IDA7XG4gICAgICAgIGNvbnN0IGlzSW50ZXJubyA9IGQucm9sZSA9PT0gJ2ludGVybm8nO1xuICAgICAgICBjb25zdCByb2xlT3B0aW9ucyA9IFsndW5hc3NpZ25lZCcsICdhZG1pbicsICdnZXJlbnRlJywgJ3ZlbmRlZG9yJywgJ2ludGVybm8nLCAndmlld2VyJ11cbiAgICAgICAgICAubWFwKFxuICAgICAgICAgICAgKHIpID0+XG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgIHIgK1xuICAgICAgICAgICAgICAnXCInICtcbiAgICAgICAgICAgICAgKGQucm9sZSA9PT0gciA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICAgKGlzU2VsZiAmJiByICE9PSAnYWRtaW4nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICByICtcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgICApXG4gICAgICAgICAgLmpvaW4oJycpO1xuICAgICAgICBjb25zdCB2ZW5kb3JPcHRpb25zID1cbiAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi08L29wdGlvbj4nICtcbiAgICAgICAgICBWRU5ET1JTLm1hcChcbiAgICAgICAgICAgICh2KSA9PlxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICB2LmtleSArXG4gICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAoZC52ZW5kb3IgPT09IHYua2V5ID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICB2LnpvbmUgK1xuICAgICAgICAgICAgICAnICcgK1xuICAgICAgICAgICAgICB2LmtleSArXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICAgICAgKS5qb2luKCcnKTtcbiAgICAgICAgLy8gU2kgZXMgaW50ZXJubywgbW9zdHJhciByZWxhY2lvbiBpbnZlcnNhICh2ZW5kZWRvcmVzIHF1ZSBsbyB0aWVuZW4gY29tbyBwYXJlamEpIGVuIHZleiBkZWwgZHJvcGRvd24gZWRpdGFibGVcbiAgICAgICAgbGV0IHBhcmVqYUNlbGw7XG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcbiAgICAgICAgICBjb25zdCB2aW5jID0gdmVuZG9yc1BhcmFJbnRlcm5vKGRvY0lkKTtcbiAgICAgICAgICBpZiAodmluYy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3QgPSB2aW5jXG4gICAgICAgICAgICAgIC5tYXAoKHUpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IHUuZGlzcGxheU5hbWUgPyB1LmRpc3BsYXlOYW1lLnNwbGl0KC9cXHMrLylbMF0gOiB1LmVtYWlsIHx8ICcnO1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKGxhYmVsKSArXG4gICAgICAgICAgICAgICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6Izk0YTNiOFwiPignICtcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XG4gICAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojMGYxNzJhO2xpbmUtaGVpZ2h0OjEuNVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNDc1NTY5O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206MnB4XCI+VmVuZGVkb3JlcyBleHRlcm5vcyB2aW5jdWxhZG9zIChhdXRvKTwvZGl2PicgK1xuICAgICAgICAgICAgICBsaXN0ICtcbiAgICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM5NGEzYjg7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgICAgICAgIGludGVybm9zXG4gICAgICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAgICAgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xuICAgICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzdjM2FlZDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiPihWT1MpPC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCBwcm90ZWN0ZWRUYWcgPVxuICAgICAgICAgIGlzUHJvdGVjdGVkICYmICFpc1NlbGZcbiAgICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiM3YzNhZWQ7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIiB0aXRsZT1cIkFkbWluIHByb3RlZ2lkbyAtIG5vIHNlIHB1ZWRlIGVsaW1pbmFyXCI+JiMxMjgyNzQ7IFBST1RFR0lETzwvc3Bhbj4nXG4gICAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB3YVZhbCA9IGQud2hhdHNhcHAgfHwgJyc7XG4gICAgICAgIGNvbnN0IHdhSW5wdXRIdG1sID1cbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXG4gICAgICAgICAgZXNjYXBlQXR0cih3YVZhbCkgK1xuICAgICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo1cHggN3B4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6I2ZmZlwiIHRpdGxlPVwiTnVtZXJvIFdoYXRzQXBwIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoc2luICsgbmkgZXNwYWNpb3MpLiBTZSB1c2EgYWwgZW52aWFyIGxhIHJ1dGEuXCIvPic7XG4gICAgICAgIC8vIERyb3Bkb3duICdSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcydcbiAgICAgICAgY29uc3QgY3VyQXBwcm92ZXJVaWQgPSBkLnJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgJyc7XG4gICAgICAgIGxldCByZW5kQXBwcm92ZXJPcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBhc2lnbmFyIC08L29wdGlvbj4nO1xuICAgICAgICByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcy5mb3JFYWNoKCh1KSA9PiB7XG4gICAgICAgICAgaWYgKHUuX3VpZCA9PT0gZG9jSWQpIHJldHVybjsgLy8gdW4gdXN1YXJpbyBubyBwdWVkZSBzZXIgc3UgcHJvcGlvIGFwcm9iYWRvclxuICAgICAgICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyAodS5yb2xlIHx8ICcnKSArICcpJztcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICs9XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgZXNjYXBlQXR0cih1Ll91aWQpICtcbiAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgKGN1ckFwcHJvdmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgZXNjYXBlSHRtbChsYmwpICtcbiAgICAgICAgICAgICc8L29wdGlvbj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcmVuZEFwcHJvdmVySHRtbCA9XG4gICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJyZW5kLWFwcHJvdmVyLXNlbFwiIHRpdGxlPVwiUXVpZW4gYXBydWViYSBsYXMgcmVuZGljaW9uZXMgZGUgZXN0ZSB1c3VhcmlvXCI+JyArXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArXG4gICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ2FtYmlhciBjb250cmFzZVx1MDBGMWFcbiAgICAgICAgY29uc3QgcHdkQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHhcIiBvbmNsaWNrPVwiY2hhbmdlVXNlclBhc3N3b3JkKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICBcIicsIFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xuICAgICAgICAgICcpXCI+JiMxMjgyNzQ7IENvbnRyYXNlXHUwMEYxYTwvYnV0dG9uPic7XG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ29uZmlndXJhciAyRkFcbiAgICAgICAgY29uc3QgdG90cFN0YXR1c1RhZyA9IGQudG90cEVuYWJsZWRcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgICAoZC50b3RwRW5hYmxlZCA/ICcjMTBiOTgxJyA6ICcjNWIyMWI2JykgK1xuICAgICAgICAgICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgXCInLCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcbiAgICAgICAgICAnKVwiPiYjMTI4MjcyOyAyRkEnICtcbiAgICAgICAgICB0b3RwU3RhdHVzVGFnICtcbiAgICAgICAgICAnPC9idXR0b24+JztcbiAgICAgICAgLy8gRGVza3RvcCByb3dcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dHIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lIHx8ICcnKSArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgKyByb2xlT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcGFyZWphQ2VsbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB3YUlucHV0SHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyByZW5kQXBwcm92ZXJIdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHB3ZEJ0bkh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgdG90cEJ0bkh0bWwgKyAnPC90ZD4nO1xuICAgICAgICBjb25zdCBzaG93RGVsZXRlID0gIWlzU2VsZiAmJiAhaXNQcm90ZWN0ZWQ7XG4gICAgICAgIGNvbnN0IGRlbEJ0biA9IHNob3dEZWxldGVcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIHRhYmxlSHRtbCArPVxuICAgICAgICAgICc8dGQ+JyArXG4gICAgICAgICAgZGVsQnRuICtcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzwvdHI+JztcbiAgICAgICAgLy8gTW9iaWxlIGNhcmRcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidXNlcnMtY2FyZFwiIGRhdGEtdWlkPVwiJyArIGRvY0lkICsgJ1wiPic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2PjxkaXYgY2xhc3M9XCJ1Yy1lbWFpbFwiPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgIHlvdVRhZyArXG4gICAgICAgICAgcHJvdGVjdGVkVGFnICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgaWYgKGQuZGlzcGxheU5hbWUpXG4gICAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtbmFtZVwiPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUpICsgJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+Um9sPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICtcbiAgICAgICAgICByb2xlT3B0aW9ucyArXG4gICAgICAgICAgJzwvc2VsZWN0PjwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlZlbmRlZG9yIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICtcbiAgICAgICAgICB2ZW5kb3JPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcbiAgICAgICAgaWYgKGlzSW50ZXJubykge1xuICAgICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3JlcyB2aW5jdWxhZG9zIChhdXRvKTwvbGFiZWw+JyArXG4gICAgICAgICAgICBwYXJlamFDZWxsICtcbiAgICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UGFyZWphIGludGVybm8gKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD4nICtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+V2hhdHNBcHAgKGNvbiBjb2RpZ28gZGUgcGFpcywgc2luICsgbmkgZXNwYWNpb3MpPC9sYWJlbD4nICtcbiAgICAgICAgICB3YUlucHV0SHRtbCArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzPC9sYWJlbD4nICtcbiAgICAgICAgICByZW5kQXBwcm92ZXJIdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcbiAgICAgICAgICBwd2RCdG5IdG1sICtcbiAgICAgICAgICB0b3RwQnRuSHRtbCArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIGNvbnN0IGRlbEJ0bkMgPSBzaG93RGVsZXRlXG4gICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInJtLXVzZXItYnRuXCIgb25jbGljaz1cImRlbGV0ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgICAgZG9jSWQgK1xuICAgICAgICAgICAgJ1xcJylcIj5FbGltaW5hcjwvYnV0dG9uPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLWFjdGlvbnNcIj4nICtcbiAgICAgICAgICBkZWxCdG5DICtcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgJ1xcJywgdGhpcylcIj5HdWFyZGFyPC9idXR0b24+PC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHRib2R5LmlubmVySFRNTCA9IHRhYmxlSHRtbDtcbiAgICBjYXJkc0VsLmlubmVySFRNTCA9IGNhcmRzSHRtbDtcbiAgICAvLyBBY3R1YWxpemEgaGVhZGVyIGRlIHRhYmxhIGNvbiBsYSBjb2x1bW5hIG51ZXZhXG4gICAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjdXNlcnMtdGFibGUgdGhlYWQgdHInKTtcbiAgICBpZiAodGhlYWQpXG4gICAgICB0aGVhZC5pbm5lckhUTUwgPVxuICAgICAgICAnPHRoPkVtYWlsPC90aD48dGg+Tm9tYnJlPC90aD48dGg+Um9sPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5QYXJlamEgaW50ZXJubzwvdGg+PHRoPldoYXRzQXBwPC90aD48dGg+UmVzcC4gcmVuZGljaW9uZXM8L3RoPjx0aD5QYXNzPC90aD48dGg+MkZBPC90aD48dGg+PC90aD4nO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgY2FyZ2FuZG8gdXN1YXJpb3M6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmNsb3NlQWRtaW5QYW5lbCA9IGZ1bmN0aW9uICgpIHtcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUNDSVx1MDBEM046IEYyOiBkZWxldGVVc2VyUm9sZSArIFRPVFAgKyBjaGFuZ2VVc2VyUGFzc3dvcmQgKyBzYXZlVXNlclJvbGUgKGlubGluZSBMMTQxMDUtMTQzOTApXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxud2luZG93LmRlbGV0ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XG4gICAgYWxlcnQoJ05vIHBvZGVzIGVsaW1pbmFyIHR1IHByb3BpbyBhY2Nlc28uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIERlZmVuc2EgYWRpY2lvbmFsOiBhZG1pbnMgcHJvdGVnaWRvcyBubyBzZSBwdWVkZW4gZWxpbWluYXIgbmkgZGVzZGUgY29uc29sYVxuICB0cnkge1xuICAgIGNvbnN0IHNuYXBQcmUgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XG4gICAgY29uc3QgZW1haWxQcmUgPSAoc25hcFByZS5leGlzdHMgPyBzbmFwUHJlLmRhdGEoKS5lbWFpbCB8fCAnJyA6ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IFBST1RFQ1RFRCA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XG4gICAgaWYgKFBST1RFQ1RFRC5pbmRleE9mKGVtYWlsUHJlKSA+PSAwKSB7XG4gICAgICBhbGVydCgnRXN0ZSBlcyB1biBhZG1pbiBwcm90ZWdpZG8gKCcgKyBlbWFpbFByZSArICcpIHkgbm8gc2UgcHVlZGUgZWxpbWluYXIuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9IGNhdGNoIChfZSkge1xuICAgIC8qIHNpIGZhbGxhIGxhIGxlY3R1cmEgcHJldmlhLCBzaWd1ZSBjb24gY29uZmlybSAqL1xuICB9XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdFbGltaW5hciBhY2Nlc28gZGUgZXN0ZSB1c3VhcmlvP1xcblxcblBpZXJkZSBhY2Nlc28gZGUgaW5tZWRpYXRvLiBTaSB2dWVsdmUgYSBlbnRyYXIgY29uIEdvb2dsZSB2YSBhIHF1ZWRhciBjb21vIFwic2luIHJvbCBhc2lnbmFkb1wiIGhhc3RhIHF1ZSB2b3MgbG8gaGFiaWxpdGVzIGRlIG51ZXZvLlxcblxcblN1IGN1ZW50YSBHb29nbGUgc2lndWUgZXhpc3RpZW5kbywgbm8gc2UgYm9ycmEuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGNvbnN0IGRhdGEgPSBzbmFwLmV4aXN0cyA/IHNuYXAuZGF0YSgpIDoge307XG4gICAgbG9nT3AoJ2VsaW1pbmFyX3VzdWFyaW8nLCAndXNlcicsIGRhdGEuZW1haWwgfHwgdWlkLCB7XG4gICAgICB1aWQsXG4gICAgICBwcmV2aW91c1JvbGU6IGRhdGEucm9sZSxcbiAgICAgIHByZXZpb3VzVmVuZG9yOiBkYXRhLnZlbmRvcixcbiAgICB9KTtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZGVsZXRlKCk7XG4gICAgc2hvd1N5bmNUYWcoJ1VzdWFyaW8gZWxpbWluYWRvJyk7XG4gICAgYXdhaXQgb3BlbkFkbWluUGFuZWwoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZVVzZXJSb2xlJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUGFuZWwgYWRtaW46IHNldHVwIC8gcmVzZXQgZGUgMkZBIHBvciB1c3VhcmlvXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XG5cbndpbmRvdy5vcGVuVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgY29uc29sZS5sb2coJ1syRkFdIG9wZW5Ub3RwU2V0dXAgY2FsbGVkJywgeyB1aWQsIGVtYWlsLCB1c2VyUm9sZSB9KTtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSB7XG4gICAgYWxlcnQoJ1NvbG8gZWwgYWRtaW5pc3RyYWRvciBwdWVkZSBjb25maWd1cmFyIDJGQSBwYXJhIG90cm9zIHVzdWFyaW9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIXVpZCkge1xuICAgIGFsZXJ0KCdFcnJvcjogVUlEIGRlbCB1c3VhcmlvIG5vIGRpc3BvbmlibGUuIFJlY2FyZ2EgbGEgcGFnaW5hIHkgcmVpbnRlbnRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XG4gIC8vIE1vZGFsIGV4aXN0ZT9cbiAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpO1xuICBpZiAoIW1vZGFsKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkbyBlbiBlbCBET00uIFJlY2FyZ2EgbGEgcGFnaW5hIChDdHJsK1NoaWZ0K1IpLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzdWJ0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1zdWJ0Jyk7XG4gIGlmIChzdWJ0RWwpIHN1YnRFbC50ZXh0Q29udGVudCA9ICdQYXJhOiAnICsgKGVtYWlsIHx8IHVpZCk7XG4gIC8vIExlZXIgZXN0YWRvIGFjdHVhbFxuICBsZXQgY3VyRW5hYmxlZCA9IGZhbHNlO1xuICBsZXQgY3VyU2VjcmV0ID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGlmIChzbmFwLmV4aXN0cykge1xuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xuICAgICAgY3VyRW5hYmxlZCA9ICEhZC50b3RwRW5hYmxlZDtcbiAgICAgIGN1clNlY3JldCA9IGQudG90cFNlY3JldCB8fCBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1syRkFdIGRvYyByb2xlcy8nICsgdWlkICsgJyBubyBleGlzdGUnKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbMkZBXSBlcnJvciBsZXllbmRvIHJvbGVzLycgKyB1aWQsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBsZXllbmRvIGVsIGVzdGFkbyBkZSAyRkEgZGVsIHVzdWFyaW86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcbiAgaWYgKCFjKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiBjb250ZW5lZG9yIGRlbCBtb2RhbCBkZSAyRkEgbm8gZW5jb250cmFkby4gUmVjYXJnYSBsYSBwYWdpbmEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjdXJFbmFibGVkICYmIGN1clNlY3JldCkge1xuICAgIGMuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZGNmY2U3O2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzE2NjUzNDt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xuICAgICAgJzxiPiYjMTAwMDM7IDJGQSB5YSBlc3RcdTAwRTEgYWN0aXZvPC9iPiBwYXJhIGVzdGUgdXN1YXJpby4nICtcbiAgICAgICc8YnI+PHNwYW4gc3R5bGU9XCJmb250LXNpemU6MTFweFwiPlNpIGxvIHBlcmRpXHUwMEYzIG8gY2FtYmlcdTAwRjMgZGUgY2VsdWxhciwgcG9kXHUwMEU5cyBnZW5lcmFybGUgdW5vIG51ZXZvIChlbCBhbnRlcmlvciBxdWVkYSBpbnZhbGlkYWRvKS48L3NwYW4+JyArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O21hcmdpbi10b3A6MTRweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZsZXgtd3JhcDp3cmFwXCI+JyArXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJnZW5lcmF0ZU5ld1RvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgXCInLCdcIiArXG4gICAgICBlc2NhcGVBdHRyKGVtYWlsIHx8ICcnKSArXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiZGlzYWJsZVRvdHAoXFwnJyArXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xuICAgICAgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+JyArXG4gICAgICAnPC9kaXY+JztcbiAgfSBlbHNlIHtcbiAgICBjLmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2VmZjZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMxZTQwYWY7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICdFc3RlIHVzdWFyaW8gdG9kYXZcdTAwRURhIG5vIHRpZW5lIDJGQSBjb25maWd1cmFkby4gR2VuZXJcdTAwRTEgdW4gbnVldm8gY1x1MDBGM2RpZ28gcGFyYSBxdWUgbG8gZXNjYW5lZSBjb24gR29vZ2xlIEF1dGhlbnRpY2F0b3IuJyArXG4gICAgICAnPC9kaXY+JyArXG4gICAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi10b3A6MTRweFwiPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgIFwiJywnXCIgK1xuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xuICAgICAgJ1xcJylcIj5HZW5lcmFyIDJGQTwvYnV0dG9uPicgK1xuICAgICAgJzwvZGl2Pic7XG4gIH1cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XG59O1xud2luZG93LmNsb3NlVG90cFNldHVwTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XG59O1xuXG53aW5kb3cuZ2VuZXJhdGVOZXdUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGNvbnN0IHNlY3JldCA9IHRvdHBHZW5lcmF0ZVNlY3JldCgpO1xuICBjb25zdCBvdHBhdXRoID0gdG90cEJ1aWxkT3RwYXV0aFVybChzZWNyZXQsIGVtYWlsIHx8IHVpZCk7XG4gIHRvdHBTZXR1cFN0YXRlID0geyB1aWQ6IHVpZCwgZW1haWw6IGVtYWlsLCBzZWNyZXQ6IHNlY3JldCwgb3RwYXV0aDogb3RwYXV0aCB9O1xuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xuICBjLmlubmVySFRNTCA9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmZWYzYzc7Ym9yZGVyOjFweCBzb2xpZCAjZmNkMzRkO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTFweDtjb2xvcjojNzgzNTBmO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xuICAgICc8Yj5QYXNvcyBwYXJhIGFjdGl2YXI6PC9iPjxicj4nICtcbiAgICAnMS4gRWwgdXN1YXJpbyBpbnN0YWxhIDxiPkdvb2dsZSBBdXRoZW50aWNhdG9yPC9iPiBlbiBzdSBjZWx1bGFyLjxicj4nICtcbiAgICAnMi4gVG9jYSBcIkFncmVnYXJcIiAvIFwiK1wiIGVuIGxhIGFwcC48YnI+JyArXG4gICAgJzMuIEVsaWdlIFwiRXNjYW5lYXIgY1x1MDBGM2RpZ28gUVJcIiB5IGVzY2FuZWEgZWwgY1x1MDBGM2RpZ28gYWJham8gKG8gcGVnYSBlbCBzZWNyZXQgbWFudWFsbWVudGUpLjxicj4nICtcbiAgICAnNC4gQXBhcmVjZSB1biBjXHUwMEYzZGlnbyBkZSA2IGRcdTAwRURnaXRvcyBlbiBHb29nbGUgQXV0aGVudGljYXRvci48YnI+JyArXG4gICAgJzUuIExvIGVzY3JpYmUgZW4gZWwgaW5wdXQgZGUgYWJham8gcGFyYSBjb25maXJtYXIgeSBhY3RpdmFyLicgK1xuICAgICc8L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+PGRpdiBpZD1cInRvdHAtcXItY29udGFpbmVyXCIgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzoxMHB4O2JvcmRlcjoxcHggc29saWQgI2U1ZTdlYjtib3JkZXItcmFkaXVzOjZweFwiPkdlbmVyYW5kbyBRUi4uLjwvZGl2PjwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmOGZhZmM7Ym9yZGVyOjFweCBzb2xpZCAjZTJlOGYwO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTBweDt0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojNDc1NTY5O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206NHB4XCI+U2VjcmV0IChjYXJnYSBtYW51YWwgc2kgZWwgUVIgZmFsbGEpPC9kaXY+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM1YjIxYjY7d29yZC1icmVhazpicmVhay1hbGw7bGV0dGVyLXNwYWNpbmc6LjFlbVwiPicgK1xuICAgIGVzY2FwZUh0bWwoc2VjcmV0KSArXG4gICAgJzwvZGl2PicgK1xuICAgICc8L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwibWFyZ2luLWJvdHRvbToxMHB4XCI+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOiM0NzU1Njk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjVweFwiPkNcdTAwRjNkaWdvIGRlIHZlcmlmaWNhY2lcdTAwRjNuIGRlIEdvb2dsZSBBdXRoZW50aWNhdG9yPC9sYWJlbD4nICtcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJ0b3RwLWNvbmZpcm0taW5wdXRcIiBpbnB1dG1vZGU9XCJudW1lcmljXCIgbWF4bGVuZ3RoPVwiN1wiIHBsYWNlaG9sZGVyPVwiMDAwMDAwXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxOHB4O3RleHQtYWxpZ246Y2VudGVyO2xldHRlci1zcGFjaW5nOi4zZW07Zm9udC13ZWlnaHQ6ODAwXCIvPjwvZGl2Pic7XG4gIGMuaW5uZXJIVE1MICs9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+PGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJjb25maXJtVG90cFNldHVwKClcIj5WZXJpZmljYXIgeSBhY3RpdmFyPC9idXR0b24+JyArXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiY2xvc2VUb3RwU2V0dXBNb2RhbCgpXCI+Q2FuY2VsYXI8L2J1dHRvbj48L2Rpdj4nO1xuICAvLyBMYXp5LWxvYWQgcXJjb2RlanMgeSBnZW5lcmFyLiBFc3RhIGxpYnJlcmlhIHBpbnRhIGVsIFFSIGRpcmVjdG8gZW4gZWxcbiAgLy8gY29udGVuZWRvciBET00gdmlhIGNhbnZhcy9pbWcgLSBubyBuZWNlc2l0YSBjYWxsYmFjayB0b0RhdGFVUkwuXG4gIHRyeSB7XG4gICAgYXdhaXQgbG9hZFFSQ29kZUxpYigpO1xuICAgIGNvbnN0IGJveCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXFyLWNvbnRhaW5lcicpO1xuICAgIGlmICghYm94KSByZXR1cm47XG4gICAgYm94LmlubmVySFRNTCA9ICcnOyAvLyBsaW1waWFyIGVsIFwiR2VuZXJhbmRvIFFSLi4uXCJcbiAgICBuZXcgUVJDb2RlKGJveCwge1xuICAgICAgdGV4dDogb3RwYXV0aCxcbiAgICAgIHdpZHRoOiAyMjAsXG4gICAgICBoZWlnaHQ6IDIyMCxcbiAgICAgIGNvbG9yRGFyazogJyMwMDAwMDAnLFxuICAgICAgY29sb3JMaWdodDogJyNmZmZmZmYnLFxuICAgICAgY29ycmVjdExldmVsOiBRUkNvZGUuQ29ycmVjdExldmVsLk0sXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1syRkFdIEVycm9yIGNhcmdhbmRvIFFSIGxpYjonLCBlKTtcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcbiAgICBpZiAoYm94KVxuICAgICAgYm94LmlubmVySFRNTCA9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk5MWIxYjtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcbiAgfVxufTtcblxud2luZG93LmNvbmZpcm1Ub3RwU2V0dXAgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghdG90cFNldHVwU3RhdGUpIHJldHVybjtcbiAgY29uc3QgY29kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1jb25maXJtLWlucHV0JykudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xuICBpZiAoIS9eXFxkezZ9JC8udGVzdChjb2RlKSkge1xuICAgIGFsZXJ0KCdJbmdyZXNcdTAwRTEgbG9zIDYgZFx1MDBFRGdpdG9zLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBvayA9IGF3YWl0IHRvdHBWZXJpZnlDb2RlKHRvdHBTZXR1cFN0YXRlLnNlY3JldCwgY29kZSwgMSk7XG4gIGlmICghb2spIHtcbiAgICBhbGVydChcbiAgICAgICdDXHUwMEYzZGlnbyBpbmNvcnJlY3RvLiBBc2VndXJhdGUgZGUgcXVlIGVsIHNlY3JldCBzZSBjYXJnXHUwMEYzIGJpZW4gZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IgeSByZWludGVudFx1MDBFMS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpXG4gICAgICAudXBkYXRlKHtcbiAgICAgICAgdG90cFNlY3JldDogdG90cFNldHVwU3RhdGUuc2VjcmV0LFxuICAgICAgICB0b3RwRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgdG90cEVuYWJsZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIHRvdHBFbmFibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgfSk7XG4gICAgc2hvd1N5bmNUYWcoJzJGQSBhY3RpdmFkbyBwYXJhICcgKyAodG90cFNldHVwU3RhdGUuZW1haWwgfHwgJ3VzdWFyaW8nKSk7XG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignc2F2ZSB0b3RwJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBpZiAoIWNvbmZpcm0oJ0Rlc2hhYmlsaXRhciAyRkEgcGFyYSBlc3RlIHVzdWFyaW8/IFZhIGEgZW50cmFyIHNvbG8gY29uIHBhc3N3b3JkLicpKSByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModWlkKVxuICAgICAgLnVwZGF0ZSh7XG4gICAgICAgIHRvdHBFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXG4gICAgICAgIHRvdHBEaXNhYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdG90cERpc2FibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgfSk7XG4gICAgc2hvd1N5bmNUYWcoJzJGQSBkZXNoYWJpbGl0YWRvJyk7XG4gICAgY2xvc2VUb3RwU2V0dXBNb2RhbCgpO1xuICAgIHRyeSB7XG4gICAgICBvcGVuQWRtaW5QYW5lbCgpO1xuICAgIH0gY2F0Y2ggKF9lKSB7fVxuICB9IGNhdGNoIChlKSB7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5jaGFuZ2VVc2VyUGFzc3dvcmQgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKCFlbWFpbCkge1xuICAgIGFsZXJ0KCdFc3RlIHVzdWFyaW8gbm8gdGllbmUgZW1haWwgcmVnaXN0cmFkbyAtIG5vIHNlIHB1ZWRlIHJlc2V0ZWFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBjaG9pY2UgPSBwcm9tcHQoXG4gICAgJ1Jlc2V0ZWFyIGNvbnRyYXNlXHUwMEYxYSBkZSAnICtcbiAgICAgIGVtYWlsICtcbiAgICAgICdcXG5cXG4nICtcbiAgICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXG4gICAgICAnMSkgRU5WSUFSIE1BSUwgREUgUkVTRVRFTyAocmVjb21lbmRhZG8pXFxuJyArXG4gICAgICAnICAgTGUgbGxlZ2EgYSAnICtcbiAgICAgIGVtYWlsICtcbiAgICAgICcgdW4gbWFpbCBkZSBGaXJlYmFzZSBjb24gdW4gbGluay5cXG4nICtcbiAgICAgICcgICBFbCB1c3VhcmlvIGNsaWNrZWEsIHNldGVhIHN1IG51ZXZhIHBhc3N3b3JkIHkgdnVlbHZlIGEgbGEgYXBwLlxcbicgK1xuICAgICAgJyAgIEVzIGxvIGVzdGFuZGFyIHkgZnVuY2lvbmEgc2VndXJvLlxcblxcbicgK1xuICAgICAgJzIpIFJlc2V0ZWFyIFNPTE8gZWwgcGFzc3dvcmQtZ2F0ZSAoc2VndW5kYSBjYXBhKS5cXG4nICtcbiAgICAgICcgICBObyBjYW1iaWEgbGEgcGFzc3dvcmQgcmVhbCBkZSBGaXJlYmFzZS4gU2lydmUgc2kgZWwgdXN1YXJpb1xcbicgK1xuICAgICAgJyAgIGVudHJhIHBvciBHb29nbGUgeSBvbHZpZG8gbGEgcGFzc3dvcmQtZ2F0ZSBkZSBsYSBhcHAsIE5PIHNpXFxuJyArXG4gICAgICAnICAgb2x2aWRvIGxhIHBhc3N3b3JkIGRlbCBsb2dpbiBjb24gZW1haWwuXFxuXFxuJyArXG4gICAgICAnRXNjcmliaSAxIG8gMjonLFxuICAgICcxJ1xuICApO1xuICBpZiAoY2hvaWNlID09PSBudWxsKSByZXR1cm47XG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZmJBdXRoLnNlbmRQYXNzd29yZFJlc2V0RW1haWwoZW1haWwpO1xuICAgICAgYWxlcnQoXG4gICAgICAgICdPSyAtIGxlIGVudmllIHVuIG1haWwgZGUgcmVzZXRlbyBhICcgK1xuICAgICAgICAgIGVtYWlsICtcbiAgICAgICAgICAnLiBEZWNpbGUgcXVlIHJldmlzZSBpbmJveCB5IHNwYW0uIEVsIGxpbmsgZXhwaXJhIGVuIDEgaG9yYS4nXG4gICAgICApO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZmJEYlxuICAgICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAgICAgLmRvYyh1aWQpXG4gICAgICAgICAgLnVwZGF0ZSh7XG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxuICAgICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignc2VuZFBhc3N3b3JkUmVzZXRFbWFpbCcsIGUpO1xuICAgICAgYWxlcnQoJ0Vycm9yIGVudmlhbmRvIGVsIG1haWw6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcbiAgICBjb25zdCBuZXdQd2QgPSBwcm9tcHQoXG4gICAgICAnTnVldmEgcGFzc3dvcmQtZ2F0ZSBwYXJhICcgK1xuICAgICAgICBlbWFpbCArXG4gICAgICAgICc6XFxuXFxuKFNvbG8gYWZlY3RhIGxhIHNlZ3VuZGEgY2FwYSBkZSBsYSBhcHAsIE5PIGVsIGxvZ2luIGNvbiBlbWFpbCknLFxuICAgICAgJydcbiAgICApO1xuICAgIGlmIChuZXdQd2QgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBwd2QgPSAobmV3UHdkIHx8ICcnKS50cmltKCk7XG4gICAgaWYgKHB3ZC5sZW5ndGggPCA0KSB7XG4gICAgICBhbGVydCgnTGEgY29udHJhc2VcdTAwRjFhIHRpZW5lIHF1ZSB0ZW5lciBhbCBtZW5vcyA0IGNhcmFjdGVyZXMuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjcmVkcyA9IGF3YWl0IGJ1aWxkUGFzc3dvcmRDcmVkZW50aWFscyhwd2QpO1xuICAgICAgYXdhaXQgZmJEYlxuICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgICAuZG9jKHVpZClcbiAgICAgICAgLnVwZGF0ZSh7XG4gICAgICAgICAgcGFzc3dvcmRIYXNoOiBjcmVkcy5wYXNzd29yZEhhc2gsXG4gICAgICAgICAgcGFzc3dvcmRTYWx0OiBjcmVkcy5wYXNzd29yZFNhbHQsXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZ2F0ZV9vbmx5JyxcbiAgICAgICAgfSk7XG4gICAgICBzaG93U3luY1RhZygnUGFzc3dvcmQtZ2F0ZSBhY3R1YWxpemFkYSBwYXJhICcgKyBlbWFpbCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcbiAgICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGFsZXJ0KCdPcGNpb24gbm8gdmFsaWRhLiBDYW5jZWxhZG8uJyk7XG59O1xuXG53aW5kb3cuc2F2ZVVzZXJSb2xlID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgYnRuKSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGJ0bi5jbG9zZXN0KCd0cicpIHx8IGJ0bi5jbG9zZXN0KCcudXNlcnMtY2FyZCcpO1xuICBpZiAoIWNvbnRhaW5lcikgcmV0dXJuO1xuICBjb25zdCByb2xlID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yb2xlLXNlbCcpLnZhbHVlO1xuICBjb25zdCB2ZW5kb3IgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnZlbmRvci1zZWwnKS52YWx1ZSB8fCBudWxsO1xuICBjb25zdCBpbnRlcm5hbFNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcuaW50ZXJuYWwtc2VsJyk7XG4gIGNvbnN0IGludGVybmFsUGFydG5lclVpZCA9IGludGVybmFsU2VsID8gaW50ZXJuYWxTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxuICBjb25zdCB3YUlucHV0ID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy53YS1pbnB1dCcpO1xuICBjb25zdCB3aGF0c2FwcCA9IHdhSW5wdXQgPyAod2FJbnB1dC52YWx1ZSB8fCAnJykucmVwbGFjZSgvXFxEL2csICcnKSA6ICcnO1xuICBpZiAod2hhdHNhcHAgJiYgd2hhdHNhcHAubGVuZ3RoIDwgOCkge1xuICAgIGFsZXJ0KFxuICAgICAgJ0VsIG51bWVybyBkZSBXaGF0c0FwcCBlcyBtdXkgY29ydG8uIFRpZW5lIHF1ZSBzZXIgZWwgbnVtZXJvIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoZWouIDU0OTExMjY3NjIwMzEgcGFyYSBBcmdlbnRpbmEpLidcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcyAodWlkIGRlbCB1c3VhcmlvIHF1ZSBhcHJ1ZWJhKVxuICBjb25zdCByZW5kQXBwcm92ZXJTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnJlbmQtYXBwcm92ZXItc2VsJyk7XG4gIGNvbnN0IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kQXBwcm92ZXJTZWwgPyByZW5kQXBwcm92ZXJTZWwudmFsdWUgfHwgbnVsbCA6IG51bGw7XG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xuICAvLyB2ZW5kZWRvcmVzIG5vIHB1ZWRlbiBsZWVyIC9yb2xlcy97b3Ryb1VpZH0gcG9yIHNlY3VyaXR5IHJ1bGVzLCBhc2kgcXVlXG4gIC8vIG5lY2VzaXRhbiBlbCBlbWFpbCBhY2EgcGFyYSBwb2RlciBtYW5kYXIgbGEgcmVuZGljaW9uIChyZXNvbHZlTXlSZW5kaWNpb25lc0FwcHJvdmVyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xuICAvLyBwdWJsaWNvICh1c2Vyc19kaXJlY3RvcnkpIHF1ZSBzb2xvIHNlIHNpbmNyb25pemEgY3VhbmRvIGFkbWluIGFicmUgZWwgcGFuZWwuXG4gIGxldCByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBudWxsO1xuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xuICAgIGNvbnN0IGFwcHJvdmVyVXNlciA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maW5kKCh1KSA9PiB1Ll91aWQgPT09IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpO1xuICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IGFwcHJvdmVyVXNlciA/IGFwcHJvdmVyVXNlci5lbWFpbCB8fCBudWxsIDogbnVsbDtcbiAgfVxuICBidG4uZGlzYWJsZWQgPSB0cnVlO1xuICBidG4udGV4dENvbnRlbnQgPSAnLi4uJztcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiXG4gICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgLmRvYyh1aWQpXG4gICAgICAuc2V0KFxuICAgICAgICB7XG4gICAgICAgICAgcm9sZSxcbiAgICAgICAgICB2ZW5kb3IsXG4gICAgICAgICAgaW50ZXJuYWxQYXJ0bmVyVWlkLFxuICAgICAgICAgIHdoYXRzYXBwOiB3aGF0c2FwcCB8fCBudWxsLFxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQsXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsOiByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwsXG4gICAgICAgICAgYXNzaWduZWRCeTogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIGFzc2lnbmVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICB9LFxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cbiAgICAgICk7XG4gICAgLy8gU2kgZWwgdXN1YXJpbyBlZGl0byBzdSBwcm9waW8gbnVtZXJvLCBhY3R1YWxpemFyIGVsIGNhY2hlIGxvY2FsXG4gICAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XG4gICAgICBteVdoYXRzYXBwTnVtYmVyID0gd2hhdHNhcHAgfHwgbnVsbDtcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlclVpZCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgbnVsbDtcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsIHx8IG51bGw7XG4gICAgfVxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdPSyc7XG4gICAgLy8gUmUtcmVuZGVyIGRlbCBwYW5lbCBhc2kgbG9zIGRyb3Bkb3ducyBcIlBhcmVqYSBpbnRlcm5vXCIgbXVlc3RyYW4gbG9zIGludGVybm9zIGFjdHVhbGl6YWRvc1xuICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcigncmVmcmVzaCBhZG1pbiBwYW5lbCcsIGUpO1xuICAgICAgfVxuICAgIH0sIDQwMCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlVXNlclJvbGUnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xuICB9XG59O1xuXG4vLyBUb2RvcyBsb3MgaGFuZGxlcnMgd2luZG93LmZvbyA9IGZ1bmN0aW9uLi4uIHlhIHNvbiB2ZXJiYXRpbS5cbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQXVCQSxNQUFJLE9BQU8sT0FBTyxlQUFl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
