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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvYWRtaW4tdXNlcnMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBBRE1JTi1VU0VSUzogUGFuZWwgQWRtaW4gY29tcGxldG8gY29uIDYgc3ViZG9taW5pb3MgKGFsbG93ZWQgZW1haWxzLCBHZW1pbmksXG4vLyBHbWFwcywgYnVsayBhcHByb3ZlciwgYWRtaW4gcGFuZWwgcHJpbmNpcGFsLCAyRkEvVE9UUCwgY2hhbmdlIHBhc3N3b3JkKSArXG4vLyBzYXZlVXNlclJvbGUgKyBkZWxldGVVc2VyUm9sZS4gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sICgyIGZyYWdtZW50b3Ncbi8vIGRpc2NvbnRpbnVvcyBzZXBhcmFkb3MgcG9yIFNBUCBkb21haW4gc3R1YnMpIGNvbW8gcGFydGUgZGUgRTIubyAoZTJiLXBlcmYgMjAyNi0wNy0yOCkuXG4vLyBVTFRJTU8gZG9taW5pbyBncmFuZGUgYSBleHRyYWVyLlxuLy9cbi8vIHY1NTEgKDIwMjYtMDgtMTkpIFNFQ1VSSVRZOiBlbGltaW5hZG8gZWwgS05PV04gQlVHIGRlbCBnZW1pbmlBcGlLZXlDYWNoZVxuLy8gY3Jvc3MtbW9kdWxlLiBMYSBrZXkgeWEgbm8gdml2ZSBlbiBGaXJlc3RvcmUgbmkgY2FjaGVhIG5hZGEgZnJvbnRlbmQgXHUyMDE0XG4vLyBzZSBtb3ZpbyBhIFNlY3JldCBNYW5hZ2VyIHkgc2UgYWNjZWRlIHZpYSBjYWxsYWJsZSBnZW1pbmlPY3JQcm94eS5cbi8vXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogdXNlcnNDYWNoZSwgZ21hcHNBcGlLZXlDYWNoZSwgdG90cFNldHVwU3RhdGUgKGxldCBsb2NhbCBhbCBidW5kbGUsXG4vLyBjb21wYXJ0aWRvcyBpbnRyYS1idW5kbGUpLiBQUk9URUNURURfQURNSU5fRU1BSUxTIChjb25zdCBkZW50cm8gZGUgb3BlbkFkbWluUGFuZWwpLlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFQ0NJXHUwMEQzTjogRjE6IHVzZXJzQ2FjaGUgKyBhbGxvd2VkLWVtYWlscyArIGdlbWluaSArIGdtYXBzICsgYnVsay1hcHByb3ZlciArIG9wZW5BZG1pblBhbmVsICsgY2xvc2VBZG1pblBhbmVsIChpbmxpbmUgTDExNjE5LTEyMTMxKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8vIENST1NTLVNDT1BFIChFNiBmaXgsIGNvZGUgcmV2aWV3IEMxKTogc3luY1VzZXJzRGlyZWN0b3J5IChidW5kbGUgbm90aWZpY2FjaW9uZXMpXG4vLyBsZWUgdXNlcnNDYWNoZSBjb21vIGlkZW50aWZpZXIgbGlicmUuIEVuIGJ1bmRsZSBcInVzZSBzdHJpY3RcIiB1biByZWFkIGFcbi8vIGlkZW50aWZpZXIgbm8tZGVjbGFyYWRvIG5pIGVuIHdpbmRvdyB0aXJhIFJlZmVyZW5jZUVycm9yLiBQcm9tb2Npb25hciBhXG4vLyB3aW5kb3cudXNlcnNDYWNoZSBwcmVzZXJ2YSBsYSByZWZlcmVuY2lhIGVudHJlIGJ1bmRsZSBhZG1pbi11c2VycyAoY2h1bmsgbGF6eSlcbi8vIHkgYnVuZGxlIG5vdGlmaWNhY2lvbmVzIChzaGVsbCkuXG5pZiAodHlwZW9mIHdpbmRvdy51c2Vyc0NhY2hlID09PSAndW5kZWZpbmVkJykgd2luZG93LnVzZXJzQ2FjaGUgPSBbXTtcbmNvbnN0IHVzZXJzQ2FjaGUgPSB3aW5kb3cudXNlcnNDYWNoZTtcblxuZnVuY3Rpb24gcmVuZGVyQWxsb3dlZEVtYWlsc1NlY3Rpb24oYWxsb3dlZExpc3QpIHtcbiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWxsb3dlZC1lbWFpbHMtc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGFsbG93ZWRMaXN0ID0gKGFsbG93ZWRMaXN0IHx8IFtdKVxuICAgIC5zbGljZSgpXG4gICAgLnNvcnQoKGEsIGIpID0+IChhLmVtYWlsIHx8ICcnKS5sb2NhbGVDb21wYXJlKGIuZW1haWwgfHwgJycpKTtcbiAgbGV0IGh0bWwgPSAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTBweFwiPic7XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtmb250LXdlaWdodDo4MDA7Y29sb3I6IzFlNDBhZlwiPkVtYWlscyBwcmUtYXV0b3JpemFkb3M8L2Rpdj4nO1xuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+U2kgdW4gdmVuZGVkb3IgdXNhIEdtYWlsIHBlcnNvbmFsIChubyBAc2hpbWFuby5jb20uYXIpLCBhZ3JlZ2FsbyBhY2EgYW50ZXMgcXVlIGludGVudGUgbG9ndWVhci4gTG9zIGVtYWlscyBAc2hpbWFuby5jb20uYXIgeSBsb3MgYWRtaW5zIGhhcmRjb2RlZCB5YSBlc3RhbiBhdXRvcml6YWRvcyBhdXRvbWF0aWNhbWVudGUuPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKCFhbGxvd2VkTGlzdC5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMCAxMHB4XCI+Tm8gaGF5IGVtYWlscyBwcmUtYXV0b3JpemFkb3MgdG9kYXZpYS48L2Rpdj4nO1xuICB9IGVsc2Uge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2ZsZXgtd3JhcDp3cmFwO2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjttYXJnaW4tYm90dG9tOjEwcHhcIj4nO1xuICAgIGFsbG93ZWRMaXN0LmZvckVhY2goKGFlKSA9PiB7XG4gICAgICBjb25zdCBsYWJlbCA9IGVzY2FwZUh0bWwoYWUuZW1haWwgfHwgYWUuX2lkKTtcbiAgICAgIGNvbnN0IG5vdGUgPSBhZS5ub3RlID8gJyAmbWlkZG90OyAnICsgZXNjYXBlSHRtbChhZS5ub3RlKSA6ICcnO1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo2cHg7YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgI2JmZGJmZTtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzozcHggNHB4IDNweCAxMHB4O2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiMxZTQwYWY7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXG4gICAgICAgIGxhYmVsICtcbiAgICAgICAgbm90ZSArXG4gICAgICAgICc8YnV0dG9uIG9uY2xpY2s9XCJyZW1vdmVBbGxvd2VkRW1haWwoXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIoYWUuX2lkKSArXG4gICAgICAgICdcXCcpXCIgdGl0bGU9XCJRdWl0YXIgYXV0b3JpemFjaW9uXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiNkYzI2MjY7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjUwJTt3aWR0aDoxOHB4O2hlaWdodDoxOHB4O2ZvbnQtc2l6ZToxMXB4O2N1cnNvcjpwb2ludGVyO2xpbmUtaGVpZ2h0OjFcIj4mdGltZXM7PC9idXR0b24+JyArXG4gICAgICAgICc8L2Rpdj4nO1xuICAgIH0pO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH1cbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tYmx1ZVwiIG9uY2xpY2s9XCJhZGRBbGxvd2VkRW1haWwoKVwiPiYjNDM7IEFncmVnYXIgZW1haWw8L2J1dHRvbj48L2Rpdj4nO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufVxuXG53aW5kb3cuYWRkQWxsb3dlZEVtYWlsID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgY29uc3QgcmF3ID0gcHJvbXB0KCdFbWFpbCBhIGF1dG9yaXphciAoZWouIGF1dG9tYXRyaXgub2ZpY2lhbEBnbWFpbC5jb20pOicpO1xuICBpZiAoIXJhdykgcmV0dXJuO1xuICBjb25zdCBlbWFpbCA9IHJhdy50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgaWYgKCEvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLy50ZXN0KGVtYWlsKSkge1xuICAgIGFsZXJ0KCdFbCBlbWFpbCBubyBwYXJlY2UgdmFsaWRvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBub3RlID1cbiAgICBwcm9tcHQoJ05vdGEgY29ydGEgb3BjaW9uYWwgKGVqLiBcIlZlbmRlZG9yIFoxIEdvbnphbG9cIiBvIFwiUmVlbXBsYXpvIGRlIE1hdXJpY2lvXCIpOicsICcnKSB8fCAnJztcbiAgY29uc3QgZG9jSWQgPSBlbWFpbFRvRG9jSWQoZW1haWwpO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpXG4gICAgICAuZG9jKGRvY0lkKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIGVtYWlsLFxuICAgICAgICAgIG5vdGU6IG5vdGUudHJpbSgpLFxuICAgICAgICAgIGFkZGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIGFkZGVkQnlVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICBhZGRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIHNob3dTeW5jVGFnKCdFbWFpbCBhdXRvcml6YWRvOiAnICsgZW1haWwpO1xuICAgIC8vIFJlY2FyZ2FyIHBhbmVsXG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdhZGRBbGxvd2VkRW1haWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnJlbW92ZUFsbG93ZWRFbWFpbCA9IGFzeW5jIGZ1bmN0aW9uIChkb2NJZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ1F1aXRhciBsYSBhdXRvcml6YWNpb24gZGUgZXN0ZSBlbWFpbD8gU2kgZWwgdXN1YXJpbyB5YSB0aWVuZSByb2wgYXNpZ25hZG8gZW4gZWwgcGFuZWwsIHZhIGEgc2VndWlyIGVudHJhbmRvIChsYSByZWdsYSBwcmUtYXByb2JhZGEgcG9yIHJvbCB0YW1iaWVuIGFwbGljYSkuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FsbG93ZWRfZW1haWxzJykuZG9jKGRvY0lkKS5kZWxldGUoKTtcbiAgICBzaG93U3luY1RhZygnQXV0b3JpemFjaW9uIHF1aXRhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3JlbW92ZUFsbG93ZWRFbWFpbCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT0gU2VjY2lvbiBHZW1pbmkgQVBJIEtleSAoYWRtaW4pID09PVxuZnVuY3Rpb24gcmVuZGVyR2VtaW5pQ29uZmlnU2VjdGlvbihfZGF0YSkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnZW1pbmktY29uZmlnLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICAvLyB2NTUxICgyMDI2LTA4LTE5KSBTRUNVUklUWTogbGEga2V5IHZpdmUgZW4gU2VjcmV0IE1hbmFnZXIsIG5vIGVuIEZpcmVzdG9yZS5cbiAgLy8gdjYzOSAoMjAyNi0wOC0yNik6IFVYIHNpbXBsaWZpY2FkbyBwb3IgcGVkaWRvIE1hcmlhbm8gXHUyMDE0IHNpbiBpbnN0cnVjY2lvbmVzXG4gIC8vIENMSSBlbiBlbCBwYW5lbCwgc29sbyB1biBiYW5uZXIgZXhwbGljYW5kbyBkb25kZSB2aXZlIGxhIGtleS5cbiAgLy8gU2UgYWRtaW5pc3RyYSBwb3IgQ0xJIChmaXJlYmFzZSBmdW5jdGlvbnM6c2VjcmV0czpzZXQgR0VNSU5JX0FQSV9LRVkpLlxuICBlbC50ZXh0Q29udGVudCA9ICcnO1xuICBjb25zdCB3cmFwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHdyYXAuc3R5bGUuY3NzVGV4dCA9XG4gICAgJ3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmc6MTRweCAxMnB4O2JhY2tncm91bmQ6I2Y1ZjNmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ2ZmU7Ym9yZGVyLXJhZGl1czo2cHgnO1xuICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0aXRsZS5zdHlsZS5jc3NUZXh0ID0gJ2ZvbnQtc2l6ZToxMnB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNWIyMWI2O21hcmdpbi1ib3R0b206NnB4JztcbiAgdGl0bGUudGV4dENvbnRlbnQgPSAnR2VtaW5pIEFQSSBLZXkgKE9DUiBkZSB0aWNrZXRzKSc7XG4gIGNvbnN0IG1zZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBtc2cuc3R5bGUuY3NzVGV4dCA9ICdmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiJztcbiAgLy8gSWNvbm8gY2FuZGFkbyArIHRleHRvLiB0ZXh0Q29udGVudCBlcyBzYWZlIChubyBIVE1MIHBhcnNpbmcpLlxuICBtc2cudGV4dENvbnRlbnQgPSAnXHVEODNEXHVERDEyIEd1YXJkYWRvIHBvciBzZWd1cmlkYWQgZW4gR29vZ2xlIFNlY3JldCBNYW5hZ2VyJztcbiAgd3JhcC5hcHBlbmRDaGlsZCh0aXRsZSk7XG4gIHdyYXAuYXBwZW5kQ2hpbGQobXNnKTtcbiAgZWwuYXBwZW5kQ2hpbGQod3JhcCk7XG59XG5cbi8vIHY1NTE6IHNhdmVHZW1pbmlBcGlLZXkgKyBkZWxldGVHZW1pbmlBcGlLZXkgZWxpbWluYWRvcy4gTGEga2V5IHZpdmVcbi8vIGVuIFNlY3JldCBNYW5hZ2VyLCBubyBlbiBGaXJlc3RvcmUuIFNlIGFkbWluaXN0cmEgcG9yIENMSS4gVmVyXG4vLyByZW5kZXJHZW1pbmlDb25maWdTZWN0aW9uIHBhcmEgbGFzIGluc3RydWNjaW9uZXMuXG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR09PR0xFIE1BUFMgR2VvY29kaW5nIEFQSSAtIG1lam9yIGNvYmVydHVyYSBlbiBBUiBydXJhbCBxdWUgT1NNXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIExhIGtleSBzZSBndWFyZGEgZW4gYXBwX2NvbmZpZy9nb29nbGVfbWFwcy4gU2kgZXN0YSBzZXRlYWRhLCBsYSB1c2Ftb3Ncbi8vIGNvbW8gZ2VvY29kZXIgUFJJTUFSSU8gZW4gZ2VvY29kZUNsaWVudEFkZHJlc3M7IHNpIGZhbGxhIG8gbm8gZXN0YVxuLy8gc2V0ZWFkYSwgY2FlbW9zIGEgbGEgY2FzY2FkYSBPU00gTm9taW5hdGltIGNvbW8gZmFsbGJhY2suXG5sZXQgZ21hcHNBcGlLZXlDYWNoZSA9IG51bGw7XG5hc3luYyBmdW5jdGlvbiBnZXRHbWFwc0FwaUtleSgpIHtcbiAgaWYgKGdtYXBzQXBpS2V5Q2FjaGUpIHJldHVybiBnbWFwc0FwaUtleUNhY2hlO1xuICB0cnkge1xuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dvb2dsZV9tYXBzJykuZ2V0KCk7XG4gICAgaWYgKHNuYXAuZXhpc3RzKSB7XG4gICAgICBjb25zdCBkID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgICBpZiAoZC5hcGlLZXkpIHtcbiAgICAgICAgZ21hcHNBcGlLZXlDYWNoZSA9IGQuYXBpS2V5O1xuICAgICAgICByZXR1cm4gZC5hcGlLZXk7XG4gICAgICB9XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbZ21hcHNdIG5vIHNlIHB1ZG8gbGVlciBhcGkga2V5JywgZSk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5mdW5jdGlvbiByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZGF0YSkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnbWFwcy1jb25maWctc2VjdGlvbicpO1xuICBpZiAoIWVsKSByZXR1cm47XG4gIGNvbnN0IGhhc0tleSA9IGRhdGEgJiYgZGF0YS5hcGlLZXk7XG4gIGNvbnN0IG1hc2tlZCA9IGhhc0tleSA/IGRhdGEuYXBpS2V5LnNsaWNlKDAsIDQpICsgJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyBkYXRhLmFwaUtleS5zbGljZSgtNCkgOiAnJztcbiAgY29uc3QgdXBkYXRlZEJ5ID0gKGRhdGEgJiYgZGF0YS51cGRhdGVkQnkpIHx8ICcnO1xuICBjb25zdCB1cGRhdGVkQXQgPVxuICAgIGRhdGEgJiYgZGF0YS51cGRhdGVkQXQgJiYgZGF0YS51cGRhdGVkQXQudG9EYXRlXG4gICAgICA/IGRhdGEudXBkYXRlZEF0LnRvRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpXG4gICAgICA6ICcnO1xuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMwNjVmNDZcIj5Hb29nbGUgTWFwcyBBUEkgS2V5IChnZW9jb2RpbmcpPC9kaXY+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweFwiPkNvbnZpZXJ0ZSBkaXJlY2Npb25lcyBhIGNvb3JkZW5hZGFzIGNvbiBtdWNoYSBtZWpvciBwcmVjaXNpXHUwMEYzbiBxdWUgT1NNIChzb2JyZSB0b2RvIGVuIGxvY2FsaWRhZGVzIGNoaWNhcykuIENvc3RvIGdyYXRpcyBoYXN0YSA0MC4wMDAgcmVxdWVzdHMvbWVzLjwvZGl2Pic7XG4gIGh0bWwgKz0gJzwvZGl2Pic7XG4gIGlmIChoYXNLZXkpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDttYXJnaW4tYm90dG9tOjEwcHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XG4gICAgaHRtbCArPVxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMXB4O2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICM2ZWU3Yjc7Ym9yZGVyLXJhZGl1czo0cHg7cGFkZGluZzo0cHggOHB4O2NvbG9yOiMwNjVmNDZcIj4nICtcbiAgICAgIGVzY2FwZUh0bWwobWFza2VkKSArXG4gICAgICAnPC9zcGFuPic7XG4gICAgaHRtbCArPVxuICAgICAgJzxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6IzY0NzQ4YlwiPkNhcmdhZGEgcG9yICcgK1xuICAgICAgZXNjYXBlSHRtbCh1cGRhdGVkQnkgfHwgJ2FkbWluJykgK1xuICAgICAgKHVwZGF0ZWRBdCA/ICcgKCcgKyBlc2NhcGVIdG1sKHVwZGF0ZWRBdCkgKyAnKScgOiAnJykgK1xuICAgICAgJzwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgaHRtbCArPVxuICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojOTRhM2I4O21hcmdpbi1ib3R0b206MTBweDt0ZXh0LWFsaWduOmNlbnRlclwiPlNpbiBBUEkga2V5LiBHZW9jb2RpbmcgdXNhIE9wZW5TdHJlZXRNYXAgKGdyYXRpcyBwZXJvIHBlb3IgY29iZXJ0dXJhIGVuIEFSIHJ1cmFsKS48L2Rpdj4nO1xuICB9XG4gIGh0bWwgKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDtmbGV4LXdyYXA6d3JhcDtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyXCI+JztcbiAgaHRtbCArPVxuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tY3lhblwiIG9uY2xpY2s9XCJzYXZlR21hcHNBcGlLZXkoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMTBiOTgxXCI+JyArXG4gICAgKGhhc0tleSA/ICdDYW1iaWFyIGtleScgOiAnQ2FyZ2FyIGtleScpICtcbiAgICAnPC9idXR0b24+JztcbiAgaWYgKGhhc0tleSlcbiAgICBodG1sICs9XG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXJlZFwiIG9uY2xpY2s9XCJkZWxldGVHbWFwc0FwaUtleSgpXCI+Qm9ycmFyPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5zYXZlR21hcHNBcGlLZXkgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCByYXcgPSBwcm9tcHQoXG4gICAgJ1BlZ2EgYWNhIGxhIEFQSSBrZXkgZGUgR29vZ2xlIE1hcHMgKGZvcm1hdG8gQUl6YVN5Li4uKS5cXG5cXG5JTVBPUlRBTlRFOiBlbiBHb29nbGUgQ2xvdWQgQ29uc29sZSByZXN0cmluZ2kgbGEga2V5IHBvciBIVFRQIHJlZmVycmVyIGEgaHR0cHM6Ly9zaGltYW5vLWFyZy5naXRodWIuaW8vKiBwYXJhIHF1ZSBuYWRpZSB0ZSBsYSByb2JlLicsXG4gICAgJydcbiAgKTtcbiAgaWYgKHJhdyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSByYXcudHJpbSgpO1xuICBpZiAoIWtleSkge1xuICAgIGFsZXJ0KCdWYWNpYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xuICAgIGFsZXJ0KCdMYSBrZXkgcGFyZWNlIG11eSBjb3J0YS4gUmV2aXNhIHF1ZSBsYSBwZWdhc3RlIGNvbXBsZXRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAgIC5kb2MoJ2dvb2dsZV9tYXBzJylcbiAgICAgIC5zZXQoXG4gICAgICAgIHtcbiAgICAgICAgICBhcGlLZXk6IGtleSxcbiAgICAgICAgICB1cGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHVwZGF0ZWRCeVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0sXG4gICAgICAgIHsgbWVyZ2U6IHRydWUgfVxuICAgICAgKTtcbiAgICBnbWFwc0FwaUtleUNhY2hlID0ga2V5O1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGd1YXJkYWRhJyk7XG4gICAgdHJ5IHtcbiAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgfSBjYXRjaCAoX2UpIHt9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzYXZlR21hcHNBcGlLZXknLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5kZWxldGVHbWFwc0FwaUtleSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdCb3JyYXIgbGEgQVBJIGtleSBkZSBHb29nbGUgTWFwcz8gRWwgZ2VvY29kaW5nIHZ1ZWx2ZSBhIE9TTSAocGVvciBjb2JlcnR1cmEgZW4gQVIgcnVyYWwpLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJykuZG9jKCdnb29nbGVfbWFwcycpLmRlbGV0ZSgpO1xuICAgIGdtYXBzQXBpS2V5Q2FjaGUgPSBudWxsO1xuICAgIHNob3dTeW5jVGFnKCdHb29nbGUgTWFwcyBBUEkga2V5IGJvcnJhZGEnKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZUdtYXBzQXBpS2V5JywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQlVMSyBBUFBST1ZFUiAtIGFzaWduYXIgZWwgbWlzbW8gXCJSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lc1wiXG4vLyBhIHRvZG9zIGxvcyB2ZW5kZWRvcmVzIGRlIHVuIHNvbG8gY2xpY2suXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFV0aWwgY3VhbmRvIHVuIHNvbG8gYXByb2JhZG9yIChlai4gUGFibG8gZ2VyZW50ZSkgcmV2aXNhIGxhc1xuLy8gcmVuZGljaW9uZXMgZGUgVE9ET1MgbG9zIHZlbmRlZG9yZXMuIFNpbiBlc3RvIGVsIGFkbWluIHRpZW5lIHF1ZVxuLy8gYWJyaXIgY2FkYSBmaWxhIGRlbCBwYW5lbCBVc3VhcmlvcyB5IHNldGVhciBlbCBkcm9wZG93biB1bmEgYSB1bmEuXG5mdW5jdGlvbiByZW5kZXJCdWxrQXBwcm92ZXJTZWN0aW9uKCkge1xuICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWxrLWFwcHJvdmVyLXNlY3Rpb24nKTtcbiAgaWYgKCFlbCkgcmV0dXJuO1xuICBjb25zdCBjYW5kaWRhdGVzID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbHRlcihcbiAgICAodSkgPT4gdS5yb2xlID09PSAnYWRtaW4nIHx8IHUucm9sZSA9PT0gJ2dlcmVudGUnIHx8IHUucm9sZSA9PT0gJ2ludGVybm8nXG4gICk7XG4gIGNvbnN0IHZlbmRlZG9yZXMgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICd2ZW5kZWRvcicpO1xuICBsZXQgaHRtbCA9ICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiNhMjFjYWZcIj5BcHJvYmFkb3IgZGUgUmVuZGljaW9uZXMgLSBhc2lnbmFjaW9uIG1hc2l2YTwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj5BcGxpY2EgZWwgbWlzbW8gcmVzcG9uc2FibGUgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyBkZSB1biBzb2xvIGNsaWNrLiBVdGlsIGN1YW5kbyB1biBnZXJlbnRlIGNvbWVyY2lhbCBjZW50cmFsaXphIGxhIGFwcm9iYWNpb24uPC9kaXY+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaWYgKCFjYW5kaWRhdGVzLmxlbmd0aCkge1xuICAgIGh0bWwgKz1cbiAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjZweCAwXCI+Tm8gaGF5IHVzdWFyaW9zIGNvbiByb2wgYWRtaW4gLyBnZXJlbnRlIC8gaW50ZXJuby4gUHJpbWVybyBhc2lnbmEgdW4gcm9sIGEgYWxndWllbi48L2Rpdj4nO1xuICAgIGVsLmlubmVySFRNTCA9IGh0bWw7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzo2cHggMFwiPk5vIGhheSB1c3VhcmlvcyBjb24gcm9sIHZlbmRlZG9yIHRvZGF2aWEuPC9kaXY+JztcbiAgICBlbC5pbm5lckhUTUwgPSBodG1sO1xuICAgIHJldHVybjtcbiAgfVxuICBodG1sICs9XG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPic7XG4gIGh0bWwgKz1cbiAgICAnPHNlbGVjdCBpZD1cImJ1bGstYXBwcm92ZXItc2VsZWN0XCIgc3R5bGU9XCJwYWRkaW5nOjhweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCAjZjBhYmZjO2JvcmRlci1yYWRpdXM6NnB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6I2ZmZjtmb250LWZhbWlseTppbmhlcml0O2ZsZXg6MTttYXgtd2lkdGg6MzQwcHhcIj4nO1xuICBodG1sICs9ICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBFbGVnaXIgYXByb2JhZG9yIC08L29wdGlvbj4nO1xuICBjYW5kaWRhdGVzLmZvckVhY2goKHUpID0+IHtcbiAgICBjb25zdCBsYmwgPSAodS5kaXNwbGF5TmFtZSB8fCB1LmVtYWlsIHx8IHUuX3VpZCkgKyAnICgnICsgdS5yb2xlICsgJyknO1xuICAgIGh0bWwgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZXNjYXBlQXR0cih1Ll91aWQpICsgJ1wiPicgKyBlc2NhcGVIdG1sKGxibCkgKyAnPC9vcHRpb24+JztcbiAgfSk7XG4gIGh0bWwgKz0gJzwvc2VsZWN0Pic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiBjbGFzcz1cImFwcC1idG4tcGlsbCBhcHAtYnRuLXZpb2xldFwiIG9uY2xpY2s9XCJidWxrQXNzaWduQXBwcm92ZXIoKVwiPkFzaWduYXIgYSBUT0RPUyBsb3MgdmVuZGVkb3JlcyAoJyArXG4gICAgdmVuZGVkb3Jlcy5sZW5ndGggK1xuICAgICcpPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn1cbndpbmRvdy5idWxrQXNzaWduQXBwcm92ZXIgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGFkbWluLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVsay1hcHByb3Zlci1zZWxlY3QnKTtcbiAgY29uc3QgdWlkID0gc2VsICYmIHNlbC52YWx1ZTtcbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRWxlZyZpYWN1dGU7IHVuIGFwcm9iYWRvciBkZWwgZHJvcGRvd24uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFwcHJvdmVyID0gKHVzZXJzQ2FjaGUgfHwgW10pLmZpbmQoKHUpID0+IHUuX3VpZCA9PT0gdWlkKTtcbiAgaWYgKCFhcHByb3Zlcikge1xuICAgIGFsZXJ0KCdBcHJvYmFkb3Igbm8gZW5jb250cmFkby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdmVuZGVkb3JlcyA9ICh1c2Vyc0NhY2hlIHx8IFtdKS5maWx0ZXIoKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyk7XG4gIGlmICghdmVuZGVkb3Jlcy5sZW5ndGgpIHtcbiAgICBhbGVydCgnTm8gaGF5IHZlbmRlZG9yZXMgcGFyYSBhc2lnbmFyLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhcHByb3ZlckxhYmVsID0gYXBwcm92ZXIuZGlzcGxheU5hbWUgfHwgYXBwcm92ZXIuZW1haWwgfHwgYXBwcm92ZXIuX3VpZDtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0FzaWduYXIgYSAnICtcbiAgICAgICAgYXBwcm92ZXJMYWJlbCArXG4gICAgICAgICcgY29tbyBhcHJvYmFkb3IgZGUgbG9zICcgK1xuICAgICAgICB2ZW5kZWRvcmVzLmxlbmd0aCArXG4gICAgICAgICcgdmVuZGVkb3Jlcz9cXG5cXG5WYSBhIHNvYnJlc2NyaWJpciBjdWFscXVpZXIgYXByb2JhZG9yIHByZXZpbyBhc2lnbmFkbyBhIGNhZGEgdmVuZGVkb3IuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgbGV0IG9rQ291bnQgPSAwLFxuICAgIF9lcnJDb3VudCA9IDA7XG4gIC8vIFVwZGF0ZSBlbiBsb3RlLiBVc2Ftb3MgdW4gYmF0Y2ggZGUgRmlyZXN0b3JlLlxuICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcbiAgdmVuZGVkb3Jlcy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh2Ll91aWQpO1xuICAgIGJhdGNoLnVwZGF0ZShyZWYsIHtcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQ6IHVpZCxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogYXBwcm92ZXIuZW1haWwgfHwgJycsXG4gICAgICByZW5kaWNpb25lc0FwcHJvdmVyVXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJVcGRhdGVkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgIH0pO1xuICB9KTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcbiAgICBva0NvdW50ID0gdmVuZGVkb3Jlcy5sZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBsb2dPcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgbG9nT3AoJ2J1bGtfYXNzaWduX2FwcHJvdmVyJywgJ3JvbGVzJywgYXBwcm92ZXJMYWJlbCwge1xuICAgICAgICBhcHByb3ZlclVpZDogdWlkLFxuICAgICAgICBhcHByb3ZlckVtYWlsOiBhcHByb3Zlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdmVuZGVkb3JDb3VudDogdmVuZGVkb3Jlcy5sZW5ndGgsXG4gICAgICAgIHZlbmRlZG9yVWlkczogdmVuZGVkb3Jlcy5tYXAoKHYpID0+IHYuX3VpZCksXG4gICAgICB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdidWxrQXNzaWduQXBwcm92ZXInLCBlKTtcbiAgICBfZXJyQ291bnQgPSB2ZW5kZWRvcmVzLmxlbmd0aDtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxuICBpZiAob2tDb3VudCkge1xuICAgIHNob3dTeW5jVGFnKG9rQ291bnQgKyAnIHZlbmRlZG9yKGVzKSBhc2lnbmFkbyhzKSBhICcgKyBhcHByb3ZlckxhYmVsKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge30gLy8gcmVmcmVzY2FyXG4gIH1cbn07XG5cbi8vIEdlb2NvZGluZyBjb24gR29vZ2xlIE1hcHMgQVBJLiBEZXZ1ZWx2ZSB7bGF0LCBsbmcsIGRpc3BsYXksIHByZWNpc2lvbn1cbi8vIG8gbnVsbCBzaSBubyBlbmNvbnRybyAvIHNpbiBrZXkuXG5hc3luYyBmdW5jdGlvbiBfZ2VvY29kZVdpdGhHb29nbGVNYXBzKGFkZHJlc3MsIGxvY2FsaXR5LCBwcm92aW5jZUNvZGUpIHtcbiAgY29uc3Qga2V5ID0gYXdhaXQgZ2V0R21hcHNBcGlLZXkoKTtcbiAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xuICBjb25zdCBwcm92ID0gdHlwZW9mIHRpdGxlQ2FzZSA9PT0gJ2Z1bmN0aW9uJyA/IHRpdGxlQ2FzZShwcm92aW5jZUNvZGUgfHwgJycpIDogcHJvdmluY2VDb2RlIHx8ICcnO1xuICBjb25zdCBmdWxsQWRkciA9IFthZGRyZXNzLCBsb2NhbGl0eSwgcHJvdiwgJ0FyZ2VudGluYSddLmZpbHRlcihCb29sZWFuKS5qb2luKCcsICcpO1xuICAvLyByZWdpb249YXIgKyBjb21wb25lbnRzPWNvdW50cnk6QVIgc2VzZ2EgbG9zIHJlc3VsdGFkb3MgYSBBUi5cbiAgY29uc3QgdXJsID1cbiAgICAnaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMuY29tL21hcHMvYXBpL2dlb2NvZGUvanNvbicgK1xuICAgICc/YWRkcmVzcz0nICtcbiAgICBlbmNvZGVVUklDb21wb25lbnQoZnVsbEFkZHIpICtcbiAgICAnJnJlZ2lvbj1hcicgK1xuICAgICcmY29tcG9uZW50cz1jb3VudHJ5OkFSJyArXG4gICAgJyZsYW5ndWFnZT1lcycgK1xuICAgICcma2V5PScgK1xuICAgIGVuY29kZVVSSUNvbXBvbmVudChrZXkpO1xuICB0cnkge1xuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKCdIVFRQICcgKyByLnN0YXR1cyk7XG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHIuanNvbigpO1xuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09LJyAmJiBkYXRhLnJlc3VsdHMgJiYgZGF0YS5yZXN1bHRzLmxlbmd0aCkge1xuICAgICAgY29uc3QgcmVzID0gZGF0YS5yZXN1bHRzWzBdO1xuICAgICAgY29uc3QgbG9jID0gcmVzLmdlb21ldHJ5ICYmIHJlcy5nZW9tZXRyeS5sb2NhdGlvbjtcbiAgICAgIGlmICghbG9jKSByZXR1cm4gbnVsbDtcbiAgICAgIC8vIGxvY2F0aW9uX3R5cGUgaW5kaWNhIHByZWNpc2lvbjogUk9PRlRPUCA+IFJBTkdFX0lOVEVSUE9MQVRFRCA+IEdFT01FVFJJQ19DRU5URVIgPiBBUFBST1hJTUFURS5cbiAgICAgIGNvbnN0IGx0ID0gKHJlcy5nZW9tZXRyeSAmJiByZXMuZ2VvbWV0cnkubG9jYXRpb25fdHlwZSkgfHwgJyc7XG4gICAgICBsZXQgcHJlY2lzaW9uID0gJ2FkZHJlc3MnO1xuICAgICAgaWYgKGx0ID09PSAnQVBQUk9YSU1BVEUnKSBwcmVjaXNpb24gPSAnbG9jYWxpdHknO1xuICAgICAgZWxzZSBpZiAobHQgPT09ICdHRU9NRVRSSUNfQ0VOVEVSJykgcHJlY2lzaW9uID0gJ3N0cmVldCc7XG4gICAgICAvLyBFeHRyYWVyIGxvY2FsaXR5ICsgYWRtaW5fYXJlYSBkZWwgcmVzcG9uc2UgcGFyYSBhdXRvY29tcGxldGFyIGNhbXBvc1xuICAgICAgLy8gcXVlIFNBUCBubyBleHBvcnRvIChTaGlwLXRvIENpdHkgdmFjaW8gZXMgbXV5IGNvbXVuIGVuIEJQcyB2aWVqb3MpLlxuICAgICAgY29uc3QgY29tcG9uZW50cyA9IHJlcy5hZGRyZXNzX2NvbXBvbmVudHMgfHwgW107XG4gICAgICBjb25zdCBieVR5cGUgPSAodCkgPT4ge1xuICAgICAgICBjb25zdCBjID0gY29tcG9uZW50cy5maW5kKChjYykgPT4gQXJyYXkuaXNBcnJheShjYy50eXBlcykgJiYgY2MudHlwZXMuaW5jbHVkZXModCkpO1xuICAgICAgICByZXR1cm4gYyA/IGMubG9uZ19uYW1lIHx8ICcnIDogJyc7XG4gICAgICB9O1xuICAgICAgLy8gUHJpb3JpZGFkIHBhcmEgbG9jYWxpZGFkOiBsb2NhbGl0eSA+IHN1YmxvY2FsaXR5ID4gYWRtaW5pc3RyYXRpdmVfYXJlYV9sZXZlbF8yLlxuICAgICAgY29uc3QgZGV0ZWN0ZWRMb2NhbGl0eSA9XG4gICAgICAgIGJ5VHlwZSgnbG9jYWxpdHknKSB8fCBieVR5cGUoJ3N1YmxvY2FsaXR5JykgfHwgYnlUeXBlKCdhZG1pbmlzdHJhdGl2ZV9hcmVhX2xldmVsXzInKSB8fCAnJztcbiAgICAgIGNvbnN0IGRldGVjdGVkUHJvdmluY2UgPSBieVR5cGUoJ2FkbWluaXN0cmF0aXZlX2FyZWFfbGV2ZWxfMScpIHx8ICcnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGF0OiBwYXJzZUZsb2F0KGxvYy5sYXQpLFxuICAgICAgICBsbmc6IHBhcnNlRmxvYXQobG9jLmxuZyksXG4gICAgICAgIGRpc3BsYXk6IHJlcy5mb3JtYXR0ZWRfYWRkcmVzcyB8fCBmdWxsQWRkcixcbiAgICAgICAgcHJlY2lzaW9uOiBwcmVjaXNpb24sXG4gICAgICAgIHByb3ZpZGVyOiAnZ29vZ2xlJyxcbiAgICAgICAgbG9jYXRpb25UeXBlOiBsdCxcbiAgICAgICAgbG9jYWxpdHk6IGRldGVjdGVkTG9jYWxpdHksXG4gICAgICAgIHByb3ZpbmNlOiBkZXRlY3RlZFByb3ZpbmNlLFxuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnWkVST19SRVNVTFRTJykge1xuICAgICAgY29uc29sZS5sb2coJ1tnbWFwc10gWkVST19SRVNVTFRTIGZvcjonLCBmdWxsQWRkcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKGRhdGEuc3RhdHVzID09PSAnUkVRVUVTVF9ERU5JRUQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFxuICAgICAgICAnW2dtYXBzXSBSRVFVRVNUX0RFTklFRDonLFxuICAgICAgICBkYXRhLmVycm9yX21lc3NhZ2UgfHxcbiAgICAgICAgICAnKHNpbiBkZXRhbGxlKS4gUmV2aXNhciBxdWUgbGEgQVBJIGtleSB0ZW5nYSBoYWJpbGl0YWRhIEdlb2NvZGluZyBBUEkgeSBlbCByZWZlcnJlciBwZXJtaXRhIGVzdGUgZG9taW5pby4nXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ09WRVJfUVVFUllfTElNSVQnKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbZ21hcHNdIE9WRVJfUVVFUllfTElNSVQgLSBleGNlZGlvIGVsIGxpbWl0ZS4gQ2FlbW9zIGEgT1NNLicpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBzdGF0dXMgaW5lc3BlcmFkbzonLCBkYXRhLnN0YXR1cywgZGF0YS5lcnJvcl9tZXNzYWdlKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignW2dtYXBzXSBnZW9jb2RlIGVycm9yOicsIGUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbndpbmRvdy5vcGVuQWRtaW5QYW5lbCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgLy8gQ2FyZ2FyIGFsbG93ZWRfZW1haWxzIHBhcmEgbW9zdHJhciBhcnJpYmEgbGEgc2VjY2lvbiBkZSBwcmUtYXV0b3JpemFjaW9uZXNcbiAgdHJ5IHtcbiAgICBjb25zdCBhZVFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdhbGxvd2VkX2VtYWlscycpLmdldCgpO1xuICAgIGNvbnN0IGFsbG93ZWRMaXN0ID0gW107XG4gICAgYWVRcy5mb3JFYWNoKChkKSA9PiB7XG4gICAgICBhbGxvd2VkTGlzdC5wdXNoKE9iamVjdC5hc3NpZ24oeyBfaWQ6IGQuaWQgfSwgZC5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICByZW5kZXJBbGxvd2VkRW1haWxzU2VjdGlvbihhbGxvd2VkTGlzdCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgYWxsb3dlZF9lbWFpbHMnLCBlKTtcbiAgfVxuICAvLyBDYXJnYXIgY29uZmlnIEdlbWluaSBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5XG4gIHRyeSB7XG4gICAgY29uc3QgZ1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKS5kb2MoJ2dlbWluaScpLmdldCgpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24oZ1NuYXAuZXhpc3RzID8gZ1NuYXAuZGF0YSgpIDogbnVsbCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ2xvYWQgZ2VtaW5pIGNvbmZpZycsIGUpO1xuICAgIHJlbmRlckdlbWluaUNvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgLy8gQ2FyZ2FyIGNvbmZpZyBHb29nbGUgTWFwcyBwYXJhIG1vc3RyYXIgbGEgc2VjY2lvbiBkZSBBUEkga2V5LlxuICB0cnkge1xuICAgIGNvbnN0IGdtU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbignYXBwX2NvbmZpZycpLmRvYygnZ29vZ2xlX21hcHMnKS5nZXQoKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24oZ21TbmFwLmV4aXN0cyA/IGdtU25hcC5kYXRhKCkgOiBudWxsKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignbG9hZCBnbWFwcyBjb25maWcnLCBlKTtcbiAgICByZW5kZXJHbWFwc0NvbmZpZ1NlY3Rpb24obnVsbCk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBxcyA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5vcmRlckJ5KCdlbWFpbCcpLmdldCgpO1xuICAgIC8vIEU2IGZpeCBDMTogdmFjaWFyIGVsIEFycmF5IGluLXBsYWNlIChwcmVzZXJ2YSB3aW5kb3cudXNlcnNDYWNoZSByZWYpLlxuICAgIHVzZXJzQ2FjaGUubGVuZ3RoID0gMDtcbiAgICBxcy5mb3JFYWNoKChkb2MpID0+IHtcbiAgICAgIHVzZXJzQ2FjaGUucHVzaChPYmplY3QuYXNzaWduKHsgX3VpZDogZG9jLmlkIH0sIGRvYy5kYXRhKCkpKTtcbiAgICB9KTtcbiAgICAvLyBSZW5kZXIgZGVsIGJsb3F1ZSBcIkFzaWduYXIgYXByb2JhZG9yIGEgdG9kb3MgbG9zIHZlbmRlZG9yZXNcIiBhcnJpYmEgZGUgbGEgdGFibGEuXG4gICAgdHJ5IHtcbiAgICAgIHJlbmRlckJ1bGtBcHByb3ZlclNlY3Rpb24oKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ2J1bGsgYXBwcm92ZXIgc2VjdGlvbicsIGUpO1xuICAgIH1cbiAgICAvLyBTaW5jcm9uaXphciBlbCBkaXJlY3RvcmlvIHB1YmxpY28gZGUgdXN1YXJpb3MgcGFyYSBxdWUgbG9zIHZlbmRlZG9yZXNcbiAgICAvLyBwdWVkYW4gdmVyIGRlc3RpbmF0YXJpb3MgYWwgY3JlYXIgdGFyZWFzIGVuIE5vdGlmaWNhY2lvbmVzLiBTaW4gZXN0b1xuICAgIC8vIGxvcyB2ZW5kZWRvcmVzIHZlbiBlbCBkcm9wZG93biB2YWNpbyAoc2VjdXJpdHkgcnVsZXMgYmxvcXVlYW4gL3JvbGVzKS5cbiAgICB0cnkge1xuICAgICAgc3luY1VzZXJzRGlyZWN0b3J5KCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdzeW5jVXNlcnNEaXJlY3RvcnknLCBlKTtcbiAgICB9XG4gICAgLy8gTGlzdGEgZGUgaW50ZXJub3MgZGlzcG9uaWJsZXMgKHBhcmEgYXNpZ25hciBwYXJlamEgYSBsb3MgdmVuZGVkb3JlcylcbiAgICBjb25zdCBpbnRlcm5vcyA9IHVzZXJzQ2FjaGUuZmlsdGVyKCh1KSA9PiB1LnJvbGUgPT09ICdpbnRlcm5vJyk7XG4gICAgY29uc3QgX2ludGVybm9PcHRzID1cbiAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgIGludGVybm9zXG4gICAgICAgIC5tYXAoXG4gICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICdcIj4nICtcbiAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCB1LmRpc3BsYXlOYW1lIHx8IHUuX3VpZCkgK1xuICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICBjb25zdCB0Ym9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy10YWJsZS1ib2R5Jyk7XG4gICAgY29uc3QgY2FyZHNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd1c2Vycy1jYXJkcycpO1xuICAgIGxldCB0YWJsZUh0bWwgPSAnJztcbiAgICBsZXQgY2FyZHNIdG1sID0gJyc7XG4gICAgaWYgKCF1c2Vyc0NhY2hlLmxlbmd0aCkge1xuICAgICAgdGFibGVIdG1sID1cbiAgICAgICAgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC90ZD48L3RyPic7XG4gICAgICBjYXJkc0h0bWwgPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImNvbG9yOiM5NGEzYjg7Zm9udC1zaXplOjEycHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZzoxOHB4XCI+Tm8gaGF5IHVzdWFyaW9zIHRvZGF2aWEuIEVzcGVyYW4gcXVlIGluZ3Jlc2VuIGNvbiBHb29nbGUuPC9kaXY+JztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWRtaW5zIHByaW1hcmlvcyBwcm90ZWdpZG9zOiBubyBzZSBwdWVkZW4gZWxpbWluYXIgKE1hcmlhbm8gKyBib3QgY29ycG9yYXRpdm8pXG4gICAgICBjb25zdCBQUk9URUNURURfQURNSU5fRU1BSUxTID0gWydib3Quc2hpbWFuby5wZXNjYUBnbWFpbC5jb20nLCAnZXJiaW5vbWFyaWFub0BnbWFpbC5jb20nXTtcbiAgICAgIC8vIFBhcmEgbG9zIGludGVybm9zIGNhbGN1bGFtb3MgbGEgcmVsYWNpb24gaW52ZXJzYTogcXVpZW5lcyBsb3MgdGllbmVuIGNvbW8gcGFyZWphXG4gICAgICBmdW5jdGlvbiB2ZW5kb3JzUGFyYUludGVybm8oaW50ZXJub1VpZCkge1xuICAgICAgICByZXR1cm4gdXNlcnNDYWNoZS5maWx0ZXIoXG4gICAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ3ZlbmRlZG9yJyAmJiB1LmludGVybmFsUGFydG5lclVpZCA9PT0gaW50ZXJub1VpZFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gQ2FuZGlkYXRvcyBhIHJlc3BvbnNhYmxlIGRlIHJlbmRpY2lvbmVzOiBhZG1pbiwgZ2VyZW50ZSBvIGludGVybm8gKG5vIHZlbmRlZG9yZXMgbmkgdmlld2VycyBuaSB1bmFzc2lnbmVkKVxuICAgICAgY29uc3QgcmVuZEFwcHJvdmVyc0NhbmRpZGF0ZXMgPSB1c2Vyc0NhY2hlLmZpbHRlcihcbiAgICAgICAgKHUpID0+IHUucm9sZSA9PT0gJ2FkbWluJyB8fCB1LnJvbGUgPT09ICdnZXJlbnRlJyB8fCB1LnJvbGUgPT09ICdpbnRlcm5vJ1xuICAgICAgKTtcbiAgICAgIHVzZXJzQ2FjaGUuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICBjb25zdCBkb2NJZCA9IGQuX3VpZDtcbiAgICAgICAgY29uc3QgaXNTZWxmID0gZG9jSWQgPT09IGN1cnJlbnRVc2VyLnVpZDtcbiAgICAgICAgY29uc3QgaXNQcm90ZWN0ZWQgPSBQUk9URUNURURfQURNSU5fRU1BSUxTLmluZGV4T2YoKGQuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCkpID49IDA7XG4gICAgICAgIGNvbnN0IGlzSW50ZXJubyA9IGQucm9sZSA9PT0gJ2ludGVybm8nO1xuICAgICAgICBjb25zdCByb2xlT3B0aW9ucyA9IFsndW5hc3NpZ25lZCcsICdhZG1pbicsICdnZXJlbnRlJywgJ3ZlbmRlZG9yJywgJ2ludGVybm8nLCAndmlld2VyJ11cbiAgICAgICAgICAubWFwKFxuICAgICAgICAgICAgKHIpID0+XG4gICAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXG4gICAgICAgICAgICAgIHIgK1xuICAgICAgICAgICAgICAnXCInICtcbiAgICAgICAgICAgICAgKGQucm9sZSA9PT0gciA/ICcgc2VsZWN0ZWQnIDogJycpICtcbiAgICAgICAgICAgICAgKGlzU2VsZiAmJiByICE9PSAnYWRtaW4nID8gJyBkaXNhYmxlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICByICtcbiAgICAgICAgICAgICAgJzwvb3B0aW9uPidcbiAgICAgICAgICApXG4gICAgICAgICAgLmpvaW4oJycpO1xuICAgICAgICBjb25zdCB2ZW5kb3JPcHRpb25zID1cbiAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIlwiPi08L29wdGlvbj4nICtcbiAgICAgICAgICBWRU5ET1JTLm1hcChcbiAgICAgICAgICAgICh2KSA9PlxuICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICB2LmtleSArXG4gICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAoZC52ZW5kb3IgPT09IHYua2V5ID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICB2LnpvbmUgK1xuICAgICAgICAgICAgICAnICcgK1xuICAgICAgICAgICAgICB2LmtleSArXG4gICAgICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICAgICAgKS5qb2luKCcnKTtcbiAgICAgICAgLy8gU2kgZXMgaW50ZXJubywgbW9zdHJhciByZWxhY2lvbiBpbnZlcnNhICh2ZW5kZWRvcmVzIHF1ZSBsbyB0aWVuZW4gY29tbyBwYXJlamEpIGVuIHZleiBkZWwgZHJvcGRvd24gZWRpdGFibGVcbiAgICAgICAgbGV0IHBhcmVqYUNlbGw7XG4gICAgICAgIGlmIChpc0ludGVybm8pIHtcbiAgICAgICAgICBjb25zdCB2aW5jID0gdmVuZG9yc1BhcmFJbnRlcm5vKGRvY0lkKTtcbiAgICAgICAgICBpZiAodmluYy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3QgPSB2aW5jXG4gICAgICAgICAgICAgIC5tYXAoKHUpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IHUuZGlzcGxheU5hbWUgPyB1LmRpc3BsYXlOYW1lLnNwbGl0KC9cXHMrLylbMF0gOiB1LmVtYWlsIHx8ICcnO1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICBlc2NhcGVIdG1sKGxhYmVsKSArXG4gICAgICAgICAgICAgICAgICAnIDxzcGFuIHN0eWxlPVwiY29sb3I6Izk0YTNiOFwiPignICtcbiAgICAgICAgICAgICAgICAgIGVzY2FwZUh0bWwodS5lbWFpbCB8fCAnJykgK1xuICAgICAgICAgICAgICAgICAgJyk8L3NwYW4+J1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5qb2luKCc8YnI+Jyk7XG4gICAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjojMGYxNzJhO2xpbmUtaGVpZ2h0OjEuNVwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNDc1NTY5O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNHB4O21hcmdpbi1ib3R0b206MnB4XCI+VmVuZGVkb3JlcyBleHRlcm5vcyB2aW5jdWxhZG9zIChhdXRvKTwvZGl2PicgK1xuICAgICAgICAgICAgICBsaXN0ICtcbiAgICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgPVxuICAgICAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOiM5NGEzYjg7Zm9udC1zdHlsZTppdGFsaWNcIj5BdW4gbmluZ3VuIHZlbmRlZG9yIGxvIHRpZW5lIGNvbW8gcGFyZWphPC9kaXY+JztcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gaW5wdXQgb2N1bHRvIHBhcmEgcXVlIHNhdmVVc2VyUm9sZSBubyBwaXNlIGVsIHZhbG9yIGRlbCByb2wgPSBpbnRlcm5vIChubyBhcGxpY2EgaW50ZXJuYWxQYXJ0bmVyVWlkKVxuICAgICAgICAgIHBhcmVqYUNlbGwgKz0gJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCIgY2xhc3M9XCJpbnRlcm5hbC1zZWxcIiB2YWx1ZT1cIlwiLz4nO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IGludGVybm9PcHRzRm9yUm93ID1cbiAgICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiXCI+LSBTaW4gcGFyZWphIC08L29wdGlvbj4nICtcbiAgICAgICAgICAgIGludGVybm9zXG4gICAgICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAgICAgKHUpID0+XG4gICAgICAgICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgICAgICAgdS5fdWlkICtcbiAgICAgICAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgICAgICAgKGQuaW50ZXJuYWxQYXJ0bmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgICAgICAgZXNjYXBlSHRtbCh1LmVtYWlsIHx8IHUuZGlzcGxheU5hbWUgfHwgdS5fdWlkKSArXG4gICAgICAgICAgICAgICAgICAnPC9vcHRpb24+J1xuICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgICAgICBwYXJlamFDZWxsID1cbiAgICAgICAgICAgICc8c2VsZWN0IGNsYXNzPVwiaW50ZXJuYWwtc2VsXCIgdGl0bGU9XCJQYXJlamEgaW50ZXJubyAoc29sbyBhcGxpY2Egc2kgZWwgcm9sIGVzIHZlbmRlZG9yKVwiPicgK1xuICAgICAgICAgICAgaW50ZXJub09wdHNGb3JSb3cgK1xuICAgICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeW91VGFnID0gaXNTZWxmXG4gICAgICAgICAgPyAnIDxzcGFuIHN0eWxlPVwiY29sb3I6IzdjM2FlZDtmb250LXNpemU6OXB4O2ZvbnQtd2VpZ2h0OjgwMFwiPihWT1MpPC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCBwcm90ZWN0ZWRUYWcgPVxuICAgICAgICAgIGlzUHJvdGVjdGVkICYmICFpc1NlbGZcbiAgICAgICAgICAgID8gJyA8c3BhbiBzdHlsZT1cImNvbG9yOiM3YzNhZWQ7Zm9udC1zaXplOjlweDtmb250LXdlaWdodDo4MDBcIiB0aXRsZT1cIkFkbWluIHByb3RlZ2lkbyAtIG5vIHNlIHB1ZWRlIGVsaW1pbmFyXCI+JiMxMjgyNzQ7IFBST1RFR0lETzwvc3Bhbj4nXG4gICAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB3YVZhbCA9IGQud2hhdHNhcHAgfHwgJyc7XG4gICAgICAgIGNvbnN0IHdhSW5wdXRIdG1sID1cbiAgICAgICAgICAnPGlucHV0IHR5cGU9XCJ0ZWxcIiBjbGFzcz1cIndhLWlucHV0XCIgcGxhY2Vob2xkZXI9XCJlai4gNTQ5MTEyNjc2MjAzMVwiIHZhbHVlPVwiJyArXG4gICAgICAgICAgZXNjYXBlQXR0cih3YVZhbCkgK1xuICAgICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo1cHggN3B4O2JvcmRlcjoxLjVweCBzb2xpZCAjY2JkNWUxO2JvcmRlci1yYWRpdXM6NHB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lO2JhY2tncm91bmQ6I2ZmZlwiIHRpdGxlPVwiTnVtZXJvIFdoYXRzQXBwIGNvbXBsZXRvIGNvbiBjb2RpZ28gZGUgcGFpcyAoc2luICsgbmkgZXNwYWNpb3MpLiBTZSB1c2EgYWwgZW52aWFyIGxhIHJ1dGEuXCIvPic7XG4gICAgICAgIC8vIERyb3Bkb3duICdSZXNwb25zYWJsZSBkZSByZW5kaWNpb25lcydcbiAgICAgICAgY29uc3QgY3VyQXBwcm92ZXJVaWQgPSBkLnJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgfHwgJyc7XG4gICAgICAgIGxldCByZW5kQXBwcm92ZXJPcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIFNpbiBhc2lnbmFyIC08L29wdGlvbj4nO1xuICAgICAgICByZW5kQXBwcm92ZXJzQ2FuZGlkYXRlcy5mb3JFYWNoKCh1KSA9PiB7XG4gICAgICAgICAgaWYgKHUuX3VpZCA9PT0gZG9jSWQpIHJldHVybjsgLy8gdW4gdXN1YXJpbyBubyBwdWVkZSBzZXIgc3UgcHJvcGlvIGFwcm9iYWRvclxuICAgICAgICAgIGNvbnN0IGxibCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdS5fdWlkKSArICcgKCcgKyAodS5yb2xlIHx8ICcnKSArICcpJztcbiAgICAgICAgICByZW5kQXBwcm92ZXJPcHRpb25zICs9XG4gICAgICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgICAgZXNjYXBlQXR0cih1Ll91aWQpICtcbiAgICAgICAgICAgICdcIicgK1xuICAgICAgICAgICAgKGN1ckFwcHJvdmVyVWlkID09PSB1Ll91aWQgPyAnIHNlbGVjdGVkJyA6ICcnKSArXG4gICAgICAgICAgICAnPicgK1xuICAgICAgICAgICAgZXNjYXBlSHRtbChsYmwpICtcbiAgICAgICAgICAgICc8L29wdGlvbj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcmVuZEFwcHJvdmVySHRtbCA9XG4gICAgICAgICAgJzxzZWxlY3QgY2xhc3M9XCJyZW5kLWFwcHJvdmVyLXNlbFwiIHRpdGxlPVwiUXVpZW4gYXBydWViYSBsYXMgcmVuZGljaW9uZXMgZGUgZXN0ZSB1c3VhcmlvXCI+JyArXG4gICAgICAgICAgcmVuZEFwcHJvdmVyT3B0aW9ucyArXG4gICAgICAgICAgJzwvc2VsZWN0Pic7XG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ2FtYmlhciBjb250cmFzZVx1MDBGMWFcbiAgICAgICAgY29uc3QgcHdkQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHhcIiBvbmNsaWNrPVwiY2hhbmdlVXNlclBhc3N3b3JkKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICBcIicsIFwiICtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShkLmVtYWlsIHx8ICcnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgK1xuICAgICAgICAgICcpXCI+JiMxMjgyNzQ7IENvbnRyYXNlXHUwMEYxYTwvYnV0dG9uPic7XG4gICAgICAgIC8vIEJvdFx1MDBGM24gQ29uZmlndXJhciAyRkFcbiAgICAgICAgY29uc3QgdG90cFN0YXR1c1RhZyA9IGQudG90cEVuYWJsZWRcbiAgICAgICAgICA/ICcgPHNwYW4gc3R5bGU9XCJjb2xvcjojMTBiOTgxO2ZvbnQtd2VpZ2h0OjgwMFwiPiYjMTAwMDM7PC9zcGFuPidcbiAgICAgICAgICA6ICcnO1xuICAgICAgICBjb25zdCB0b3RwQnRuSHRtbCA9XG4gICAgICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBzdHlsZT1cInBhZGRpbmc6NXB4IDEwcHg7Zm9udC1zaXplOjEwcHg7YmFja2dyb3VuZDonICtcbiAgICAgICAgICAoZC50b3RwRW5hYmxlZCA/ICcjMTBiOTgxJyA6ICcjNWIyMWI2JykgK1xuICAgICAgICAgICdcIiBvbmNsaWNrPVwib3BlblRvdHBTZXR1cChcXCcnICtcbiAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgXCInLCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZC5lbWFpbCB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICtcbiAgICAgICAgICAnKVwiPiYjMTI4MjcyOyAyRkEnICtcbiAgICAgICAgICB0b3RwU3RhdHVzVGFnICtcbiAgICAgICAgICAnPC9idXR0b24+JztcbiAgICAgICAgLy8gRGVza3RvcCByb3dcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dHIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIGVzY2FwZUh0bWwoZC5lbWFpbCB8fCAnJykgKyB5b3VUYWcgKyBwcm90ZWN0ZWRUYWcgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgZXNjYXBlSHRtbChkLmRpc3BsYXlOYW1lIHx8ICcnKSArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgKyByb2xlT3B0aW9ucyArICc8L3NlbGVjdD48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPjxzZWxlY3QgY2xhc3M9XCJ2ZW5kb3Itc2VsXCI+JyArIHZlbmRvck9wdGlvbnMgKyAnPC9zZWxlY3Q+PC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcGFyZWphQ2VsbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkIGNsYXNzPVwid2EtY29sXCI+JyArIHdhSW5wdXRIdG1sICsgJzwvdGQ+JztcbiAgICAgICAgdGFibGVIdG1sICs9ICc8dGQ+JyArIHJlbmRBcHByb3Zlckh0bWwgKyAnPC90ZD4nO1xuICAgICAgICB0YWJsZUh0bWwgKz0gJzx0ZD4nICsgcHdkQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPHRkPicgKyB0b3RwQnRuSHRtbCArICc8L3RkPic7XG4gICAgICAgIGNvbnN0IHNob3dEZWxldGUgPSAhaXNTZWxmICYmICFpc1Byb3RlY3RlZDtcbiAgICAgICAgY29uc3QgZGVsQnRuID0gc2hvd0RlbGV0ZVxuICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJybS11c2VyLWJ0blwiIG9uY2xpY2s9XCJkZWxldGVVc2VyUm9sZShcXCcnICtcbiAgICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAgICdcXCcpXCI+RWxpbWluYXI8L2J1dHRvbj4nXG4gICAgICAgICAgOiAnJztcbiAgICAgICAgdGFibGVIdG1sICs9XG4gICAgICAgICAgJzx0ZD4nICtcbiAgICAgICAgICBkZWxCdG4gK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L3RkPic7XG4gICAgICAgIHRhYmxlSHRtbCArPSAnPC90cj4nO1xuICAgICAgICAvLyBNb2JpbGUgY2FyZFxuICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1c2Vycy1jYXJkXCIgZGF0YS11aWQ9XCInICsgZG9jSWQgKyAnXCI+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXY+PGRpdiBjbGFzcz1cInVjLWVtYWlsXCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbChkLmVtYWlsIHx8ICcnKSArXG4gICAgICAgICAgeW91VGFnICtcbiAgICAgICAgICBwcm90ZWN0ZWRUYWcgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBpZiAoZC5kaXNwbGF5TmFtZSlcbiAgICAgICAgICBjYXJkc0h0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1Yy1uYW1lXCI+JyArIGVzY2FwZUh0bWwoZC5kaXNwbGF5TmFtZSkgKyAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5Sb2w8L2xhYmVsPjxzZWxlY3QgY2xhc3M9XCJyb2xlLXNlbFwiPicgK1xuICAgICAgICAgIHJvbGVPcHRpb25zICtcbiAgICAgICAgICAnPC9zZWxlY3Q+PC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+VmVuZGVkb3IgKHNvbG8gc2kgcm9sID0gdmVuZGVkb3IpPC9sYWJlbD48c2VsZWN0IGNsYXNzPVwidmVuZG9yLXNlbFwiPicgK1xuICAgICAgICAgIHZlbmRvck9wdGlvbnMgK1xuICAgICAgICAgICc8L3NlbGVjdD48L2Rpdj4nO1xuICAgICAgICBpZiAoaXNJbnRlcm5vKSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5WZW5kZWRvcmVzIHZpbmN1bGFkb3MgKGF1dG8pPC9sYWJlbD4nICtcbiAgICAgICAgICAgIHBhcmVqYUNlbGwgK1xuICAgICAgICAgICAgJzwvZGl2Pic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5QYXJlamEgaW50ZXJubyAoc29sbyBzaSByb2wgPSB2ZW5kZWRvcik8L2xhYmVsPicgK1xuICAgICAgICAgICAgcGFyZWphQ2VsbCArXG4gICAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiPjxsYWJlbD5XaGF0c0FwcCAoY29uIGNvZGlnbyBkZSBwYWlzLCBzaW4gKyBuaSBlc3BhY2lvcyk8L2xhYmVsPicgK1xuICAgICAgICAgIHdhSW5wdXRIdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY2FyZHNIdG1sICs9XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1Yy1yb3dcIj48bGFiZWw+UmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXM8L2xhYmVsPicgK1xuICAgICAgICAgIHJlbmRBcHByb3Zlckh0bWwgK1xuICAgICAgICAgICc8L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz1cbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInVjLXJvd1wiIHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXI7ZGlzcGxheTpmbGV4O2dhcDo2cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xuICAgICAgICAgIHB3ZEJ0bkh0bWwgK1xuICAgICAgICAgIHRvdHBCdG5IdG1sICtcbiAgICAgICAgICAnPC9kaXY+JztcbiAgICAgICAgY29uc3QgZGVsQnRuQyA9IHNob3dEZWxldGVcbiAgICAgICAgICA/ICc8YnV0dG9uIGNsYXNzPVwicm0tdXNlci1idG5cIiBvbmNsaWNrPVwiZGVsZXRlVXNlclJvbGUoXFwnJyArXG4gICAgICAgICAgICBkb2NJZCArXG4gICAgICAgICAgICAnXFwnKVwiPkVsaW1pbmFyPC9idXR0b24+J1xuICAgICAgICAgIDogJyc7XG4gICAgICAgIGNhcmRzSHRtbCArPVxuICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWMtYWN0aW9uc1wiPicgK1xuICAgICAgICAgIGRlbEJ0bkMgK1xuICAgICAgICAgICc8YnV0dG9uIGNsYXNzPVwic2F2ZS1idG5cIiBvbmNsaWNrPVwic2F2ZVVzZXJSb2xlKFxcJycgK1xuICAgICAgICAgIGRvY0lkICtcbiAgICAgICAgICAnXFwnLCB0aGlzKVwiPkd1YXJkYXI8L2J1dHRvbj48L2Rpdj4nO1xuICAgICAgICBjYXJkc0h0bWwgKz0gJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGJvZHkuaW5uZXJIVE1MID0gdGFibGVIdG1sO1xuICAgIGNhcmRzRWwuaW5uZXJIVE1MID0gY2FyZHNIdG1sO1xuICAgIC8vIEFjdHVhbGl6YSBoZWFkZXIgZGUgdGFibGEgY29uIGxhIGNvbHVtbmEgbnVldmFcbiAgICBjb25zdCB0aGVhZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyN1c2Vycy10YWJsZSB0aGVhZCB0cicpO1xuICAgIGlmICh0aGVhZClcbiAgICAgIHRoZWFkLmlubmVySFRNTCA9XG4gICAgICAgICc8dGg+RW1haWw8L3RoPjx0aD5Ob21icmU8L3RoPjx0aD5Sb2w8L3RoPjx0aD5WZW5kZWRvcjwvdGg+PHRoPlBhcmVqYSBpbnRlcm5vPC90aD48dGggY2xhc3M9XCJ3YS1jb2xcIj5XaGF0c0FwcDwvdGg+PHRoPlJlc3AuIHJlbmRpY2lvbmVzPC90aD48dGg+UGFzczwvdGg+PHRoPjJGQTwvdGg+PHRoPjwvdGg+JztcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29wZW5BZG1pblBhbmVsJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGNhcmdhbmRvIHVzdWFyaW9zOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5jbG9zZUFkbWluUGFuZWwgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhZG1pbi1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VDQ0lcdTAwRDNOOiBGMjogZGVsZXRlVXNlclJvbGUgKyBUT1RQICsgY2hhbmdlVXNlclBhc3N3b3JkICsgc2F2ZVVzZXJSb2xlIChpbmxpbmUgTDE0MTA1LTE0MzkwKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbndpbmRvdy5kZWxldGVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xuICAgIGFsZXJ0KCdObyBwb2RlcyBlbGltaW5hciB0dSBwcm9waW8gYWNjZXNvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBEZWZlbnNhIGFkaWNpb25hbDogYWRtaW5zIHByb3RlZ2lkb3Mgbm8gc2UgcHVlZGVuIGVsaW1pbmFyIG5pIGRlc2RlIGNvbnNvbGFcbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwUHJlID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmdldCgpO1xuICAgIGNvbnN0IGVtYWlsUHJlID0gKHNuYXBQcmUuZXhpc3RzID8gc25hcFByZS5kYXRhKCkuZW1haWwgfHwgJycgOiAnJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBQUk9URUNURUQgPSBbJ2JvdC5zaGltYW5vLnBlc2NhQGdtYWlsLmNvbScsICdlcmJpbm9tYXJpYW5vQGdtYWlsLmNvbSddO1xuICAgIGlmIChQUk9URUNURUQuaW5kZXhPZihlbWFpbFByZSkgPj0gMCkge1xuICAgICAgYWxlcnQoJ0VzdGUgZXMgdW4gYWRtaW4gcHJvdGVnaWRvICgnICsgZW1haWxQcmUgKyAnKSB5IG5vIHNlIHB1ZWRlIGVsaW1pbmFyLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfSBjYXRjaCAoX2UpIHtcbiAgICAvKiBzaSBmYWxsYSBsYSBsZWN0dXJhIHByZXZpYSwgc2lndWUgY29uIGNvbmZpcm0gKi9cbiAgfVxuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnRWxpbWluYXIgYWNjZXNvIGRlIGVzdGUgdXN1YXJpbz9cXG5cXG5QaWVyZGUgYWNjZXNvIGRlIGlubWVkaWF0by4gU2kgdnVlbHZlIGEgZW50cmFyIGNvbiBHb29nbGUgdmEgYSBxdWVkYXIgY29tbyBcInNpbiByb2wgYXNpZ25hZG9cIiBoYXN0YSBxdWUgdm9zIGxvIGhhYmlsaXRlcyBkZSBudWV2by5cXG5cXG5TdSBjdWVudGEgR29vZ2xlIHNpZ3VlIGV4aXN0aWVuZG8sIG5vIHNlIGJvcnJhLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBjb25zdCBkYXRhID0gc25hcC5leGlzdHMgPyBzbmFwLmRhdGEoKSA6IHt9O1xuICAgIGxvZ09wKCdlbGltaW5hcl91c3VhcmlvJywgJ3VzZXInLCBkYXRhLmVtYWlsIHx8IHVpZCwge1xuICAgICAgdWlkLFxuICAgICAgcHJldmlvdXNSb2xlOiBkYXRhLnJvbGUsXG4gICAgICBwcmV2aW91c1ZlbmRvcjogZGF0YS52ZW5kb3IsXG4gICAgfSk7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmRvYyh1aWQpLmRlbGV0ZSgpO1xuICAgIHNob3dTeW5jVGFnKCdVc3VhcmlvIGVsaW1pbmFkbycpO1xuICAgIGF3YWl0IG9wZW5BZG1pblBhbmVsKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdkZWxldGVVc2VyUm9sZScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBhbmVsIGFkbWluOiBzZXR1cCAvIHJlc2V0IGRlIDJGQSBwb3IgdXN1YXJpb1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5sZXQgdG90cFNldHVwU3RhdGUgPSBudWxsOyAvLyB7dWlkLCBlbWFpbCwgc2VjcmV0LCBvdHBhdXRofVxuXG53aW5kb3cub3BlblRvdHBTZXR1cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGNvbnNvbGUubG9nKCdbMkZBXSBvcGVuVG90cFNldHVwIGNhbGxlZCcsIHsgdWlkLCBlbWFpbCwgdXNlclJvbGUgfSk7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykge1xuICAgIGFsZXJ0KCdTb2xvIGVsIGFkbWluaXN0cmFkb3IgcHVlZGUgY29uZmlndXJhciAyRkEgcGFyYSBvdHJvcyB1c3Vhcmlvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCF1aWQpIHtcbiAgICBhbGVydCgnRXJyb3I6IFVJRCBkZWwgdXN1YXJpbyBubyBkaXNwb25pYmxlLiBSZWNhcmdhIGxhIHBhZ2luYSB5IHJlaW50ZW50YS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xuICAvLyBNb2RhbCBleGlzdGU/XG4gIGNvbnN0IG1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtbW9kYWwnKTtcbiAgaWYgKCFtb2RhbCkge1xuICAgIGFsZXJ0KCdFcnJvcjogbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8gZW4gZWwgRE9NLiBSZWNhcmdhIGxhIHBhZ2luYSAoQ3RybCtTaGlmdCtSKS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc3VidEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtc2V0dXAtc3VidCcpO1xuICBpZiAoc3VidEVsKSBzdWJ0RWwudGV4dENvbnRlbnQgPSAnUGFyYTogJyArIChlbWFpbCB8fCB1aWQpO1xuICAvLyBMZWVyIGVzdGFkbyBhY3R1YWxcbiAgbGV0IGN1ckVuYWJsZWQgPSBmYWxzZTtcbiAgbGV0IGN1clNlY3JldCA9IG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgc25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS5kb2ModWlkKS5nZXQoKTtcbiAgICBpZiAoc25hcC5leGlzdHMpIHtcbiAgICAgIGNvbnN0IGQgPSBzbmFwLmRhdGEoKSB8fCB7fTtcbiAgICAgIGN1ckVuYWJsZWQgPSAhIWQudG90cEVuYWJsZWQ7XG4gICAgICBjdXJTZWNyZXQgPSBkLnRvdHBTZWNyZXQgfHwgbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS53YXJuKCdbMkZBXSBkb2Mgcm9sZXMvJyArIHVpZCArICcgbm8gZXhpc3RlJyk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignWzJGQV0gZXJyb3IgbGV5ZW5kbyByb2xlcy8nICsgdWlkLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgbGV5ZW5kbyBlbCBlc3RhZG8gZGUgMkZBIGRlbCB1c3VhcmlvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1jb250ZW50Jyk7XG4gIGlmICghYykge1xuICAgIGFsZXJ0KCdFcnJvcjogY29udGVuZWRvciBkZWwgbW9kYWwgZGUgMkZBIG5vIGVuY29udHJhZG8uIFJlY2FyZ2EgbGEgcGFnaW5hLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY3VyRW5hYmxlZCAmJiBjdXJTZWNyZXQpIHtcbiAgICBjLmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBzdHlsZT1cImJhY2tncm91bmQ6I2RjZmNlNztib3JkZXI6MXB4IHNvbGlkICM4NmVmYWM7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoxMnB4O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiMxNjY1MzQ7dGV4dC1hbGlnbjpjZW50ZXJcIj4nICtcbiAgICAgICc8Yj4mIzEwMDAzOyAyRkEgeWEgZXN0XHUwMEUxIGFjdGl2bzwvYj4gcGFyYSBlc3RlIHVzdWFyaW8uJyArXG4gICAgICAnPGJyPjxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjExcHhcIj5TaSBsbyBwZXJkaVx1MDBGMyBvIGNhbWJpXHUwMEYzIGRlIGNlbHVsYXIsIHBvZFx1MDBFOXMgZ2VuZXJhcmxlIHVubyBudWV2byAoZWwgYW50ZXJpb3IgcXVlZGEgaW52YWxpZGFkbykuPC9zcGFuPicgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjhweDttYXJnaW4tdG9wOjE0cHg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmbGV4LXdyYXA6d3JhcFwiPicgK1xuICAgICAgJzxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiZ2VuZXJhdGVOZXdUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgIFwiJywnXCIgK1xuICAgICAgZXNjYXBlQXR0cihlbWFpbCB8fCAnJykgK1xuICAgICAgJ1xcJylcIj5HZW5lcmFyIG51ZXZvIChyZXNldGVhcik8L2J1dHRvbj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImRpc2FibGVUb3RwKFxcJycgK1xuICAgICAgZXNjYXBlQXR0cih1aWQpICtcbiAgICAgICdcXCcpXCI+RGVzaGFiaWxpdGFyIDJGQTwvYnV0dG9uPicgK1xuICAgICAgJzwvZGl2Pic7XG4gIH0gZWxzZSB7XG4gICAgYy5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOiNlZmY2ZmY7Ym9yZGVyOjFweCBzb2xpZCAjYmZkYmZlO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweDtmb250LXNpemU6MTJweDtjb2xvcjojMWU0MGFmO3RleHQtYWxpZ246Y2VudGVyXCI+JyArXG4gICAgICAnRXN0ZSB1c3VhcmlvIHRvZGF2XHUwMEVEYSBubyB0aWVuZSAyRkEgY29uZmlndXJhZG8uIEdlbmVyXHUwMEUxIHVuIG51ZXZvIGNcdTAwRjNkaWdvIHBhcmEgcXVlIGxvIGVzY2FuZWUgY29uIEdvb2dsZSBBdXRoZW50aWNhdG9yLicgK1xuICAgICAgJzwvZGl2PicgK1xuICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW4tdG9wOjE0cHhcIj4nICtcbiAgICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tdmlvbGV0XCIgb25jbGljaz1cImdlbmVyYXRlTmV3VG90cChcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICBcIicsJ1wiICtcbiAgICAgIGVzY2FwZUF0dHIoZW1haWwgfHwgJycpICtcbiAgICAgICdcXCcpXCI+R2VuZXJhciAyRkE8L2J1dHRvbj4nICtcbiAgICAgICc8L2Rpdj4nO1xuICB9XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xufTtcbndpbmRvdy5jbG9zZVRvdHBTZXR1cE1vZGFsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1zZXR1cC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcbiAgdG90cFNldHVwU3RhdGUgPSBudWxsO1xufTtcblxud2luZG93LmdlbmVyYXRlTmV3VG90cCA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGVtYWlsKSB7XG4gIGlmICh1c2VyUm9sZSAhPT0gJ2FkbWluJykgcmV0dXJuO1xuICBjb25zdCBzZWNyZXQgPSB0b3RwR2VuZXJhdGVTZWNyZXQoKTtcbiAgY29uc3Qgb3RwYXV0aCA9IHRvdHBCdWlsZE90cGF1dGhVcmwoc2VjcmV0LCBlbWFpbCB8fCB1aWQpO1xuICB0b3RwU2V0dXBTdGF0ZSA9IHsgdWlkOiB1aWQsIGVtYWlsOiBlbWFpbCwgc2VjcmV0OiBzZWNyZXQsIG90cGF1dGg6IG90cGF1dGggfTtcbiAgY29uc3QgYyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0b3RwLXNldHVwLWNvbnRlbnQnKTtcbiAgYy5pbm5lckhUTUwgPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZmVmM2M3O2JvcmRlcjoxcHggc29saWQgI2ZjZDM0ZDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHg7Zm9udC1zaXplOjExcHg7Y29sb3I6Izc4MzUwZjttYXJnaW4tYm90dG9tOjE0cHhcIj4nICtcbiAgICAnPGI+UGFzb3MgcGFyYSBhY3RpdmFyOjwvYj48YnI+JyArXG4gICAgJzEuIEVsIHVzdWFyaW8gaW5zdGFsYSA8Yj5Hb29nbGUgQXV0aGVudGljYXRvcjwvYj4gZW4gc3UgY2VsdWxhci48YnI+JyArXG4gICAgJzIuIFRvY2EgXCJBZ3JlZ2FyXCIgLyBcIitcIiBlbiBsYSBhcHAuPGJyPicgK1xuICAgICczLiBFbGlnZSBcIkVzY2FuZWFyIGNcdTAwRjNkaWdvIFFSXCIgeSBlc2NhbmVhIGVsIGNcdTAwRjNkaWdvIGFiYWpvIChvIHBlZ2EgZWwgc2VjcmV0IG1hbnVhbG1lbnRlKS48YnI+JyArXG4gICAgJzQuIEFwYXJlY2UgdW4gY1x1MDBGM2RpZ28gZGUgNiBkXHUwMEVEZ2l0b3MgZW4gR29vZ2xlIEF1dGhlbnRpY2F0b3IuPGJyPicgK1xuICAgICc1LiBMbyBlc2NyaWJlIGVuIGVsIGlucHV0IGRlIGFiYWpvIHBhcmEgY29uZmlybWFyIHkgYWN0aXZhci4nICtcbiAgICAnPC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cInRleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MTRweFwiPjxkaXYgaWQ9XCJ0b3RwLXFyLWNvbnRhaW5lclwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojZmZmO3BhZGRpbmc6MTBweDtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czo2cHhcIj5HZW5lcmFuZG8gUVIuLi48L2Rpdj48L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDojZjhmYWZjO2JvcmRlcjoxcHggc29saWQgI2UyZThmMDtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEwcHg7dGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToxNHB4XCI+JyArXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6IzQ3NTU2OTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjRweDttYXJnaW4tYm90dG9tOjRweFwiPlNlY3JldCAoY2FyZ2EgbWFudWFsIHNpIGVsIFFSIGZhbGxhKTwvZGl2PicgK1xuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1mYW1pbHk6Q29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtd2VpZ2h0OjgwMDtjb2xvcjojNWIyMWI2O3dvcmQtYnJlYWs6YnJlYWstYWxsO2xldHRlci1zcGFjaW5nOi4xZW1cIj4nICtcbiAgICBlc2NhcGVIdG1sKHNlY3JldCkgK1xuICAgICc8L2Rpdj4nICtcbiAgICAnPC9kaXY+JztcbiAgYy5pbm5lckhUTUwgKz1cbiAgICAnPGRpdiBzdHlsZT1cIm1hcmdpbi1ib3R0b206MTBweFwiPjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojNDc1NTY5O2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo1cHhcIj5DXHUwMEYzZGlnbyBkZSB2ZXJpZmljYWNpXHUwMEYzbiBkZSBHb29nbGUgQXV0aGVudGljYXRvcjwvbGFiZWw+JyArXG4gICAgJzxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwidG90cC1jb25maXJtLWlucHV0XCIgaW5wdXRtb2RlPVwibnVtZXJpY1wiIG1heGxlbmd0aD1cIjdcIiBwbGFjZWhvbGRlcj1cIjAwMDAwMFwiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjEwcHggMTJweDtib3JkZXI6MS41cHggc29saWQgI2NiZDVlMTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MThweDt0ZXh0LWFsaWduOmNlbnRlcjtsZXR0ZXItc3BhY2luZzouM2VtO2ZvbnQtd2VpZ2h0OjgwMFwiLz48L2Rpdj4nO1xuICBjLmlubmVySFRNTCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDo4cHg7anVzdGlmeS1jb250ZW50OmNlbnRlclwiPjxidXR0b24gY2xhc3M9XCJhcHAtYnRuLXBpbGwgYXBwLWJ0bi12aW9sZXRcIiBvbmNsaWNrPVwiY29uZmlybVRvdHBTZXR1cCgpXCI+VmVyaWZpY2FyIHkgYWN0aXZhcjwvYnV0dG9uPicgK1xuICAgICc8YnV0dG9uIGNsYXNzPVwiYXBwLWJ0bi1waWxsIGFwcC1idG4tcmVkXCIgb25jbGljaz1cImNsb3NlVG90cFNldHVwTW9kYWwoKVwiPkNhbmNlbGFyPC9idXR0b24+PC9kaXY+JztcbiAgLy8gTGF6eS1sb2FkIHFyY29kZWpzIHkgZ2VuZXJhci4gRXN0YSBsaWJyZXJpYSBwaW50YSBlbCBRUiBkaXJlY3RvIGVuIGVsXG4gIC8vIGNvbnRlbmVkb3IgRE9NIHZpYSBjYW52YXMvaW1nIC0gbm8gbmVjZXNpdGEgY2FsbGJhY2sgdG9EYXRhVVJMLlxuICB0cnkge1xuICAgIGF3YWl0IGxvYWRRUkNvZGVMaWIoKTtcbiAgICBjb25zdCBib3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG90cC1xci1jb250YWluZXInKTtcbiAgICBpZiAoIWJveCkgcmV0dXJuO1xuICAgIGJveC5pbm5lckhUTUwgPSAnJzsgLy8gbGltcGlhciBlbCBcIkdlbmVyYW5kbyBRUi4uLlwiXG4gICAgbmV3IFFSQ29kZShib3gsIHtcbiAgICAgIHRleHQ6IG90cGF1dGgsXG4gICAgICB3aWR0aDogMjIwLFxuICAgICAgaGVpZ2h0OiAyMjAsXG4gICAgICBjb2xvckRhcms6ICcjMDAwMDAwJyxcbiAgICAgIGNvbG9yTGlnaHQ6ICcjZmZmZmZmJyxcbiAgICAgIGNvcnJlY3RMZXZlbDogUVJDb2RlLkNvcnJlY3RMZXZlbC5NLFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS53YXJuKCdbMkZBXSBFcnJvciBjYXJnYW5kbyBRUiBsaWI6JywgZSk7XG4gICAgY29uc3QgYm94ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtcXItY29udGFpbmVyJyk7XG4gICAgaWYgKGJveClcbiAgICAgIGJveC5pbm5lckhUTUwgPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5OTFiMWI7cGFkZGluZzoxNHB4XCI+Tm8gc2UgcHVkbyBjYXJnYXIgbGEgbGlicmVyXHUwMEVEYSBRUi4gVXNhIGVsIHNlY3JldCBtYW51YWwgcGFyYSBjb25maWd1cmFyLjwvZGl2Pic7XG4gIH1cbn07XG5cbndpbmRvdy5jb25maXJtVG90cFNldHVwID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICBpZiAoIXRvdHBTZXR1cFN0YXRlKSByZXR1cm47XG4gIGNvbnN0IGNvZGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3RvdHAtY29uZmlybS1pbnB1dCcpLnZhbHVlIHx8ICcnKS5yZXBsYWNlKC9cXHMrL2csICcnKTtcbiAgaWYgKCEvXlxcZHs2fSQvLnRlc3QoY29kZSkpIHtcbiAgICBhbGVydCgnSW5ncmVzXHUwMEUxIGxvcyA2IGRcdTAwRURnaXRvcy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb2sgPSBhd2FpdCB0b3RwVmVyaWZ5Q29kZSh0b3RwU2V0dXBTdGF0ZS5zZWNyZXQsIGNvZGUsIDEpO1xuICBpZiAoIW9rKSB7XG4gICAgYWxlcnQoXG4gICAgICAnQ1x1MDBGM2RpZ28gaW5jb3JyZWN0by4gQXNlZ3VyYXRlIGRlIHF1ZSBlbCBzZWNyZXQgc2UgY2FyZ1x1MDBGMyBiaWVuIGVuIEdvb2dsZSBBdXRoZW50aWNhdG9yIHkgcmVpbnRlbnRcdTAwRTEuJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModG90cFNldHVwU3RhdGUudWlkKVxuICAgICAgLnVwZGF0ZSh7XG4gICAgICAgIHRvdHBTZWNyZXQ6IHRvdHBTZXR1cFN0YXRlLnNlY3JldCxcbiAgICAgICAgdG90cEVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHRvdHBFbmFibGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICB0b3RwRW5hYmxlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgIH0pO1xuICAgIHNob3dTeW5jVGFnKCcyRkEgYWN0aXZhZG8gcGFyYSAnICsgKHRvdHBTZXR1cFN0YXRlLmVtYWlsIHx8ICd1c3VhcmlvJykpO1xuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NhdmUgdG90cCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBndWFyZGFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LmRpc2FibGVUb3RwID0gYXN5bmMgZnVuY3Rpb24gKHVpZCkge1xuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcbiAgaWYgKCFjb25maXJtKCdEZXNoYWJpbGl0YXIgMkZBIHBhcmEgZXN0ZSB1c3VhcmlvPyBWYSBhIGVudHJhciBzb2xvIGNvbiBwYXNzd29yZC4nKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAuZG9jKHVpZClcbiAgICAgIC51cGRhdGUoe1xuICAgICAgICB0b3RwRW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHRvdHBTZWNyZXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLmRlbGV0ZSgpLFxuICAgICAgICB0b3RwRGlzYWJsZWRCeTogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgIHRvdHBEaXNhYmxlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIH0pO1xuICAgIHNob3dTeW5jVGFnKCcyRkEgZGVzaGFiaWxpdGFkbycpO1xuICAgIGNsb3NlVG90cFNldHVwTW9kYWwoKTtcbiAgICB0cnkge1xuICAgICAgb3BlbkFkbWluUGFuZWwoKTtcbiAgICB9IGNhdGNoIChfZSkge31cbiAgfSBjYXRjaCAoZSkge1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG53aW5kb3cuY2hhbmdlVXNlclBhc3N3b3JkID0gYXN5bmMgZnVuY3Rpb24gKHVpZCwgZW1haWwpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICghZW1haWwpIHtcbiAgICBhbGVydCgnRXN0ZSB1c3VhcmlvIG5vIHRpZW5lIGVtYWlsIHJlZ2lzdHJhZG8gLSBubyBzZSBwdWVkZSByZXNldGVhci4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY2hvaWNlID0gcHJvbXB0KFxuICAgICdSZXNldGVhciBjb250cmFzZVx1MDBGMWEgZGUgJyArXG4gICAgICBlbWFpbCArXG4gICAgICAnXFxuXFxuJyArXG4gICAgICAnRWxlZ2kgdW5hIG9wY2lvbiAoMSAvIDIpOlxcblxcbicgK1xuICAgICAgJzEpIEVOVklBUiBNQUlMIERFIFJFU0VURU8gKHJlY29tZW5kYWRvKVxcbicgK1xuICAgICAgJyAgIExlIGxsZWdhIGEgJyArXG4gICAgICBlbWFpbCArXG4gICAgICAnIHVuIG1haWwgZGUgRmlyZWJhc2UgY29uIHVuIGxpbmsuXFxuJyArXG4gICAgICAnICAgRWwgdXN1YXJpbyBjbGlja2VhLCBzZXRlYSBzdSBudWV2YSBwYXNzd29yZCB5IHZ1ZWx2ZSBhIGxhIGFwcC5cXG4nICtcbiAgICAgICcgICBFcyBsbyBlc3RhbmRhciB5IGZ1bmNpb25hIHNlZ3Vyby5cXG5cXG4nICtcbiAgICAgICcyKSBSZXNldGVhciBTT0xPIGVsIHBhc3N3b3JkLWdhdGUgKHNlZ3VuZGEgY2FwYSkuXFxuJyArXG4gICAgICAnICAgTm8gY2FtYmlhIGxhIHBhc3N3b3JkIHJlYWwgZGUgRmlyZWJhc2UuIFNpcnZlIHNpIGVsIHVzdWFyaW9cXG4nICtcbiAgICAgICcgICBlbnRyYSBwb3IgR29vZ2xlIHkgb2x2aWRvIGxhIHBhc3N3b3JkLWdhdGUgZGUgbGEgYXBwLCBOTyBzaVxcbicgK1xuICAgICAgJyAgIG9sdmlkbyBsYSBwYXNzd29yZCBkZWwgbG9naW4gY29uIGVtYWlsLlxcblxcbicgK1xuICAgICAgJ0VzY3JpYmkgMSBvIDI6JyxcbiAgICAnMSdcbiAgKTtcbiAgaWYgKGNob2ljZSA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzEnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZiQXV0aC5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKTtcbiAgICAgIGFsZXJ0KFxuICAgICAgICAnT0sgLSBsZSBlbnZpZSB1biBtYWlsIGRlIHJlc2V0ZW8gYSAnICtcbiAgICAgICAgICBlbWFpbCArXG4gICAgICAgICAgJy4gRGVjaWxlIHF1ZSByZXZpc2UgaW5ib3ggeSBzcGFtLiBFbCBsaW5rIGV4cGlyYSBlbiAxIGhvcmEuJ1xuICAgICAgKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZiRGJcbiAgICAgICAgICAuY29sbGVjdGlvbigncm9sZXMnKVxuICAgICAgICAgIC5kb2ModWlkKVxuICAgICAgICAgIC51cGRhdGUoe1xuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQnk6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgICAgcGFzc3dvcmRDaGFuZ2VkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2ZpcmViYXNlX2VtYWlsJyxcbiAgICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ3NlbmRQYXNzd29yZFJlc2V0RW1haWwnLCBlKTtcbiAgICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbyBlbCBtYWlsOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY2hvaWNlLnRyaW0oKSA9PT0gJzInKSB7XG4gICAgY29uc3QgbmV3UHdkID0gcHJvbXB0KFxuICAgICAgJ051ZXZhIHBhc3N3b3JkLWdhdGUgcGFyYSAnICtcbiAgICAgICAgZW1haWwgK1xuICAgICAgICAnOlxcblxcbihTb2xvIGFmZWN0YSBsYSBzZWd1bmRhIGNhcGEgZGUgbGEgYXBwLCBOTyBlbCBsb2dpbiBjb24gZW1haWwpJyxcbiAgICAgICcnXG4gICAgKTtcbiAgICBpZiAobmV3UHdkID09PSBudWxsKSByZXR1cm47XG4gICAgY29uc3QgcHdkID0gKG5ld1B3ZCB8fCAnJykudHJpbSgpO1xuICAgIGlmIChwd2QubGVuZ3RoIDwgNCkge1xuICAgICAgYWxlcnQoJ0xhIGNvbnRyYXNlXHUwMEYxYSB0aWVuZSBxdWUgdGVuZXIgYWwgbWVub3MgNCBjYXJhY3RlcmVzLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgY3JlZHMgPSBhd2FpdCBidWlsZFBhc3N3b3JkQ3JlZGVudGlhbHMocHdkKTtcbiAgICAgIGF3YWl0IGZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgICAgLmRvYyh1aWQpXG4gICAgICAgIC51cGRhdGUoe1xuICAgICAgICAgIHBhc3N3b3JkSGFzaDogY3JlZHMucGFzc3dvcmRIYXNoLFxuICAgICAgICAgIHBhc3N3b3JkU2FsdDogY3JlZHMucGFzc3dvcmRTYWx0LFxuICAgICAgICAgIHBhc3N3b3JkQ2hhbmdlZEJ5OiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgICBwYXNzd29yZENoYW5nZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgcGFzc3dvcmRSZXNldE1ldGhvZDogJ2dhdGVfb25seScsXG4gICAgICAgIH0pO1xuICAgICAgc2hvd1N5bmNUYWcoJ1Bhc3N3b3JkLWdhdGUgYWN0dWFsaXphZGEgcGFyYSAnICsgZW1haWwpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ2NoYW5nZVVzZXJQYXNzd29yZCBnYXRlJywgZSk7XG4gICAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBhbGVydCgnT3BjaW9uIG5vIHZhbGlkYS4gQ2FuY2VsYWRvLicpO1xufTtcblxud2luZG93LnNhdmVVc2VyUm9sZSA9IGFzeW5jIGZ1bmN0aW9uICh1aWQsIGJ0bikge1xuICBjb25zdCBjb250YWluZXIgPSBidG4uY2xvc2VzdCgndHInKSB8fCBidG4uY2xvc2VzdCgnLnVzZXJzLWNhcmQnKTtcbiAgaWYgKCFjb250YWluZXIpIHJldHVybjtcbiAgY29uc3Qgcm9sZSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcucm9sZS1zZWwnKS52YWx1ZTtcbiAgY29uc3QgdmVuZG9yID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy52ZW5kb3Itc2VsJykudmFsdWUgfHwgbnVsbDtcbiAgY29uc3QgaW50ZXJuYWxTZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcignLmludGVybmFsLXNlbCcpO1xuICBjb25zdCBpbnRlcm5hbFBhcnRuZXJVaWQgPSBpbnRlcm5hbFNlbCA/IGludGVybmFsU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xuICAvLyBXaGF0c0FwcDogbGltcGlhciB0b2RvIGxvIHF1ZSBubyBzZWEgZGlnaXRvIChhY2VwdGEgKywgZXNwYWNpb3MsIHBhclx1MDBFOW50ZXNpcywgZXRjLilcbiAgY29uc3Qgd2FJbnB1dCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKCcud2EtaW5wdXQnKTtcbiAgY29uc3Qgd2hhdHNhcHAgPSB3YUlucHV0ID8gKHdhSW5wdXQudmFsdWUgfHwgJycpLnJlcGxhY2UoL1xcRC9nLCAnJykgOiAnJztcbiAgaWYgKHdoYXRzYXBwICYmIHdoYXRzYXBwLmxlbmd0aCA8IDgpIHtcbiAgICBhbGVydChcbiAgICAgICdFbCBudW1lcm8gZGUgV2hhdHNBcHAgZXMgbXV5IGNvcnRvLiBUaWVuZSBxdWUgc2VyIGVsIG51bWVybyBjb21wbGV0byBjb24gY29kaWdvIGRlIHBhaXMgKGVqLiA1NDkxMTI2NzYyMDMxIHBhcmEgQXJnZW50aW5hKS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gUmVzcG9uc2FibGUgZGUgcmVuZGljaW9uZXMgKHVpZCBkZWwgdXN1YXJpbyBxdWUgYXBydWViYSlcbiAgY29uc3QgcmVuZEFwcHJvdmVyU2VsID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoJy5yZW5kLWFwcHJvdmVyLXNlbCcpO1xuICBjb25zdCByZW5kaWNpb25lc0FwcHJvdmVyVWlkID0gcmVuZEFwcHJvdmVyU2VsID8gcmVuZEFwcHJvdmVyU2VsLnZhbHVlIHx8IG51bGwgOiBudWxsO1xuICAvLyBDYWNoZWFyIHRhbWJpZW4gZWwgZW1haWwgZGVsIGFwcm9iYWRvciBlbiBlbCBkb2MgZGVsIHZlbmRlZG9yOiBsb3NcbiAgLy8gdmVuZGVkb3JlcyBubyBwdWVkZW4gbGVlciAvcm9sZXMve290cm9VaWR9IHBvciBzZWN1cml0eSBydWxlcywgYXNpIHF1ZVxuICAvLyBuZWNlc2l0YW4gZWwgZW1haWwgYWNhIHBhcmEgcG9kZXIgbWFuZGFyIGxhIHJlbmRpY2lvbiAocmVzb2x2ZU15UmVuZGljaW9uZXNBcHByb3ZlclxuICAvLyBsbyB1c2EgY29tbyBwcmltZXIgZmFzdC1wYXRoKS4gU2luIGVzdG8gZWwgZmx1am8gZGVwZW5kaWEgZGVsIGRpcmVjdG9yaW9cbiAgLy8gcHVibGljbyAodXNlcnNfZGlyZWN0b3J5KSBxdWUgc29sbyBzZSBzaW5jcm9uaXphIGN1YW5kbyBhZG1pbiBhYnJlIGVsIHBhbmVsLlxuICBsZXQgcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsID0gbnVsbDtcbiAgaWYgKHJlbmRpY2lvbmVzQXBwcm92ZXJVaWQpIHtcbiAgICBjb25zdCBhcHByb3ZlclVzZXIgPSAodXNlcnNDYWNoZSB8fCBbXSkuZmluZCgodSkgPT4gdS5fdWlkID09PSByZW5kaWNpb25lc0FwcHJvdmVyVWlkKTtcbiAgICByZW5kaWNpb25lc0FwcHJvdmVyRW1haWwgPSBhcHByb3ZlclVzZXIgPyBhcHByb3ZlclVzZXIuZW1haWwgfHwgbnVsbCA6IG51bGw7XG4gIH1cbiAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgYnRuLnRleHRDb250ZW50ID0gJy4uLic7XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYlxuICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgIC5kb2ModWlkKVxuICAgICAgLnNldChcbiAgICAgICAge1xuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgdmVuZG9yLFxuICAgICAgICAgIGludGVybmFsUGFydG5lclVpZCxcbiAgICAgICAgICB3aGF0c2FwcDogd2hhdHNhcHAgfHwgbnVsbCxcbiAgICAgICAgICByZW5kaWNpb25lc0FwcHJvdmVyVWlkOiByZW5kaWNpb25lc0FwcHJvdmVyVWlkLFxuICAgICAgICAgIHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbDogcmVuZGljaW9uZXNBcHByb3ZlckVtYWlsLFxuICAgICAgICAgIGFzc2lnbmVkQnk6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICBhc3NpZ25lZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSxcbiAgICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgICApO1xuICAgIC8vIFNpIGVsIHVzdWFyaW8gZWRpdG8gc3UgcHJvcGlvIG51bWVybywgYWN0dWFsaXphciBlbCBjYWNoZSBsb2NhbFxuICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkge1xuICAgICAgbXlXaGF0c2FwcE51bWJlciA9IHdoYXRzYXBwIHx8IG51bGw7XG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJVaWQgPSByZW5kaWNpb25lc0FwcHJvdmVyVWlkIHx8IG51bGw7XG4gICAgICBteVJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCA9IHJlbmRpY2lvbmVzQXBwcm92ZXJFbWFpbCB8fCBudWxsO1xuICAgIH1cbiAgICBidG4udGV4dENvbnRlbnQgPSAnT0snO1xuICAgIC8vIFJlLXJlbmRlciBkZWwgcGFuZWwgYXNpIGxvcyBkcm9wZG93bnMgXCJQYXJlamEgaW50ZXJub1wiIG11ZXN0cmFuIGxvcyBpbnRlcm5vcyBhY3R1YWxpemFkb3NcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9wZW5BZG1pblBhbmVsKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ3JlZnJlc2ggYWRtaW4gcGFuZWwnLCBlKTtcbiAgICAgIH1cbiAgICB9LCA0MDApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignc2F2ZVVzZXJSb2xlJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGd1YXJkYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFyJztcbiAgfVxufTtcblxuLy8gVG9kb3MgbG9zIGhhbmRsZXJzIHdpbmRvdy5mb28gPSBmdW5jdGlvbi4uLiB5YSBzb24gdmVyYmF0aW0uXG4iXSwKICAibWFwcGlu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
