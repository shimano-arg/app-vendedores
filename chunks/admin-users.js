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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEFETUlOLVVTRVJTOiBQYW5lbCBBZG1pbiBjb21wbGV0byBjb24gNiBzdWJkb21pbmlvcyAoYWxsb3dlZCBlbWFpbHMsIEdlbWluaSxcclxuLy8gR21hcHMsIGJ1bGsgYXBwcm92ZXIsIGFkbWluIHBhbmVsIHByaW5jaXBhbCwgMkZBL1RPVFAsIGNoYW5nZSBwYXNzd29yZCkgK1xyXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3NcclxuLy8gZGlzY29udGludW9zIHNlcGFyYWRvcyBwb3IgU0FQIGRvbWFpbiBzdHVicykgY29tbyBwYXJ0ZSBkZSBFMi5vIChlMmItcGVyZiAyMDI2LTA3LTI4KS5cclxuLy8gVUxUSU1PIGRvbWluaW8gZ3JhbmRlIGEgZXh0cmFlci5cclxuLy9cclxuLy8gdjU1MSAoMjAyNi0wOC0xOSkgU0VDVVJJVFk6IGVsaW1pbmFkbyBlbCBLTk9XTiBCVUcgZGVsIGdlbWluaUFwaUtleUNhY2hlXHJcbi8vIGNyb3NzLW1vZHVsZS4gTGEga2V5IHlhIG5vIHZpdmUgZW4gRmlyZXN0b3JlIG5pIGNhY2hlYSBuYWRhIGZyb250ZW5kIFx1MjAxNFxyXG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cclxuLy9cclxuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGU6IHVzZXJzQ2FjaGUsIGdtYXBzQXBpS2V5Q2FjaGUsIHRvdHBTZXR1cFN0YXRlIChsZXQgbG9jYWwgYWwgYnVuZGxlLFxyXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXHJcbi8vIGxlZSB1c2Vyc0NhY2hlIGNvbW8gaWRlbnRpZmllciBsaWJyZS4gRW4gYnVuZGxlIFwidXNlIHN0cmljdFwiIHVuIHJlYWQgYVxyXG4vLyBpZGVudGlmaWVyIG5vLWRlY2xhcmFkbyBuaSBlbiB3aW5kb3cgdGlyYSBSZWZlcmVuY2VFcnJvci4gUHJvbW9jaW9uYXIgYVxyXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcclxuLy8geSBidW5kbGUgbm90aWZpY2FjaW9uZXMgKHNoZWxsKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cudXNlcnNDYWNoZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51c2Vyc0NhY2hlID0gW107XHJcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcclxuXHJcbmZ1bmN0aW9uIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KSB7XHJcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBhbGxvd2VkTGlzdCA9IChhbGxvd2VkTGlzdCB8fCBbXSlcclxuICAgIC5zbGljZSgpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gKGEuZW1haWwgfHwgJycpLmxvY2FsZUNvbXBhcmUoYi5lbWFpbCB8fCAnJykpO1xyXG4gIGxldCBodG1sID0gJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPlNpIHVuIHZlbmRlZG9yIHVzYSBHbWFpbCBwZXJzb25hbCAobm8gQHNoaW1hbm8uY29tLmFyKSwgYWdyZWdhbG8gYWNhIGFudGVzIHF1ZSBpbnRlbnRlIGxvZ3VlYXIuIExvcyBlbWFpbHMgQHNoaW1hbm8uY29tLmFyIHkgbG9zIGFkbWlucyBoYXJkY29kZWQgeWEgZXN0YW4gYXV0b3JpemFkb3MgYXV0b21hdGljYW1lbnRlLjwvZGl2Pic7XHJcbiAgaHRtbCArPSAnPC9kaXY+JztcclxuICBpZiAoIWFsbG93ZWRMaXN0Lmxlbmd0aCkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMCAxMHB4XCI+Tm8gaGF5IGVtYWlscyBwcmUtYXV0b3JpemFkb3MgdG9kYXZpYS48L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xyXG4gICAgYWxsb3dlZExpc3QuZm9yRWFjaCgoYWUpID0+IHtcclxuICAgICAgY29uc3QgbGFiZWwgPSBlc2NhcGVIdG1sKGFlLmVtYWlsIHx8IGFlLl9pZCk7XHJcbiAgICAgIGNvbnN0IG5vdGUgPSBhZS5ub3RlID8gJyAmbWlkZG90OyAnICsgZXNjYXBlSHRtbChhZS5ub3RlKSA6ICcnO1xyXG4gICAgICBodG1sICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICNiZmRiZmU7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6M3B4IDRweCAzcHggMTBweDtmb250LXNpemU6MTFweDtjb2xvcjojMWU0MGFmO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xyXG4gICAgICAgIGxhYmVsICtcclxuICAgICAgICBub3RlICtcclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwicmVtb3ZlQWxsb3dlZEVtYWlsKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIoYWUuX2lkKSArXHJcbiAgICAgICAgJ1xcJylcIiB0aXRsZT1cIlF1aXRhciBhdXRvcml6YWNpb25cIiBzdHlsZT1cImJhY2tncm91bmQ6I2RjMjYyNjtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6NTAlO3dpZHRoOjE4cHg7aGVpZ2h0OjE4cHg7Zm9udC1zaXplOjExcHg7Y3Vyc29yOnBvaW50ZXI7bGluZS1oZWlnaHQ6MVwiPiZ0aW1lczs8L2J1dHRvbj4nICtcclxuICAgICAgICAnPC9kaXY+JztcclxuICAgIH0pO1xyXG4gICAgaHRtbCArPSAnPC9kaXY+JztcclxuICB9XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1ibHVlXCIgb25jbGljaz1cImFkZEFsbG93ZWRFbWFpbCgpXCI+JiM0MzsgQWdyZWdhciBlbWFpbDwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG5cclxud2luZG93LmFkZEFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoJ0VtYWlsIGEgYXV0b3JpemFyIChlai4gYXV0b21hdHJpeC5vZmljaWFsQGdtYWlsLmNvbSk6Jyk7XHJcbiAgaWYgKCFyYXcpIHJldHVybjtcclxuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcclxuICBpZiAoIS9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvLnRlc3QoZW1haWwpKSB7XHJcbiAgICBhbGVydCgnRWwgZW1haWwgbm8gcGFyZWNlIHZhbGlkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgbm90ZSA9XHJcbiAgICBwcm9tcHQoJ05vdGEgY29ydGEgb3BjaW9uYWwgKGVqLiBcIlZlbmRlZG9yIFoxIEdvbnphbG9cIiBvIFwiUmVlbXBsYXpvIGRlIE1hdXJpY2lvXCIpOicsICcnKSB8fCAnJztcclxuICBjb25zdCBkb2NJZCA9IGVtYWlsVG9Eb2NJZChlbWFpbCk7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJylcclxuICAgICAgLmRvYyhkb2NJZClcclxuICAgICAgLnNldChcclxuICAgICAgICB7XHJcbiAgICAgICAgICBlbWFpbCxcclxuICAgICAgICAgIG5vdGU6IG5vdGUudHJpbSgpLFxyXG4gICAgICAgICAgYWRkZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICBhZGRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICBhZGRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxyXG4gICAgICApO1xyXG4gICAgc2hvd1N5bmNUYWcoJ0VtYWlsIGF1dG9yaXphZG86ICcgKyBlbWFpbCk7XHJcbiAgICAvLyBSZWNhcmdhciBwYW5lbFxyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2FkZEFsbG93ZWRFbWFpbCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LnJlbW92ZUFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uIChkb2NJZCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnUXVpdGFyIGxhIGF1dG9yaXphY2lvbiBkZSBlc3RlIGVtYWlsPyBTaSBlbCB1c3VhcmlvIHlhIHRpZW5lIHJvbCBhc2lnbmFkbyBlbiBlbCBwYW5lbCwgdmEgYSBzZWd1aXIgZW50cmFuZG8gKGxhIHJlZ2xhIHByZS1hcHJvYmFkYSBwb3Igcm9sIHRhbWJpZW4gYXBsaWNhKS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5kZWxldGUoKTtcclxuICAgIHNob3dTeW5jVGFnKCdBdXRvcml6YWNpb24gcXVpdGFkYScpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3JlbW92ZUFsbG93ZWRFbWFpbCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09IFNlY2Npb24gR2VtaW5pIEFQSSBLZXkgKGFkbWluKSA9PT1cclxuZnVuY3Rpb24gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihfZGF0YSkge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dlbWluaS1jb25maWctc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICAvLyB2NTUxICgyMDI2LTA4LTE5KSBTRUNVUklUWTogbGEga2V5IHZpdmUgZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuIEZpcmVzdG9yZS5cclxuICAvLyB2NjM5ICgyMDI2LTA4LTI2KTogVVggc2ltcGxpZmljYWRvIHBvciBwZWRpZG8gTWFyaWFubyBcdTIwMTQgc2luIGluc3RydWNjaW9uZXNcclxuICAvLyBDTEkgZW4gZWwgcGFuZWwsIHNvbG8gdW4gYmFubmVyIGV4cGxpY2FuZG8gZG9uZGUgdml2ZSBsYSBrZXkuXHJcbiAgLy8gU2UgYWRtaW5pc3RyYSBwb3IgQ0xJIChmaXJlYmFzZSBmdW5jdGlvbnM6c2VjcmV0czpzZXQgR0VNSU5JX0FQSV9LRVkpLlxyXG4gIGVsLnRleHRDb250ZW50ID0gJyc7XHJcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIHdyYXAuc3R5bGUuY3NzVGV4dCA9XHJcbiAgICAndGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxNHB4IDEycHg7YmFja2dyb3VuZDojZjVmM2ZmO2JvcmRlcjoxcHggc29saWQgI2RkZDZmZTtib3JkZXItcmFkaXVzOjZweCc7XHJcbiAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICB0aXRsZS5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNWIyMWI2O21hcmdpbi1ib3R0b206NnB4JztcclxuICB0aXRsZS50ZXh0Q29udGVudCA9ICdHZW1pbmkgQVBJIEtleSAoT0NSIGRlIHRpY2tldHMpJztcclxuICBjb25zdCBtc2cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiJztcclxuICAvLyBJY29ubyBjYW5kYWRvICsgdGV4dG8uIHRleHRDb250ZW50IGVzIHNhZmUgKG5vIEhUTUwgcGFyc2luZykuXHJcbiAgbXNnLnRleHRDb250ZW50ID0gJ1x1RDgzRFx1REQxMiBHdWFyZGFkbyBwb3Igc2VndXJpZGFkIGVuIEdvb2dsZSBTZWNyZXQgTWFuYWdlcic7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZCh0aXRsZSk7XHJcbiAgd3JhcC5hcHBlbmRDaGlsZChtc2cpO1xyXG4gIGVsLmFwcGVuZENoaWxkKHdyYXApO1xyXG59XHJcblxyXG4vLyB2NTUxOiBzYXZlR2VtaW5pQXBpS2V5ICsgZGVsZXRlR2VtaW5pQXBpS2V5IGVsaW1pbmFkb3MuIExhIGtleSB2aXZlXHJcbi8vIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuIFNlIGFkbWluaXN0cmEgcG9yIENMSS4gVmVyXHJcbi8vIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24gcGFyYSBsYXMgaW5zdHJ1Y2Npb25lcy5cclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBHT09HTEUgTUFQUyBHZW9jb2RpbmcgQVBJIC0gbWVqb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsIHF1ZSBPU01cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3NcclxuLy8gY29tbyBnZW9jb2RlciBQUklNQVJJTyBlbiBnZW9jb2RlQ2xpZW50QWRkcmVzczsgc2kgZmFsbGEgbyBubyBlc3RhXHJcbi8vIHNldGVhZGEsIGNhZW1vcyBhIGxhIGNhc2NhZGEgT1NNIE5vbWluYXRpbSBjb21vIGZhbGxiYWNrLlxyXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XHJcbmFzeW5jIGZ1bmN0aW9uIGdldEdtYXBzQXBpS2V5KCkge1xyXG4gIGlmIChnbWFwc0FwaUtleUNhY2hlKSByZXR1cm4gZ21hcHNBcGlLZXlDYWNoZTtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcclxuICAgIGlmIChzbmFwLmV4aXN0cykge1xyXG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XHJcbiAgICAgIGlmIChkLmFwaUtleSkge1xyXG4gICAgICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBkLmFwaUtleTtcclxuICAgICAgICByZXR1cm4gZC5hcGlLZXk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1tnbWFwc10gbm8gc2UgcHVkbyBsZWVyIGFwaSBrZXknLCBlKTtcclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuZnVuY3Rpb24gcmVuZGVyR21hcHNDb25maWdTZWN0aW9uKGRhdGEpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnbWFwcy1jb25maWctc2VjdGlvbicpO1xyXG4gIGlmICghZWwpIHJldHVybjtcclxuICBjb25zdCBoYXNLZXkgPSBkYXRhICYmIGRhdGEuYXBpS2V5O1xyXG4gIGNvbnN0IG1hc2tlZCA9IGhhc0tleSA/IGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkgOiAnJztcclxuICBjb25zdCB1cGRhdGVkQnkgPSAoZGF0YSAmJiBkYXRhLnVwZGF0ZWRCeSkgfHwgJyc7XHJcbiAgY29uc3QgdXBkYXRlZEF0ID1cclxuICAgIGRhdGEgJiYgZGF0YS51cGRhdGVkQXQgJiYgZGF0YS51cGRhdGVkQXQudG9EYXRlXHJcbiAgICAgID8gZGF0YS51cGRhdGVkQXQudG9EYXRlKCkudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJylcclxuICAgICAgOiAnJztcclxuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojMDY1ZjQ2XCI+R29vZ2xlIE1hcHMgQVBJIEtleSAoZ2VvY29kaW5nKTwvZGl2Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+Q29udmllcnRlIGRpcmVjY2lvbmVzIGEgY29vcmRlbmFkYXMgY29uIG11Y2hhIG1lam9yIHByZWNpc2lcdTAwRjNuIHF1ZSBPU00gKHNvYnJlIHRvZG8gZW4gbG9jYWxpZGFkZXMgY2hpY2FzKS4gQ29zdG8gZ3JhdGlzIGhhc3RhIDQwLjAwMCByZXF1ZXN0cy9tZXMuPC9kaXY+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGlmIChoYXNLZXkpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7ZmxleC13cmFwOndyYXA7bWFyZ2luLWJvdHRvbToxMHB4O2p1c3RpZnktY29udGVudDpjZW50ZXJcIj4nO1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPHNwYW4gc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjExcHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgIzZlZTdiNztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjRweCA4cHg7Y29sb3I6IzA2NWY0NlwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKG1hc2tlZCkgK1xyXG4gICAgICAnPC9zcGFuPic7XHJcbiAgICBodG1sICs9XHJcbiAgICAgICc8c3BhbiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGJcIj5DYXJnYWRhIHBvciAnICtcclxuICAgICAgZXNjYXBlSHRtbCh1cGRhdGVkQnkgfHwgJ2FkbWluJykgK1xyXG4gICAgICAodXBkYXRlZEF0ID8gJyAoJyArIGVzY2FwZUh0bWwodXBkYXRlZEF0KSArICcpJyA6ICcnKSArXHJcbiAgICAgICc8L3NwYW4+JztcclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgfSBlbHNlIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xyXG4gIH1cclxuICBodG1sICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1jeWFuXCIgb25jbGljaz1cInNhdmVHbWFwc0FwaUtleSgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiMxMGI5ODFcIj4nICtcclxuICAgIChoYXNLZXkgPyAnQ2FtYmlhciBrZXknIDogJ0NhcmdhciBrZXknKSArXHJcbiAgICAnPC9idXR0b24+JztcclxuICBpZiAoaGFzS2V5KVxyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcclxuICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbn1cclxud2luZG93LnNhdmVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBjb25zdCByYXcgPSBwcm9tcHQoXHJcbiAgICAnUGVnYSBhY2EgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcyAoZm9ybWF0byBBSXphU3kuLi4pLlxcblxcbklNUE9SVEFOVEU6IGVuIEdvb2dsZSBDbG91ZCBDb25zb2xlIHJlc3RyaW5naSBsYSBrZXkgcG9yIEhUVFAgcmVmZXJyZXIgYSBodHRwczovL3NoaW1hbm8tYXJnLmdpdGh1Yi5pby8qIHBhcmEgcXVlIG5hZGllIHRlIGxhIHJvYmUuJyxcclxuICAgICcnXHJcbiAgKTtcclxuICBpZiAocmF3ID09PSBudWxsKSByZXR1cm47XHJcbiAgY29uc3Qga2V5ID0gcmF3LnRyaW0oKTtcclxuICBpZiAoIWtleSkge1xyXG4gICAgYWxlcnQoJ1ZhY2lhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7XHJcbiAgICBhbGVydCgnTGEga2V5IHBhcmVjZSBtdXkgY29ydGEuIFJldmlzYSBxdWUgbGEgcGVnYXN0ZSBjb21wbGV0YS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgICAuZG9jKCdnb29nbGVfbWFwcycpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgYXBpS2V5OiBrZXksXHJcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgdXBkYXRlZEJ5VWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XHJcbiAgICAgICk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xyXG4gICAgc2hvd1N5bmNUYWcoJ0dvb2dsZSBNYXBzIEFQSSBrZXkgZ3VhcmRhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxud2luZG93LmRlbGV0ZUdtYXBzQXBpS2V5ID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnQm9ycmFyIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHM/IEVsIGdlb2NvZGluZyB2dWVsdmUgYSBPU00gKHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZGVsZXRlKCk7XHJcbiAgICBnbWFwc0FwaUtleUNhY2hlID0gbnVsbDtcclxuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVHbWFwc0FwaUtleScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEJVTEsgQVBQUk9WRVIgLSBhc2lnbmFyIGVsIG1pc21vIFwiUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXNcIlxyXG4vLyBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBVdGlsIGN1YW5kbyB1biBzb2xvIGFwcm9iYWRvciAoZWouIFBhYmxvIGdlcmVudGUpIHJldmlzYSBsYXNcclxuLy8gcmVuZGljaW9uZXMgZGUgVE9ET1MgbG9zIHZlbmRlZG9yZXMuIFNpbiBlc3RvIGVsIGFkbWluIHRpZW5lIHF1ZVxyXG4vLyBhYnJpciBjYWRhIGZpbGEgZGVsIHBhbmVsIFVzdWFyaW9zIHkgc2V0ZWFyIGVsIGRyb3Bkb3duIHVuYSBhIHVuYS5cclxuZnVuY3Rpb24gcmVuZGVyQnVsa0FwcHJvdmVyU2VjdGlvbigpIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlY3Rpb24nKTtcclxuICBpZiAoIWVsKSByZXR1cm47XHJcbiAgY29uc3QgY2FuZGlkYXRlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoXHJcbiAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXHJcbiAgKTtcclxuICBjb25zdCB2ZW5kZWRvcmVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSAndmVuZGVkb3InKTtcclxuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojYTIxY2FmXCI+QXByb2JhZG9yIGRlIFJlbmRpY2lvbmVzIC0gYXNpZ25hY2lvbiBtYXNpdmE8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkFwbGljYSBlbCBtaXNtbyByZXNwb25zYWJsZSBhIFRPRE9TIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suIFV0aWwgY3VhbmRvIHVuIGdlcmVudGUgY29tZXJjaWFsIGNlbnRyYWxpemEgbGEgYXByb2JhY2lvbi48L2Rpdj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaWYgKCFjYW5kaWRhdGVzLmxlbmd0aCkge1xyXG4gICAgaHRtbCArPVxyXG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIGFkbWluIC8gZ2VyZW50ZSAvIGludGVybm8uIFByaW1lcm8gYXNpZ25hIHVuIHJvbCBhIGFsZ3VpZW4uPC9kaXY+JztcclxuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6NnB4IDBcIj5ObyBoYXkgdXN1YXJpb3MgY29uIHJvbCB2ZW5kZWRvciB0b2RhdmlhLjwvZGl2Pic7XHJcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBodG1sICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtnYXA6OHB4O2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcclxuICBodG1sICs9XHJcbiAgICAnPHNlbGVjdCBpZD1cImJ1bGstYXBwcm92ZXItc2VsZWN0XCIgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCAjZjBhYmZjO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6I2ZmZjtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xyXG4gIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciBhcHJvYmFkb3IgLTwvb3B0aW9uPic7XHJcbiAgY2FuZGlkYXRlcy5mb3JFYWNoKCh1KSA9PiB7XHJcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xyXG4gICAgaHRtbCArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBlc2NhcGVBdHRyKHUuX3VpZCkgKyAnXCI+JyArIGVzY2FwZUh0bWwobGJsKSArICc8L29wdGlvbj4nO1xyXG4gIH0pO1xyXG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiYnVsa0Fzc2lnbkFwcHJvdmVyKClcIj5Bc2lnbmFyIGEgVE9ET1MgbG9zIHZlbmRlZG9yZXMgKCcgK1xyXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xyXG4gICAgJyk8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG53aW5kb3cuYnVsa0Fzc2lnbkFwcHJvdmVyID0gYXN5bmMgZnVuY3Rpb24gKCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xyXG4gICAgYWxlcnQoJ1NvbG8gYWRtaW4uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlbGVjdCcpO1xyXG4gIGNvbnN0IHVpZCA9IHNlbCAmJiBzZWwudmFsdWU7XHJcbiAgaWYgKCF1aWQpIHtcclxuICAgIGFsZXJ0KCdFbGVnJmlhY3V0ZTsgdW4gYXByb2JhZG9yIGRlbCBkcm9wZG93bi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYXBwcm92ZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSB1aWQpO1xyXG4gIGlmICghYXBwcm92ZXIpIHtcclxuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XHJcbiAgaWYgKCF2ZW5kZWRvcmVzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ05vIGhheSB2ZW5kZWRvcmVzIHBhcmEgYXNpZ25hci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYXBwcm92ZXJMYWJlbCA9IGFwcHJvdmVyLmRpc3BsYXlOYW1lIHx8IGFwcHJvdmVyLmVtYWlsIHx8IGFwcHJvdmVyLl91aWQ7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdBc2lnbmFyIGEgJyArXHJcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXHJcbiAgICAgICAgJyBjb21vIGFwcm9iYWRvciBkZSBsb3MgJyArXHJcbiAgICAgICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xyXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICBsZXQgb2tDb3VudCA9IDAsXHJcbiAgICBfZXJyQ291bnQgPSAwO1xyXG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxyXG4gIGNvbnN0IGJhdGNoID0gZmJEYi5iYXRjaCgpO1xyXG4gIHZlbmRlZG9yZXMuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xyXG4gICAgYmF0Y2gudXBkYXRlKHJlZiwge1xyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVWlkOiB1aWQsXHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgIH0pO1xyXG4gIH0pO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcclxuICAgIG9rQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcclxuICAgIGlmICh0eXBlb2YgbG9nT3AgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xyXG4gICAgICAgIGFwcHJvdmVyVWlkOiB1aWQsXHJcbiAgICAgICAgYXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXHJcbiAgICAgICAgdmVuZGVkb3JVaWRzOiB2ZW5kZWRvcmVzLm1hcCgodikgPT4gdi5fdWlkKSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignYnVsa0Fzc2lnbkFwcHJvdmVyJywgZSk7XHJcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxuICBpZiAob2tDb3VudCkge1xyXG4gICAgc2hvd1N5bmNUYWcob2tDb3VudCArICcgdmVuZGVkb3IoZXMpIGFzaWduYWRvKHMpIGEgJyArIGFwcHJvdmVyTGFiZWwpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgIH0gY2F0Y2ggKF9lKSB7fSAvLyByZWZyZXNjYXJcclxuICB9XHJcbn07XHJcblxyXG4vLyBHZW9jb2RpbmcgY29uIEdvb2dsZSBNYXBzIEFQSS4gRGV2dWVsdmUge2xhdCwgbG5nLCBkaXNwbGF5LCBwcmVjaXNpb259XHJcbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXHJcbmFzeW5jIGZ1bmN0aW9uIF9nZW9jb2RlV2l0aEdvb2dsZU1hcHMoYWRkcmVzcywgbG9jYWxpdHksIHByb3ZpbmNlQ29kZSkge1xyXG4gIGNvbnN0IGtleSA9IGF3YWl0IGdldEdtYXBzQXBpS2V5KCk7XHJcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHByb3YgPSB0eXBlb2YgdGl0bGVDYXNlID09PSAnZnVuY3Rpb24nID8gdGl0bGVDYXNlKHByb3ZpbmNlQ29kZSB8fCAnJykgOiBwcm92aW5jZUNvZGUgfHwgJyc7XHJcbiAgY29uc3QgZnVsbEFkZHIgPSBbYWRkcmVzcywgbG9jYWxpdHksIHByb3YsICdBcmdlbnRpbmEnXS5maWx0ZXIoQm9vbGVhbikuam9pbignLCAnKTtcclxuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cclxuICBjb25zdCB1cmwgPVxyXG4gICAgJ2h0dHBzOi8vbWFwcy5nb29nbGVhcGlzLmNvbS9tYXBzL2FwaS9nZW9jb2RlL2pzb24nICtcclxuICAgICc/YWRkcmVzcz0nICtcclxuICAgIGVuY29kZVVSSUNvbXBvbmVudChmdWxsQWRkcikgK1xyXG4gICAgJyZyZWdpb249YXInICtcclxuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXHJcbiAgICAnJmxhbmd1YWdlPWVzJyArXHJcbiAgICAnJmtleT0nICtcclxuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2godXJsKTtcclxuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgci5qc29uKCk7XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdPSycgJiYgZGF0YS5yZXN1bHRzICYmIGRhdGEucmVzdWx0cy5sZW5ndGgpIHtcclxuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xyXG4gICAgICBjb25zdCBsb2MgPSByZXMuZ2VvbWV0cnkgJiYgcmVzLmdlb21ldHJ5LmxvY2F0aW9uO1xyXG4gICAgICBpZiAoIWxvYykgcmV0dXJuIG51bGw7XHJcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cclxuICAgICAgY29uc3QgbHQgPSAocmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbl90eXBlKSB8fCAnJztcclxuICAgICAgbGV0IHByZWNpc2lvbiA9ICdhZGRyZXNzJztcclxuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xyXG4gICAgICBlbHNlIGlmIChsdCA9PT0gJ0dFT01FVFJJQ19DRU5URVInKSBwcmVjaXNpb24gPSAnc3RyZWV0JztcclxuICAgICAgLy8gRXh0cmFlciBsb2NhbGl0eSArIGFkbWluX2FyZWEgZGVsIHJlc3BvbnNlIHBhcmEgYXV0b2NvbXBsZXRhciBjYW1wb3NcclxuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxyXG4gICAgICBjb25zdCBjb21wb25lbnRzID0gcmVzLmFkZHJlc3NfY29tcG9uZW50cyB8fCBbXTtcclxuICAgICAgY29uc3QgYnlUeXBlID0gKHQpID0+IHtcclxuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xyXG4gICAgICAgIHJldHVybiBjID8gYy5sb25nX25hbWUgfHwgJycgOiAnJztcclxuICAgICAgfTtcclxuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxyXG4gICAgICBjb25zdCBkZXRlY3RlZExvY2FsaXR5ID1cclxuICAgICAgICBieVR5cGUoJ2xvY2FsaXR5JykgfHwgYnlUeXBlKCdzdWJsb2NhbGl0eScpIHx8IGJ5VHlwZSgnYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yJykgfHwgJyc7XHJcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGxhdDogcGFyc2VGbG9hdChsb2MubGF0KSxcclxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXHJcbiAgICAgICAgZGlzcGxheTogcmVzLmZvcm1hdHRlZF9hZGRyZXNzIHx8IGZ1bGxBZGRyLFxyXG4gICAgICAgIHByZWNpc2lvbjogcHJlY2lzaW9uLFxyXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcclxuICAgICAgICBsb2NhdGlvblR5cGU6IGx0LFxyXG4gICAgICAgIGxvY2FsaXR5OiBkZXRlY3RlZExvY2FsaXR5LFxyXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xyXG4gICAgICBjb25zb2xlLmxvZygnW2dtYXBzXSBaRVJPX1JFU1VMVFMgZm9yOicsIGZ1bGxBZGRyKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoZGF0YS5zdGF0dXMgPT09ICdSRVFVRVNUX0RFTklFRCcpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihcclxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxyXG4gICAgICAgIGRhdGEuZXJyb3JfbWVzc2FnZSB8fFxyXG4gICAgICAgICAgJyhzaW4gZGV0YWxsZSkuIFJldmlzYXIgcXVlIGxhIEFQSSBrZXkgdGVuZ2EgaGFiaWxpdGFkYSBHZW9jb2RpbmcgQVBJIHkgZWwgcmVmZXJyZXIgcGVybWl0YSBlc3RlIGRvbWluaW8uJ1xyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tnbWFwc10gT1ZFUl9RVUVSWV9MSU1JVCAtIGV4Y2VkaW8gZWwgbGltaXRlLiBDYWVtb3MgYSBPU00uJyk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIHN0YXR1cyBpbmVzcGVyYWRvOicsIGRhdGEuc3RhdHVzLCBkYXRhLmVycm9yX21lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIGdlb2NvZGUgZXJyb3I6JywgZSk7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWRtaW4tbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcclxuICB0cnkge1xyXG4gICAgY29uc3QgYWVRcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYWxsb3dlZF9lbWFpbHMnKS5nZXQoKTtcclxuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XHJcbiAgICBhZVFzLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgYWxsb3dlZExpc3QucHVzaChPYmplY3QuYXNzaWduKHsgX2lkOiBkLmlkIH0sIGQuZGF0YSgpKSk7XHJcbiAgICB9KTtcclxuICAgIHJlbmRlckFsbG93ZWRFbWFpbHNTZWN0aW9uKGFsbG93ZWRMaXN0KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcclxuICB9XHJcbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHZW1pbmkgcGFyYSBtb3N0cmFyIGxhIHNlY2Npb24gZGUgQVBJIGtleVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBnU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ2VtaW5pJykuZ2V0KCk7XHJcbiAgICByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uKGdTbmFwLmV4aXN0cyA/IGdTbmFwLmRhdGEoKSA6IG51bGwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignbG9hZCBnZW1pbmkgY29uZmlnJywgZSk7XHJcbiAgICByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uKG51bGwpO1xyXG4gIH1cclxuICAvLyBDYXJnYXIgY29uZmlnIEdvb2dsZSBNYXBzIHBhcmEgbW9zdHJhciBsYSBzZWNjaW9uIGRlIEFQSSBrZXkuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcclxuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihnbVNuYXAuZXhpc3RzID8gZ21TbmFwLmRhdGEoKSA6IG51bGwpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcclxuICAgIHJlbmRlckdtYXBzQ29uZmlnU2VjdGlvbihudWxsKTtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLm9yZGVyQnkoJ2VtYWlsJykuZ2V0KCk7XHJcbiAgICAvLyBFNiBmaXggQzE6IHZhY2lhciBlbCBBcnJheSBpbi1wbGFjZSAocHJlc2VydmEgd2luZG93LnVzZXJzQ2FjaGUgcmVmKS5cclxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcclxuICAgIHFzLmZvckVhY2goKGRvYykgPT4ge1xyXG4gICAgICB1c2Vyc0NhY2hlLnB1c2goT2JqZWN0LmFzc2lnbih7IF91aWQ6IGRvYy5pZCB9LCBkb2MuZGF0YSgpKSk7XHJcbiAgICB9KTtcclxuICAgIC8vIFJlbmRlciBkZWwgYmxvcXVlIFwiQXNpZ25hciBhcHJvYmFkb3IgYSB0b2RvcyBsb3MgdmVuZGVkb3Jlc1wiIGFycmliYSBkZSBsYSB0YWJsYS5cclxuICAgIHRyeSB7XHJcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdidWxrIGFwcHJvdmVyIHNlY3Rpb24nLCBlKTtcclxuICAgIH1cclxuICAgIC8vIFNpbmNyb25pemFyIGVsIGRpcmVjdG9yaW8gcHVibGljbyBkZSB1c3VhcmlvcyBwYXJhIHF1ZSBsb3MgdmVuZGVkb3Jlc1xyXG4gICAgLy8gcHVlZGFuIHZlciBkZXN0aW5hdGFyaW9zIGFsIGNyZWFyIHRhcmVhcyBlbiBOb3RpZmljYWNpb25lcy4gU2luIGVzdG9cclxuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cclxuICAgIHRyeSB7XHJcbiAgICAgIHN5bmNVc2Vyc0RpcmVjdG9yeSgpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ3N5bmNVc2Vyc0RpcmVjdG9yeScsIGUpO1xyXG4gICAgfVxyXG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcclxuICAgIGNvbnN0IGludGVybm9zID0gdXNlcnNDYWNoZS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ2ludGVybm8nKTtcclxuICAgIGNvbnN0IF9pbnRlcm5vT3B0cyA9XHJcbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcclxuICAgICAgaW50ZXJub3NcclxuICAgICAgICAubWFwKFxyXG4gICAgICAgICAgKHUpID0+XHJcbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgIHUuX3VpZCArXHJcbiAgICAgICAgICAgICdcIj4nICtcclxuICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXHJcbiAgICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XHJcbiAgICBjb25zdCBjYXJkc0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3VzZXJzLWNhcmRzJyk7XHJcbiAgICBsZXQgdGFibGVIdG1sID0gJyc7XHJcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XHJcbiAgICBpZiAoIXVzZXJzQ2FjaGUubGVuZ3RoKSB7XHJcbiAgICAgIHRhYmxlSHRtbCA9XHJcbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XHJcbiAgICAgIGNhcmRzSHRtbCA9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJjb2xvcjojOTRhM2I4O2ZvbnQtc2l6ZToxMnB4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MThweFwiPk5vIGhheSB1c3VhcmlvcyB0b2RhdmlhLiBFc3BlcmFuIHF1ZSBpbmdyZXNlbiBjb24gR29vZ2xlLjwvZGl2Pic7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBBZG1pbnMgcHJpbWFyaW9zIHByb3RlZ2lkb3M6IG5vIHNlIHB1ZWRlbiBlbGltaW5hciAoTWFyaWFubyArIGJvdCBjb3Jwb3JhdGl2bylcclxuICAgICAgY29uc3QgUFJPVEVDVEVEX0FETUlOX0VNQUlMUyA9IFsnYm90LnNoaW1hbm8ucGVzY2FAZ21haWwuY29tJywgJ2VyYmlub21hcmlhbm9AZ21haWwuY29tJ107XHJcbiAgICAgIC8vIFBhcmEgbG9zIGludGVybm9zIGNhbGN1bGFtb3MgbGEgcmVsYWNpb24gaW52ZXJzYTogcXVpZW5lcyBsb3MgdGllbmVuIGNvbW8gcGFyZWphXHJcbiAgICAgIGZ1bmN0aW9uIHZlbmRvcnNQYXJhSW50ZXJubyhpbnRlcm5vVWlkKSB7XHJcbiAgICAgICAgcmV0dXJuIHVzZXJzQ2FjaGUuZmlsdGVyKFxyXG4gICAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyAmJiB1LmludGVybmFsUGFydG5lclVpZCA9PT0gaW50ZXJub1VpZFxyXG4gICAgICAgICk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gQ2FuZGlkYXRvcyBhIHJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzOiBhZG1pbiwgZ2VyZW50ZSBvIGludGVybm8gKG5vIHZlbmRlZG9yZXMgbmkgdmlld2VycyBuaSB1bmFzc2lnbmVkKVxyXG4gICAgICBjb25zdCByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKFxyXG4gICAgICAgICh1KSA9PiB1LnJvbGUgPT09ICdhZG1pbicgfHwgdS5yb2xlID09PSAnZ2VyZW50ZScgfHwgdS5yb2xlID09PSAnaW50ZXJubydcclxuICAgICAgKTtcclxuICAgICAgdXNlcnNDYWNoZS5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZG9jSWQgPSBkLl91aWQ7XHJcbiAgICAgICAgY29uc3QgaXNTZWxmID0gZG9jSWQgPT09IGN1cnJlbnRVc2VyLnVpZDtcclxuICAgICAgICBjb25zdCBpc1Byb3RlY3RlZCA9IFBST1RFQ1RFRF9BRE1JTl9FTUFJTFMuaW5kZXhPZigoZC5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKSkgPj0gMDtcclxuICAgICAgICBjb25zdCBpc0ludGVybm8gPSBkLnJvbGUgPT09ICdpbnRlcm5vJztcclxuICAgICAgICBjb25zdCByb2xlT3B0aW9ucyA9IFsndW5hc3NpZ25lZCcsICdhZG1pbicsICdnZXJlbnRlJywgJ3ZlbmRlZG9yJywgJ2ludGVybm8nLCAndmlld2VyJ11cclxuICAgICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAgIChyKSA9PlxyXG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICAgICAgciArXHJcbiAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgKGQucm9sZSA9PT0gciA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAoaXNTZWxmICYmIHIgIT09ICdhZG1pbicgPyAnIGRpc2FibGVkJyA6ICcnKSArXHJcbiAgICAgICAgICAgICAgJz4nICtcclxuICAgICAgICAgICAgICByICtcclxuICAgICAgICAgICAgICAnPC9vcHRpb24+J1xyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICAgIGNvbnN0IHZlbmRvck9wdGlvbnMgPVxyXG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tPC9vcHRpb24+JyArXHJcbiAgICAgICAgICBWRU5ET1JTLm1hcChcclxuICAgICAgICAgICAgKHYpID0+XHJcbiAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgICB2LmtleSArXHJcbiAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgKGQudmVuZG9yID09PSB2LmtleSA/ICcgc2VsZWN0ZWQnIDogJycpICtcclxuICAgICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICAgIHYuem9uZSArXHJcbiAgICAgICAgICAgICAgJyAnICtcclxuICAgICAgICAgICAgICB2LmtleSArXHJcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgICkuam9pbignJyk7XHJcbiAgICAgICAgLy8gU2kgZXMgaW50ZXJubywgbW9zdHJhciByZWxhY2lvbiBpbnZlcnNhICh2ZW5kZWRvcmVzIHF1ZSBsbyB0aWVuZW4gY29tbyBwYXJlamEpIGVuIHZleiBkZWwgZHJvcGRvd24gZWRpdGFibGVcclxuICAgICAgICBsZXQgcGFyZWphQ2VsbDtcclxuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XHJcbiAgICAgICAgICBjb25zdCB2aW5jID0gdmVuZG9yc1BhcmFJbnRlcm5vKGRvY0lkKTtcclxuICAgICAgICAgIGlmICh2aW5jLmxlbmd0aCkge1xyXG4gICAgICAgICAgICBjb25zdCBsaXN0ID0gdmluY1xyXG4gICAgICAgICAgICAgIC5tYXAoKHUpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gdS5kaXNwbGF5TmFtZSA/IHUuZGlzcGxheU5hbWUuc3BsaXQoL1xccysvKVswXSA6IHUuZW1haWwgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKGxhYmVsKSArXHJcbiAgICAgICAgICAgICAgICAgICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojOTRhM2I4XCI+KCcgK1xyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgJycpICtcclxuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzBmMTcyYTtsaW5lLWhlaWdodDoxLjVcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzQ3NTU2OTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjJweFwiPlZlbmRlZG9yZXMgZXh0ZXJub3MgdmluY3VsYWRvcyAoYXV0byk8L2Rpdj4nICtcclxuICAgICAgICAgICAgICBsaXN0ICtcclxuICAgICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxyXG4gICAgICAgICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6Izk0YTNiODtmb250LXN0eWxlOml0YWxpY1wiPkF1biBuaW5ndW4gdmVuZGVkb3IgbG8gdGllbmUgY29tbyBwYXJlamE8L2Rpdj4nO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxyXG4gICAgICAgICAgcGFyZWphQ2VsbCArPSAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIiBjbGFzcz1cImludGVybmFsLXNlbFwiIHZhbHVlPVwiXCIvPic7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBwYXJlamEgLTwvb3B0aW9uPicgK1xyXG4gICAgICAgICAgICBpbnRlcm5vc1xyXG4gICAgICAgICAgICAgIC5tYXAoXHJcbiAgICAgICAgICAgICAgICAodSkgPT5cclxuICAgICAgICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcclxuICAgICAgICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgICAgICAgIChkLmludGVybmFsUGFydG5lclVpZCA9PT0gdS5fdWlkID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKHUuZW1haWwgfHwgdS5kaXNwbGF5TmFtZSB8fCB1Ll91aWQpICtcclxuICAgICAgICAgICAgICAgICAgJzwvb3B0aW9uPidcclxuICAgICAgICAgICAgICApXHJcbiAgICAgICAgICAgICAgLmpvaW4oJycpO1xyXG4gICAgICAgICAgcGFyZWphQ2VsbCA9XHJcbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xyXG4gICAgICAgICAgICBpbnRlcm5vT3B0c0ZvclJvdyArXHJcbiAgICAgICAgICAgICc8L3NlbGVjdD4nO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCB5b3VUYWcgPSBpc1NlbGZcclxuICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiM3YzNhZWQ7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIj4oVk9TKTwvc3Bhbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHByb3RlY3RlZFRhZyA9XHJcbiAgICAgICAgICBpc1Byb3RlY3RlZCAmJiAhaXNTZWxmXHJcbiAgICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiM3YzNhZWQ7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIiB0aXRsZT1cIkFkbWluIHByb3RlZ2lkbyAtIG5vIHNlIHB1ZWRlIGVsaW1pbmFyXCI+JiMxMjgyNzQ7IFBST1RFR0lETzwvc3Bhbj4nXHJcbiAgICAgICAgICAgIDogJyc7XHJcbiAgICAgICAgY29uc3Qgd2FWYWwgPSBkLndoYXRzYXBwIHx8ICcnO1xyXG4gICAgICAgIGNvbnN0IHdhSW5wdXRIdG1sID1cclxuICAgICAgICAgICc8aW5wdXQgdHlwZT1cInRlbFwiIGNsYXNzPVwid2EtaW5wdXRcIiBwbGFjZWhvbGRlcj1cImVqLiA1NDkxMTI2NzYyMDMxXCIgdmFsdWU9XCInICtcclxuICAgICAgICAgIGVzY2FwZUF0dHIod2FWYWwpICtcclxuICAgICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo1cHggN3B4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6I2ZmZlwiIHRpdGxlPVwiTnVtZXJvIFdoYXRzQXBwIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoc2luICsgbmkgZXNwYWNpb3MpLiBTZSB1c2EgYWwgZW52aWFyIGxhIHJ1dGEuXCIvPic7XHJcbiAgICAgICAgLy8gRHJvcGRvd24gJ1Jlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzJ1xyXG4gICAgICAgIGNvbnN0IGN1ckFwcHJvdmVyVWlkID0gZC5yZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8ICcnO1xyXG4gICAgICAgIGxldCByZW5kQXBwcm92ZXJPcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBhc2lnbmFyIC08L29wdGlvbj4nO1xyXG4gICAgICAgIHJlbmRBcHByb3ZlcnNDYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcclxuICAgICAgICAgIGlmICh1Ll91aWQgPT09IGRvY0lkKSByZXR1cm47IC8vIHVuIHVzdWFyaW8gbm8gcHVlZGUgc2VyIHN1IHByb3BpbyBhcHJvYmFkb3JcclxuICAgICAgICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyAodS5yb2xlIHx8ICcnKSArICcpJztcclxuICAgICAgICAgIHJlbmRBcHByb3Zlck9wdGlvbnMgKz1cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgICAgZXNjYXBlQXR0cih1Ll91aWQpICtcclxuICAgICAgICAgICAgJ1wiJyArXHJcbiAgICAgICAgICAgIChjdXJBcHByb3ZlclVpZCA9PT0gdS5fdWlkID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgICBlc2NhcGVIdG1sKGxibCkgK1xyXG4gICAgICAgICAgICAnPC9vcHRpb24+JztcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCByZW5kQXBwcm92ZXJIdG1sID1cclxuICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwicmVuZC1hcHByb3Zlci1zZWxcIiB0aXRsZT1cIlF1aWVuIGFwcnVlYmEgbGFzIHJlbmRpY2lvbmVzIGRlIGVzdGUgdXN1YXJpb1wiPicgK1xyXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArXHJcbiAgICAgICAgICAnPC9zZWxlY3Q+JztcclxuICAgICAgICAvLyBCb3RcdTAwRjNuIENhbWJpYXIgY29udHJhc2VcdTAwRjFhXHJcbiAgICAgICAgY29uc3QgcHdkQnRuSHRtbCA9XHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIHN0eWxlPVwicGFkZGluZzo1cHggMTBweDtmb250LXNpemU6MTBweFwiIG9uY2xpY2s9XCJjaGFuZ2VVc2VyUGFzc3dvcmQoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICBcIicsIFwiICtcclxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KGQuZW1haWwgfHwgJycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArXHJcbiAgICAgICAgICAnKVwiPiYjMTI4Mjc0OyBDb250cmFzZVx1MDBGMWE8L2J1dHRvbj4nO1xyXG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ29uZmlndXJhciAyRkFcclxuICAgICAgICBjb25zdCB0b3RwU3RhdHVzVGFnID0gZC50b3RwRW5hYmxlZFxyXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzEwYjk4MTtmb250LXdlaWdodDo4MDBcIj4mIzEwMDAzOzwvc3Bhbj4nXHJcbiAgICAgICAgICA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHRvdHBCdG5IdG1sID1cclxuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgc3R5bGU9XCJwYWRkaW5nOjVweCAxMHB4O2ZvbnQtc2l6ZToxMHB4O2JhY2tncm91bmQ6JyArXHJcbiAgICAgICAgICAoZC50b3RwRW5hYmxlZCA/ICcjMTBiOTgxJyA6ICcjNWIyMWI2JykgK1xyXG4gICAgICAgICAgJ1wiIG9uY2xpY2s9XCJvcGVuVG90cFNldHVwKFxcJycgK1xyXG4gICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgXCInLCBcIiArXHJcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xyXG4gICAgICAgICAgJylcIj4mIzEyODI3MjsgMkZBJyArXHJcbiAgICAgICAgICB0b3RwU3RhdHVzVGFnICtcclxuICAgICAgICAgICc8L2J1dHRvbj4nO1xyXG4gICAgICAgIC8vIERlc2t0b3Agcm93XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dHIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArIHlvdVRhZyArIHByb3RlY3RlZFRhZyArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSB8fCAnJykgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgKyByb2xlT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+PHNlbGVjdCBjbGFzcz1cInZlbmRvci1zZWxcIj4nICsgdmVuZG9yT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHBhcmVqYUNlbGwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkIGNsYXNzPVwid2EtY29sXCI+JyArIHdhSW5wdXRIdG1sICsgJzwvdGQ+JztcclxuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcmVuZEFwcHJvdmVySHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHB3ZEJ0bkh0bWwgKyAnPC90ZD4nO1xyXG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB0b3RwQnRuSHRtbCArICc8L3RkPic7XHJcbiAgICAgICAgY29uc3Qgc2hvd0RlbGV0ZSA9ICFpc1NlbGYgJiYgIWlzUHJvdGVjdGVkO1xyXG4gICAgICAgIGNvbnN0IGRlbEJ0biA9IHNob3dEZWxldGVcclxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICB0YWJsZUh0bWwgKz1cclxuICAgICAgICAgICc8dGQ+JyArXHJcbiAgICAgICAgICBkZWxCdG4gK1xyXG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJzYXZlLWJ0blwiIG9uY2xpY2s9XCJzYXZlVXNlclJvbGUoXFwnJyArXHJcbiAgICAgICAgICBkb2NJZCArXHJcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L3RkPic7XHJcbiAgICAgICAgdGFibGVIdG1sICs9ICc8L3RyPic7XHJcbiAgICAgICAgLy8gTW9iaWxlIGNhcmRcclxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1c2Vycy1jYXJkXCIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2PjxkaXYgY2xhc3M9XCJ1Yy1lbWFpbFwiPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArXHJcbiAgICAgICAgICB5b3VUYWcgK1xyXG4gICAgICAgICAgcHJvdGVjdGVkVGFnICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGlmIChkLmRpc3BsYXlOYW1lKVxyXG4gICAgICAgICAgY2FyZHNIdG1sICs9ICc8ZGl2IGNsYXNzPVwidWMtbmFtZVwiPicgKyBlc2NhcGVIdG1sKGQuZGlzcGxheU5hbWUpICsgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+Um9sPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwicm9sZS1zZWxcIj4nICtcclxuICAgICAgICAgIHJvbGVPcHRpb25zICtcclxuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgK1xyXG4gICAgICAgICAgdmVuZG9yT3B0aW9ucyArXHJcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcclxuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XHJcbiAgICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3JlcyB2aW5jdWxhZG9zIChhdXRvKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xyXG4gICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtcm93XCI+PGxhYmVsPlBhcmVqYSBpbnRlcm5vIChzb2xvIHNpIHJvbCA9IHZlbmRlZG9yKTwvbGFiZWw+JyArXHJcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xyXG4gICAgICAgICAgICAnPC9kaXY+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgK1xyXG4gICAgICAgICAgd2FJbnB1dEh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5SZXNwb25zYWJsZSBkZSByZW5kaWNpb25lczwvbGFiZWw+JyArXHJcbiAgICAgICAgICByZW5kQXBwcm92ZXJIdG1sICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICAgIGNhcmRzSHRtbCArPVxyXG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcclxuICAgICAgICAgIHB3ZEJ0bkh0bWwgK1xyXG4gICAgICAgICAgdG90cEJ0bkh0bWwgK1xyXG4gICAgICAgICAgJzwvZGl2Pic7XHJcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGVcclxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgICAgZG9jSWQgK1xyXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xyXG4gICAgICAgICAgOiAnJztcclxuICAgICAgICBjYXJkc0h0bWwgKz1cclxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgK1xyXG4gICAgICAgICAgZGVsQnRuQyArXHJcbiAgICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInNhdmUtYnRuXCIgb25jbGljaz1cInNhdmVVc2VyUm9sZShcXCcnICtcclxuICAgICAgICAgIGRvY0lkICtcclxuICAgICAgICAgICdcXCcsIHRoaXMpXCI+R3VhcmRhcjwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIHRib2R5LmlubmVySFRNTCA9IHRhYmxlSHRtbDtcclxuICAgIGNhcmRzRWwuaW5uZXJIVE1MID0gY2FyZHNIdG1sO1xyXG4gICAgLy8gQWN0dWFsaXphIGhlYWRlciBkZSB0YWJsYSBjb24gbGEgY29sdW1uYSBudWV2YVxyXG4gICAgY29uc3QgdGhlYWQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjdXNlcnMtdGFibGUgdGhlYWQgdHInKTtcclxuICAgIGlmICh0aGVhZClcclxuICAgICAgdGhlYWQuaW5uZXJIVE1MID1cclxuICAgICAgICAnPHRoPkVtYWlsPC90aD48dGg+Tm9tYnJlPC90aD48dGg+Um9sPC90aD48dGg+VmVuZGVkb3I8L3RoPjx0aD5QYXJlamEgaW50ZXJubzwvdGg+PHRoIGNsYXNzPVwid2EtY29sXCI+V2hhdHNBcHA8L3RoPjx0aD5SZXNwLiByZW5kaWNpb25lczwvdGg+PHRoPlBhc3M8L3RoPjx0aD4yRkE8L3RoPjx0aD48L3RoPic7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignb3BlbkFkbWluUGFuZWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBjYXJnYW5kbyB1c3VhcmlvczogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FkbWluLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFNFQ0NJXHUwMEQzTjogRjI6IGRlbGV0ZVVzZXJSb2xlICsgVE9UUCArIGNoYW5nZVVzZXJQYXNzd29yZCArIHNhdmVVc2VyUm9sZSAoaW5saW5lIEwxNDEwNS0xNDM5MClcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG53aW5kb3cuZGVsZXRlVXNlclJvbGUgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICBhbGVydCgnTm8gcG9kZXMgZWxpbWluYXIgdHUgcHJvcGlvIGFjY2Vzby4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gRGVmZW5zYSBhZGljaW9uYWw6IGFkbWlucyBwcm90ZWdpZG9zIG5vIHNlIHB1ZWRlbiBlbGltaW5hciBuaSBkZXNkZSBjb25zb2xhXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXBQcmUgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBjb25zdCBlbWFpbFByZSA9IChzbmFwUHJlLmV4aXN0cyA/IHNuYXBQcmUuZGF0YSgpLmVtYWlsIHx8ICcnIDogJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCBQUk9URUNURUQgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xyXG4gICAgaWYgKFBST1RFQ1RFRC5pbmRleE9mKGVtYWlsUHJlKSA+PSAwKSB7XHJcbiAgICAgIGFsZXJ0KCdFc3RlIGVzIHVuIGFkbWluIHByb3RlZ2lkbyAoJyArIGVtYWlsUHJlICsgJykgeSBubyBzZSBwdWVkZSBlbGltaW5hci4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKF9lKSB7XHJcbiAgICAvKiBzaSBmYWxsYSBsYSBsZWN0dXJhIHByZXZpYSwgc2lndWUgY29uIGNvbmZpcm0gKi9cclxuICB9XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBhY2Nlc28gZGUgZXN0ZSB1c3VhcmlvP1xcblxcblBpZXJkZSBhY2Nlc28gZGUgaW5tZWRpYXRvLiBTaSB2dWVsdmUgYSBlbnRyYXIgY29uIEdvb2dsZSB2YSBhIHF1ZWRhciBjb21vIFwic2luIHJvbCBhc2lnbmFkb1wiIGhhc3RhIHF1ZSB2b3MgbG8gaGFiaWxpdGVzIGRlIG51ZXZvLlxcblxcblN1IGN1ZW50YSBHb29nbGUgc2lndWUgZXhpc3RpZW5kbywgbm8gc2UgYm9ycmEuJ1xyXG4gICAgKVxyXG4gIClcclxuICAgIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcclxuICAgIGNvbnN0IGRhdGEgPSBzbmFwLmV4aXN0cyA/IHNuYXAuZGF0YSgpIDoge307XHJcbiAgICBsb2dPcCgnZWxpbWluYXJfdXN1YXJpbycsICd1c2VyJywgZGF0YS5lbWFpbCB8fCB1aWQsIHtcclxuICAgICAgdWlkLFxyXG4gICAgICBwcmV2aW91c1JvbGU6IGRhdGEucm9sZSxcclxuICAgICAgcHJldmlvdXNWZW5kb3I6IGRhdGEudmVuZG9yLFxyXG4gICAgfSk7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZGVsZXRlKCk7XHJcbiAgICBzaG93U3luY1RhZygnVXN1YXJpbyBlbGltaW5hZG8nKTtcclxuICAgIGF3YWl0IG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBQYW5lbCBhZG1pbjogc2V0dXAgLyByZXNldCBkZSAyRkEgcG9yIHVzdWFyaW9cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbmxldCB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7IC8vIHt1aWQsIGVtYWlsLCBzZWNyZXQsIG90cGF1dGh9XHJcblxyXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XHJcbiAgY29uc29sZS5sb2coJ1syRkFdIG9wZW5Ub3RwU2V0dXAgY2FsbGVkJywgeyB1aWQsIGVtYWlsLCB1c2VyUm9sZSB9KTtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHtcclxuICAgIGFsZXJ0KCdTb2xvIGVsIGFkbWluaXN0cmFkb3IgcHVlZGUgY29uZmlndXJhciAyRkEgcGFyYSBvdHJvcyB1c3Vhcmlvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCF1aWQpIHtcclxuICAgIGFsZXJ0KCdFcnJvcjogVUlEIGRlbCB1c3VhcmlvIG5vIGRpc3BvbmlibGUuIFJlY2FyZ2EgbGEgcGFnaW5hIHkgcmVpbnRlbnRhLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0b3RwU2V0dXBTdGF0ZSA9IG51bGw7XHJcbiAgLy8gTW9kYWwgZXhpc3RlP1xyXG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKTtcclxuICBpZiAoIW1vZGFsKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvIGVuIGVsIERPTS4gUmVjYXJnYSBsYSBwYWdpbmEgKEN0cmwrU2hpZnQrUikuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IHN1YnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLXN1YnQnKTtcclxuICBpZiAoc3VidEVsKSBzdWJ0RWwudGV4dENvbnRlbnQgPSAnUGFyYTogJyArIChlbWFpbCB8fCB1aWQpO1xyXG4gIC8vIExlZXIgZXN0YWRvIGFjdHVhbFxyXG4gIGxldCBjdXJFbmFibGVkID0gZmFsc2U7XHJcbiAgbGV0IGN1clNlY3JldCA9IG51bGw7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZG9jKHVpZCkuZ2V0KCk7XHJcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcclxuICAgICAgY29uc3QgZCA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgICBjdXJFbmFibGVkID0gISFkLnRvdHBFbmFibGVkO1xyXG4gICAgICBjdXJTZWNyZXQgPSBkLnRvdHBTZWNyZXQgfHwgbnVsbDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignWzJGQV0gZG9jIHJvbGVzLycgKyB1aWQgKyAnIG5vIGV4aXN0ZScpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1syRkFdIGVycm9yIGxleWVuZG8gcm9sZXMvJyArIHVpZCwgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBlbCBlc3RhZG8gZGUgMkZBIGRlbCB1c3VhcmlvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XHJcbiAgaWYgKCFjKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6IGNvbnRlbmVkb3IgZGVsIG1vZGFsIGRlIDJGQSBubyBlbmNvbnRyYWRvLiBSZWNhcmdhIGxhIHBhZ2luYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGN1ckVuYWJsZWQgJiYgY3VyU2VjcmV0KSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZGNmY2U3O2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzE2NjUzNDt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnPGI+JiMxMDAwMzsgMkZBIHlhIGVzdFx1MDBFMSBhY3Rpdm88L2I+IHBhcmEgZXN0ZSB1c3VhcmlvLicgK1xyXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjExcHhcIj5TaSBsbyBwZXJkaVx1MDBGMyBvIGNhbWJpXHUwMEYzIGRlIGNlbHVsYXIsIHBvZFx1MDBFOXMgZ2VuZXJhcmxlIHVubyBudWV2byAoZWwgYW50ZXJpb3IgcXVlZGEgaW52YWxpZGFkbykuPC9zcGFuPicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7bWFyZ2luLXRvcDoxNHB4O2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC13cmFwOndyYXBcIj4nICtcclxuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICBcIicsJ1wiICtcclxuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xyXG4gICAgICAnXFwnKVwiPkdlbmVyYXIgbnVldm8gKHJlc2V0ZWFyKTwvYnV0dG9uPicgK1xyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkaXNhYmxlVG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgJ1xcJylcIj5EZXNoYWJpbGl0YXIgMkZBPC9idXR0b24+JyArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBjLmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZWZmNmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjEycHg7Y29sb3I6IzFlNDBhZjt0ZXh0LWFsaWduOmNlbnRlclwiPicgK1xyXG4gICAgICAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLicgK1xyXG4gICAgICAnPC9kaXY+JyArXHJcbiAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLXRvcDoxNHB4XCI+JyArXHJcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcclxuICAgICAgZXNjYXBlQXR0cih1aWQpICtcclxuICAgICAgXCInLCdcIiArXHJcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcclxuICAgICAgJ1xcJylcIj5HZW5lcmFyIDJGQTwvYnV0dG9uPicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICB9XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKS5jbGFzc0xpc3QuYWRkKCdvcGVuJyk7XHJcbn07XHJcbndpbmRvdy5jbG9zZVRvdHBTZXR1cE1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xyXG4gIHRvdHBTZXR1cFN0YXRlID0gbnVsbDtcclxufTtcclxuXHJcbndpbmRvdy5nZW5lcmF0ZU5ld1RvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkLCBlbWFpbCkge1xyXG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xyXG4gIGNvbnN0IHNlY3JldCA9IHRvdHBHZW5lcmF0ZVNlY3JldCgpO1xyXG4gIGNvbnN0IG90cGF1dGggPSB0b3RwQnVpbGRPdHBhdXRoVXJsKHNlY3JldCwgZW1haWwgfHwgdWlkKTtcclxuICB0b3RwU2V0dXBTdGF0ZSA9IHsgdWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGggfTtcclxuICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtY29udGVudCcpO1xyXG4gIGMuaW5uZXJIVE1MID1cclxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmVmM2M3O2JvcmRlcjoxcHggc29saWQgI2ZjZDM0ZDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6Izc4MzUwZjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcclxuICAgICc8Yj5QYXNvcyBwYXJhIGFjdGl2YXI6PC9iPjxicj4nICtcclxuICAgICcxLiBFbCB1c3VhcmlvIGluc3RhbGEgPGI+R29vZ2xlIEF1dGhlbnRpY2F0b3I8L2I+IGVuIHN1IGNlbHVsYXIuPGJyPicgK1xyXG4gICAgJzIuIFRvY2EgXCJBZ3JlZ2FyXCIgLyBcIitcIiBlbiBsYSBhcHAuPGJyPicgK1xyXG4gICAgJzMuIEVsaWdlIFwiRXNjYW5lYXIgY1x1MDBGM2RpZ28gUVJcIiB5IGVzY2FuZWEgZWwgY1x1MDBGM2RpZ28gYWJham8gKG8gcGVnYSBlbCBzZWNyZXQgbWFudWFsbWVudGUpLjxicj4nICtcclxuICAgICc0LiBBcGFyZWNlIHVuIGNcdTAwRjNkaWdvIGRlIDYgZFx1MDBFRGdpdG9zIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yLjxicj4nICtcclxuICAgICc1LiBMbyBlc2NyaWJlIGVuIGVsIGlucHV0IGRlIGFiYWpvIHBhcmEgY29uZmlybWFyIHkgYWN0aXZhci4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2Y4ZmFmYztib3JkZXI6MXB4IHNvbGlkICNlMmU4ZjA7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMHB4O3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzQ3NTU2OTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjRweFwiPlNlY3JldCAoY2FyZ2EgbWFudWFsIHNpIGVsIFFSIGZhbGxhKTwvZGl2PicgK1xyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiM1YjIxYjY7d29yZC1icmVhazpicmVhay1hbGw7bGV0dGVyLXNwYWNpbmc6LjFlbVwiPicgK1xyXG4gICAgZXNjYXBlSHRtbChzZWNyZXQpICtcclxuICAgICc8L2Rpdj4nICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGMuaW5uZXJIVE1MICs9XHJcbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTBweFwiPjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojNDc1NTY5O2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo1cHhcIj5DXHUwMEYzZGlnbyBkZSB2ZXJpZmljYWNpXHUwMEYzbiBkZSBHb29nbGUgQXV0aGVudGljYXRvcjwvbGFiZWw+JyArXHJcbiAgICAnPGlucHV0IHR5cGU9XCJ0ZXh0XCIgaWQ9XCJ0b3RwLWNvbmZpcm0taW5wdXRcIiBpbnB1dG1vZGU9XCJudW1lcmljXCIgbWF4bGVuZ3RoPVwiN1wiIHBsYWNlaG9sZGVyPVwiMDAwMDAwXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxOHB4O3RleHQtYWxpZ246Y2VudGVyO2xldHRlci1zcGFjaW5nOi4zZW07Zm9udC13ZWlnaHQ6ODAwXCIvPjwvZGl2Pic7XHJcbiAgYy5pbm5lckhUTUwgKz1cclxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiY29uZmlybVRvdHBTZXR1cCgpXCI+VmVyaWZpY2FyIHkgYWN0aXZhcjwvYnV0dG9uPicgK1xyXG4gICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi1yZWRcIiBvbmNsaWNrPVwiY2xvc2VUb3RwU2V0dXBNb2RhbCgpXCI+Q2FuY2VsYXI8L2J1dHRvbj48L2Rpdj4nO1xyXG4gIC8vIExhenktbG9hZCBxcmNvZGVqcyB5IGdlbmVyYXIuIEVzdGEgbGlicmVyaWEgcGludGEgZWwgUVIgZGlyZWN0byBlbiBlbFxyXG4gIC8vIGNvbnRlbmVkb3IgRE9NIHZpYSBjYW52YXMvaW1nIC0gbm8gbmVjZXNpdGEgY2FsbGJhY2sgdG9EYXRhVVJMLlxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBsb2FkUVJDb2RlTGliKCk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmICghYm94KSByZXR1cm47XHJcbiAgICBib3guaW5uZXJIVE1MID0gJyc7IC8vIGxpbXBpYXIgZWwgXCJHZW5lcmFuZG8gUVIuLi5cIlxyXG4gICAgbmV3IFFSQ29kZShib3gsIHtcclxuICAgICAgdGV4dDogb3RwYXV0aCxcclxuICAgICAgd2lkdGg6IDIyMCxcclxuICAgICAgaGVpZ2h0OiAyMjAsXHJcbiAgICAgIGNvbG9yRGFyazogJyMwMDAwMDAnLFxyXG4gICAgICBjb2xvckxpZ2h0OiAnI2ZmZmZmZicsXHJcbiAgICAgIGNvcnJlY3RMZXZlbDogUVJDb2RlLkNvcnJlY3RMZXZlbC5NLFxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS53YXJuKCdbMkZBXSBFcnJvciBjYXJnYW5kbyBRUiBsaWI6JywgZSk7XHJcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcclxuICAgIGlmIChib3gpXHJcbiAgICAgIGJveC5pbm5lckhUTUwgPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk5MWIxYjtwYWRkaW5nOjE0cHhcIj5ObyBzZSBwdWRvIGNhcmdhciBsYSBsaWJyZXJcdTAwRURhIFFSLiBVc2EgZWwgc2VjcmV0IG1hbnVhbCBwYXJhIGNvbmZpZ3VyYXIuPC9kaXY+JztcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY29uZmlybVRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIXRvdHBTZXR1cFN0YXRlKSByZXR1cm47XHJcbiAgY29uc3QgY29kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1jb25maXJtLWlucHV0JykudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJycpO1xyXG4gIGlmICghL15cXGR7Nn0kLy50ZXN0KGNvZGUpKSB7XHJcbiAgICBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xyXG4gIGlmICghb2spIHtcclxuICAgIGFsZXJ0KFxyXG4gICAgICAnQ1x1MDBGM2RpZ28gaW5jb3JyZWN0by4gQXNlZ3VyYXRlIGRlIHF1ZSBlbCBzZWNyZXQgc2UgY2FyZ1x1MDBGMyBiaWVuIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yIHkgcmVpbnRlbnRcdTAwRTEuJ1xyXG4gICAgKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh0b3RwU2V0dXBTdGF0ZS51aWQpXHJcbiAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcclxuICAgICAgICB0b3RwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB0b3RwRW5hYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGFjdGl2YWRvIHBhcmEgJyArICh0b3RwU2V0dXBTdGF0ZS5lbWFpbCB8fCAndXN1YXJpbycpKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlIHRvdHAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuZGlzYWJsZVRvdHAgPSBhc3luYyBmdW5jdGlvbiAodWlkKSB7XHJcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XHJcbiAgaWYgKCFjb25maXJtKCdEZXNoYWJpbGl0YXIgMkZBIHBhcmEgZXN0ZSB1c3VhcmlvPyBWYSBhIGVudHJhciBzb2xvIGNvbiBwYXNzd29yZC4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiXHJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgIC5kb2ModWlkKVxyXG4gICAgICAudXBkYXRlKHtcclxuICAgICAgICB0b3RwRW5hYmxlZDogZmFsc2UsXHJcbiAgICAgICAgdG90cFNlY3JldDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuZGVsZXRlKCksXHJcbiAgICAgICAgdG90cERpc2FibGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHRvdHBEaXNhYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICBzaG93U3luY1RhZygnMkZBIGRlc2hhYmlsaXRhZG8nKTtcclxuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcclxuICAgIHRyeSB7XHJcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XHJcbiAgICB9IGNhdGNoIChfZSkge31cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY2hhbmdlVXNlclBhc3N3b3JkID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIWVtYWlsKSB7XHJcbiAgICBhbGVydCgnRXN0ZSB1c3VhcmlvIG5vIHRpZW5lIGVtYWlsIHJlZ2lzdHJhZG8gLSBubyBzZSBwdWVkZSByZXNldGVhci4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgY2hvaWNlID0gcHJvbXB0KFxyXG4gICAgJ1Jlc2V0ZWFyIGNvbnRyYXNlXHUwMEYxYSBkZSAnICtcclxuICAgICAgZW1haWwgK1xyXG4gICAgICAnXFxuXFxuJyArXHJcbiAgICAgICdFbGVnaSB1bmEgb3BjaW9uICgxIC8gMik6XFxuXFxuJyArXHJcbiAgICAgICcxKSBFTlZJQVIgTUFJTCBERSBSRVNFVEVPIChyZWNvbWVuZGFkbylcXG4nICtcclxuICAgICAgJyAgIExlIGxsZWdhIGEgJyArXHJcbiAgICAgIGVtYWlsICtcclxuICAgICAgJyB1biBtYWlsIGRlIEZpcmViYXNlIGNvbiB1biBsaW5rLlxcbicgK1xyXG4gICAgICAnICAgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcclxuICAgICAgJyAgIEVzIGxvIGVzdGFuZGFyIHkgZnVuY2lvbmEgc2VndXJvLlxcblxcbicgK1xyXG4gICAgICAnMikgUmVzZXRlYXIgU09MTyBlbCBwYXNzd29yZC1nYXRlIChzZWd1bmRhIGNhcGEpLlxcbicgK1xyXG4gICAgICAnICAgTm8gY2FtYmlhIGxhIHBhc3N3b3JkIHJlYWwgZGUgRmlyZWJhc2UuIFNpcnZlIHNpIGVsIHVzdWFyaW9cXG4nICtcclxuICAgICAgJyAgIGVudHJhIHBvciBHb29nbGUgeSBvbHZpZG8gbGEgcGFzc3dvcmQtZ2F0ZSBkZSBsYSBhcHAsIE5PIHNpXFxuJyArXHJcbiAgICAgICcgICBvbHZpZG8gbGEgcGFzc3dvcmQgZGVsIGxvZ2luIGNvbiBlbWFpbC5cXG5cXG4nICtcclxuICAgICAgJ0VzY3JpYmkgMSBvIDI6JyxcclxuICAgICcxJ1xyXG4gICk7XHJcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcclxuICAgICAgYWxlcnQoXHJcbiAgICAgICAgJ09LIC0gbGUgZW52aWUgdW4gbWFpbCBkZSByZXNldGVvIGEgJyArXHJcbiAgICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgICAnLiBEZWNpbGUgcXVlIHJldmlzZSBpbmJveCB5IHNwYW0uIEVsIGxpbmsgZXhwaXJhIGVuIDEgaG9yYS4nXHJcbiAgICAgICk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgICAgIC5kb2ModWlkKVxyXG4gICAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgICBwYXNzd29yZFJlc2V0TWV0aG9kOiAnZmlyZWJhc2VfZW1haWwnLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdzZW5kUGFzc3dvcmRSZXNldEVtYWlsJywgZSk7XHJcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChjaG9pY2UudHJpbSgpID09PSAnMicpIHtcclxuICAgIGNvbnN0IG5ld1B3ZCA9IHByb21wdChcclxuICAgICAgJ051ZXZhIHBhc3N3b3JkLWdhdGUgcGFyYSAnICtcclxuICAgICAgICBlbWFpbCArXHJcbiAgICAgICAgJzpcXG5cXG4oU29sbyBhZmVjdGEgbGEgc2VndW5kYSBjYXBhIGRlIGxhIGFwcCwgTk8gZWwgbG9naW4gY29uIGVtYWlsKScsXHJcbiAgICAgICcnXHJcbiAgICApO1xyXG4gICAgaWYgKG5ld1B3ZCA9PT0gbnVsbCkgcmV0dXJuO1xyXG4gICAgY29uc3QgcHdkID0gKG5ld1B3ZCB8fCAnJykudHJpbSgpO1xyXG4gICAgaWYgKHB3ZC5sZW5ndGggPCA0KSB7XHJcbiAgICAgIGFsZXJ0KCdMYSBjb250cmFzZVx1MDBGMWEgdGllbmUgcXVlIHRlbmVyIGFsIG1lbm9zIDQgY2FyYWN0ZXJlcy4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZHMgPSBhd2FpdCBidWlsZFBhc3N3b3JkQ3JlZGVudGlhbHMocHdkKTtcclxuICAgICAgYXdhaXQgZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgICAgLmRvYyh1aWQpXHJcbiAgICAgICAgLnVwZGF0ZSh7XHJcbiAgICAgICAgICBwYXNzd29yZEhhc2g6IGNyZWRzLnBhc3N3b3JkSGFzaCxcclxuICAgICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIHNob3dTeW5jVGFnKCdQYXNzd29yZC1nYXRlIGFjdHVhbGl6YWRhIHBhcmEgJyArIGVtYWlsKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignY2hhbmdlVXNlclBhc3N3b3JkIGdhdGUnLCBlKTtcclxuICAgICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xyXG59O1xyXG5cclxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGJ0bikge1xyXG4gIGNvbnN0IGNvbnRhaW5lciA9IGJ0bi5jbG9zZXN0KCd0cicpIHx8IGJ0bi5jbG9zZXN0KCcudXNlcnMtY2FyZCcpO1xyXG4gIGlmICghY29udGFpbmVyKSByZXR1cm47XHJcbiAgY29uc3Qgcm9sZSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucm9sZS1zZWwnKS52YWx1ZTtcclxuICBjb25zdCB2ZW5kb3IgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLnZlbmRvci1zZWwnKS52YWx1ZSB8fCBudWxsO1xyXG4gIGNvbnN0IGludGVybmFsU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5pbnRlcm5hbC1zZWwnKTtcclxuICBjb25zdCBpbnRlcm5hbFBhcnRuZXJVaWQgPSBpbnRlcm5hbFNlbCA/IGludGVybmFsU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIFdoYXRzQXBwOiBsaW1waWFyIHRvZG8gbG8gcXVlIG5vIHNlYSBkaWdpdG8gKGFjZXB0YSArLCBlc3BhY2lvcywgcGFyXHUwMEU5bnRlc2lzLCBldGMuKVxyXG4gIGNvbnN0IHdhSW5wdXQgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLndhLWlucHV0Jyk7XHJcbiAgY29uc3Qgd2hhdHNhcHAgPSB3YUlucHV0ID8gKHdhSW5wdXQudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcRC9nLCAnJykgOiAnJztcclxuICBpZiAod2hhdHNhcHAgJiYgd2hhdHNhcHAubGVuZ3RoIDwgOCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICAvLyBSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcyAodWlkIGRlbCB1c3VhcmlvIHF1ZSBhcHJ1ZWJhKVxyXG4gIGNvbnN0IHJlbmRBcHByb3ZlclNlbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucmVuZC1hcHByb3Zlci1zZWwnKTtcclxuICBjb25zdCByZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZEFwcHJvdmVyU2VsID8gcmVuZEFwcHJvdmVyU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xyXG4gIC8vIENhY2hlYXIgdGFtYmllbiBlbCBlbWFpbCBkZWwgYXByb2JhZG9yIGVuIGVsIGRvYyBkZWwgdmVuZGVkb3I6IGxvc1xyXG4gIC8vIHZlbmRlZG9yZXMgbm8gcHVlZGVuIGxlZXIgL3JvbGVzL3tvdHJvVWlkfSBwb3Igc2VjdXJpdHkgcnVsZXMsIGFzaSBxdWVcclxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxyXG4gIC8vIGxvIHVzYSBjb21vIHByaW1lciBmYXN0LXBhdGgpLiBTaW4gZXN0byBlbCBmbHVqbyBkZXBlbmRpYSBkZWwgZGlyZWN0b3Jpb1xyXG4gIC8vIHB1YmxpY28gKHVzZXJzX2RpcmVjdG9yeSkgcXVlIHNvbG8gc2Ugc2luY3Jvbml6YSBjdWFuZG8gYWRtaW4gYWJyZSBlbCBwYW5lbC5cclxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcclxuICBpZiAocmVuZGljaW9uZXNBcHByb3ZlclVpZCkge1xyXG4gICAgY29uc3QgYXBwcm92ZXJVc2VyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gcmVuZGljaW9uZXNBcHByb3ZlclVpZCk7XHJcbiAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBhcHByb3ZlclVzZXIgPyBhcHByb3ZlclVzZXIuZW1haWwgfHwgbnVsbCA6IG51bGw7XHJcbiAgfVxyXG4gIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgYnRuLnRleHRDb250ZW50ID0gJy4uLic7XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGJcclxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgLmRvYyh1aWQpXHJcbiAgICAgIC5zZXQoXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcm9sZSxcclxuICAgICAgICAgIHZlbmRvcixcclxuICAgICAgICAgIGludGVybmFsUGFydG5lclVpZCxcclxuICAgICAgICAgIHdoYXRzYXBwOiB3aGF0c2FwcCB8fCBudWxsLFxyXG4gICAgICAgICAgcmVuZGljaW9uZXNBcHByb3ZlclVpZDogcmVuZGljaW9uZXNBcHByb3ZlclVpZCxcclxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLFxyXG4gICAgICAgICAgYXNzaWduZWRCeTogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgYXNzaWduZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IG1lcmdlOiB0cnVlIH1cclxuICAgICAgKTtcclxuICAgIC8vIFNpIGVsIHVzdWFyaW8gZWRpdG8gc3UgcHJvcGlvIG51bWVybywgYWN0dWFsaXphciBlbCBjYWNoZSBsb2NhbFxyXG4gICAgaWYgKHVpZCA9PT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICAgIG15V2hhdHNhcHBOdW1iZXIgPSB3aGF0c2FwcCB8fCBudWxsO1xyXG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8IG51bGw7XHJcbiAgICAgIG15UmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsIHx8IG51bGw7XHJcbiAgICB9XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnT0snO1xyXG4gICAgLy8gUmUtcmVuZGVyIGRlbCBwYW5lbCBhc2kgbG9zIGRyb3Bkb3ducyBcIlBhcmVqYSBpbnRlcm5vXCIgbXVlc3RyYW4gbG9zIGludGVybm9zIGFjdHVhbGl6YWRvc1xyXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgb3BlbkFkbWluUGFuZWwoKTtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ3JlZnJlc2ggYWRtaW4gcGFuZWwnLCBlKTtcclxuICAgICAgfVxyXG4gICAgfSwgNDAwKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlVXNlclJvbGUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0d1YXJkYXInO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIFRvZG9zIGxvcyBoYW5kbGVycyB3aW5kb3cuZm9vID0gZnVuY3Rpb24uLi4geWEgc29uIHZlcmJhdGltLlxyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF1QkEsTUFBSSxPQUFPLE9BQU8sZUFBZSxZQUFhLFFBQU8sYUFBYSxDQUFDO0FBQ25FLE1BQU0sYUFBYSxPQUFPO0FBRTFCLFdBQVMsMkJBQTJCLGFBQWE7QUFDL0MsVUFBTSxLQUFLLFNBQVMsZUFBZSx3QkFBd0I7QUFDM0QsUUFBSSxDQUFDLEdBQUk7QUFDVCxtQkFBZSxlQUFlLENBQUMsR0FDNUIsTUFBTSxFQUNOLEtBQUssQ0FBQyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksY0FBYyxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQzlELFFBQUksT0FBTztBQUNYLFlBQVE7QUFDUixZQUNFO0FBQ0YsWUFBUTtBQUNSLFFBQUksQ0FBQyxZQUFZLFFBQVE7QUFDdkIsY0FDRTtBQUFBLElBQ0os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
