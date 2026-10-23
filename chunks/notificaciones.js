"use strict";
(() => {
  // src/domains/notificaciones.js
  if (typeof window.notifsTab === "undefined") window.notifsTab = "recibidas";
  var mySentTasks = [];
  if (typeof window.unsubMySentTasks === "undefined") window.unsubMySentTasks = null;
  var taskFormImages = [];
  function ensureMySentTasksListener() {
    if (unsubMySentTasks || !currentUser || !fbDb) return;
    window.unsubMySentTasks = fbDb.collection("notifications").where("fromUid", "==", currentUser.uid).onSnapshot(
      (qs) => {
        mySentTasks = [];
        qs.forEach((d) => {
          const data = d.data() || {};
          if ((data.type || "derivacion") !== "task") return;
          mySentTasks.push(Object.assign({ _fsId: d.id }, data));
        });
        mySentTasks.sort((a, b) => {
          const ta = a.createdAt ? a.createdAt.toMillis ? a.createdAt.toMillis() : 0 : 0;
          const tb = b.createdAt ? b.createdAt.toMillis ? b.createdAt.toMillis() : 0 : 0;
          return tb - ta;
        });
        const panePeek = document.getElementById("pane-notif");
        const paneVisible = panePeek && panePeek.style.display !== "none";
        if (paneVisible && window.notifsTab === "enviadas") renderMySentTasks();
        updateNotifsTabCounts();
      },
      (err) => console.warn("sent tasks listener", err)
    );
  }
  window.openNotifsPanel = function() {
    setTab("notif");
    ensureMySentTasksListener();
    setNotifsTab(window.notifsTab || "recibidas");
    populateTaskTargetSelect();
    updateNotifsTabCounts();
  };
  window.closeNotifsPanel = function() {
  };
  window.populateTaskTargets = function() {
    try {
      populateTaskTargetSelect();
    } catch (_e) {
    }
  };
  var CLIENT_APPLICATION_APPROVER_EMAILS = ["srb90284@gmail.com", "quilgym@gmail.com"];
  var ALTA_CLI_MAX_FOTOS = 5;
  var altaCliFiles = { arca: null, iibb: null, fotos: [] };
  var altaCliMine = [];
  if (typeof window.unsubAltaCliMine === "undefined") window.unsubAltaCliMine = null;
  function ensureAltaCliListener() {
    if (window.unsubAltaCliMine || !currentUser || !fbDb) return;
    window.unsubAltaCliMine = fbDb.collection("client_applications").where("ownerUid", "==", currentUser.uid).onSnapshot(
      (qs) => {
        altaCliMine = [];
        qs.forEach((d) => altaCliMine.push(Object.assign({ _fsId: d.id }, d.data())));
        altaCliMine.sort((a, b) => {
          const ta = a.createdAt ? a.createdAt.toMillis ? a.createdAt.toMillis() : 0 : 0;
          const tb = b.createdAt ? b.createdAt.toMillis ? b.createdAt.toMillis() : 0 : 0;
          return tb - ta;
        });
        const pane = document.getElementById("ac-pane-mias");
        if (pane && pane.style.display !== "none") renderAltaCliMisSolicitudes();
        const c = document.getElementById("ac-sub-count-mias");
        if (c) {
          const pendientes = altaCliMine.filter((a) => a.status === "pending_approval").length;
          c.textContent = pendientes > 0 ? pendientes : "";
        }
      },
      (err) => console.warn("alta cli listener", err)
    );
  }
  function populateAltaCliProvincias() {
    const provs = /* @__PURE__ */ new Set();
    (POINTS || []).forEach((p) => provs.add(p.province));
    const sorted = [...provs].sort();
    ["ac-provincia", "ar-provincia"].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel || sel.options.length > 1) return;
      sorted.forEach((pr) => {
        const o = document.createElement("option");
        o.value = pr;
        o.textContent = titleCase(pr);
        sel.appendChild(o);
      });
    });
  }
  function buildAltaCliShareUrl() {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "alta-cliente.html";
    const params = new URLSearchParams();
    if (currentUser && currentUser.uid) params.set("vendor", currentUser.uid);
    const vname = currentUser && currentUser.displayName || currentUser && currentUser.email || "";
    if (vname) params.set("vendorName", vname);
    if (currentUser && currentUser.email) params.set("vendorEmail", currentUser.email);
    return base + "?" + params.toString();
  }
  window.copyAltaCliShareLink = function() {
    const url = buildAltaCliShareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showSyncTag("Link copiado. Pegalo y mandalo al cliente.");
      }).catch(() => prompt("Copia el link:", url));
    } else {
      prompt("Copia el link:", url);
    }
  };
  window.shareAltaCliViaWhatsapp = function() {
    const url = buildAltaCliShareUrl();
    const vname = currentUser && currentUser.displayName || currentUser && currentUser.email || "Shimano";
    const msg = "Hola! Soy " + vname + " de Shimano Argentina. Para darte de alta como cliente, completa por favor este formulario con los datos de tu comercio. Una vez aprobado, podes empezar a comprar. Cualquier duda me avisas.\n\n" + url;
    const waUrl = "https://wa.me/?text=" + encodeURIComponent(msg);
    window.open(waUrl, "_blank");
  };
  window.setAltaCliSubtab = function(sub) {
    document.querySelectorAll(".ac-subtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.acsub === sub));
    const nuevoPane = document.getElementById("ac-pane-nuevo");
    if (nuevoPane) nuevoPane.style.display = sub === "nuevo" ? "" : "none";
    document.getElementById("ac-pane-mias").style.display = sub === "mias" ? "" : "none";
    const rapidaPane = document.getElementById("ac-pane-rapida");
    if (rapidaPane) rapidaPane.style.display = sub === "rapida" ? "" : "none";
    if (sub === "mias") renderAltaCliMisSolicitudes();
  };
  window.submitAltaRapida = async function() {
    if (!currentUser) {
      alert("No hay sesi\xF3n activa.");
      return;
    }
    const comercio = (document.getElementById("ar-comercio").value || "").trim();
    const provincia = ((document.getElementById("ar-provincia") || {}).value || "").trim().toUpperCase();
    const localidad = ((document.getElementById("ar-localidad") || {}).value || "").trim();
    const direccion = (document.getElementById("ar-direccion").value || "").trim();
    const dueno = (document.getElementById("ar-dueno").value || "").trim();
    const telefono = (document.getElementById("ar-telefono").value || "").trim();
    const cuitRaw = (document.getElementById("ar-cuit") || { value: "" }).value || "";
    const cuit = cuitRaw.replace(/\D/g, "");
    if (comercio.length < 2) {
      alert("Complet\xE1 el nombre del local.");
      return;
    }
    if (!provincia) {
      alert("Eleg\xED la provincia.");
      return;
    }
    if (localidad.length < 2) {
      alert("Complet\xE1 la localidad.");
      return;
    }
    if (direccion.length < 5) {
      alert("Complet\xE1 la direcci\xF3n.");
      return;
    }
    if (dueno.length < 2) {
      alert("Complet\xE1 el nombre del due\xF1o / contacto.");
      return;
    }
    if (cuit && cuit.length !== 11) {
      if (!confirm("El CUIT ingresado tiene " + cuit.length + " digitos (esperaba 11). Guardar igual?"))
        return;
    }
    if (!confirm(
      'Confirmar alta r\xE1pida de "' + comercio + '"?\n\nProvincia: ' + titleCase(provincia) + "\nLocalidad: " + localidad + "\nDireccion: " + direccion + "\nDue\xF1o: " + dueno + (telefono ? "\nTel: " + telefono : "") + (cuit ? "\nCUIT: " + cuit : "") + "\n\nEl cliente queda habilitado PROVISORIAMENTE (amarillo).\nVas a poder cargarle pedidos y visitas, pero los pedidos NO se envian\na SAP hasta que administracion cree el cliente alli."
    ))
      return;
    const btn = document.querySelector("#alta-rapida-form .btn-confirm");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Guardando...";
    }
    const myVendor = typeof assignedVendor !== "undefined" && assignedVendor ? assignedVendor : "";
    let geoPromise = Promise.resolve(null);
    if (typeof geocodeClientAddress === "function") {
      geoPromise = geocodeClientAddress(direccion, "", "").catch(() => null);
    }
    try {
      const docRef = await fbDb.collection("client_applications").add({
        comercio,
        fantasia: comercio,
        calle: direccion,
        provincia,
        localidad,
        localidadFinal: localidad,
        duenoNombre: dueno,
        telefonoContacto: telefono || "",
        cuit: cuit || "",
        // v293+: CUIT opcional para match automatico con SAP
        status: "approved",
        source: "alta_rapida",
        manualSapPending: true,
        // FLAG: admin tiene que cargar a SAP manual
        assignedVendor: myVendor,
        ownerUid: currentUser.uid,
        ownerEmail: currentUser.email || "",
        ownerName: currentUser.displayName || currentUser.email || "",
        approvals: {
          [currentUser.uid]: {
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            email: currentUser.email || "",
            name: currentUser.displayName || "",
            note: "Alta rapida auto-aprobada por el vendedor"
          }
        },
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      geoPromise.then((geo) => {
        if (geo && geo.lat != null && geo.lng != null) {
          const update = {
            lat: geo.lat,
            lng: geo.lng,
            geoDisplay: geo.display || "",
            geoProvider: geo.provider || "osm",
            geoAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          const detectedLoc = (geo.locality || "").trim();
          if (detectedLoc) {
            update.localidad = detectedLoc;
            update.localidadFinal = detectedLoc;
          }
          const detectedProv = (geo.province || "").trim();
          if (detectedProv) update.provincia = detectedProv.toUpperCase();
          docRef.set(update, { merge: true }).catch((e) => console.warn("geocode update alta rapida", e));
        }
      });
      try {
        const adminsSnap = await fbDb.collection("roles").where("role", "==", "admin").get();
        const me = currentUser.displayName || currentUser.email || "Vendedor";
        adminsSnap.forEach((d) => {
          fbDb.collection("notifications").add({
            type: "alta_rapida_creada",
            targetUid: d.id,
            fromUid: currentUser.uid,
            fromEmail: currentUser.email || "",
            title: "Alta rapida pendiente de carga manual en SAP",
            body: me + ' dio de alta rapida a "' + comercio + '" (' + direccion + ", due\xF1o " + dueno + "). Hay que cargarlo manualmente en SAP.",
            comercio,
            status: "unread",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }).catch(() => {
          });
        });
      } catch (e) {
        console.warn("notify admin alta rapida", e);
      }
      document.getElementById("alta-rapida-form").reset();
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirmar cliente y habilitar";
      }
      alert(
        "Cliente habilitado provisoriamente.\n\nYa podes cargarle pedidos desde la solapa PEDIDOS."
      );
    } catch (e) {
      console.error("submitAltaRapida", e);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirmar cliente y habilitar";
      }
      alert("Error guardando: " + (e.message || e));
    }
  };
  window.onAltaCliFile = async function(input, kind) {
    const files = [...input.files || []];
    for (const f of files) {
      try {
        const b64 = await compressImage(f, 1400, 0.78);
        if (kind === "fotos") {
          if (altaCliFiles.fotos.length >= ALTA_CLI_MAX_FOTOS) {
            alert("Maximo " + ALTA_CLI_MAX_FOTOS + " fotos del local.");
            break;
          }
          altaCliFiles.fotos.push(b64);
        } else {
          altaCliFiles[kind] = b64;
          break;
        }
      } catch (e) {
        console.warn("compress alta cli", e);
      }
    }
    input.value = "";
    refreshAltaCliGrid(kind);
  };
  window.removeAltaCliFile = function(kind, idx) {
    if (kind === "fotos") altaCliFiles.fotos.splice(idx, 1);
    else altaCliFiles[kind] = null;
    refreshAltaCliGrid(kind);
  };
  function refreshAltaCliGrid(kind) {
    const gridId = kind === "arca" ? "ac-arca-grid" : kind === "iibb" ? "ac-iibb-grid" : "ac-fotos-grid";
    const grid = document.getElementById(gridId);
    if (!grid) return;
    let cells = "";
    if (kind === "fotos") {
      cells = altaCliFiles.fotos.map(
        (b64, i) => '<div class="photo-cell"><img src="' + b64 + `"/><button type="button" class="rm" onclick="removeAltaCliFile('fotos',` + i + ')">&times;</button></div>'
      ).join("");
      if (altaCliFiles.fotos.length < ALTA_CLI_MAX_FOTOS) {
        cells += `<label class="photo-cell add"><input type="file" accept="image/*" multiple onchange="onAltaCliFile(this,'fotos')"/>+</label>`;
      }
    } else {
      const v = altaCliFiles[kind];
      if (v) {
        cells = '<div class="photo-cell"><img src="' + v + `"/><button type="button" class="rm" onclick="removeAltaCliFile('` + kind + `')">&times;</button></div>`;
      } else {
        cells = `<label class="photo-cell add"><input type="file" accept="image/*,.pdf" onchange="onAltaCliFile(this,'` + kind + `')"/>+</label>`;
      }
    }
    grid.innerHTML = cells;
  }
  function resetAltaCliForm() {
    const f = document.getElementById("alta-cli-form");
    if (f) f.reset();
    altaCliFiles = { arca: null, iibb: null, fotos: [] };
    refreshAltaCliGrid("arca");
    refreshAltaCliGrid("iibb");
    refreshAltaCliGrid("fotos");
  }
  window.submitClientApplication = async function() {
    const errors = [];
    function read(id) {
      const el = document.getElementById(id);
      return el ? (el.value || "").trim() : "";
    }
    const fields = [
      ["ac-email", "E-mail comercio"],
      ["ac-comercio", "Nombre del comercio"],
      ["ac-fantasia", "Nombre fantasia"],
      ["ac-cuit", "CUIT"],
      ["ac-condfiscal", "Condicion fiscal"],
      ["ac-calle", "Calle"],
      ["ac-numero", "Numero"],
      ["ac-localidad", "Localidad"],
      ["ac-provincia", "Provincia"],
      ["ac-cp", "Codigo Postal"],
      ["ac-telefono", "Telefono"],
      ["ac-web", "Pagina web"],
      ["ac-redes", "Redes"],
      ["ac-contacto-nombre", "Nombre contacto"],
      ["ac-contacto-telpart", "Telefono particular contacto"],
      ["ac-contacto-wsp", "WhatsApp contacto"],
      ["ac-contacto-email", "Email contacto"],
      ["ac-tipocomercio", "Tipo de comercio"],
      ["ac-tiendaonline", "Tienda online"]
    ];
    fields.forEach(([id, label]) => {
      if (!read(id)) errors.push(label);
    });
    if (!altaCliFiles.arca) errors.push("Constancia ARCA");
    if (!altaCliFiles.fotos.length) errors.push("Fotos del local (al menos 1)");
    if (errors.length) {
      alert("Faltan completar:\n\n- " + errors.join("\n- "));
      return;
    }
    if (!confirm(
      'Enviar la solicitud de alta de "' + read("ac-comercio") + '"?\n\nLes va a llegar como tarea a los aprobadores (Santiago y Diego). Cuando ambos aprueben, el cliente queda dado de alta y vas a poder cargarle pedidos.'
    ))
      return;
    const data = {
      // Datos comercio
      email: read("ac-email"),
      comercio: read("ac-comercio"),
      fantasia: read("ac-fantasia"),
      cuit: read("ac-cuit"),
      condicionFiscal: read("ac-condfiscal"),
      calle: read("ac-calle"),
      numero: read("ac-numero"),
      localidad: read("ac-localidad"),
      provincia: read("ac-provincia"),
      cp: read("ac-cp"),
      telefono: read("ac-telefono"),
      web: read("ac-web"),
      redes: read("ac-redes"),
      // Contacto
      contactoNombre: read("ac-contacto-nombre"),
      contactoTelParticular: read("ac-contacto-telpart"),
      contactoWhatsapp: read("ac-contacto-wsp"),
      contactoEmail: read("ac-contacto-email"),
      tipoComercio: read("ac-tipocomercio"),
      tiendaOnline: read("ac-tiendaonline"),
      // Documentos
      constanciaArca: altaCliFiles.arca,
      constanciaIIBB: altaCliFiles.iibb,
      fotosLocal: altaCliFiles.fotos.slice(),
      // Metadata
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email || "",
      ownerName: currentUser.displayName || currentUser.email || "",
      vendor: assignedVendor || null,
      status: "pending_approval",
      approvals: {},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const btn = document.querySelector("#alta-cli-form .btn-confirm");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enviando...";
    }
    try {
      const docRef = await fbDb.collection("client_applications").add(data);
      const approvers = await findApproverUids();
      for (const u of approvers) {
        try {
          await fbDb.collection("notifications").add({
            type: "client_approval",
            fromUid: currentUser.uid,
            fromEmail: currentUser.email || "",
            fromName: currentUser.displayName || currentUser.email || "",
            targetUid: u.uid,
            targetEmail: u.email,
            title: "Nueva solicitud de alta: " + data.comercio,
            description: "Vendedor: " + (data.ownerName || data.ownerEmail) + "\nCUIT: " + data.cuit + "\nLocalidad: " + data.localidad + ", " + titleCase(data.provincia) + "\nCondici\xF3n fiscal: " + data.condicionFiscal,
            applicationId: docRef.id,
            status: "unread",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) {
          console.warn("notif approver", u.email, e);
        }
      }
      showSyncTag("Solicitud enviada. Aprobadores notificados.");
      resetAltaCliForm();
      setAltaCliSubtab("mias");
    } catch (e) {
      console.error("submit client app", e);
      alert("Error enviando: " + (e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enviar solicitud de alta";
      }
    }
  };
  async function findApproverUids() {
    const out = [];
    try {
      const qs = await fbDb.collection("roles").get();
      qs.forEach((d) => {
        const data = d.data() || {};
        const em = (data.email || "").toLowerCase();
        if (CLIENT_APPLICATION_APPROVER_EMAILS.indexOf(em) >= 0) {
          out.push({ uid: d.id, email: em });
        }
      });
    } catch (e) {
      console.warn("findApproverUids", e);
    }
    return out;
  }
  function renderAltaCliMisSolicitudes() {
    const cont = document.getElementById("ac-mias-list");
    if (!cont) return;
    if (!altaCliMine.length) {
      cont.innerHTML = '<div class="notif-empty">No enviaste solicitudes todavia. Usa la pesta\xF1a <b>Nueva solicitud</b>.</div>';
      return;
    }
    let html = "";
    altaCliMine.forEach((a) => {
      const stCls = a.status === "approved" ? "approved" : a.status === "rejected" ? "rejected" : "pending";
      const stLbl = a.status === "approved" ? "Aprobada" : a.status === "rejected" ? "Rechazada" : "Pendiente";
      const dt = a.createdAt ? a.createdAt.toDate ? a.createdAt.toDate() : null : null;
      const dtStr = dt ? dt.toLocaleString("es-AR") : "";
      const apCount = a.approvals ? Object.keys(a.approvals).length : 0;
      const isRapida = a.source === "alta_rapida";
      const hasSap = !!a.cardCodeSap;
      html += '<div class="ac-app-card ' + stCls + '">';
      html += "<h5>" + escapeHtml(a.comercio || "-") + "</h5>";
      html += '<div class="ac-app-meta">' + escapeHtml(a.fantasia || "") + " &middot; CUIT " + escapeHtml(a.cuit || "") + "</div>";
      html += '<div class="ac-app-meta">' + escapeHtml(a.localidad || "") + " &middot; " + escapeHtml(titleCase(a.provincia || "")) + " &middot; Enviada " + escapeHtml(dtStr) + "</div>";
      html += '<div><span class="ac-app-status">' + stLbl + "</span>";
      if (a.status === "pending_approval") {
        html += ' <span style="font-size:10px;color:var(--text-muted);margin-left:6px">' + apCount + "/2 aprobaciones</span>";
      }
      if (a.status === "rejected" && a.rejectedReason) {
        html += '<div style="font-size:10px;color:var(--color-danger-strong);margin-top:4px"><b>Motivo:</b> ' + escapeHtml(a.rejectedReason) + "</div>";
      }
      html += "</div>";
      const canDelete = isRapida ? !hasSap : a.status !== "approved" || !hasSap;
      if (canDelete) {
        const safeId = escapeAttr(a._fsId || "");
        const safeName = JSON.stringify(a.comercio || "").replace(/"/g, "&quot;");
        html += '<div style="margin-top:8px;text-align:right">';
        html += `<button onclick="deleteMyAltaCli('` + safeId + "', " + safeName + ')" style="background:var(--color-danger-bg);color:var(--color-danger-strong);border:1.5px solid #fca5a5;border-radius:5px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">Eliminar</button>';
        html += "</div>";
      }
      html += "</div>";
    });
    cont.innerHTML = html;
  }
  window.deleteMyAltaCli = async function(fsId, comercio) {
    if (!fsId) return;
    const nombre = comercio || "esta solicitud";
    if (!confirm(
      'Eliminar "' + nombre + '"?\n\nLa alta se borra de tus solicitudes y deja de aparecer en PEDIDOS / VISITAS / mapa. No se puede deshacer.'
    ))
      return;
    try {
      await fbDb.collection("client_applications").doc(fsId).delete();
      if (typeof showSyncTag === "function") showSyncTag("Alta eliminada");
    } catch (e) {
      console.error("deleteMyAltaCli", e);
      alert("Error eliminando la solicitud: " + (e.message || e));
    }
  };
  window.openClientApplicationDetail = async function(appId, notifId) {
    if (!appId) {
      alert("Solicitud no encontrada.");
      return;
    }
    try {
      const snap = await fbDb.collection("client_applications").doc(appId).get();
      if (!snap.exists) {
        alert("La solicitud ya no existe.");
        return;
      }
      const a = Object.assign({ _id: appId }, snap.data());
      const c = document.getElementById("ca-detail-content");
      let h = '<div style="padding:18px 20px;font-size:12px;color:var(--text-primary);line-height:1.6">';
      h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Comercio</h4>';
      h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
      h += "<div><b>Nombre:</b> " + escapeHtml(a.comercio || "") + "</div>";
      h += "<div><b>Fantasia:</b> " + escapeHtml(a.fantasia || "") + "</div>";
      h += "<div><b>CUIT:</b> " + escapeHtml(a.cuit || "") + "</div>";
      h += "<div><b>Cond. fiscal:</b> " + escapeHtml(a.condicionFiscal || "") + "</div>";
      h += "<div><b>Direccion:</b> " + escapeHtml(a.calle || "") + " " + escapeHtml(a.numero || "") + "</div>";
      h += "<div><b>CP:</b> " + escapeHtml(a.cp || "") + "</div>";
      h += "<div><b>Localidad:</b> " + escapeHtml(a.localidad || "") + "</div>";
      h += "<div><b>Provincia:</b> " + escapeHtml(titleCase(a.provincia || "")) + "</div>";
      h += "<div><b>Telefono:</b> " + escapeHtml(a.telefono || "") + "</div>";
      h += "<div><b>Email:</b> " + escapeHtml(a.email || "") + "</div>";
      h += '<div style="grid-column:1/-1"><b>Web:</b> ' + escapeHtml(a.web || "") + "</div>";
      h += '<div style="grid-column:1/-1"><b>Redes:</b> ' + escapeHtml(a.redes || "") + "</div>";
      h += "</div>";
      h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Contacto</h4>';
      h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px">';
      h += "<div><b>Nombre:</b> " + escapeHtml(a.contactoNombre || "") + "</div>";
      h += "<div><b>Tel particular:</b> " + escapeHtml(a.contactoTelParticular || "") + "</div>";
      h += "<div><b>WhatsApp:</b> " + escapeHtml(a.contactoWhatsapp || "") + "</div>";
      h += "<div><b>E-mail:</b> " + escapeHtml(a.contactoEmail || "") + "</div>";
      h += "<div><b>Tipo comercio:</b> " + escapeHtml(a.tipoComercio || "") + "</div>";
      h += "<div><b>Tienda online:</b> " + escapeHtml(a.tiendaOnline || "") + "</div>";
      h += "</div>";
      h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Documentaci&oacute;n</h4>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
      if (a.constanciaArca)
        h += '<div style="text-align:center"><div style="font-size:9px;color:var(--text-secondary);margin-bottom:3px;font-weight:700;text-transform:uppercase">ARCA</div><img src="' + a.constanciaArca + `" id="ca-arca-img" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer('ca-arca-img')"/></div>`;
      if (a.constanciaIIBB)
        h += '<div style="text-align:center"><div style="font-size:9px;color:var(--text-secondary);margin-bottom:3px;font-weight:700;text-transform:uppercase">IIBB</div><img src="' + a.constanciaIIBB + `" id="ca-iibb-img" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer('ca-iibb-img')"/></div>`;
      (a.fotosLocal || []).forEach((f, i) => {
        h += '<div style="text-align:center"><div style="font-size:9px;color:var(--text-secondary);margin-bottom:3px;font-weight:700;text-transform:uppercase">Local ' + (i + 1) + '</div><img src="' + f + '" id="ca-foto-' + i + `" class="task-img-thumb" style="width:90px;height:90px" onclick="openImgViewer('ca-foto-` + i + `')"/></div>`;
      });
      h += "</div>";
      h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Origen</h4>';
      h += "<div>Vendedor: <b>" + escapeHtml(a.ownerName || a.ownerEmail || "-") + "</b></div>";
      const apN = a.approvals ? Object.keys(a.approvals).length : 0;
      h += "<div>Aprobaciones recibidas: <b>" + apN + " / 2</b></div>";
      if (a.approvals) {
        Object.keys(a.approvals).forEach((uid) => {
          const ap = a.approvals[uid];
          h += '<div style="font-size:10px;color:var(--color-success);margin-left:8px">&#10003; ' + escapeHtml(ap.email || uid) + "</div>";
        });
      }
      if (a.status === "rejected") {
        h += '<div style="background:var(--color-danger-bg);border:1px solid #fca5a5;border-radius:4px;padding:8px;margin-top:8px;color:var(--color-danger-strong)"><b>RECHAZADA</b> por ' + escapeHtml(a.rejectedByEmail || "") + ". Motivo: " + escapeHtml(a.rejectedReason || "-") + "</div>";
      }
      const meEmail = (currentUser.email || "").toLowerCase();
      const iAmApprover = CLIENT_APPLICATION_APPROVER_EMAILS.indexOf(meEmail) >= 0;
      const iAlreadyApproved = a.approvals && a.approvals[currentUser.uid];
      if (a.status === "pending_approval" && iAmApprover && !iAlreadyApproved) {
        const preCardCode = a.cardCodeSap || "";
        const preVendor = a.assignedVendor || "";
        const preLoc = a.localidadFinal || a.localidad || "";
        h += '<h4 style="font-size:12px;color:#0891b2;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;padding-bottom:5px;border-bottom:1.5px solid #67e8f9">Datos del aprobador</h4>';
        h += '<div style="display:grid;grid-template-columns:1fr;gap:8px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:6px;padding:12px">';
        h += '<div><label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px">CardCode SAP B1 <span style="color:var(--color-danger)">*</span></label>';
        h += '<input id="ca-cardcode" type="text" placeholder="C-12345 / dejar vacio si todavia no se creo el BP" value="' + escapeAttr(preCardCode) + '" style="width:100%;padding:7px 10px;border:1.5px solid var(--border-default);border-radius:5px;font-size:12px;font-family:Consolas,monospace;font-weight:700"/>';
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">Sin CardCode la tienda aparece en el mapa pero no se puede crear pedido (DTW lo necesita).</div></div>';
        h += '<div><label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px">Asignar a vendedor <span style="color:var(--color-danger)">*</span></label>';
        h += '<select id="ca-vendor" style="width:100%;padding:7px 10px;border:1.5px solid var(--border-default);border-radius:5px;font-size:12px;background:var(--bg-elevated)">';
        h += '<option value="">- Elegir vendedor -</option>';
        h += '<optgroup label="Vendedores externos (VDE)">';
        VENDORS.filter((v) => VDE_VENDOR_KEYS.has(v.key)).forEach((v) => {
          const sel = v.key === preVendor ? " selected" : "";
          h += '<option value="' + escapeAttr(v.key) + '"' + sel + ">" + escapeHtml(v.zone + " - " + titleCase(v.key)) + "</option>";
        });
        h += "</optgroup>";
        h += '<optgroup label="Vendedores internos (VDI)">';
        VENDORS.filter((v) => VDI_VENDOR_KEYS.has(v.key)).forEach((v) => {
          const sel = v.key === preVendor ? " selected" : "";
          h += '<option value="' + escapeAttr(v.key) + '"' + sel + ">" + escapeHtml(titleCase(v.key)) + "</option>";
        });
        h += "</optgroup>";
        h += '<optgroup label="Otras asignaciones">';
        h += '<option value="__DISTRIBUTOR__"' + (preVendor === "__DISTRIBUTOR__" ? " selected" : "") + ">DISTRIBUIDOR</option>";
        h += "</optgroup>";
        h += "</select>";
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">El vendedor elegido va a ver la tienda en su mapa para crear pedidos.</div></div>';
        h += '<div><label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px">Localidad final (como aparece en el mapa)</label>';
        h += '<input id="ca-loc-final" type="text" placeholder="' + escapeAttr(a.localidad || "") + '" value="' + escapeAttr(preLoc) + '" style="width:100%;padding:7px 10px;border:1.5px solid var(--border-default);border-radius:5px;font-size:12px"/>';
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">Si la localidad declarada por el vendedor (' + escapeHtml(a.localidad || "-") + ") no matchea con el mapa, ajustala aca.</div></div>";
        h += "</div>";
        h += '<div style="display:flex;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle)">';
        h += `<button class="qmodal-btn primary" style="flex:1" onclick="approveClientApplication('` + escapeAttr(appId) + "','" + escapeAttr(notifId || "") + `')">Aprobar</button>`;
        h += `<button class="qmodal-btn danger" style="flex:1" onclick="rejectClientApplication('` + escapeAttr(appId) + "','" + escapeAttr(notifId || "") + `')">Rechazar</button>`;
        h += "</div>";
      } else if (iAlreadyApproved) {
        h += '<div style="background:var(--color-success-bg);border:1px solid #86efac;border-radius:4px;padding:8px;margin-top:14px;color:var(--color-success);text-align:center;font-weight:700">&#10003; Ya aprobaste esta solicitud</div>';
      }
      h += "</div>";
      c.innerHTML = h;
      document.getElementById("ca-detail-modal").classList.add("open");
    } catch (e) {
      console.error("open client app detail", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.closeClientApplicationDetail = function() {
    document.getElementById("ca-detail-modal").classList.remove("open");
  };
  window.approveClientApplication = async function(appId, notifId) {
    const cardCodeEl = document.getElementById("ca-cardcode");
    const vendorEl = document.getElementById("ca-vendor");
    const locFinalEl = document.getElementById("ca-loc-final");
    const cardCode = cardCodeEl ? cardCodeEl.value.trim() : "";
    const assignedVendor2 = vendorEl ? vendorEl.value : "";
    const localidadFinal = locFinalEl ? locFinalEl.value.trim() : "";
    if (!cardCode) {
      if (!confirm(
        "No cargaste CardCode SAP. La tienda va a aparecer en el mapa pero NO se va a poder crear pedido hasta que se cargue. \xBFAprobar igual?"
      ))
        return;
    }
    if (!assignedVendor2) {
      alert(
        "Tenes que elegir un vendedor para asignar la tienda. Sin vendedor no se sabe en qu\xE9 zona del mapa aparece."
      );
      return;
    }
    if (!confirm("Confirmar aprobacion de esta solicitud?")) return;
    try {
      const upd = {};
      upd["approvals." + currentUser.uid] = {
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        email: currentUser.email || "",
        name: currentUser.displayName || ""
      };
      if (cardCode) upd.cardCodeSap = cardCode;
      if (assignedVendor2) upd.assignedVendor = assignedVendor2;
      if (localidadFinal) upd.localidadFinal = localidadFinal;
      await fbDb.collection("client_applications").doc(appId).update(upd);
      const snap = await fbDb.collection("client_applications").doc(appId).get();
      const a = snap.data() || {};
      const apN = a.approvals ? Object.keys(a.approvals).length : 0;
      if (apN >= 2 && a.status === "pending_approval") {
        await fbDb.collection("client_applications").doc(appId).update({
          status: "approved",
          approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (a.ownerUid) {
          await fbDb.collection("notifications").add({
            type: "client_approval_ack",
            fromUid: currentUser.uid,
            fromEmail: currentUser.email || "",
            fromName: currentUser.displayName || currentUser.email || "",
            targetUid: a.ownerUid,
            title: "Solicitud de alta APROBADA",
            message: 'Tu solicitud para dar de alta a "' + (a.comercio || "") + '" fue aprobada por los 2 revisores. Ya podes cargarle pedidos.',
            applicationId: appId,
            status: "unread",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }
      if (notifId) {
        try {
          await fbDb.collection("notifications").doc(notifId).update({ status: "done", doneAt: firebase.firestore.FieldValue.serverTimestamp() });
        } catch (_e) {
        }
      }
      showSyncTag(
        apN >= 2 ? "Solicitud aprobada (definitiva)" : "Aprobaste. Falta 1 aprobacion mas."
      );
      closeClientApplicationDetail();
    } catch (e) {
      console.error("approve", e);
      alert("Error aprobando: " + (e.message || e));
    }
  };
  window.rejectClientApplication = async function(appId, notifId) {
    const reason = prompt("Motivo del rechazo (se notifica al vendedor):", "");
    if (reason === null) return;
    if (!reason.trim()) {
      alert("Tenes que indicar un motivo.");
      return;
    }
    try {
      await fbDb.collection("client_applications").doc(appId).update({
        status: "rejected",
        rejectedBy: currentUser.uid,
        rejectedByEmail: currentUser.email || "",
        rejectedReason: reason.trim(),
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      const snap = await fbDb.collection("client_applications").doc(appId).get();
      const a = snap.data() || {};
      if (a.ownerUid) {
        await fbDb.collection("notifications").add({
          type: "client_approval_ack",
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || "",
          fromName: currentUser.displayName || currentUser.email || "",
          targetUid: a.ownerUid,
          title: "Solicitud de alta RECHAZADA",
          message: 'Tu solicitud para "' + (a.comercio || "") + '" fue rechazada.\nMotivo: ' + reason.trim(),
          applicationId: appId,
          status: "unread",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      if (notifId) {
        try {
          await fbDb.collection("notifications").doc(notifId).update({ status: "done", doneAt: firebase.firestore.FieldValue.serverTimestamp() });
        } catch (_e) {
        }
      }
      showSyncTag("Solicitud rechazada");
      closeClientApplicationDetail();
    } catch (e) {
      console.error("reject", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.setNotifsTab = function(tab) {
    window.notifsTab = tab;
    document.querySelectorAll(".ntab-btn").forEach((b) => b.classList.toggle("active", b.dataset.ntab === tab));
    document.getElementById("notifs-pane-recibidas").style.display = tab === "recibidas" ? "" : "none";
    document.getElementById("notifs-pane-realizadas").style.display = tab === "realizadas" ? "" : "none";
    document.getElementById("notifs-pane-crear").style.display = tab === "crear" ? "" : "none";
    document.getElementById("notifs-pane-enviadas").style.display = tab === "enviadas" ? "" : "none";
    document.getElementById("notifs-footer").style.display = tab === "recibidas" ? "" : "none";
    if (tab === "recibidas") renderNotifsList();
    else if (tab === "realizadas") renderNotifsRealizadas();
    else if (tab === "enviadas") renderMySentTasks();
  };
  function isNotifPending(n) {
    return n.status !== "read" && n.status !== "done";
  }
  function updateNotifsTabCounts() {
    const pending = (myNotifications || []).filter(isNotifPending).length;
    const realizadas = (myNotifications || []).filter((n) => !isNotifPending(n)).length;
    const recEl = document.getElementById("ntab-recibidas-count");
    if (recEl) {
      recEl.textContent = pending > 0 ? pending : "";
      recEl.classList.toggle("zero", pending === 0);
    }
    const realEl = document.getElementById("ntab-realizadas-count");
    if (realEl) {
      realEl.textContent = realizadas > 0 ? realizadas : "";
      realEl.classList.toggle("zero", realizadas === 0);
    }
    const pendSent = (mySentTasks || []).filter((t) => t.status !== "done").length;
    const sentEl = document.getElementById("ntab-enviadas-count");
    if (sentEl) {
      sentEl.textContent = pendSent > 0 ? pendSent : "";
      sentEl.classList.toggle("zero", pendSent === 0);
    }
  }
  function fmtNotifDate(n) {
    const dt = n.createdAt ? n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt) : null;
    return dt ? dt.toLocaleString("es-AR") : "";
  }
  function notifItemHtml(n, opts) {
    opts = opts || {};
    const type = n.type || "derivacion";
    const isClosed = n.status === "read" || n.status === "done";
    const cls = "notif-item type-" + type + (isClosed ? " read" : "");
    const dtStr = fmtNotifDate(n);
    let h = '<div class="' + cls + '">';
    if (type === "task") {
      const fromLabel = n.fromName || n.fromEmail || "Alguien";
      h += '<div class="task-sender">De ' + escapeHtml(fromLabel) + "</div>";
      const statusTag = n.status === "done" ? '<span class="task-status-tag done">&#10003; Completada</span>' : '<span class="task-status-tag pending">Pendiente</span>';
      h += '<div class="task-title">' + escapeHtml(n.title || "Sin titulo") + statusTag + "</div>";
      if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + "</div>";
      if ((n.images || []).length) {
        h += '<div class="task-imgs">';
        n.images.forEach((img, i) => {
          const safe = img.replace(/'/g, "&#39;");
          h += '<img src="' + safe + `" class="task-img-thumb" onclick="openImgViewer('` + escapeAttr("task-" + n._fsId + "-" + i) + `')" id="task-` + n._fsId + "-" + i + '"/>';
        });
        h += "</div>";
      }
      h += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "done" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="completarTask('` + escapeAttr(n._fsId) + `')">Marcar como completada</button>`;
        h += "</div>";
      } else if (n.status === "done" && n.doneAt) {
        const da = n.doneAt.toDate ? n.doneAt.toDate() : new Date(n.doneAt);
        h += '<div style="font-size:10px;color:var(--color-success);margin-top:6px;font-weight:600">&#10003; Completada el ' + da.toLocaleString("es-AR") + "</div>";
      }
    } else if (type === "task_ack") {
      h += "<h4>" + escapeHtml(n.title || "Confirmacion de tarea") + "</h4>";
      h += '<div class="nm">' + escapeHtml(n.message || "") + "</div>";
      h += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="markNotifRead('` + escapeAttr(n._fsId) + `')">Marcar leida</button>`;
        h += "</div>";
      }
    } else if (type === "client_approval") {
      h += '<div class="task-sender">De ' + escapeHtml(n.fromName || n.fromEmail || "Vendedor") + "</div>";
      h += '<div class="task-title">' + escapeHtml(n.title || "Solicitud de alta") + "</div>";
      if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + "</div>";
      h += '<div class="nf" style="margin-top:6px"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && n.status !== "done" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="openClientApplicationDetail('` + escapeAttr(n.applicationId || "") + "','" + escapeAttr(n._fsId) + `')" style="background:#0891b2">Ver detalle y decidir</button>`;
        h += "</div>";
      }
    } else if (type === "client_approval_ack") {
      h += "<h4>" + escapeHtml(n.title || "Solicitud de alta") + "</h4>";
      h += '<div class="nm">' + escapeHtml(n.message || "") + "</div>";
      h += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="markNotifRead('` + escapeAttr(n._fsId) + `')">Marcar leida</button>`;
        h += "</div>";
      }
    } else if (type === "rendicion_approval") {
      h += '<div class="task-sender">De ' + escapeHtml(n.fromName || n.fromEmail || "Vendedor") + "</div>";
      h += '<div class="task-title">' + escapeHtml(n.title || "Rendicion pendiente") + "</div>";
      if (n.description) h += '<div class="task-desc">' + escapeHtml(n.description) + "</div>";
      h += '<div class="nf" style="margin-top:6px"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && n.status !== "done" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="openRendicionDetail('` + escapeAttr(n.rendicionId || "") + "','" + escapeAttr(n._fsId) + `')" style="background:#be185d">Ver detalle y decidir</button>`;
        h += "</div>";
      }
    } else if (type === "rendicion_approval_ack") {
      h += "<h4>" + escapeHtml(n.title || "Rendicion") + "</h4>";
      h += '<div class="nm">' + escapeHtml(n.message || "") + "</div>";
      h += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="markNotifRead('` + escapeAttr(n._fsId) + `')">Marcar leida</button>`;
        h += "</div>";
      }
    } else if (type === "auto_confirm_timeout") {
      const minutes = Number(n.minutesInPending) || 10;
      h += '<h4 style="color:#b45309">&#9200; Pedido auto-confirmado por timeout</h4>';
      h += '<div class="nm">Tu pedido de <b>' + escapeHtml(n.clientName || "cliente") + "</b>" + (n.month ? " (" + escapeHtml(n.month) + ")" : "") + " quedo <b>" + minutes + " min</b> en Pendientes sin confirmar. Se paso a Confirmados automaticamente y se envio a SAP.</div>";
      h += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="markNotifRead('` + escapeAttr(n._fsId) + `')">Marcar leida</button>`;
        h += "</div>";
      }
    } else {
      h += "<h4>" + escapeHtml(n.tienda || "Sin tienda") + "</h4>";
      h += '<div class="nm">' + escapeHtml(n.message || "") + "</div>";
      h += '<div class="nf"><span>' + escapeHtml((n.localidad || "") + " &middot; " + (n.provincia || "")) + "</span><span>" + escapeHtml(dtStr) + "</span></div>";
      if (n.status !== "read" && !opts.readonly) {
        h += '<div class="notif-item-actions">';
        h += `<button class="btn-read" onclick="contactarDesdeNotif('` + escapeAttr(n._fsId) + `')">Contactar</button>`;
        h += `<button class="btn-read" style="background:var(--bg-elevated);color:var(--text-secondary);border:1.5px solid var(--border-default);margin-left:6px" onclick="markNotifRead('` + escapeAttr(n._fsId) + `')" title="Solo marcar como leida (sin cargar visita)">Solo marcar leida</button>`;
        h += "</div>";
      }
    }
    if (!opts.readonly) {
      h += '<div class="notif-item-actions" style="margin-top:6px;justify-content:flex-end">';
      h += `<button class="btn-read" style="background:var(--color-danger-bg);color:var(--color-danger-strong);border:1.5px solid #fca5a5;font-weight:700" onclick="deleteNotif('` + escapeAttr(n._fsId) + `')" title="Eliminar esta notificacion">Eliminar</button>`;
      h += "</div>";
    }
    h += "</div>";
    return h;
  }
  window.deleteNotif = async function(fsId) {
    if (!fsId) return;
    if (!confirm("Eliminar esta notificacion? No se puede deshacer.")) return;
    try {
      await fbDb.collection("notifications").doc(fsId).delete();
      if (typeof showSyncTag === "function") showSyncTag("Notificacion eliminada");
    } catch (e) {
      console.error("deleteNotif", e);
      alert("Error eliminando la notificacion: " + (e.message || e));
    }
  };
  function renderNotifsList() {
    const cont = document.getElementById("notifs-list");
    const pendientes = (myNotifications || []).filter(isNotifPending);
    if (!pendientes.length) {
      cont.innerHTML = '<div class="notif-empty">No tenes alertas ni tareas pendientes. </div>';
      return;
    }
    const nPend = pendientes.length;
    let html = "";
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;background:var(--bg-muted);border:1px solid var(--border-default);border-radius:6px">';
    html += '<div style="font-size:11px;color:var(--text-secondary);font-weight:600">' + nPend + " pendiente" + (nPend === 1 ? "" : "s") + "</div>";
    html += '<button onclick="markAllNotifsRead()" style="background:#0d9488;color:#fff;border:none;padding:7px 12px;font-size:11px;font-weight:800;border-radius:5px;cursor:pointer;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap">&#10003; Marcar todas como leidas</button>';
    html += "</div>";
    html += pendientes.map((n) => notifItemHtml(n)).join("");
    cont.innerHTML = html;
  }
  window.markAllNotifsRead = async function() {
    const pendientes = (myNotifications || []).filter(isNotifPending);
    if (!pendientes.length) {
      alert("No hay notificaciones pendientes.");
      return;
    }
    const n = pendientes.length;
    if (!confirm(
      "Marcar " + n + " notificacion" + (n === 1 ? "" : "es") + " como leida" + (n === 1 ? "" : "s") + "?\n\nEsta accion no se puede deshacer masivamente (podrias re-abrir cada una manual desde Realizadas)."
    ))
      return;
    const btn = document.querySelector('#notifs-list button[onclick*="markAllNotifsRead"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Marcando...";
    }
    try {
      const CHUNK = 400;
      let ok = 0;
      for (let i = 0; i < pendientes.length; i += CHUNK) {
        const slice = pendientes.slice(i, i + CHUNK);
        const batch = fbDb.batch();
        slice.forEach((n2) => {
          const ref = fbDb.collection("notifications").doc(n2._fsId);
          batch.update(ref, {
            status: "read",
            readAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        ok += slice.length;
      }
      showSyncTag(ok + " notificaciones marcadas como leidas");
    } catch (e) {
      console.error("markAllNotifsRead", e);
      alert("Error marcando notificaciones: " + (e.message || e));
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Marcar todas como leidas";
      }
    }
  };
  function renderNotifsRealizadas() {
    const cont = document.getElementById("notifs-realizadas-list");
    const cerradas = (myNotifications || []).filter((n) => !isNotifPending(n));
    if (!cerradas.length) {
      cont.innerHTML = '<div class="notif-empty">Aca van a aparecer las alertas y tareas que ya cerraste.</div>';
      return;
    }
    cont.innerHTML = cerradas.map((n) => notifItemHtml(n, { readonly: true })).join("");
  }
  function renderMySentTasks() {
    const cont = document.getElementById("notifs-sent-list");
    if (!mySentTasks.length) {
      cont.innerHTML = '<div class="notif-empty">No enviaste tareas todavia. Us\xE1 la pesta\xF1a <b>Crear tarea</b>.</div>';
      return;
    }
    let html = "";
    mySentTasks.forEach((n) => {
      const isDone = n.status === "done";
      const cls = "notif-item type-task" + (isDone ? " read" : "");
      const dtStr = fmtNotifDate(n);
      const targetLabel = n.targetName || n.targetEmail || n.targetUid || "Alguien";
      html += '<div class="' + cls + '">';
      html += '<div class="task-sender">Para ' + escapeHtml(targetLabel) + "</div>";
      const statusTag = isDone ? '<span class="task-status-tag done">&#10003; Completada</span>' : '<span class="task-status-tag pending">Pendiente</span>';
      html += '<div class="task-title">' + escapeHtml(n.title || "Sin titulo") + statusTag + "</div>";
      if (n.description) html += '<div class="task-desc">' + escapeHtml(n.description) + "</div>";
      if ((n.images || []).length) {
        html += '<div class="task-imgs">';
        n.images.forEach((img, i) => {
          const safe = img.replace(/'/g, "&#39;");
          html += '<img src="' + safe + `" class="task-img-thumb" onclick="openImgViewer('` + escapeAttr("sent-" + n._fsId + "-" + i) + `')" id="sent-` + n._fsId + "-" + i + '"/>';
        });
        html += "</div>";
      }
      html += '<div class="nf"><span>' + escapeHtml(dtStr) + "</span>";
      if (isDone && n.doneAt) {
        const da = n.doneAt.toDate ? n.doneAt.toDate() : new Date(n.doneAt);
        html += '<span style="color:var(--color-success);font-weight:700">&#10003; Marcada ' + da.toLocaleString("es-AR") + "</span>";
      }
      html += "</div></div>";
    });
    cont.innerHTML = html;
  }
  window.openImgViewer = function(thumbId) {
    const thumb = document.getElementById(thumbId);
    if (!thumb) return;
    document.getElementById("img-viewer-img").src = thumb.src;
    document.getElementById("img-viewer-overlay").classList.add("open");
  };
  window.closeImgViewer = function() {
    document.getElementById("img-viewer-overlay").classList.remove("open");
  };
  function populateTaskTargetSelect() {
    const sel = document.getElementById("task-target");
    if (!sel) return;
    function renderFromMap(usersMap) {
      const opts = ['<option value="">Seleccionar...</option>'];
      Object.entries(usersMap || {}).forEach(([uid, u]) => {
        if (uid === currentUser.uid) return;
        if (!u || !u.role || u.role === "unassigned") return;
        const label = (u.displayName || u.email || uid) + " \xB7 " + (u.role || "");
        opts.push(
          '<option value="' + escapeAttr(uid) + '" data-email="' + escapeAttr(u.email || "") + '" data-name="' + escapeAttr(u.displayName || u.email || "") + '">' + escapeHtml(label) + "</option>"
        );
      });
      sel.innerHTML = opts.join("");
    }
    fbDb.collection("app_config").doc("users_directory").get().then((snap) => {
      if (snap.exists && snap.data() && snap.data().users) {
        renderFromMap(snap.data().users);
        return;
      }
      fbDb.collection("roles").get().then((qs) => {
        const usersMap = {};
        qs.forEach((d) => {
          usersMap[d.id] = d.data() || {};
        });
        renderFromMap(usersMap);
      }).catch((e) => {
        console.warn("populate task target - sin /roles ni users_directory:", e);
        sel.innerHTML = '<option value="">Seleccionar... (sin usuarios disponibles, pedile al admin que entre 1 vez al Panel Usuarios)</option>';
      });
    }).catch((e) => {
      console.warn("populate task target - fallback a /roles:", e);
      fbDb.collection("roles").get().then((qs) => {
        const usersMap = {};
        qs.forEach((d) => {
          usersMap[d.id] = d.data() || {};
        });
        renderFromMap(usersMap);
      }).catch(() => {
        sel.innerHTML = '<option value="">Seleccionar... (sin usuarios disponibles)</option>';
      });
    });
  }
  function syncUsersDirectory() {
    if (userRole !== "admin") return;
    if (!Array.isArray(usersCache) || !usersCache.length) return;
    const dir = {};
    usersCache.forEach((u) => {
      if (!u || !u._uid) return;
      if (!u.role || u.role === "unassigned") return;
      dir[u._uid] = {
        email: u.email || "",
        displayName: u.displayName || "",
        role: u.role
      };
    });
    fbDb.collection("app_config").doc("users_directory").set(
      {
        users: dir,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser && currentUser.email || "",
        userCount: Object.keys(dir).length
      },
      { merge: true }
    ).then(() => {
      console.log("[users_directory] sincronizado:", Object.keys(dir).length, "usuarios");
    }).catch((e) => console.warn("syncUsersDirectory error:", e));
  }
  window.syncUsersDirectory = syncUsersDirectory;
  window.onTaskImageInput = async function(input) {
    const files = [...input.files || []];
    for (const f of files) {
      if (taskFormImages.length >= 5) {
        alert("Maximo 5 imagenes por tarea.");
        break;
      }
      try {
        const b64 = await compressImage(f, 1200, 0.75);
        taskFormImages.push(b64);
      } catch (e) {
        console.warn("compress task img", e);
      }
    }
    input.value = "";
    refreshTaskImageGrid();
  };
  window.removeTaskFormImage = function(idx) {
    taskFormImages.splice(idx, 1);
    refreshTaskImageGrid();
  };
  function refreshTaskImageGrid() {
    const grid = document.getElementById("task-img-grid");
    if (!grid) return;
    const cells = taskFormImages.map(
      (b64, i) => '<div class="photo-cell"><img src="' + b64 + '"/><button type="button" class="rm" onclick="removeTaskFormImage(' + i + ')">&times;</button></div>'
    ).join("");
    const addCell = taskFormImages.length < 5 ? '<label class="photo-cell add"><input type="file" accept="image/*" multiple onchange="onTaskImageInput(this)"/>+</label>' : "";
    grid.innerHTML = cells + addCell;
  }
  window.sendTaskNotification = async function() {
    const sel = document.getElementById("task-target");
    const targetUid = sel.value;
    if (!targetUid) {
      alert("Elegi un destinatario.");
      return;
    }
    const opt = sel.options[sel.selectedIndex];
    const targetEmail = opt.dataset.email || "";
    const targetName = opt.dataset.name || targetEmail;
    const title = (document.getElementById("task-title").value || "").trim();
    const description = (document.getElementById("task-description").value || "").trim();
    if (!title) {
      alert("Falta el titulo.");
      return;
    }
    if (!description) {
      alert("Falta la descripcion.");
      return;
    }
    const btn = document.querySelector("#notifs-pane-crear .qmodal-btn.primary");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enviando...";
    }
    try {
      await fbDb.collection("notifications").add({
        type: "task",
        fromUid: currentUser.uid,
        fromEmail: currentUser.email || "",
        fromName: currentUser.displayName || currentUser.email || "",
        targetUid,
        targetEmail,
        targetName,
        title,
        description,
        images: taskFormImages.slice(),
        status: "unread",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.getElementById("task-title").value = "";
      document.getElementById("task-description").value = "";
      taskFormImages = [];
      refreshTaskImageGrid();
      sel.value = "";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enviar tarea";
      }
      showSyncTag("Tarea enviada a " + (targetName || "destinatario"));
      setNotifsTab("enviadas");
    } catch (e) {
      console.error("sendTaskNotification", e);
      alert("Error enviando: " + (e.message || e));
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Enviar tarea";
      }
    }
  };
  window.completarTask = async function(notifId) {
    if (!confirm("Marcar la tarea como completada? Le va a llegar un aviso al que la envio.")) return;
    const n = (myNotifications || []).find((x) => x._fsId === notifId);
    if (!n) {
      alert("Tarea no encontrada.");
      return;
    }
    try {
      await fbDb.collection("notifications").doc(notifId).update({
        status: "done",
        doneAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (n.fromUid && n.fromUid !== currentUser.uid) {
        const myName = currentUser.displayName || currentUser.email || "el destinatario";
        await fbDb.collection("notifications").add({
          type: "task_ack",
          fromUid: currentUser.uid,
          fromEmail: currentUser.email || "",
          fromName: myName,
          targetUid: n.fromUid,
          title: "Tarea leida y completada",
          message: myName + ' marco como completada tu tarea: "' + (n.title || "") + '"',
          relatedTaskId: notifId,
          status: "unread",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      showSyncTag("Tarea completada. Aviso enviado al emisor.");
    } catch (e) {
      console.error("completarTask", e);
      alert("Error: " + (e.message || e));
    }
  };
  window.markNotifRead = async function(fsId) {
    try {
      await fbDb.collection("notifications").doc(fsId).update({ status: "read", readAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      console.error("mark read", e);
      alert("Error: " + (e.message || e));
    }
  };
  if (typeof window.pendingNotifIdToMarkRead === "undefined") window.pendingNotifIdToMarkRead = null;
  window.contactarDesdeNotif = function(notifId) {
    const n = (myNotifications || []).find((x) => x._fsId === notifId);
    if (!n) {
      alert("Notificacion no encontrada.");
      return;
    }
    if (!n.tienda || !n.provincia || !n.localidad) {
      alert(
        "Esta notificacion no tiene datos completos de tienda. Marcala como leida desde el otro boton."
      );
      return;
    }
    window.pendingNotifIdToMarkRead = notifId;
    closeNotifsPanel();
    if (typeof abrirVisitaParaTienda === "function") {
      abrirVisitaParaTienda(n.localidad, n.provincia, n.tienda);
    } else {
      abrirVisitaParaTienda_real(n.localidad, n.provincia, n.tienda);
    }
  };
  window.markAllNotifsRead = async function() {
    const pending = (myNotifications || []).filter(isNotifPending);
    if (!pending.length) return;
    if (!confirm(
      "Marcar las " + pending.length + " alertas/tareas como leidas? Pasan a la pestana Realizadas."
    ))
      return;
    try {
      for (const n of pending) {
        const isTask = n.type === "task";
        const upd = isTask ? { status: "done", doneAt: firebase.firestore.FieldValue.serverTimestamp() } : { status: "read", readAt: firebase.firestore.FieldValue.serverTimestamp() };
        await fbDb.collection("notifications").doc(n._fsId).update(upd);
        if (isTask && n.fromUid && n.fromUid !== currentUser.uid) {
          const myName = currentUser.displayName || currentUser.email || "el destinatario";
          try {
            await fbDb.collection("notifications").add({
              type: "task_ack",
              fromUid: currentUser.uid,
              fromEmail: currentUser.email || "",
              fromName: myName,
              targetUid: n.fromUid,
              title: "Tarea leida y completada",
              message: myName + ' marco como completada tu tarea: "' + (n.title || "") + '"',
              relatedTaskId: n._fsId,
              status: "unread",
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) {
            console.warn("ack desde markAll", e);
          }
        }
      }
    } catch (e) {
      console.error("mark all", e);
    }
  };
  window.renderNotifsList = renderNotifsList;
  window.ensureAltaCliListener = ensureAltaCliListener;
  window.updateNotifsTabCounts = updateNotifsTabCounts;
  window.populateAltaCliProvincias = populateAltaCliProvincias;
  window.notifItemHtml = notifItemHtml;
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvbm90aWZpY2FjaW9uZXMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXG4vLyBHbG9iYWxzIGxlXHUwMEVEZG9zIGRlbCBlbnRvcm5vIChkZWNsYXJhZG9zIGVuIGluZGV4Lmh0bWwgaW5saW5lKTpcbi8vIGZiRGIsIGZpcmViYXNlLCBjdXJyZW50VXNlciwgdXNlclJvbGUsIGVzY2FwZUh0bWwsIGVzY2FwZUF0dHIsIHRpdGxlQ2FzZSxcbi8vIHNob3dTeW5jVGFnLCBjb21wcmVzc0ltYWdlLCBvcGVuUmVuZGljaW9uRGV0YWlsIChidW5kbGUgcmVuZGljaW9uZXMpLFxuLy8gb3BlbkNsaWVudEFwcGxpY2F0aW9uRGV0YWlsIChpbmxpbmUpLCBhYnJpclZpc2l0YVBhcmFUaWVuZGFfcmVhbCAoYnVuZGxlIHJ1dGFzKSxcbi8vIG15Tm90aWZpY2F0aW9ucyArIHVuc3ViTXlOb3RpZnMgKHRvcC1sZXZlbCBsZXRzIGRlbCBpbmxpbmUsIHZpc2libGVzIHZpYVxuLy8gZnJlZSByZWZlcmVuY2UgZ3JhY2lhcyBhbCBHbG9iYWwgRW52aXJvbm1lbnQgUmVjb3JkIGNvbXBhcnRpZG8pLFxuLy8gZW5zdXJlTm90aWZzTGlzdGVuZXIgKyB1cGRhdGVOb3RpZnNCYWRnZSAodG9wLWxldmVsIGZ1bmNzIGRlbCBpbmxpbmUsXG4vLyBtaXNtbyBtZWNhbmlzbW8pLlxuLy8gTVx1MDBGM2R1bG8gZXh0cmFcdTAwRURkbyB2ZXJiYXRpbTogdGlwYWRvIHJlYWwgZnVlcmEgZGUgc2NvcGUgRTIuZy5cbi8vXG4vLyBQQU5FTCBBTEVSVEFTIFkgVEFSRUFTIChOb3RpZmljYWNpb25lcykgXHUyMDE0IHBhbmVsIFVJICsgdGFicyAoUmVjaWJpZGFzIC9cbi8vIFJlYWxpemFkYXMgLyBDcmVhciB0YXJlYSAvIEVudmlhZGFzKSArIGJyb2FkY2FzdCArIHRhc2sgYWN0aW9ucy5cbi8vIEV4dHJhXHUwMEVEZG8gdmVyYmF0aW0gZGUgaW5kZXguaHRtbCAobFx1MDBFRG5lYXMgMTI1MTItMTM3MzAgcHJlLUUyLmcpIGNvbW8gcGFydGVcbi8vIGRlIEUyLmcgKGUyYi1wZXJmIDIwMjYtMDctMjgpLiBQcmVzZXJ2YSAxMDAlIGNvbXBvcnRhbWllbnRvLlxuLy9cbi8vIE5PVEE6IEZyYWdtZW50byBwYXJjaWFsIGRlbCBkb21pbmlvIG5vdGlmaWNhY2lvbmVzLiBMYXMgZGVjbGFyYWNpb25lc1xuLy8gbXlOb3RpZmljYXRpb25zL3Vuc3ViTXlOb3RpZnMgKGxcdTAwRURuZWFzIDEyMDY4LTY5IHByZS1FMi5nKSBlc3RcdTAwRTFuIGRlbnRyb1xuLy8gZGVsIGJsb3F1ZSBWREUtVkRJIGNvbXBhcnRpZG8geSBzZSBkZWphbiBlbiBlbCBpbmxpbmUuIExhcyBmdW5jaW9uZXNcbi8vIGVuc3VyZU5vdGlmc0xpc3RlbmVyICgxMjI2OSkgKyBlbnN1cmVWaXNpdHNQYXJ0bmVyTGlzdGVuZXIgKDEyMzA0KSArXG4vLyB1cGRhdGVOb3RpZnNCYWRnZSAoMTIzMTgpIHRhbWJpXHUwMEU5biBzZSBkZWphbiBlbiBlbCBpbmxpbmUgcG9ycXVlIGVzdFx1MDBFMW5cbi8vIGludGVyY2FsYWRhcyBjb24gVkRFLVZESSB5IG1vZGFsIHJlYWdlbmRhbWllbnRvICgxMjMzNS0xMjUxMSkuIEV4dHJhZXJcbi8vIGVzYXMgcmVxdWVyaXJcdTAwRURhIHVuIG1pbmktcGxhbiBkZSByZW9yZ2FuaXphY2lcdTAwRjNuLCBmdWVyYSBkZSBzY29wZSBFMi5nLlxuLy9cbi8vIEtOT1dOIEJVRyAodmVyYmF0aW0gcHJlc2VydmFkbyk6IHdpbmRvdy5tYXJrQWxsTm90aWZzUmVhZCBlc3RcdTAwRTEgZGVjbGFyYWRhXG4vLyBET1MgdmVjZXMgZW4gZWwgYmxvcXVlIChsXHUwMEVEbmVhcyB+MTM0MDkgeSB+MTM2OTkgcHJlLUUyLmcpLiBMYSAyZGEgc29icmVzY3JpYmVcbi8vIGxhIDFyYSBlbiBydW50aW1lLiBUT0RPIEU2IGNvZGUgcmV2aWV3OiBjb25zb2xpZGFyIGVuIHVuYSBzb2xhIGltcGxlbWVudGFjaVx1MDBGM24uXG4vL1xuLy8gQ3Jvc3Mtc2NvcGUgc3RhdGUgKHZpYSB3aW5kb3cpOlxuLy8gLSB3aW5kb3cudW5zdWJNeVNlbnRUYXNrczogbGlzdGVuZXIgY29uIGNsZWFudXAgZW4gZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMoKVxuLy8gZGVsIGlubGluZSAobFx1MDBFRG5lYSB+MjM4NjkgcHJlLUUyLmcpLlxuLy8gTG9jYWxzIGFsIG1cdTAwRjNkdWxvOiB3aW5kb3cubm90aWZzVGFiLCBteVNlbnRUYXNrcywgdGFza0Zvcm1JbWFnZXMsIHBlbmRpbmdOb3RpZklkVG9NYXJrUmVhZC5cbi8vID09PSBOb3RpZmljYWNpb25lcyBwYW5lbCA9PT1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUEFORUwgQUxFUlRBUyBZIFRBUkVBUyAodGFiczogUmVjaWJpZGFzIC8gQ3JlYXIgdGFyZWEgLyBFbnZpYWRhcylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ1JPU1MtU0NPUEUgKEU2IGZpeCBDMyk6IHVwZGF0ZU5vdGlmc0JhZGdlIGRlbCBpbmxpbmUgKEw4NTE5KSBsZWUgd2luZG93Lm5vdGlmc1RhYi5cbi8vIEJ1bmRsZSBzdHJpY3QgdGlyYSBSZWZlcmVuY2VFcnJvciBcdTIxOTIgbGlzdGEgbm90aWYgbm8gcmUtcmVuZGVyZWEgZW4gc25hcHNob3QuXG5pZiAodHlwZW9mIHdpbmRvdy5ub3RpZnNUYWIgPT09ICd1bmRlZmluZWQnKSB3aW5kb3cubm90aWZzVGFiID0gJ3JlY2liaWRhcyc7XG5sZXQgbXlTZW50VGFza3MgPSBbXTsgLy8gbm90aWZzIGNyZWFkYXMgcG9yIG1pIHRpcG8gdGFzayAoY29uIHN0YXR1cyBkZWwgZGVzdGluYXRhcmlvKVxuaWYgKHR5cGVvZiB3aW5kb3cudW5zdWJNeVNlbnRUYXNrcyA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51bnN1Yk15U2VudFRhc2tzID0gbnVsbDtcbi8vIEVzdGFkbyBkZWwgZm9ybSBcIkNyZWFyIHRhcmVhXCJcbmxldCB0YXNrRm9ybUltYWdlcyA9IFtdOyAvLyBiYXNlNjQgc3RyaW5nc1xuXG5mdW5jdGlvbiBlbnN1cmVNeVNlbnRUYXNrc0xpc3RlbmVyKCkge1xuICBpZiAodW5zdWJNeVNlbnRUYXNrcyB8fCAhY3VycmVudFVzZXIgfHwgIWZiRGIpIHJldHVybjtcbiAgLy8gU29sbyBmaWx0cmFtb3MgcG9yIGZyb21VaWQgKGV2aXRhIG5lY2VzaWRhZCBkZSBpbmRpY2UgY29tcHVlc3RvKS5cbiAgLy8gRWwgZmlsdHJvIHBvciB0eXBlID09PSAndGFzaycgc2UgYXBsaWNhIGVuIGNsaWVudGUuXG4gIHdpbmRvdy51bnN1Yk15U2VudFRhc2tzID0gZmJEYlxuICAgIC5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJylcbiAgICAud2hlcmUoJ2Zyb21VaWQnLCAnPT0nLCBjdXJyZW50VXNlci51aWQpXG4gICAgLm9uU25hcHNob3QoXG4gICAgICAocXMpID0+IHtcbiAgICAgICAgbXlTZW50VGFza3MgPSBbXTtcbiAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgICBpZiAoKGRhdGEudHlwZSB8fCAnZGVyaXZhY2lvbicpICE9PSAndGFzaycpIHJldHVybjtcbiAgICAgICAgICBteVNlbnRUYXNrcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBfZnNJZDogZC5pZCB9LCBkYXRhKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBteVNlbnRUYXNrcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgICAgY29uc3QgdGEgPSBhLmNyZWF0ZWRBdCA/IChhLmNyZWF0ZWRBdC50b01pbGxpcyA/IGEuY3JlYXRlZEF0LnRvTWlsbGlzKCkgOiAwKSA6IDA7XG4gICAgICAgICAgY29uc3QgdGIgPSBiLmNyZWF0ZWRBdCA/IChiLmNyZWF0ZWRBdC50b01pbGxpcyA/IGIuY3JlYXRlZEF0LnRvTWlsbGlzKCkgOiAwKSA6IDA7XG4gICAgICAgICAgcmV0dXJuIHRiIC0gdGE7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBwYW5lUGVlayA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwYW5lLW5vdGlmJyk7XG4gICAgICAgIGNvbnN0IHBhbmVWaXNpYmxlID0gcGFuZVBlZWsgJiYgcGFuZVBlZWsuc3R5bGUuZGlzcGxheSAhPT0gJ25vbmUnO1xuICAgICAgICBpZiAocGFuZVZpc2libGUgJiYgd2luZG93Lm5vdGlmc1RhYiA9PT0gJ2VudmlhZGFzJykgcmVuZGVyTXlTZW50VGFza3MoKTtcbiAgICAgICAgdXBkYXRlTm90aWZzVGFiQ291bnRzKCk7XG4gICAgICB9LFxuICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdzZW50IHRhc2tzIGxpc3RlbmVyJywgZXJyKVxuICAgICk7XG59XG5cbi8vIG9wZW5Ob3RpZnNQYW5lbC9jbG9zZU5vdGlmc1BhbmVsIHF1ZWRhcm9uIGNvbW8gc2hpbXMgcGFyYSByZXRyby1jb21wYXQ6XG4vLyBlbCBcIm1vZGFsXCIgZGUgbm90aWZpY2FjaW9uZXMgYWhvcmEgZXMgbGEgcGVzdGFuYSAnbm90aWYnIGRlbCBzaWRlYmFyLlxud2luZG93Lm9wZW5Ob3RpZnNQYW5lbCA9IGZ1bmN0aW9uICgpIHtcbiAgc2V0VGFiKCdub3RpZicpO1xuICBlbnN1cmVNeVNlbnRUYXNrc0xpc3RlbmVyKCk7XG4gIHNldE5vdGlmc1RhYih3aW5kb3cubm90aWZzVGFiIHx8ICdyZWNpYmlkYXMnKTtcbiAgcG9wdWxhdGVUYXNrVGFyZ2V0U2VsZWN0KCk7XG4gIHVwZGF0ZU5vdGlmc1RhYkNvdW50cygpO1xufTtcbndpbmRvdy5jbG9zZU5vdGlmc1BhbmVsID0gZnVuY3Rpb24gKCkge1xuICAvLyBBbnRlcyBjZXJyYWJhIGVsIG1vZGFsLiBBaG9yYSBubyBoYWNlIGZhbHRhIGhhY2VyIG5hZGEgcG9ycXVlIGVzIHVuYVxuICAvLyBwZXN0YW5hOyBlbCB1c3VhcmlvIHB1ZWRlIHNpbXBsZW1lbnRlIGNhbWJpYXIgYSBvdHJhIHBlc3RhbmEuIExvXG4gIC8vIGRlamFtb3MgY29tbyBuby1vcCBwYXJhIG5vIHJvbXBlciBsbGFtYWRhcyBsZWdhY3kuXG59O1xud2luZG93LnBvcHVsYXRlVGFza1RhcmdldHMgPSBmdW5jdGlvbiAoKSB7XG4gIC8vIEFsaWFzIGRlZmVuc2l2bzogc2kgZW4gZWwgZnV0dXJvIHNlIGxsYW1hIGRlc2RlIHNldFRhYiwgZ2FyYW50aXphIHF1ZVxuICAvLyBlbCBkcm9wZG93biBkZSBkZXN0aW5hdGFyaW9zIHNlIGxsZW5lLlxuICB0cnkge1xuICAgIHBvcHVsYXRlVGFza1RhcmdldFNlbGVjdCgpO1xuICB9IGNhdGNoIChfZSkge31cbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQUxUQSBDTElFTlRFUyAtIHNvbGljaXR1ZCBkZSBhbHRhICsgYXByb2JhY2lvbiAoU2FudGlhZ28gKyBEaWVnbylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQXByb2JhZG9yZXM6IHNlIGlkZW50aWZpY2FuIHBvciBlbWFpbC4gU2kgbmVjZXNpdGFzIGNhbWJpYXJsb3MsIGVkaXRhciBsYSBsaXN0YS5cbmNvbnN0IENMSUVOVF9BUFBMSUNBVElPTl9BUFBST1ZFUl9FTUFJTFMgPSBbJ3NyYjkwMjg0QGdtYWlsLmNvbScsICdxdWlsZ3ltQGdtYWlsLmNvbSddO1xuY29uc3QgQUxUQV9DTElfTUFYX0ZPVE9TID0gNTtcbmxldCBhbHRhQ2xpRmlsZXMgPSB7IGFyY2E6IG51bGwsIGlpYmI6IG51bGwsIGZvdG9zOiBbXSB9O1xubGV0IGFsdGFDbGlNaW5lID0gW107IC8vIG1pcyBzb2xpY2l0dWRlcyAodmVuZGVkb3IgbG9ndWVhZG8pXG4vLyBDcm9zcy1zY29wZTogZWwgaW5saW5lIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzIGhhY2Vcbi8vIG9mZigndW5zdWJBbHRhQ2xpTWluZScsIHVuc3ViQWx0YUNsaU1pbmUsICgpID0+IHVuc3ViQWx0YUNsaU1pbmUgPSBudWxsKVxuLy8gZG9uZGUgYHVuc3ViQWx0YUNsaU1pbmVgIGVzIGZyZWUgcmVmZXJlbmNlLiBTaW4gYHdpbmRvdy5gIGV4cGxcdTAwRURjaXRvLCBlbFxuLy8gYGxldGAgZGVsIGJ1bmRsZSBJSUZFIE5PIGVzIHZpc2libGUgYWwgaW5saW5lIFx1MjE5MiBvZmYgc2tpcGVhYmEgXHUyMTkyIGxpc3RlbmVyIGxlYWsuXG5pZiAodHlwZW9mIHdpbmRvdy51bnN1YkFsdGFDbGlNaW5lID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViQWx0YUNsaU1pbmUgPSBudWxsO1xuXG5mdW5jdGlvbiBlbnN1cmVBbHRhQ2xpTGlzdGVuZXIoKSB7XG4gIGlmICh3aW5kb3cudW5zdWJBbHRhQ2xpTWluZSB8fCAhY3VycmVudFVzZXIgfHwgIWZiRGIpIHJldHVybjtcbiAgLy8gU29sbyBuZWNlc2l0byBtaXMgcHJvcGlhcyBzb2xpY2l0dWRlcyBwYXJhIGxhIHN1Yi10YWIgXCJNaXMgc29saWNpdHVkZXNcIlxuICB3aW5kb3cudW5zdWJBbHRhQ2xpTWluZSA9IGZiRGJcbiAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXG4gICAgLndoZXJlKCdvd25lclVpZCcsICc9PScsIGN1cnJlbnRVc2VyLnVpZClcbiAgICAub25TbmFwc2hvdChcbiAgICAgIChxcykgPT4ge1xuICAgICAgICBhbHRhQ2xpTWluZSA9IFtdO1xuICAgICAgICBxcy5mb3JFYWNoKChkKSA9PiBhbHRhQ2xpTWluZS5wdXNoKE9iamVjdC5hc3NpZ24oeyBfZnNJZDogZC5pZCB9LCBkLmRhdGEoKSkpKTtcbiAgICAgICAgYWx0YUNsaU1pbmUuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICAgIGNvbnN0IHRhID0gYS5jcmVhdGVkQXQgPyAoYS5jcmVhdGVkQXQudG9NaWxsaXMgPyBhLmNyZWF0ZWRBdC50b01pbGxpcygpIDogMCkgOiAwO1xuICAgICAgICAgIGNvbnN0IHRiID0gYi5jcmVhdGVkQXQgPyAoYi5jcmVhdGVkQXQudG9NaWxsaXMgPyBiLmNyZWF0ZWRBdC50b01pbGxpcygpIDogMCkgOiAwO1xuICAgICAgICAgIHJldHVybiB0YiAtIHRhO1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcGFuZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1wYW5lLW1pYXMnKTtcbiAgICAgICAgaWYgKHBhbmUgJiYgcGFuZS5zdHlsZS5kaXNwbGF5ICE9PSAnbm9uZScpIHJlbmRlckFsdGFDbGlNaXNTb2xpY2l0dWRlcygpO1xuICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjLXN1Yi1jb3VudC1taWFzJyk7XG4gICAgICAgIGlmIChjKSB7XG4gICAgICAgICAgY29uc3QgcGVuZGllbnRlcyA9IGFsdGFDbGlNaW5lLmZpbHRlcigoYSkgPT4gYS5zdGF0dXMgPT09ICdwZW5kaW5nX2FwcHJvdmFsJykubGVuZ3RoO1xuICAgICAgICAgIGMudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzID4gMCA/IHBlbmRpZW50ZXMgOiAnJztcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIChlcnIpID0+IGNvbnNvbGUud2FybignYWx0YSBjbGkgbGlzdGVuZXInLCBlcnIpXG4gICAgKTtcbn1cblxuZnVuY3Rpb24gcG9wdWxhdGVBbHRhQ2xpUHJvdmluY2lhcygpIHtcbiAgY29uc3QgcHJvdnMgPSBuZXcgU2V0KCk7XG4gIChQT0lOVFMgfHwgW10pLmZvckVhY2goKHApID0+IHByb3ZzLmFkZChwLnByb3ZpbmNlKSk7XG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5wcm92c10uc29ydCgpO1xuICAvLyBMbGVubyBlbCBzZWxlY3QgZGUgXCJOdWV2YSBzb2xpY2l0dWRcIiB5IHRhbWJpZW4gZWwgZGUgXCJBbHRhIHJhcGlkYVwiLlxuICBbJ2FjLXByb3ZpbmNpYScsICdhci1wcm92aW5jaWEnXS5mb3JFYWNoKChpZCkgPT4ge1xuICAgIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTtcbiAgICBpZiAoIXNlbCB8fCBzZWwub3B0aW9ucy5sZW5ndGggPiAxKSByZXR1cm47XG4gICAgc29ydGVkLmZvckVhY2goKHByKSA9PiB7XG4gICAgICBjb25zdCBvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgICBvLnZhbHVlID0gcHI7XG4gICAgICBvLnRleHRDb250ZW50ID0gdGl0bGVDYXNlKHByKTtcbiAgICAgIHNlbC5hcHBlbmRDaGlsZChvKTtcbiAgICB9KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQWx0YUNsaVNoYXJlVXJsKCkge1xuICAvLyBCYXNlID0gbWlzbWEgVVJMIHBlcm8gYXB1bnRhbmRvIGEgYWx0YS1jbGllbnRlLmh0bWxcbiAgY29uc3QgYmFzZSA9XG4gICAgd2luZG93LmxvY2F0aW9uLm9yaWdpbiArIHdpbmRvdy5sb2NhdGlvbi5wYXRobmFtZS5yZXBsYWNlKC9bXi9dKiQvLCAnJykgKyAnYWx0YS1jbGllbnRlLmh0bWwnO1xuICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKCk7XG4gIGlmIChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci51aWQpIHBhcmFtcy5zZXQoJ3ZlbmRvcicsIGN1cnJlbnRVc2VyLnVpZCk7XG4gIGNvbnN0IHZuYW1lID1cbiAgICAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpIHx8IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJyc7XG4gIGlmICh2bmFtZSkgcGFyYW1zLnNldCgndmVuZG9yTmFtZScsIHZuYW1lKTtcbiAgaWYgKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLmVtYWlsKSBwYXJhbXMuc2V0KCd2ZW5kb3JFbWFpbCcsIGN1cnJlbnRVc2VyLmVtYWlsKTtcbiAgcmV0dXJuIGJhc2UgKyAnPycgKyBwYXJhbXMudG9TdHJpbmcoKTtcbn1cblxud2luZG93LmNvcHlBbHRhQ2xpU2hhcmVMaW5rID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB1cmwgPSBidWlsZEFsdGFDbGlTaGFyZVVybCgpO1xuICAvLyBJbnRlbnRhciBDbGlwYm9hcmQgQVBJOyBmYWxsYmFjayBhIHByb21wdFxuICBpZiAobmF2aWdhdG9yLmNsaXBib2FyZCAmJiBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCkge1xuICAgIG5hdmlnYXRvci5jbGlwYm9hcmRcbiAgICAgIC53cml0ZVRleHQodXJsKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICBzaG93U3luY1RhZygnTGluayBjb3BpYWRvLiBQZWdhbG8geSBtYW5kYWxvIGFsIGNsaWVudGUuJyk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IHByb21wdCgnQ29waWEgZWwgbGluazonLCB1cmwpKTtcbiAgfSBlbHNlIHtcbiAgICBwcm9tcHQoJ0NvcGlhIGVsIGxpbms6JywgdXJsKTtcbiAgfVxufTtcblxud2luZG93LnNoYXJlQWx0YUNsaVZpYVdoYXRzYXBwID0gZnVuY3Rpb24gKCkge1xuICBjb25zdCB1cmwgPSBidWlsZEFsdGFDbGlTaGFyZVVybCgpO1xuICBjb25zdCB2bmFtZSA9XG4gICAgKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lKSB8fCAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZW1haWwpIHx8ICdTaGltYW5vJztcbiAgY29uc3QgbXNnID1cbiAgICAnSG9sYSEgU295ICcgK1xuICAgIHZuYW1lICtcbiAgICAnIGRlIFNoaW1hbm8gQXJnZW50aW5hLiBQYXJhIGRhcnRlIGRlIGFsdGEgY29tbyBjbGllbnRlLCAnICtcbiAgICAnY29tcGxldGEgcG9yIGZhdm9yIGVzdGUgZm9ybXVsYXJpbyBjb24gbG9zIGRhdG9zIGRlIHR1IGNvbWVyY2lvLiBVbmEgdmV6IGFwcm9iYWRvLCAnICtcbiAgICAncG9kZXMgZW1wZXphciBhIGNvbXByYXIuIEN1YWxxdWllciBkdWRhIG1lIGF2aXNhcy5cXG5cXG4nICtcbiAgICB1cmw7XG4gIGNvbnN0IHdhVXJsID0gJ2h0dHBzOi8vd2EubWUvP3RleHQ9JyArIGVuY29kZVVSSUNvbXBvbmVudChtc2cpO1xuICB3aW5kb3cub3Blbih3YVVybCwgJ19ibGFuaycpO1xufTtcblxud2luZG93LnNldEFsdGFDbGlTdWJ0YWIgPSBmdW5jdGlvbiAoc3ViKSB7XG4gIGRvY3VtZW50XG4gICAgLnF1ZXJ5U2VsZWN0b3JBbGwoJy5hYy1zdWJ0YWItYnRuJylcbiAgICAuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBiLmRhdGFzZXQuYWNzdWIgPT09IHN1YikpO1xuICAvLyB2MzQxKyAoMjAyNi0wNy0yOCk6IHN1Yi10YWIgJ251ZXZvJyArIHBhbmUgI2FjLXBhbmUtbnVldm8gcmVtb3ZpZG9zLiBMb3NcbiAgLy8gZ2V0RWxlbWVudEJ5SWQgc2UgaGFjZW4gY29uIGd1YXJkIHBhcmEgdG9sZXJhciBlbCBwYW5lIGVsaW1pbmFkbyBzaW4gdGlyYXIuXG4gIGNvbnN0IG51ZXZvUGFuZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1wYW5lLW51ZXZvJyk7XG4gIGlmIChudWV2b1BhbmUpIG51ZXZvUGFuZS5zdHlsZS5kaXNwbGF5ID0gc3ViID09PSAnbnVldm8nID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1wYW5lLW1pYXMnKS5zdHlsZS5kaXNwbGF5ID0gc3ViID09PSAnbWlhcycgPyAnJyA6ICdub25lJztcbiAgY29uc3QgcmFwaWRhUGFuZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1wYW5lLXJhcGlkYScpO1xuICBpZiAocmFwaWRhUGFuZSkgcmFwaWRhUGFuZS5zdHlsZS5kaXNwbGF5ID0gc3ViID09PSAncmFwaWRhJyA/ICcnIDogJ25vbmUnO1xuICBpZiAoc3ViID09PSAnbWlhcycpIHJlbmRlckFsdGFDbGlNaXNTb2xpY2l0dWRlcygpO1xufTtcblxuLy8gQWx0YSByYXBpZGEgKHByb3Zpc29yaWEpOiBzb2xvIDMgY2FtcG9zLCBzaW4gU0FQLCBzaW4gYXByb2JhY2lvbi4gU2Vcbi8vIGNyZWEgdW4gZG9jIGVuIGNsaWVudF9hcHBsaWNhdGlvbnMgY29uIHN0YXR1cz0nYXBwcm92ZWQnIChhc2kgZW50cmFcbi8vIGRpcmVjdG8gYSBsYXMgbGlzdGFzIGRlIHRpZW5kYXMgaGFiaWxpdGFkYXMpIHkgdW4gZmxhZyBtYW51YWxTYXBQZW5kaW5nXG4vLyA9IHRydWUgcGFyYSBxdWUgYWRtaW4gc2VwYSBxdWUgaGF5IHF1ZSBjYXJnYXJsbyBhIG1hbm8gZW4gU0FQLlxud2luZG93LnN1Ym1pdEFsdGFSYXBpZGEgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGlmICghY3VycmVudFVzZXIpIHtcbiAgICBhbGVydCgnTm8gaGF5IHNlc2lcdTAwRjNuIGFjdGl2YS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY29tZXJjaW8gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLWNvbWVyY2lvJykudmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgcHJvdmluY2lhID0gKChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXItcHJvdmluY2lhJykgfHwge30pLnZhbHVlIHx8ICcnKVxuICAgIC50cmltKClcbiAgICAudG9VcHBlckNhc2UoKTtcbiAgY29uc3QgbG9jYWxpZGFkID0gKChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXItbG9jYWxpZGFkJykgfHwge30pLnZhbHVlIHx8ICcnKS50cmltKCk7XG4gIGNvbnN0IGRpcmVjY2lvbiA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXItZGlyZWNjaW9uJykudmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgZHVlbm8gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLWR1ZW5vJykudmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgY29uc3QgdGVsZWZvbm8gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLXRlbGVmb25vJykudmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgLy8gQ1VJVCBvcGNpb25hbC4gU29sbyBkaWdpdG9zIHBhcmEgcG9kZXIgbWF0Y2hlYXIgY29uIFNBUCAocXVlIGEgdmVjZXNcbiAgLy8gdHJhZSAyMC0xMjM0NTY3OC05LCBvdHJhcyAyMDEyMzQ1Njc4OSkuIFNpIGVsIHZlbmRlZG9yIGVzY3JpYmUgYWxnb1xuICAvLyBxdWUgbm8gZXMgdW4gQ1VJVCB2YWxpZG8gKG1lbm9zIGRlIDExIGRpZ2l0b3MpLCBndWFyZGFtb3MgaWd1YWwgcGVyb1xuICAvLyBhdmlzYW1vcyAtIGVsIG1hdGNoIGF1dG9tYXRpY28gdXNhIHN0cmljdCBlcXVhbGl0eSBzb2JyZSBkaWdpdG9zLlxuICBjb25zdCBjdWl0UmF3ID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhci1jdWl0JykgfHwgeyB2YWx1ZTogJycgfSkudmFsdWUgfHwgJyc7XG4gIGNvbnN0IGN1aXQgPSBjdWl0UmF3LnJlcGxhY2UoL1xcRC9nLCAnJyk7XG4gIGlmIChjb21lcmNpby5sZW5ndGggPCAyKSB7XG4gICAgYWxlcnQoJ0NvbXBsZXRcdTAwRTEgZWwgbm9tYnJlIGRlbCBsb2NhbC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFwcm92aW5jaWEpIHtcbiAgICBhbGVydCgnRWxlZ1x1MDBFRCBsYSBwcm92aW5jaWEuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChsb2NhbGlkYWQubGVuZ3RoIDwgMikge1xuICAgIGFsZXJ0KCdDb21wbGV0XHUwMEUxIGxhIGxvY2FsaWRhZC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGRpcmVjY2lvbi5sZW5ndGggPCA1KSB7XG4gICAgYWxlcnQoJ0NvbXBsZXRcdTAwRTEgbGEgZGlyZWNjaVx1MDBGM24uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChkdWVuby5sZW5ndGggPCAyKSB7XG4gICAgYWxlcnQoJ0NvbXBsZXRcdTAwRTEgZWwgbm9tYnJlIGRlbCBkdWVcdTAwRjFvIC8gY29udGFjdG8uJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjdWl0ICYmIGN1aXQubGVuZ3RoICE9PSAxMSkge1xuICAgIGlmIChcbiAgICAgICFjb25maXJtKCdFbCBDVUlUIGluZ3Jlc2FkbyB0aWVuZSAnICsgY3VpdC5sZW5ndGggKyAnIGRpZ2l0b3MgKGVzcGVyYWJhIDExKS4gR3VhcmRhciBpZ3VhbD8nKVxuICAgIClcbiAgICAgIHJldHVybjtcbiAgfVxuICBpZiAoXG4gICAgIWNvbmZpcm0oXG4gICAgICAnQ29uZmlybWFyIGFsdGEgclx1MDBFMXBpZGEgZGUgXCInICtcbiAgICAgICAgY29tZXJjaW8gK1xuICAgICAgICAnXCI/XFxuXFxuJyArXG4gICAgICAgICdQcm92aW5jaWE6ICcgK1xuICAgICAgICB0aXRsZUNhc2UocHJvdmluY2lhKSArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJ0xvY2FsaWRhZDogJyArXG4gICAgICAgIGxvY2FsaWRhZCArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJ0RpcmVjY2lvbjogJyArXG4gICAgICAgIGRpcmVjY2lvbiArXG4gICAgICAgICdcXG4nICtcbiAgICAgICAgJ0R1ZVx1MDBGMW86ICcgK1xuICAgICAgICBkdWVubyArXG4gICAgICAgICh0ZWxlZm9ubyA/ICdcXG5UZWw6ICcgKyB0ZWxlZm9ubyA6ICcnKSArXG4gICAgICAgIChjdWl0ID8gJ1xcbkNVSVQ6ICcgKyBjdWl0IDogJycpICtcbiAgICAgICAgJ1xcblxcbicgK1xuICAgICAgICAnRWwgY2xpZW50ZSBxdWVkYSBoYWJpbGl0YWRvIFBST1ZJU09SSUFNRU5URSAoYW1hcmlsbG8pLlxcbicgK1xuICAgICAgICAnVmFzIGEgcG9kZXIgY2FyZ2FybGUgcGVkaWRvcyB5IHZpc2l0YXMsIHBlcm8gbG9zIHBlZGlkb3MgTk8gc2UgZW52aWFuXFxuJyArXG4gICAgICAgICdhIFNBUCBoYXN0YSBxdWUgYWRtaW5pc3RyYWNpb24gY3JlZSBlbCBjbGllbnRlIGFsbGkuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI2FsdGEtcmFwaWRhLWZvcm0gLmJ0bi1jb25maXJtJyk7XG4gIGlmIChidG4pIHtcbiAgICBidG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdHdWFyZGFuZG8uLi4nO1xuICB9XG4gIC8vIFZlbmRvciBlZmVjdGl2bzogZWwgZGVsIHZlbmRlZG9yIGxvZ3VlYWRvIChhc3NpZ25lZFZlbmRvcikgbyBhZG1pbi5cbiAgY29uc3QgbXlWZW5kb3IgPSB0eXBlb2YgYXNzaWduZWRWZW5kb3IgIT09ICd1bmRlZmluZWQnICYmIGFzc2lnbmVkVmVuZG9yID8gYXNzaWduZWRWZW5kb3IgOiAnJztcbiAgLy8gR2VvY29kaW5nIGZpcmUtYW5kLWZvcmdldDogaW50ZW50YW1vcyBwZXJvIG5vIGJsb3F1ZWFtb3MgZWwgYWx0YS5cbiAgbGV0IGdlb1Byb21pc2UgPSBQcm9taXNlLnJlc29sdmUobnVsbCk7XG4gIGlmICh0eXBlb2YgZ2VvY29kZUNsaWVudEFkZHJlc3MgPT09ICdmdW5jdGlvbicpIHtcbiAgICBnZW9Qcm9taXNlID0gZ2VvY29kZUNsaWVudEFkZHJlc3MoZGlyZWNjaW9uLCAnJywgJycpLmNhdGNoKCgpID0+IG51bGwpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3QgZG9jUmVmID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuYWRkKHtcbiAgICAgIGNvbWVyY2lvOiBjb21lcmNpbyxcbiAgICAgIGZhbnRhc2lhOiBjb21lcmNpbyxcbiAgICAgIGNhbGxlOiBkaXJlY2Npb24sXG4gICAgICBwcm92aW5jaWE6IHByb3ZpbmNpYSxcbiAgICAgIGxvY2FsaWRhZDogbG9jYWxpZGFkLFxuICAgICAgbG9jYWxpZGFkRmluYWw6IGxvY2FsaWRhZCxcbiAgICAgIGR1ZW5vTm9tYnJlOiBkdWVubyxcbiAgICAgIHRlbGVmb25vQ29udGFjdG86IHRlbGVmb25vIHx8ICcnLFxuICAgICAgY3VpdDogY3VpdCB8fCAnJywgLy8gdjI5Mys6IENVSVQgb3BjaW9uYWwgcGFyYSBtYXRjaCBhdXRvbWF0aWNvIGNvbiBTQVBcbiAgICAgIHN0YXR1czogJ2FwcHJvdmVkJyxcbiAgICAgIHNvdXJjZTogJ2FsdGFfcmFwaWRhJyxcbiAgICAgIG1hbnVhbFNhcFBlbmRpbmc6IHRydWUsIC8vIEZMQUc6IGFkbWluIHRpZW5lIHF1ZSBjYXJnYXIgYSBTQVAgbWFudWFsXG4gICAgICBhc3NpZ25lZFZlbmRvcjogbXlWZW5kb3IsXG4gICAgICBvd25lclVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgb3duZXJFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICBvd25lck5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgYXBwcm92YWxzOiB7XG4gICAgICAgIFtjdXJyZW50VXNlci51aWRdOiB7XG4gICAgICAgICAgYXBwcm92ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgZW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIG5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8ICcnLFxuICAgICAgICAgIG5vdGU6ICdBbHRhIHJhcGlkYSBhdXRvLWFwcm9iYWRhIHBvciBlbCB2ZW5kZWRvcicsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgYXBwcm92ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICB9KTtcbiAgICAvLyBHZW9jb2RpbmcgZW4gYmFja2dyb3VuZCAobm8gYmxvcXVlYSkuXG4gICAgZ2VvUHJvbWlzZS50aGVuKChnZW8pID0+IHtcbiAgICAgIGlmIChnZW8gJiYgZ2VvLmxhdCAhPSBudWxsICYmIGdlby5sbmcgIT0gbnVsbCkge1xuICAgICAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICAgICAgbGF0OiBnZW8ubGF0LFxuICAgICAgICAgIGxuZzogZ2VvLmxuZyxcbiAgICAgICAgICBnZW9EaXNwbGF5OiBnZW8uZGlzcGxheSB8fCAnJyxcbiAgICAgICAgICBnZW9Qcm92aWRlcjogZ2VvLnByb3ZpZGVyIHx8ICdvc20nLFxuICAgICAgICAgIGdlb0F0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgZGV0ZWN0ZWRMb2MgPSAoZ2VvLmxvY2FsaXR5IHx8ICcnKS50cmltKCk7XG4gICAgICAgIGlmIChkZXRlY3RlZExvYykge1xuICAgICAgICAgIHVwZGF0ZS5sb2NhbGlkYWQgPSBkZXRlY3RlZExvYztcbiAgICAgICAgICB1cGRhdGUubG9jYWxpZGFkRmluYWwgPSBkZXRlY3RlZExvYztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBkZXRlY3RlZFByb3YgPSAoZ2VvLnByb3ZpbmNlIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGlmIChkZXRlY3RlZFByb3YpIHVwZGF0ZS5wcm92aW5jaWEgPSBkZXRlY3RlZFByb3YudG9VcHBlckNhc2UoKTtcbiAgICAgICAgZG9jUmVmXG4gICAgICAgICAgLnNldCh1cGRhdGUsIHsgbWVyZ2U6IHRydWUgfSlcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IGNvbnNvbGUud2FybignZ2VvY29kZSB1cGRhdGUgYWx0YSByYXBpZGEnLCBlKSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gTm90aWZpY2FyIGFsIGFkbWluIHBhcmEgcXVlIHNlcGEgcXVlIGhheSB1biBhbHRhIHByb3Zpc29yaWEgcXVlIGNhcmdhci5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYWRtaW5zU25hcCA9IGF3YWl0IGZiRGIuY29sbGVjdGlvbigncm9sZXMnKS53aGVyZSgncm9sZScsICc9PScsICdhZG1pbicpLmdldCgpO1xuICAgICAgY29uc3QgbWUgPSBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSB8fCBjdXJyZW50VXNlci5lbWFpbCB8fCAnVmVuZGVkb3InO1xuICAgICAgYWRtaW5zU25hcC5mb3JFYWNoKChkKSA9PiB7XG4gICAgICAgIGZiRGJcbiAgICAgICAgICAuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpXG4gICAgICAgICAgLmFkZCh7XG4gICAgICAgICAgICB0eXBlOiAnYWx0YV9yYXBpZGFfY3JlYWRhJyxcbiAgICAgICAgICAgIHRhcmdldFVpZDogZC5pZCxcbiAgICAgICAgICAgIGZyb21VaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgICB0aXRsZTogJ0FsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBtYW51YWwgZW4gU0FQJyxcbiAgICAgICAgICAgIGJvZHk6XG4gICAgICAgICAgICAgIG1lICtcbiAgICAgICAgICAgICAgJyBkaW8gZGUgYWx0YSByYXBpZGEgYSBcIicgK1xuICAgICAgICAgICAgICBjb21lcmNpbyArXG4gICAgICAgICAgICAgICdcIiAoJyArXG4gICAgICAgICAgICAgIGRpcmVjY2lvbiArXG4gICAgICAgICAgICAgICcsIGR1ZVx1MDBGMW8gJyArXG4gICAgICAgICAgICAgIGR1ZW5vICtcbiAgICAgICAgICAgICAgJykuIEhheSBxdWUgY2FyZ2FybG8gbWFudWFsbWVudGUgZW4gU0FQLicsXG4gICAgICAgICAgICBjb21lcmNpbzogY29tZXJjaW8sXG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ25vdGlmeSBhZG1pbiBhbHRhIHJhcGlkYScsIGUpO1xuICAgIH1cbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWx0YS1yYXBpZGEtZm9ybScpLnJlc2V0KCk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnQ29uZmlybWFyIGNsaWVudGUgeSBoYWJpbGl0YXInO1xuICAgIH1cbiAgICBhbGVydChcbiAgICAgICdDbGllbnRlIGhhYmlsaXRhZG8gcHJvdmlzb3JpYW1lbnRlLlxcblxcbllhIHBvZGVzIGNhcmdhcmxlIHBlZGlkb3MgZGVzZGUgbGEgc29sYXBhIFBFRElET1MuJ1xuICAgICk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdzdWJtaXRBbHRhUmFwaWRhJywgZSk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnQ29uZmlybWFyIGNsaWVudGUgeSBoYWJpbGl0YXInO1xuICAgIH1cbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5vbkFsdGFDbGlGaWxlID0gYXN5bmMgZnVuY3Rpb24gKGlucHV0LCBraW5kKSB7XG4gIGNvbnN0IGZpbGVzID0gWy4uLihpbnB1dC5maWxlcyB8fCBbXSldO1xuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYjY0ID0gYXdhaXQgY29tcHJlc3NJbWFnZShmLCAxNDAwLCAwLjc4KTtcbiAgICAgIGlmIChraW5kID09PSAnZm90b3MnKSB7XG4gICAgICAgIGlmIChhbHRhQ2xpRmlsZXMuZm90b3MubGVuZ3RoID49IEFMVEFfQ0xJX01BWF9GT1RPUykge1xuICAgICAgICAgIGFsZXJ0KCdNYXhpbW8gJyArIEFMVEFfQ0xJX01BWF9GT1RPUyArICcgZm90b3MgZGVsIGxvY2FsLicpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGFsdGFDbGlGaWxlcy5mb3Rvcy5wdXNoKGI2NCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhbHRhQ2xpRmlsZXNba2luZF0gPSBiNjQ7IC8vIHJlZW1wbGF6YSBlbCBhbnRlcmlvclxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ2NvbXByZXNzIGFsdGEgY2xpJywgZSk7XG4gICAgfVxuICB9XG4gIGlucHV0LnZhbHVlID0gJyc7XG4gIHJlZnJlc2hBbHRhQ2xpR3JpZChraW5kKTtcbn07XG5cbndpbmRvdy5yZW1vdmVBbHRhQ2xpRmlsZSA9IGZ1bmN0aW9uIChraW5kLCBpZHgpIHtcbiAgaWYgKGtpbmQgPT09ICdmb3RvcycpIGFsdGFDbGlGaWxlcy5mb3Rvcy5zcGxpY2UoaWR4LCAxKTtcbiAgZWxzZSBhbHRhQ2xpRmlsZXNba2luZF0gPSBudWxsO1xuICByZWZyZXNoQWx0YUNsaUdyaWQoa2luZCk7XG59O1xuXG5mdW5jdGlvbiByZWZyZXNoQWx0YUNsaUdyaWQoa2luZCkge1xuICBjb25zdCBncmlkSWQgPVxuICAgIGtpbmQgPT09ICdhcmNhJyA/ICdhYy1hcmNhLWdyaWQnIDoga2luZCA9PT0gJ2lpYmInID8gJ2FjLWlpYmItZ3JpZCcgOiAnYWMtZm90b3MtZ3JpZCc7XG4gIGNvbnN0IGdyaWQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChncmlkSWQpO1xuICBpZiAoIWdyaWQpIHJldHVybjtcbiAgbGV0IGNlbGxzID0gJyc7XG4gIGlmIChraW5kID09PSAnZm90b3MnKSB7XG4gICAgY2VsbHMgPSBhbHRhQ2xpRmlsZXMuZm90b3NcbiAgICAgIC5tYXAoXG4gICAgICAgIChiNjQsIGkpID0+XG4gICAgICAgICAgJzxkaXYgY2xhc3M9XCJwaG90by1jZWxsXCI+PGltZyBzcmM9XCInICtcbiAgICAgICAgICBiNjQgK1xuICAgICAgICAgICdcIi8+PGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJybVwiIG9uY2xpY2s9XCJyZW1vdmVBbHRhQ2xpRmlsZShcXCdmb3Rvc1xcJywnICtcbiAgICAgICAgICBpICtcbiAgICAgICAgICAnKVwiPiZ0aW1lczs8L2J1dHRvbj48L2Rpdj4nXG4gICAgICApXG4gICAgICAuam9pbignJyk7XG4gICAgaWYgKGFsdGFDbGlGaWxlcy5mb3Rvcy5sZW5ndGggPCBBTFRBX0NMSV9NQVhfRk9UT1MpIHtcbiAgICAgIGNlbGxzICs9XG4gICAgICAgICc8bGFiZWwgY2xhc3M9XCJwaG90by1jZWxsIGFkZFwiPjxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cImltYWdlLypcIiBtdWx0aXBsZSBvbmNoYW5nZT1cIm9uQWx0YUNsaUZpbGUodGhpcyxcXCdmb3Rvc1xcJylcIi8+KzwvbGFiZWw+JztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgdiA9IGFsdGFDbGlGaWxlc1traW5kXTtcbiAgICBpZiAodikge1xuICAgICAgY2VsbHMgPVxuICAgICAgICAnPGRpdiBjbGFzcz1cInBob3RvLWNlbGxcIj48aW1nIHNyYz1cIicgK1xuICAgICAgICB2ICtcbiAgICAgICAgJ1wiLz48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInJtXCIgb25jbGljaz1cInJlbW92ZUFsdGFDbGlGaWxlKFxcJycgK1xuICAgICAgICBraW5kICtcbiAgICAgICAgJ1xcJylcIj4mdGltZXM7PC9idXR0b24+PC9kaXY+JztcbiAgICB9IGVsc2Uge1xuICAgICAgY2VsbHMgPVxuICAgICAgICAnPGxhYmVsIGNsYXNzPVwicGhvdG8tY2VsbCBhZGRcIj48aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCJpbWFnZS8qLC5wZGZcIiBvbmNoYW5nZT1cIm9uQWx0YUNsaUZpbGUodGhpcyxcXCcnICtcbiAgICAgICAga2luZCArXG4gICAgICAgICdcXCcpXCIvPis8L2xhYmVsPic7XG4gICAgfVxuICB9XG4gIGdyaWQuaW5uZXJIVE1MID0gY2VsbHM7XG59XG5cbmZ1bmN0aW9uIHJlc2V0QWx0YUNsaUZvcm0oKSB7XG4gIGNvbnN0IGYgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWx0YS1jbGktZm9ybScpO1xuICBpZiAoZikgZi5yZXNldCgpO1xuICBhbHRhQ2xpRmlsZXMgPSB7IGFyY2E6IG51bGwsIGlpYmI6IG51bGwsIGZvdG9zOiBbXSB9O1xuICByZWZyZXNoQWx0YUNsaUdyaWQoJ2FyY2EnKTtcbiAgcmVmcmVzaEFsdGFDbGlHcmlkKCdpaWJiJyk7XG4gIHJlZnJlc2hBbHRhQ2xpR3JpZCgnZm90b3MnKTtcbn1cblxud2luZG93LnN1Ym1pdENsaWVudEFwcGxpY2F0aW9uID0gYXN5bmMgZnVuY3Rpb24gKCkge1xuICAvLyBWYWxpZGFyXG4gIGNvbnN0IGVycm9ycyA9IFtdO1xuICBmdW5jdGlvbiByZWFkKGlkKSB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7XG4gICAgcmV0dXJuIGVsID8gKGVsLnZhbHVlIHx8ICcnKS50cmltKCkgOiAnJztcbiAgfVxuICBjb25zdCBmaWVsZHMgPSBbXG4gICAgWydhYy1lbWFpbCcsICdFLW1haWwgY29tZXJjaW8nXSxcbiAgICBbJ2FjLWNvbWVyY2lvJywgJ05vbWJyZSBkZWwgY29tZXJjaW8nXSxcbiAgICBbJ2FjLWZhbnRhc2lhJywgJ05vbWJyZSBmYW50YXNpYSddLFxuICAgIFsnYWMtY3VpdCcsICdDVUlUJ10sXG4gICAgWydhYy1jb25kZmlzY2FsJywgJ0NvbmRpY2lvbiBmaXNjYWwnXSxcbiAgICBbJ2FjLWNhbGxlJywgJ0NhbGxlJ10sXG4gICAgWydhYy1udW1lcm8nLCAnTnVtZXJvJ10sXG4gICAgWydhYy1sb2NhbGlkYWQnLCAnTG9jYWxpZGFkJ10sXG4gICAgWydhYy1wcm92aW5jaWEnLCAnUHJvdmluY2lhJ10sXG4gICAgWydhYy1jcCcsICdDb2RpZ28gUG9zdGFsJ10sXG4gICAgWydhYy10ZWxlZm9ubycsICdUZWxlZm9ubyddLFxuICAgIFsnYWMtd2ViJywgJ1BhZ2luYSB3ZWInXSxcbiAgICBbJ2FjLXJlZGVzJywgJ1JlZGVzJ10sXG4gICAgWydhYy1jb250YWN0by1ub21icmUnLCAnTm9tYnJlIGNvbnRhY3RvJ10sXG4gICAgWydhYy1jb250YWN0by10ZWxwYXJ0JywgJ1RlbGVmb25vIHBhcnRpY3VsYXIgY29udGFjdG8nXSxcbiAgICBbJ2FjLWNvbnRhY3RvLXdzcCcsICdXaGF0c0FwcCBjb250YWN0byddLFxuICAgIFsnYWMtY29udGFjdG8tZW1haWwnLCAnRW1haWwgY29udGFjdG8nXSxcbiAgICBbJ2FjLXRpcG9jb21lcmNpbycsICdUaXBvIGRlIGNvbWVyY2lvJ10sXG4gICAgWydhYy10aWVuZGFvbmxpbmUnLCAnVGllbmRhIG9ubGluZSddLFxuICBdO1xuICBmaWVsZHMuZm9yRWFjaCgoW2lkLCBsYWJlbF0pID0+IHtcbiAgICBpZiAoIXJlYWQoaWQpKSBlcnJvcnMucHVzaChsYWJlbCk7XG4gIH0pO1xuICBpZiAoIWFsdGFDbGlGaWxlcy5hcmNhKSBlcnJvcnMucHVzaCgnQ29uc3RhbmNpYSBBUkNBJyk7XG4gIC8vIENvbnN0YW5jaWEgSUlCQiBlcyBPUENJT05BTDogbXVjaGFzIHRpZW5kYXMgKG1vbm90cmlidXRpc3Rhcykgbm8gdGllbmVuLlxuICBpZiAoIWFsdGFDbGlGaWxlcy5mb3Rvcy5sZW5ndGgpIGVycm9ycy5wdXNoKCdGb3RvcyBkZWwgbG9jYWwgKGFsIG1lbm9zIDEpJyk7XG4gIGlmIChlcnJvcnMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ0ZhbHRhbiBjb21wbGV0YXI6XFxuXFxuLSAnICsgZXJyb3JzLmpvaW4oJ1xcbi0gJykpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdFbnZpYXIgbGEgc29saWNpdHVkIGRlIGFsdGEgZGUgXCInICtcbiAgICAgICAgcmVhZCgnYWMtY29tZXJjaW8nKSArXG4gICAgICAgICdcIj9cXG5cXG5MZXMgdmEgYSBsbGVnYXIgY29tbyB0YXJlYSBhIGxvcyBhcHJvYmFkb3JlcyAoU2FudGlhZ28geSBEaWVnbykuIEN1YW5kbyBhbWJvcyBhcHJ1ZWJlbiwgZWwgY2xpZW50ZSBxdWVkYSBkYWRvIGRlIGFsdGEgeSB2YXMgYSBwb2RlciBjYXJnYXJsZSBwZWRpZG9zLidcbiAgICApXG4gIClcbiAgICByZXR1cm47XG5cbiAgY29uc3QgZGF0YSA9IHtcbiAgICAvLyBEYXRvcyBjb21lcmNpb1xuICAgIGVtYWlsOiByZWFkKCdhYy1lbWFpbCcpLFxuICAgIGNvbWVyY2lvOiByZWFkKCdhYy1jb21lcmNpbycpLFxuICAgIGZhbnRhc2lhOiByZWFkKCdhYy1mYW50YXNpYScpLFxuICAgIGN1aXQ6IHJlYWQoJ2FjLWN1aXQnKSxcbiAgICBjb25kaWNpb25GaXNjYWw6IHJlYWQoJ2FjLWNvbmRmaXNjYWwnKSxcbiAgICBjYWxsZTogcmVhZCgnYWMtY2FsbGUnKSxcbiAgICBudW1lcm86IHJlYWQoJ2FjLW51bWVybycpLFxuICAgIGxvY2FsaWRhZDogcmVhZCgnYWMtbG9jYWxpZGFkJyksXG4gICAgcHJvdmluY2lhOiByZWFkKCdhYy1wcm92aW5jaWEnKSxcbiAgICBjcDogcmVhZCgnYWMtY3AnKSxcbiAgICB0ZWxlZm9ubzogcmVhZCgnYWMtdGVsZWZvbm8nKSxcbiAgICB3ZWI6IHJlYWQoJ2FjLXdlYicpLFxuICAgIHJlZGVzOiByZWFkKCdhYy1yZWRlcycpLFxuICAgIC8vIENvbnRhY3RvXG4gICAgY29udGFjdG9Ob21icmU6IHJlYWQoJ2FjLWNvbnRhY3RvLW5vbWJyZScpLFxuICAgIGNvbnRhY3RvVGVsUGFydGljdWxhcjogcmVhZCgnYWMtY29udGFjdG8tdGVscGFydCcpLFxuICAgIGNvbnRhY3RvV2hhdHNhcHA6IHJlYWQoJ2FjLWNvbnRhY3RvLXdzcCcpLFxuICAgIGNvbnRhY3RvRW1haWw6IHJlYWQoJ2FjLWNvbnRhY3RvLWVtYWlsJyksXG4gICAgdGlwb0NvbWVyY2lvOiByZWFkKCdhYy10aXBvY29tZXJjaW8nKSxcbiAgICB0aWVuZGFPbmxpbmU6IHJlYWQoJ2FjLXRpZW5kYW9ubGluZScpLFxuICAgIC8vIERvY3VtZW50b3NcbiAgICBjb25zdGFuY2lhQXJjYTogYWx0YUNsaUZpbGVzLmFyY2EsXG4gICAgY29uc3RhbmNpYUlJQkI6IGFsdGFDbGlGaWxlcy5paWJiLFxuICAgIGZvdG9zTG9jYWw6IGFsdGFDbGlGaWxlcy5mb3Rvcy5zbGljZSgpLFxuICAgIC8vIE1ldGFkYXRhXG4gICAgb3duZXJVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICBvd25lckVtYWlsOiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICBvd25lck5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgIHZlbmRvcjogYXNzaWduZWRWZW5kb3IgfHwgbnVsbCxcbiAgICBzdGF0dXM6ICdwZW5kaW5nX2FwcHJvdmFsJyxcbiAgICBhcHByb3ZhbHM6IHt9LFxuICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gIH07XG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNhbHRhLWNsaS1mb3JtIC5idG4tY29uZmlybScpO1xuICBpZiAoYnRuKSB7XG4gICAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFuZG8uLi4nO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3QgZG9jUmVmID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuYWRkKGRhdGEpO1xuICAgIC8vIE5vdGlmaWNhciBhIGNhZGEgYXByb2JhZG9yXG4gICAgY29uc3QgYXBwcm92ZXJzID0gYXdhaXQgZmluZEFwcHJvdmVyVWlkcygpO1xuICAgIGZvciAoY29uc3QgdSBvZiBhcHByb3ZlcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmFkZCh7XG4gICAgICAgICAgdHlwZTogJ2NsaWVudF9hcHByb3ZhbCcsXG4gICAgICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgZnJvbU5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHRhcmdldFVpZDogdS51aWQsXG4gICAgICAgICAgdGFyZ2V0RW1haWw6IHUuZW1haWwsXG4gICAgICAgICAgdGl0bGU6ICdOdWV2YSBzb2xpY2l0dWQgZGUgYWx0YTogJyArIGRhdGEuY29tZXJjaW8sXG4gICAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgICAnVmVuZGVkb3I6ICcgK1xuICAgICAgICAgICAgKGRhdGEub3duZXJOYW1lIHx8IGRhdGEub3duZXJFbWFpbCkgK1xuICAgICAgICAgICAgJ1xcbkNVSVQ6ICcgK1xuICAgICAgICAgICAgZGF0YS5jdWl0ICtcbiAgICAgICAgICAgICdcXG5Mb2NhbGlkYWQ6ICcgK1xuICAgICAgICAgICAgZGF0YS5sb2NhbGlkYWQgK1xuICAgICAgICAgICAgJywgJyArXG4gICAgICAgICAgICB0aXRsZUNhc2UoZGF0YS5wcm92aW5jaWEpICtcbiAgICAgICAgICAgICdcXG5Db25kaWNpXHUwMEYzbiBmaXNjYWw6ICcgK1xuICAgICAgICAgICAgZGF0YS5jb25kaWNpb25GaXNjYWwsXG4gICAgICAgICAgYXBwbGljYXRpb25JZDogZG9jUmVmLmlkLFxuICAgICAgICAgIHN0YXR1czogJ3VucmVhZCcsXG4gICAgICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2Fybignbm90aWYgYXBwcm92ZXInLCB1LmVtYWlsLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgc2hvd1N5bmNUYWcoJ1NvbGljaXR1ZCBlbnZpYWRhLiBBcHJvYmFkb3JlcyBub3RpZmljYWRvcy4nKTtcbiAgICByZXNldEFsdGFDbGlGb3JtKCk7XG4gICAgc2V0QWx0YUNsaVN1YnRhYignbWlhcycpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignc3VibWl0IGNsaWVudCBhcHAnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZW52aWFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAoYnRuKSB7XG4gICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICAgIGJ0bi50ZXh0Q29udGVudCA9ICdFbnZpYXIgc29saWNpdHVkIGRlIGFsdGEnO1xuICAgIH1cbiAgfVxufTtcblxuYXN5bmMgZnVuY3Rpb24gZmluZEFwcHJvdmVyVWlkcygpIHtcbiAgLy8gQnVzY2EgZW4gL3JvbGVzIGxvcyB1aWRzIGRlIGxvcyBhcHJvYmFkb3JlcyBwb3IgZW1haWxcbiAgY29uc3Qgb3V0ID0gW107XG4gIHRyeSB7XG4gICAgY29uc3QgcXMgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykuZ2V0KCk7XG4gICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgY29uc3QgZGF0YSA9IGQuZGF0YSgpIHx8IHt9O1xuICAgICAgY29uc3QgZW0gPSAoZGF0YS5lbWFpbCB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChDTElFTlRfQVBQTElDQVRJT05fQVBQUk9WRVJfRU1BSUxTLmluZGV4T2YoZW0pID49IDApIHtcbiAgICAgICAgb3V0LnB1c2goeyB1aWQ6IGQuaWQsIGVtYWlsOiBlbSB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUud2FybignZmluZEFwcHJvdmVyVWlkcycsIGUpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckFsdGFDbGlNaXNTb2xpY2l0dWRlcygpIHtcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1taWFzLWxpc3QnKTtcbiAgaWYgKCFjb250KSByZXR1cm47XG4gIGlmICghYWx0YUNsaU1pbmUubGVuZ3RoKSB7XG4gICAgY29udC5pbm5lckhUTUwgPVxuICAgICAgJzxkaXYgY2xhc3M9XCJub3RpZi1lbXB0eVwiPk5vIGVudmlhc3RlIHNvbGljaXR1ZGVzIHRvZGF2aWEuIFVzYSBsYSBwZXN0YVx1MDBGMWEgPGI+TnVldmEgc29saWNpdHVkPC9iPi48L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgaHRtbCA9ICcnO1xuICBhbHRhQ2xpTWluZS5mb3JFYWNoKChhKSA9PiB7XG4gICAgY29uc3Qgc3RDbHMgPVxuICAgICAgYS5zdGF0dXMgPT09ICdhcHByb3ZlZCcgPyAnYXBwcm92ZWQnIDogYS5zdGF0dXMgPT09ICdyZWplY3RlZCcgPyAncmVqZWN0ZWQnIDogJ3BlbmRpbmcnO1xuICAgIGNvbnN0IHN0TGJsID1cbiAgICAgIGEuc3RhdHVzID09PSAnYXBwcm92ZWQnID8gJ0Fwcm9iYWRhJyA6IGEuc3RhdHVzID09PSAncmVqZWN0ZWQnID8gJ1JlY2hhemFkYScgOiAnUGVuZGllbnRlJztcbiAgICBjb25zdCBkdCA9IGEuY3JlYXRlZEF0ID8gKGEuY3JlYXRlZEF0LnRvRGF0ZSA/IGEuY3JlYXRlZEF0LnRvRGF0ZSgpIDogbnVsbCkgOiBudWxsO1xuICAgIGNvbnN0IGR0U3RyID0gZHQgPyBkdC50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcnO1xuICAgIGNvbnN0IGFwQ291bnQgPSBhLmFwcHJvdmFscyA/IE9iamVjdC5rZXlzKGEuYXBwcm92YWxzKS5sZW5ndGggOiAwO1xuICAgIGNvbnN0IGlzUmFwaWRhID0gYS5zb3VyY2UgPT09ICdhbHRhX3JhcGlkYSc7XG4gICAgY29uc3QgaGFzU2FwID0gISFhLmNhcmRDb2RlU2FwO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJhYy1hcHAtY2FyZCAnICsgc3RDbHMgKyAnXCI+JztcbiAgICBodG1sICs9ICc8aDU+JyArIGVzY2FwZUh0bWwoYS5jb21lcmNpbyB8fCAnLScpICsgJzwvaDU+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImFjLWFwcC1tZXRhXCI+JyArXG4gICAgICBlc2NhcGVIdG1sKGEuZmFudGFzaWEgfHwgJycpICtcbiAgICAgICcgJm1pZGRvdDsgQ1VJVCAnICtcbiAgICAgIGVzY2FwZUh0bWwoYS5jdWl0IHx8ICcnKSArXG4gICAgICAnPC9kaXY+JztcbiAgICBodG1sICs9XG4gICAgICAnPGRpdiBjbGFzcz1cImFjLWFwcC1tZXRhXCI+JyArXG4gICAgICBlc2NhcGVIdG1sKGEubG9jYWxpZGFkIHx8ICcnKSArXG4gICAgICAnICZtaWRkb3Q7ICcgK1xuICAgICAgZXNjYXBlSHRtbCh0aXRsZUNhc2UoYS5wcm92aW5jaWEgfHwgJycpKSArXG4gICAgICAnICZtaWRkb3Q7IEVudmlhZGEgJyArXG4gICAgICBlc2NhcGVIdG1sKGR0U3RyKSArXG4gICAgICAnPC9kaXY+JztcbiAgICBodG1sICs9ICc8ZGl2PjxzcGFuIGNsYXNzPVwiYWMtYXBwLXN0YXR1c1wiPicgKyBzdExibCArICc8L3NwYW4+JztcbiAgICBpZiAoYS5zdGF0dXMgPT09ICdwZW5kaW5nX2FwcHJvdmFsJykge1xuICAgICAgaHRtbCArPVxuICAgICAgICAnIDxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWxlZnQ6NnB4XCI+JyArXG4gICAgICAgIGFwQ291bnQgK1xuICAgICAgICAnLzIgYXByb2JhY2lvbmVzPC9zcGFuPic7XG4gICAgfVxuICAgIGlmIChhLnN0YXR1cyA9PT0gJ3JlamVjdGVkJyAmJiBhLnJlamVjdGVkUmVhc29uKSB7XG4gICAgICBodG1sICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7bWFyZ2luLXRvcDo0cHhcIj48Yj5Nb3Rpdm86PC9iPiAnICtcbiAgICAgICAgZXNjYXBlSHRtbChhLnJlamVjdGVkUmVhc29uKSArXG4gICAgICAgICc8L2Rpdj4nO1xuICAgIH1cbiAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgIC8vIEJvdG9uIGVsaW1pbmFyLiBQYXJhIGFsdGFzIHJhcGlkYXMgc2UgcGVybWl0ZSBzaWVtcHJlIChtaWVudHJhc1xuICAgIC8vIG5vIGVzdGVuIGNhcmdhZGFzIGVuIFNBUCkuIFBhcmEgYWx0YXMgZm9ybWFsZXMgc2UgcGVybWl0ZSBjdWFuZG9cbiAgICAvLyBlc3RhbiBwZW5kaWVudGVzIG8gcmVjaGF6YWRhcyAtIGFwcm9iYWRhcyBjb24gY2FyZENvZGUgbm8gc2UgcHVlZGVuXG4gICAgLy8gYm9ycmFyIGRlc2RlIGFjYSAoc2UgbWFuZWphbiBkZXNkZSBTQVApLlxuICAgIGNvbnN0IGNhbkRlbGV0ZSA9IGlzUmFwaWRhID8gIWhhc1NhcCA6IGEuc3RhdHVzICE9PSAnYXBwcm92ZWQnIHx8ICFoYXNTYXA7XG4gICAgaWYgKGNhbkRlbGV0ZSkge1xuICAgICAgY29uc3Qgc2FmZUlkID0gZXNjYXBlQXR0cihhLl9mc0lkIHx8ICcnKTtcbiAgICAgIGNvbnN0IHNhZmVOYW1lID0gSlNPTi5zdHJpbmdpZnkoYS5jb21lcmNpbyB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xuICAgICAgaHRtbCArPSAnPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6OHB4O3RleHQtYWxpZ246cmlnaHRcIj4nO1xuICAgICAgaHRtbCArPVxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZGVsZXRlTXlBbHRhQ2xpKFxcJycgK1xuICAgICAgICBzYWZlSWQgK1xuICAgICAgICBcIicsIFwiICtcbiAgICAgICAgc2FmZU5hbWUgK1xuICAgICAgICAnKVwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXItYmcpO2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlci1zdHJvbmcpO2JvcmRlcjoxLjVweCBzb2xpZCAjZmNhNWE1O2JvcmRlci1yYWRpdXM6NXB4O3BhZGRpbmc6NnB4IDEycHg7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2N1cnNvcjpwb2ludGVyXCI+RWxpbWluYXI8L2J1dHRvbj4nO1xuICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICB9XG4gICAgaHRtbCArPSAnPC9kaXY+JztcbiAgfSk7XG4gIGNvbnQuaW5uZXJIVE1MID0gaHRtbDtcbn1cblxud2luZG93LmRlbGV0ZU15QWx0YUNsaSA9IGFzeW5jIGZ1bmN0aW9uIChmc0lkLCBjb21lcmNpbykge1xuICBpZiAoIWZzSWQpIHJldHVybjtcbiAgY29uc3Qgbm9tYnJlID0gY29tZXJjaW8gfHwgJ2VzdGEgc29saWNpdHVkJztcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ0VsaW1pbmFyIFwiJyArXG4gICAgICAgIG5vbWJyZSArXG4gICAgICAgICdcIj9cXG5cXG5MYSBhbHRhIHNlIGJvcnJhIGRlIHR1cyBzb2xpY2l0dWRlcyB5IGRlamEgZGUgYXBhcmVjZXIgZW4gUEVESURPUyAvIFZJU0lUQVMgLyBtYXBhLiBObyBzZSBwdWVkZSBkZXNoYWNlci4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmRvYyhmc0lkKS5kZWxldGUoKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnQWx0YSBlbGltaW5hZGEnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZU15QWx0YUNsaScsIGUpO1xuICAgIGFsZXJ0KCdFcnJvciBlbGltaW5hbmRvIGxhIHNvbGljaXR1ZDogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTkRJQ0lPTkVTIC0gc29saWNpdHVkIGFudGljaXBvICsgZ2FzdG9zIGNvbiBmb3RvICsgYXByb2JhY2lvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFMi5lIChlMmItcGVyZiAyMDI2LTA3LTI4KTogbW92aWRvIGEgc3JjL2RvbWFpbnMvcmVuZGljaW9uZXMuanMgKDkwMSBMT0MpLlxuLy8gQnVuZGxlIHJlZ2lzdHJhIHdpbmRvdy5lbnN1cmVSZW5kaWNpb25lc0xpc3RlbmVyLCB3aW5kb3cub3BlblJlbmRpY2lvbkRldGFpbCxcbi8vIHdpbmRvdy5zZXRSZW5kU3VidGFiLCB3aW5kb3cuc3VibWl0UmVuZFNvbGljaXR1ZCwgd2luZG93LnN1Ym1pdFJlbmRHYXN0byxcbi8vIHdpbmRvdy5hcHByb3ZlUmVuZGljaW9uLCB3aW5kb3cucmVqZWN0UmVuZGljaW9uLCB3aW5kb3cuZXhwb3J0TWlzUmVuZGljaW9uZXNFeGNlbCxcbi8vIHdpbmRvdy5zZXRUb2Rhc1JlbmRGaWx0ZXIgKyB+NSBoYW5kbGVycyBkZSBVSSAoYWRqdW50b3MgKyBmb3RvcyArIE9DUiByZXRyeSkuXG4vLyBDYWxsZXJzIGRlbCBpbmxpbmUgbGFzIHVzYW4gc2luIHByZWZpeC5cbi8vIENyb3NzLXNjb3BlIHN0YXRlOiB3aW5kb3cudW5zdWJNaXNSZW5kaWNpb25lcyArIHdpbmRvdy51bnN1YlRvZGFzUmVuZGljaW9uZXNcbi8vIChsaXN0ZW5lcnMgY29uIGNsZWFudXAgZW4gZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMpIGluaWNpYWxpemFkb3MgcG9yIGVsIGJ1bmRsZS5cbi8vIE5vdGE6IG15UmVuZGljaW9uZXNBcHByb3ZlclVpZC9FbWFpbCBzaWd1ZW4gZGVjbGFyYWRhcyBjb21vIGxldCBlbiBlbCBpbmxpbmU7XG4vLyBlbCBidW5kbGUgbGFzIGxlZSB2aWEgZnJlZSByZWZlcmVuY2UgKEdsb2JhbCBFbnZpcm9ubWVudCBSZWNvcmQgY29tcGFydGlkbykuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gRGV0YWxsZSBkZSBzb2xpY2l0dWQgZGUgYWx0YSAtPiBhcHJvYmFyIC8gcmVjaGF6YXJcbndpbmRvdy5vcGVuQ2xpZW50QXBwbGljYXRpb25EZXRhaWwgPSBhc3luYyBmdW5jdGlvbiAoYXBwSWQsIG5vdGlmSWQpIHtcbiAgaWYgKCFhcHBJZCkge1xuICAgIGFsZXJ0KCdTb2xpY2l0dWQgbm8gZW5jb250cmFkYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS5nZXQoKTtcbiAgICBpZiAoIXNuYXAuZXhpc3RzKSB7XG4gICAgICBhbGVydCgnTGEgc29saWNpdHVkIHlhIG5vIGV4aXN0ZS4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYSA9IE9iamVjdC5hc3NpZ24oeyBfaWQ6IGFwcElkIH0sIHNuYXAuZGF0YSgpKTtcbiAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWRldGFpbC1jb250ZW50Jyk7XG4gICAgbGV0IGggPVxuICAgICAgJzxkaXYgc3R5bGU9XCJwYWRkaW5nOjE4cHggMjBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0LXByaW1hcnkpO2xpbmUtaGVpZ2h0OjEuNlwiPic7XG4gICAgaCArPVxuICAgICAgJzxoNCBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2NvbG9yOiMwODkxYjI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi41cHg7bWFyZ2luLWJvdHRvbTo4cHg7cGFkZGluZy1ib3R0b206NXB4O2JvcmRlci1ib3R0b206MS41cHggc29saWQgIzY3ZThmOVwiPkNvbWVyY2lvPC9oND4nO1xuICAgIGggKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCgyLDFmcik7Z2FwOjZweCAxNHB4XCI+JztcbiAgICBoICs9ICc8ZGl2PjxiPk5vbWJyZTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY29tZXJjaW8gfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5GYW50YXNpYTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuZmFudGFzaWEgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5DVUlUOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jdWl0IHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXY+PGI+Q29uZC4gZmlzY2FsOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jb25kaWNpb25GaXNjYWwgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPVxuICAgICAgJzxkaXY+PGI+RGlyZWNjaW9uOjwvYj4gJyArXG4gICAgICBlc2NhcGVIdG1sKGEuY2FsbGUgfHwgJycpICtcbiAgICAgICcgJyArXG4gICAgICBlc2NhcGVIdG1sKGEubnVtZXJvIHx8ICcnKSArXG4gICAgICAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2PjxiPkNQOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jcCB8fCAnJykgKyAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2PjxiPkxvY2FsaWRhZDo8L2I+ICcgKyBlc2NhcGVIdG1sKGEubG9jYWxpZGFkIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXY+PGI+UHJvdmluY2lhOjwvYj4gJyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGEucHJvdmluY2lhIHx8ICcnKSkgKyAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2PjxiPlRlbGVmb25vOjwvYj4gJyArIGVzY2FwZUh0bWwoYS50ZWxlZm9ubyB8fCAnJykgKyAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2PjxiPkVtYWlsOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5lbWFpbCB8fCAnJykgKyAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2IHN0eWxlPVwiZ3JpZC1jb2x1bW46MS8tMVwiPjxiPldlYjo8L2I+ICcgKyBlc2NhcGVIdG1sKGEud2ViIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXYgc3R5bGU9XCJncmlkLWNvbHVtbjoxLy0xXCI+PGI+UmVkZXM6PC9iPiAnICsgZXNjYXBlSHRtbChhLnJlZGVzIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzwvZGl2Pic7XG4gICAgaCArPVxuICAgICAgJzxoNCBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2NvbG9yOiMwODkxYjI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi41cHg7bWFyZ2luOjE0cHggMCA4cHg7cGFkZGluZy1ib3R0b206NXB4O2JvcmRlci1ib3R0b206MS41cHggc29saWQgIzY3ZThmOVwiPkNvbnRhY3RvPC9oND4nO1xuICAgIGggKz0gJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCgyLDFmcik7Z2FwOjZweCAxNHB4XCI+JztcbiAgICBoICs9ICc8ZGl2PjxiPk5vbWJyZTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY29udGFjdG9Ob21icmUgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5UZWwgcGFydGljdWxhcjo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY29udGFjdG9UZWxQYXJ0aWN1bGFyIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXY+PGI+V2hhdHNBcHA6PC9iPiAnICsgZXNjYXBlSHRtbChhLmNvbnRhY3RvV2hhdHNhcHAgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5FLW1haWw6PC9iPiAnICsgZXNjYXBlSHRtbChhLmNvbnRhY3RvRW1haWwgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5UaXBvIGNvbWVyY2lvOjwvYj4gJyArIGVzY2FwZUh0bWwoYS50aXBvQ29tZXJjaW8gfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdj48Yj5UaWVuZGEgb25saW5lOjwvYj4gJyArIGVzY2FwZUh0bWwoYS50aWVuZGFPbmxpbmUgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPC9kaXY+JztcbiAgICBoICs9XG4gICAgICAnPGg0IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6IzA4OTFiMjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjVweDttYXJnaW46MTRweCAwIDhweDtwYWRkaW5nLWJvdHRvbTo1cHg7Ym9yZGVyLWJvdHRvbToxLjVweCBzb2xpZCAjNjdlOGY5XCI+RG9jdW1lbnRhY2kmb2FjdXRlO248L2g0Pic7XG4gICAgaCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4XCI+JztcbiAgICBpZiAoYS5jb25zdGFuY2lhQXJjYSlcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXJnaW4tYm90dG9tOjNweDtmb250LXdlaWdodDo3MDA7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QVJDQTwvZGl2PjxpbWcgc3JjPVwiJyArXG4gICAgICAgIGEuY29uc3RhbmNpYUFyY2EgK1xuICAgICAgICAnXCIgaWQ9XCJjYS1hcmNhLWltZ1wiIGNsYXNzPVwidGFzay1pbWctdGh1bWJcIiBzdHlsZT1cIndpZHRoOjkwcHg7aGVpZ2h0OjkwcHhcIiBvbmNsaWNrPVwib3BlbkltZ1ZpZXdlcihcXCdjYS1hcmNhLWltZ1xcJylcIi8+PC9kaXY+JztcbiAgICBpZiAoYS5jb25zdGFuY2lhSUlCQilcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXJnaW4tYm90dG9tOjNweDtmb250LXdlaWdodDo3MDA7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+SUlCQjwvZGl2PjxpbWcgc3JjPVwiJyArXG4gICAgICAgIGEuY29uc3RhbmNpYUlJQkIgK1xuICAgICAgICAnXCIgaWQ9XCJjYS1paWJiLWltZ1wiIGNsYXNzPVwidGFzay1pbWctdGh1bWJcIiBzdHlsZT1cIndpZHRoOjkwcHg7aGVpZ2h0OjkwcHhcIiBvbmNsaWNrPVwib3BlbkltZ1ZpZXdlcihcXCdjYS1paWJiLWltZ1xcJylcIi8+PC9kaXY+JztcbiAgICAoYS5mb3Rvc0xvY2FsIHx8IFtdKS5mb3JFYWNoKChmLCBpKSA9PiB7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjlweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bWFyZ2luLWJvdHRvbTozcHg7Zm9udC13ZWlnaHQ6NzAwO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPkxvY2FsICcgK1xuICAgICAgICAoaSArIDEpICtcbiAgICAgICAgJzwvZGl2PjxpbWcgc3JjPVwiJyArXG4gICAgICAgIGYgK1xuICAgICAgICAnXCIgaWQ9XCJjYS1mb3RvLScgK1xuICAgICAgICBpICtcbiAgICAgICAgJ1wiIGNsYXNzPVwidGFzay1pbWctdGh1bWJcIiBzdHlsZT1cIndpZHRoOjkwcHg7aGVpZ2h0OjkwcHhcIiBvbmNsaWNrPVwib3BlbkltZ1ZpZXdlcihcXCdjYS1mb3RvLScgK1xuICAgICAgICBpICtcbiAgICAgICAgJ1xcJylcIi8+PC9kaXY+JztcbiAgICB9KTtcbiAgICBoICs9ICc8L2Rpdj4nO1xuICAgIGggKz1cbiAgICAgICc8aDQgc3R5bGU9XCJmb250LXNpemU6MTJweDtjb2xvcjojMDg5MWIyO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNXB4O21hcmdpbjoxNHB4IDAgOHB4O3BhZGRpbmctYm90dG9tOjVweDtib3JkZXItYm90dG9tOjEuNXB4IHNvbGlkICM2N2U4ZjlcIj5PcmlnZW48L2g0Pic7XG4gICAgaCArPSAnPGRpdj5WZW5kZWRvcjogPGI+JyArIGVzY2FwZUh0bWwoYS5vd25lck5hbWUgfHwgYS5vd25lckVtYWlsIHx8ICctJykgKyAnPC9iPjwvZGl2Pic7XG4gICAgY29uc3QgYXBOID0gYS5hcHByb3ZhbHMgPyBPYmplY3Qua2V5cyhhLmFwcHJvdmFscykubGVuZ3RoIDogMDtcbiAgICBoICs9ICc8ZGl2PkFwcm9iYWNpb25lcyByZWNpYmlkYXM6IDxiPicgKyBhcE4gKyAnIC8gMjwvYj48L2Rpdj4nO1xuICAgIGlmIChhLmFwcHJvdmFscykge1xuICAgICAgT2JqZWN0LmtleXMoYS5hcHByb3ZhbHMpLmZvckVhY2goKHVpZCkgPT4ge1xuICAgICAgICBjb25zdCBhcCA9IGEuYXBwcm92YWxzW3VpZF07XG4gICAgICAgIGggKz1cbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO21hcmdpbi1sZWZ0OjhweFwiPiYjMTAwMDM7ICcgK1xuICAgICAgICAgIGVzY2FwZUh0bWwoYXAuZW1haWwgfHwgdWlkKSArXG4gICAgICAgICAgJzwvZGl2Pic7XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGEuc3RhdHVzID09PSAncmVqZWN0ZWQnKSB7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXItYmcpO2JvcmRlcjoxcHggc29saWQgI2ZjYTVhNTtib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjhweDttYXJnaW4tdG9wOjhweDtjb2xvcjp2YXIoLS1jb2xvci1kYW5nZXItc3Ryb25nKVwiPjxiPlJFQ0hBWkFEQTwvYj4gcG9yICcgK1xuICAgICAgICBlc2NhcGVIdG1sKGEucmVqZWN0ZWRCeUVtYWlsIHx8ICcnKSArXG4gICAgICAgICcuIE1vdGl2bzogJyArXG4gICAgICAgIGVzY2FwZUh0bWwoYS5yZWplY3RlZFJlYXNvbiB8fCAnLScpICtcbiAgICAgICAgJzwvZGl2Pic7XG4gICAgfVxuICAgIC8vIEJsb3F1ZSBkZSBcImRhdG9zIGRlbCBhcHJvYmFkb3JcIiAtIHNvbG8gdmlzaWJsZSBzaSBzb3kgYXByb2JhZG9yIHkgbm9cbiAgICAvLyBkaSBtaSBhcHJvYmFjaW9uIHRvZGF2aWEuIEFjYSBlbCBhcHJvYmFkb3IgY29tcGxldGEgaW5mbyBxdWUgbGFcbiAgICAvLyBzb2xpY2l0dWQgbm8gdHJhZSBkZWwgbGFkbyBkZWwgdmVuZGVkb3I6XG4gICAgLy8gLSBjYXJkQ29kZSBTQVA6IEJQIGEgdXNhciBlbiBwZWRpZG9zIChzaW4gZXN0byBubyBlbnRyYSBlbCBaSVAgRFRXKVxuICAgIC8vIC0gYXNzaWduZWRWZW5kb3I6IHZlbmRvciBxdWUgdmEgYSBhdGVuZGVyIGxhIHRpZW5kYSAoYXBhcmVjZSBlbiBzdSBtYXBhKVxuICAgIC8vIC0gbG9jYWxpZGFkRmluYWw6IHBvciBzaSBsYSBsb2NhbGlkYWQgZGVjbGFyYWRhIG5vIG1hdGNoZWEgY29uIGVsIG1hcGFcbiAgICBjb25zdCBtZUVtYWlsID0gKGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGlBbUFwcHJvdmVyID0gQ0xJRU5UX0FQUExJQ0FUSU9OX0FQUFJPVkVSX0VNQUlMUy5pbmRleE9mKG1lRW1haWwpID49IDA7XG4gICAgY29uc3QgaUFscmVhZHlBcHByb3ZlZCA9IGEuYXBwcm92YWxzICYmIGEuYXBwcm92YWxzW2N1cnJlbnRVc2VyLnVpZF07XG4gICAgaWYgKGEuc3RhdHVzID09PSAncGVuZGluZ19hcHByb3ZhbCcgJiYgaUFtQXBwcm92ZXIgJiYgIWlBbHJlYWR5QXBwcm92ZWQpIHtcbiAgICAgIGNvbnN0IHByZUNhcmRDb2RlID0gYS5jYXJkQ29kZVNhcCB8fCAnJztcbiAgICAgIGNvbnN0IHByZVZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XG4gICAgICBjb25zdCBwcmVMb2MgPSBhLmxvY2FsaWRhZEZpbmFsIHx8IGEubG9jYWxpZGFkIHx8ICcnO1xuICAgICAgaCArPVxuICAgICAgICAnPGg0IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6IzA4OTFiMjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjVweDttYXJnaW46MTRweCAwIDhweDtwYWRkaW5nLWJvdHRvbTo1cHg7Ym9yZGVyLWJvdHRvbToxLjVweCBzb2xpZCAjNjdlOGY5XCI+RGF0b3MgZGVsIGFwcm9iYWRvcjwvaDQ+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmcjtnYXA6OHB4O2JhY2tncm91bmQ6dmFyKC0tYmctc2Vjb25kYXJ5KTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpO2JvcmRlci1yYWRpdXM6NnB4O3BhZGRpbmc6MTJweFwiPic7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2PjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjRweFwiPkNhcmRDb2RlIFNBUCBCMSA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWRhbmdlcilcIj4qPC9zcGFuPjwvbGFiZWw+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxpbnB1dCBpZD1cImNhLWNhcmRjb2RlXCIgdHlwZT1cInRleHRcIiBwbGFjZWhvbGRlcj1cIkMtMTIzNDUgLyBkZWphciB2YWNpbyBzaSB0b2RhdmlhIG5vIHNlIGNyZW8gZWwgQlBcIiB2YWx1ZT1cIicgK1xuICAgICAgICBlc2NhcGVBdHRyKHByZUNhcmRDb2RlKSArXG4gICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo3cHggMTBweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4O2ZvbnQtZmFtaWx5OkNvbnNvbGFzLG1vbm9zcGFjZTtmb250LXdlaWdodDo3MDBcIi8+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjNweFwiPlNpbiBDYXJkQ29kZSBsYSB0aWVuZGEgYXBhcmVjZSBlbiBlbCBtYXBhIHBlcm8gbm8gc2UgcHVlZGUgY3JlYXIgcGVkaWRvIChEVFcgbG8gbmVjZXNpdGEpLjwvZGl2PjwvZGl2Pic7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2PjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjRweFwiPkFzaWduYXIgYSB2ZW5kZWRvciA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWRhbmdlcilcIj4qPC9zcGFuPjwvbGFiZWw+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxzZWxlY3QgaWQ9XCJjYS12ZW5kb3JcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo3cHggMTBweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmctZWxldmF0ZWQpXCI+JztcbiAgICAgIGggKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciB2ZW5kZWRvciAtPC9vcHRpb24+JztcbiAgICAgIGggKz0gJzxvcHRncm91cCBsYWJlbD1cIlZlbmRlZG9yZXMgZXh0ZXJub3MgKFZERSlcIj4nO1xuICAgICAgVkVORE9SUy5maWx0ZXIoKHYpID0+IFZERV9WRU5ET1JfS0VZUy5oYXModi5rZXkpKS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICAgIGNvbnN0IHNlbCA9IHYua2V5ID09PSBwcmVWZW5kb3IgPyAnIHNlbGVjdGVkJyA6ICcnO1xuICAgICAgICBoICs9XG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICBlc2NhcGVBdHRyKHYua2V5KSArXG4gICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgc2VsICtcbiAgICAgICAgICAnPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWwodi56b25lICsgJyAtICcgKyB0aXRsZUNhc2Uodi5rZXkpKSArXG4gICAgICAgICAgJzwvb3B0aW9uPic7XG4gICAgICB9KTtcbiAgICAgIGggKz0gJzwvb3B0Z3JvdXA+JztcbiAgICAgIGggKz0gJzxvcHRncm91cCBsYWJlbD1cIlZlbmRlZG9yZXMgaW50ZXJub3MgKFZESSlcIj4nO1xuICAgICAgVkVORE9SUy5maWx0ZXIoKHYpID0+IFZESV9WRU5ET1JfS0VZUy5oYXModi5rZXkpKS5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICAgIGNvbnN0IHNlbCA9IHYua2V5ID09PSBwcmVWZW5kb3IgPyAnIHNlbGVjdGVkJyA6ICcnO1xuICAgICAgICBoICs9XG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcbiAgICAgICAgICBlc2NhcGVBdHRyKHYua2V5KSArXG4gICAgICAgICAgJ1wiJyArXG4gICAgICAgICAgc2VsICtcbiAgICAgICAgICAnPicgK1xuICAgICAgICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKHYua2V5KSkgK1xuICAgICAgICAgICc8L29wdGlvbj4nO1xuICAgICAgfSk7XG4gICAgICBoICs9ICc8L29wdGdyb3VwPic7XG4gICAgICBoICs9ICc8b3B0Z3JvdXAgbGFiZWw9XCJPdHJhcyBhc2lnbmFjaW9uZXNcIj4nO1xuICAgICAgaCArPVxuICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIl9fRElTVFJJQlVUT1JfX1wiJyArXG4gICAgICAgIChwcmVWZW5kb3IgPT09ICdfX0RJU1RSSUJVVE9SX18nID8gJyBzZWxlY3RlZCcgOiAnJykgK1xuICAgICAgICAnPkRJU1RSSUJVSURPUjwvb3B0aW9uPic7XG4gICAgICBoICs9ICc8L29wdGdyb3VwPic7XG4gICAgICBoICs9ICc8L3NlbGVjdD4nO1xuICAgICAgaCArPVxuICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6M3B4XCI+RWwgdmVuZGVkb3IgZWxlZ2lkbyB2YSBhIHZlciBsYSB0aWVuZGEgZW4gc3UgbWFwYSBwYXJhIGNyZWFyIHBlZGlkb3MuPC9kaXY+PC9kaXY+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXY+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtkaXNwbGF5OmJsb2NrO21hcmdpbi1ib3R0b206NHB4XCI+TG9jYWxpZGFkIGZpbmFsIChjb21vIGFwYXJlY2UgZW4gZWwgbWFwYSk8L2xhYmVsPic7XG4gICAgICBoICs9XG4gICAgICAgICc8aW5wdXQgaWQ9XCJjYS1sb2MtZmluYWxcIiB0eXBlPVwidGV4dFwiIHBsYWNlaG9sZGVyPVwiJyArXG4gICAgICAgIGVzY2FwZUF0dHIoYS5sb2NhbGlkYWQgfHwgJycpICtcbiAgICAgICAgJ1wiIHZhbHVlPVwiJyArXG4gICAgICAgIGVzY2FwZUF0dHIocHJlTG9jKSArXG4gICAgICAgICdcIiBzdHlsZT1cIndpZHRoOjEwMCU7cGFkZGluZzo3cHggMTBweDtib3JkZXI6MS41cHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NXB4O2ZvbnQtc2l6ZToxMnB4XCIvPic7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDozcHhcIj5TaSBsYSBsb2NhbGlkYWQgZGVjbGFyYWRhIHBvciBlbCB2ZW5kZWRvciAoJyArXG4gICAgICAgIGVzY2FwZUh0bWwoYS5sb2NhbGlkYWQgfHwgJy0nKSArXG4gICAgICAgICcpIG5vIG1hdGNoZWEgY29uIGVsIG1hcGEsIGFqdXN0YWxhIGFjYS48L2Rpdj48L2Rpdj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7Z2FwOjEwcHg7bWFyZ2luLXRvcDoxNnB4O3BhZGRpbmctdG9wOjE0cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyLXN1YnRsZSlcIj4nO1xuICAgICAgaCArPVxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cInFtb2RhbC1idG4gcHJpbWFyeVwiIHN0eWxlPVwiZmxleDoxXCIgb25jbGljaz1cImFwcHJvdmVDbGllbnRBcHBsaWNhdGlvbihcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihhcHBJZCkgK1xuICAgICAgICBcIicsJ1wiICtcbiAgICAgICAgZXNjYXBlQXR0cihub3RpZklkIHx8ICcnKSArXG4gICAgICAgICdcXCcpXCI+QXByb2JhcjwvYnV0dG9uPic7XG4gICAgICBoICs9XG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwicW1vZGFsLWJ0biBkYW5nZXJcIiBzdHlsZT1cImZsZXg6MVwiIG9uY2xpY2s9XCJyZWplY3RDbGllbnRBcHBsaWNhdGlvbihcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihhcHBJZCkgK1xuICAgICAgICBcIicsJ1wiICtcbiAgICAgICAgZXNjYXBlQXR0cihub3RpZklkIHx8ICcnKSArXG4gICAgICAgICdcXCcpXCI+UmVjaGF6YXI8L2J1dHRvbj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICB9IGVsc2UgaWYgKGlBbHJlYWR5QXBwcm92ZWQpIHtcbiAgICAgIGggKz1cbiAgICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MtYmcpO2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjhweDttYXJnaW4tdG9wOjE0cHg7Y29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+JiMxMDAwMzsgWWEgYXByb2Jhc3RlIGVzdGEgc29saWNpdHVkPC9kaXY+JztcbiAgICB9XG4gICAgaCArPSAnPC9kaXY+JztcbiAgICBjLmlubmVySFRNTCA9IGg7XG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWRldGFpbC1tb2RhbCcpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ29wZW4gY2xpZW50IGFwcCBkZXRhaWwnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcbndpbmRvdy5jbG9zZUNsaWVudEFwcGxpY2F0aW9uRGV0YWlsID0gZnVuY3Rpb24gKCkge1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2EtZGV0YWlsLW1vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnb3BlbicpO1xufTtcblxud2luZG93LmFwcHJvdmVDbGllbnRBcHBsaWNhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIChhcHBJZCwgbm90aWZJZCkge1xuICAvLyBMZWVyIGxvcyAzIGlucHV0cyBkZWwgYmxvcXVlIFwiRGF0b3MgZGVsIGFwcm9iYWRvclwiIGFudGVzIGRlIGNvbmZpcm1hci5cbiAgLy8gQ2FyZENvZGUgeSB2ZW5kb3Igc29uIG9ibGlnYXRvcmlvczsgbG9jYWxpZGFkRmluYWwgcHVlZGUgcXVlZGFyIHZhY2lhXG4gIC8vIChmYWxsYmFjayBhIGxhIGRlY2xhcmFkYSBwb3IgZWwgdmVuZGVkb3IpLlxuICBjb25zdCBjYXJkQ29kZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWNhcmRjb2RlJyk7XG4gIGNvbnN0IHZlbmRvckVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLXZlbmRvcicpO1xuICBjb25zdCBsb2NGaW5hbEVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWxvYy1maW5hbCcpO1xuICBjb25zdCBjYXJkQ29kZSA9IGNhcmRDb2RlRWwgPyBjYXJkQ29kZUVsLnZhbHVlLnRyaW0oKSA6ICcnO1xuICBjb25zdCBhc3NpZ25lZFZlbmRvciA9IHZlbmRvckVsID8gdmVuZG9yRWwudmFsdWUgOiAnJztcbiAgY29uc3QgbG9jYWxpZGFkRmluYWwgPSBsb2NGaW5hbEVsID8gbG9jRmluYWxFbC52YWx1ZS50cmltKCkgOiAnJztcbiAgaWYgKCFjYXJkQ29kZSkge1xuICAgIGlmIChcbiAgICAgICFjb25maXJtKFxuICAgICAgICAnTm8gY2FyZ2FzdGUgQ2FyZENvZGUgU0FQLiBMYSB0aWVuZGEgdmEgYSBhcGFyZWNlciBlbiBlbCBtYXBhIHBlcm8gTk8gc2UgdmEgYSBwb2RlciBjcmVhciBwZWRpZG8gaGFzdGEgcXVlIHNlIGNhcmd1ZS4gXHUwMEJGQXByb2JhciBpZ3VhbD8nXG4gICAgICApXG4gICAgKVxuICAgICAgcmV0dXJuO1xuICB9XG4gIGlmICghYXNzaWduZWRWZW5kb3IpIHtcbiAgICBhbGVydChcbiAgICAgICdUZW5lcyBxdWUgZWxlZ2lyIHVuIHZlbmRlZG9yIHBhcmEgYXNpZ25hciBsYSB0aWVuZGEuIFNpbiB2ZW5kZWRvciBubyBzZSBzYWJlIGVuIHF1XHUwMEU5IHpvbmEgZGVsIG1hcGEgYXBhcmVjZS4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKCFjb25maXJtKCdDb25maXJtYXIgYXByb2JhY2lvbiBkZSBlc3RhIHNvbGljaXR1ZD8nKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGNvbnN0IHVwZCA9IHt9O1xuICAgIHVwZFsnYXBwcm92YWxzLicgKyBjdXJyZW50VXNlci51aWRdID0ge1xuICAgICAgYXBwcm92ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICBlbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICBuYW1lOiBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSB8fCAnJyxcbiAgICB9O1xuICAgIC8vIEd1YXJkYW1vcyBsb3MgZGF0b3MgZGVsIGFwcm9iYWRvciBlbiBsYSBzb2xpY2l0dWQuIFNpIHlhIGVzdGFiYW5cbiAgICAvLyBjYXJnYWRvcyAob3RybyBhcHJvYmFkb3IgbG9zIGxsZW5vIGFudGVzKSwgbm8gbG9zIHNvYnJlc2NyaWJpbW9zXG4gICAgLy8gYSBtZW5vcyBxdWUgYWhvcmEgc2UgcGFzZW4gdmFsb3JlcyBubyB2YWNpb3MuXG4gICAgaWYgKGNhcmRDb2RlKSB1cGQuY2FyZENvZGVTYXAgPSBjYXJkQ29kZTtcbiAgICBpZiAoYXNzaWduZWRWZW5kb3IpIHVwZC5hc3NpZ25lZFZlbmRvciA9IGFzc2lnbmVkVmVuZG9yO1xuICAgIGlmIChsb2NhbGlkYWRGaW5hbCkgdXBkLmxvY2FsaWRhZEZpbmFsID0gbG9jYWxpZGFkRmluYWw7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS51cGRhdGUodXBkKTtcbiAgICAvLyBSZWxlZXIgcGFyYSBjaGVxdWVhciBzaSBhbWJvcyBhcHJvYmFyb25cbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS5nZXQoKTtcbiAgICBjb25zdCBhID0gc25hcC5kYXRhKCkgfHwge307XG4gICAgY29uc3QgYXBOID0gYS5hcHByb3ZhbHMgPyBPYmplY3Qua2V5cyhhLmFwcHJvdmFscykubGVuZ3RoIDogMDtcbiAgICBpZiAoYXBOID49IDIgJiYgYS5zdGF0dXMgPT09ICdwZW5kaW5nX2FwcHJvdmFsJykge1xuICAgICAgLy8gTWFyY2FyIGNvbW8gYXByb2JhZGEgZGVmaW5pdGl2YW1lbnRlXG4gICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5kb2MoYXBwSWQpLnVwZGF0ZSh7XG4gICAgICAgIHN0YXR1czogJ2FwcHJvdmVkJyxcbiAgICAgICAgYXBwcm92ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICB9KTtcbiAgICAgIC8vIE5vdGlmaWNhciBhbCB2ZW5kZWRvclxuICAgICAgaWYgKGEub3duZXJVaWQpIHtcbiAgICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuYWRkKHtcbiAgICAgICAgICB0eXBlOiAnY2xpZW50X2FwcHJvdmFsX2FjaycsXG4gICAgICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxuICAgICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgICAgZnJvbU5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgIHRhcmdldFVpZDogYS5vd25lclVpZCxcbiAgICAgICAgICB0aXRsZTogJ1NvbGljaXR1ZCBkZSBhbHRhIEFQUk9CQURBJyxcbiAgICAgICAgICBtZXNzYWdlOlxuICAgICAgICAgICAgJ1R1IHNvbGljaXR1ZCBwYXJhIGRhciBkZSBhbHRhIGEgXCInICtcbiAgICAgICAgICAgIChhLmNvbWVyY2lvIHx8ICcnKSArXG4gICAgICAgICAgICAnXCIgZnVlIGFwcm9iYWRhIHBvciBsb3MgMiByZXZpc29yZXMuIFlhIHBvZGVzIGNhcmdhcmxlIHBlZGlkb3MuJyxcbiAgICAgICAgICBhcHBsaWNhdGlvbklkOiBhcHBJZCxcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxuICAgICAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBNYXJjYXIgbGEgbm90aWYgZGVsIGFwcm9iYWRvciBjb21vIGRvbmVcbiAgICBpZiAobm90aWZJZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZmJEYlxuICAgICAgICAgIC5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJylcbiAgICAgICAgICAuZG9jKG5vdGlmSWQpXG4gICAgICAgICAgLnVwZGF0ZSh7IHN0YXR1czogJ2RvbmUnLCBkb25lQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpIH0pO1xuICAgICAgfSBjYXRjaCAoX2UpIHt9XG4gICAgfVxuICAgIHNob3dTeW5jVGFnKFxuICAgICAgYXBOID49IDIgPyAnU29saWNpdHVkIGFwcm9iYWRhIChkZWZpbml0aXZhKScgOiAnQXByb2Jhc3RlLiBGYWx0YSAxIGFwcm9iYWNpb24gbWFzLidcbiAgICApO1xuICAgIGNsb3NlQ2xpZW50QXBwbGljYXRpb25EZXRhaWwoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2FwcHJvdmUnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgYXByb2JhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gIH1cbn07XG5cbndpbmRvdy5yZWplY3RDbGllbnRBcHBsaWNhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIChhcHBJZCwgbm90aWZJZCkge1xuICBjb25zdCByZWFzb24gPSBwcm9tcHQoJ01vdGl2byBkZWwgcmVjaGF6byAoc2Ugbm90aWZpY2EgYWwgdmVuZGVkb3IpOicsICcnKTtcbiAgaWYgKHJlYXNvbiA9PT0gbnVsbCkgcmV0dXJuO1xuICBpZiAoIXJlYXNvbi50cmltKCkpIHtcbiAgICBhbGVydCgnVGVuZXMgcXVlIGluZGljYXIgdW4gbW90aXZvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJylcbiAgICAgIC5kb2MoYXBwSWQpXG4gICAgICAudXBkYXRlKHtcbiAgICAgICAgc3RhdHVzOiAncmVqZWN0ZWQnLFxuICAgICAgICByZWplY3RlZEJ5OiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgIHJlamVjdGVkQnlFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgIHJlamVjdGVkUmVhc29uOiByZWFzb24udHJpbSgpLFxuICAgICAgICByZWplY3RlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgIH0pO1xuICAgIC8vIE5vdGlmaWNhciBhbCB2ZW5kZWRvclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5kb2MoYXBwSWQpLmdldCgpO1xuICAgIGNvbnN0IGEgPSBzbmFwLmRhdGEoKSB8fCB7fTtcbiAgICBpZiAoYS5vd25lclVpZCkge1xuICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuYWRkKHtcbiAgICAgICAgdHlwZTogJ2NsaWVudF9hcHByb3ZhbF9hY2snLFxuICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgIGZyb21OYW1lOiBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSB8fCBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcbiAgICAgICAgdGFyZ2V0VWlkOiBhLm93bmVyVWlkLFxuICAgICAgICB0aXRsZTogJ1NvbGljaXR1ZCBkZSBhbHRhIFJFQ0hBWkFEQScsXG4gICAgICAgIG1lc3NhZ2U6XG4gICAgICAgICAgJ1R1IHNvbGljaXR1ZCBwYXJhIFwiJyArIChhLmNvbWVyY2lvIHx8ICcnKSArICdcIiBmdWUgcmVjaGF6YWRhLlxcbk1vdGl2bzogJyArIHJlYXNvbi50cmltKCksXG4gICAgICAgIGFwcGxpY2F0aW9uSWQ6IGFwcElkLFxuICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxuICAgICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChub3RpZklkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmYkRiXG4gICAgICAgICAgLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKVxuICAgICAgICAgIC5kb2Mobm90aWZJZClcbiAgICAgICAgICAudXBkYXRlKHsgc3RhdHVzOiAnZG9uZScsIGRvbmVBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCkgfSk7XG4gICAgICB9IGNhdGNoIChfZSkge31cbiAgICB9XG4gICAgc2hvd1N5bmNUYWcoJ1NvbGljaXR1ZCByZWNoYXphZGEnKTtcbiAgICBjbG9zZUNsaWVudEFwcGxpY2F0aW9uRGV0YWlsKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdyZWplY3QnLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93LnNldE5vdGlmc1RhYiA9IGZ1bmN0aW9uICh0YWIpIHtcbiAgd2luZG93Lm5vdGlmc1RhYiA9IHRhYjtcbiAgZG9jdW1lbnRcbiAgICAucXVlcnlTZWxlY3RvckFsbCgnLm50YWItYnRuJylcbiAgICAuZm9yRWFjaCgoYikgPT4gYi5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBiLmRhdGFzZXQubnRhYiA9PT0gdGFiKSk7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdub3RpZnMtcGFuZS1yZWNpYmlkYXMnKS5zdHlsZS5kaXNwbGF5ID1cbiAgICB0YWIgPT09ICdyZWNpYmlkYXMnID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdub3RpZnMtcGFuZS1yZWFsaXphZGFzJykuc3R5bGUuZGlzcGxheSA9XG4gICAgdGFiID09PSAncmVhbGl6YWRhcycgPyAnJyA6ICdub25lJztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25vdGlmcy1wYW5lLWNyZWFyJykuc3R5bGUuZGlzcGxheSA9IHRhYiA9PT0gJ2NyZWFyJyA/ICcnIDogJ25vbmUnO1xuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLXBhbmUtZW52aWFkYXMnKS5zdHlsZS5kaXNwbGF5ID0gdGFiID09PSAnZW52aWFkYXMnID8gJycgOiAnbm9uZSc7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdub3RpZnMtZm9vdGVyJykuc3R5bGUuZGlzcGxheSA9IHRhYiA9PT0gJ3JlY2liaWRhcycgPyAnJyA6ICdub25lJztcbiAgaWYgKHRhYiA9PT0gJ3JlY2liaWRhcycpIHJlbmRlck5vdGlmc0xpc3QoKTtcbiAgZWxzZSBpZiAodGFiID09PSAncmVhbGl6YWRhcycpIHJlbmRlck5vdGlmc1JlYWxpemFkYXMoKTtcbiAgZWxzZSBpZiAodGFiID09PSAnZW52aWFkYXMnKSByZW5kZXJNeVNlbnRUYXNrcygpO1xufTtcblxuZnVuY3Rpb24gaXNOb3RpZlBlbmRpbmcobikge1xuICAvLyBQZW5kaWVudGUgPSBubyBsZWlkYSB5IG5vIGNvbXBsZXRhZGEgKHNlZ3VuIHRpcG8pLlxuICByZXR1cm4gbi5zdGF0dXMgIT09ICdyZWFkJyAmJiBuLnN0YXR1cyAhPT0gJ2RvbmUnO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVOb3RpZnNUYWJDb3VudHMoKSB7XG4gIGNvbnN0IHBlbmRpbmcgPSAobXlOb3RpZmljYXRpb25zIHx8IFtdKS5maWx0ZXIoaXNOb3RpZlBlbmRpbmcpLmxlbmd0aDtcbiAgY29uc3QgcmVhbGl6YWRhcyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcigobikgPT4gIWlzTm90aWZQZW5kaW5nKG4pKS5sZW5ndGg7XG4gIGNvbnN0IHJlY0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ250YWItcmVjaWJpZGFzLWNvdW50Jyk7XG4gIGlmIChyZWNFbCkge1xuICAgIHJlY0VsLnRleHRDb250ZW50ID0gcGVuZGluZyA+IDAgPyBwZW5kaW5nIDogJyc7XG4gICAgcmVjRWwuY2xhc3NMaXN0LnRvZ2dsZSgnemVybycsIHBlbmRpbmcgPT09IDApO1xuICB9XG4gIGNvbnN0IHJlYWxFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdudGFiLXJlYWxpemFkYXMtY291bnQnKTtcbiAgaWYgKHJlYWxFbCkge1xuICAgIHJlYWxFbC50ZXh0Q29udGVudCA9IHJlYWxpemFkYXMgPiAwID8gcmVhbGl6YWRhcyA6ICcnO1xuICAgIHJlYWxFbC5jbGFzc0xpc3QudG9nZ2xlKCd6ZXJvJywgcmVhbGl6YWRhcyA9PT0gMCk7XG4gIH1cbiAgLy8gRW52aWFkYXM6IHRhcmVhcyBxdWUgbWFuZGUgeSBxdWUgZXN0YW4gcGVuZGllbnRlcyAobm8gZG9uZSlcbiAgY29uc3QgcGVuZFNlbnQgPSAobXlTZW50VGFza3MgfHwgW10pLmZpbHRlcigodCkgPT4gdC5zdGF0dXMgIT09ICdkb25lJykubGVuZ3RoO1xuICBjb25zdCBzZW50RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbnRhYi1lbnZpYWRhcy1jb3VudCcpO1xuICBpZiAoc2VudEVsKSB7XG4gICAgc2VudEVsLnRleHRDb250ZW50ID0gcGVuZFNlbnQgPiAwID8gcGVuZFNlbnQgOiAnJztcbiAgICBzZW50RWwuY2xhc3NMaXN0LnRvZ2dsZSgnemVybycsIHBlbmRTZW50ID09PSAwKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBmbXROb3RpZkRhdGUobikge1xuICBjb25zdCBkdCA9IG4uY3JlYXRlZEF0XG4gICAgPyBuLmNyZWF0ZWRBdC50b0RhdGVcbiAgICAgID8gbi5jcmVhdGVkQXQudG9EYXRlKClcbiAgICAgIDogbmV3IERhdGUobi5jcmVhdGVkQXQpXG4gICAgOiBudWxsO1xuICByZXR1cm4gZHQgPyBkdC50b0xvY2FsZVN0cmluZygnZXMtQVInKSA6ICcnO1xufVxuXG5mdW5jdGlvbiBub3RpZkl0ZW1IdG1sKG4sIG9wdHMpIHtcbiAgb3B0cyA9IG9wdHMgfHwge307XG4gIGNvbnN0IHR5cGUgPSBuLnR5cGUgfHwgJ2Rlcml2YWNpb24nO1xuICBjb25zdCBpc0Nsb3NlZCA9IG4uc3RhdHVzID09PSAncmVhZCcgfHwgbi5zdGF0dXMgPT09ICdkb25lJztcbiAgY29uc3QgY2xzID0gJ25vdGlmLWl0ZW0gdHlwZS0nICsgdHlwZSArIChpc0Nsb3NlZCA/ICcgcmVhZCcgOiAnJyk7XG4gIGNvbnN0IGR0U3RyID0gZm10Tm90aWZEYXRlKG4pO1xuICBsZXQgaCA9ICc8ZGl2IGNsYXNzPVwiJyArIGNscyArICdcIj4nO1xuICBpZiAodHlwZSA9PT0gJ3Rhc2snKSB7XG4gICAgY29uc3QgZnJvbUxhYmVsID0gbi5mcm9tTmFtZSB8fCBuLmZyb21FbWFpbCB8fCAnQWxndWllbic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stc2VuZGVyXCI+RGUgJyArIGVzY2FwZUh0bWwoZnJvbUxhYmVsKSArICc8L2Rpdj4nO1xuICAgIGNvbnN0IHN0YXR1c1RhZyA9XG4gICAgICBuLnN0YXR1cyA9PT0gJ2RvbmUnXG4gICAgICAgID8gJzxzcGFuIGNsYXNzPVwidGFzay1zdGF0dXMtdGFnIGRvbmVcIj4mIzEwMDAzOyBDb21wbGV0YWRhPC9zcGFuPidcbiAgICAgICAgOiAnPHNwYW4gY2xhc3M9XCJ0YXNrLXN0YXR1cy10YWcgcGVuZGluZ1wiPlBlbmRpZW50ZTwvc3Bhbj4nO1xuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLXRpdGxlXCI+JyArIGVzY2FwZUh0bWwobi50aXRsZSB8fCAnU2luIHRpdHVsbycpICsgc3RhdHVzVGFnICsgJzwvZGl2Pic7XG4gICAgaWYgKG4uZGVzY3JpcHRpb24pIGggKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLWRlc2NcIj4nICsgZXNjYXBlSHRtbChuLmRlc2NyaXB0aW9uKSArICc8L2Rpdj4nO1xuICAgIGlmICgobi5pbWFnZXMgfHwgW10pLmxlbmd0aCkge1xuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cInRhc2staW1nc1wiPic7XG4gICAgICBuLmltYWdlcy5mb3JFYWNoKChpbWcsIGkpID0+IHtcbiAgICAgICAgY29uc3Qgc2FmZSA9IGltZy5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xuICAgICAgICBoICs9XG4gICAgICAgICAgJzxpbWcgc3JjPVwiJyArXG4gICAgICAgICAgc2FmZSArXG4gICAgICAgICAgJ1wiIGNsYXNzPVwidGFzay1pbWctdGh1bWJcIiBvbmNsaWNrPVwib3BlbkltZ1ZpZXdlcihcXCcnICtcbiAgICAgICAgICBlc2NhcGVBdHRyKCd0YXNrLScgKyBuLl9mc0lkICsgJy0nICsgaSkgK1xuICAgICAgICAgICdcXCcpXCIgaWQ9XCJ0YXNrLScgK1xuICAgICAgICAgIG4uX2ZzSWQgK1xuICAgICAgICAgICctJyArXG4gICAgICAgICAgaSArXG4gICAgICAgICAgJ1wiLz4nO1xuICAgICAgfSk7XG4gICAgICBoICs9ICc8L2Rpdj4nO1xuICAgIH1cbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibmZcIj48c3Bhbj4nICsgZXNjYXBlSHRtbChkdFN0cikgKyAnPC9zcGFuPjwvZGl2Pic7XG4gICAgaWYgKG4uc3RhdHVzICE9PSAnZG9uZScgJiYgIW9wdHMucmVhZG9ubHkpIHtcbiAgICAgIGggKz0gJzxkaXYgY2xhc3M9XCJub3RpZi1pdGVtLWFjdGlvbnNcIj4nO1xuICAgICAgaCArPVxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgb25jbGljaz1cImNvbXBsZXRhclRhc2soXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xuICAgICAgICAnXFwnKVwiPk1hcmNhciBjb21vIGNvbXBsZXRhZGE8L2J1dHRvbj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICB9IGVsc2UgaWYgKG4uc3RhdHVzID09PSAnZG9uZScgJiYgbi5kb25lQXQpIHtcbiAgICAgIGNvbnN0IGRhID0gbi5kb25lQXQudG9EYXRlID8gbi5kb25lQXQudG9EYXRlKCkgOiBuZXcgRGF0ZShuLmRvbmVBdCk7XG4gICAgICBoICs9XG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7bWFyZ2luLXRvcDo2cHg7Zm9udC13ZWlnaHQ6NjAwXCI+JiMxMDAwMzsgQ29tcGxldGFkYSBlbCAnICtcbiAgICAgICAgZGEudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgICAnPC9kaXY+JztcbiAgICB9XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3Rhc2tfYWNrJykge1xuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdDb25maXJtYWNpb24gZGUgdGFyZWEnKSArICc8L2g0Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5tXCI+JyArIGVzY2FwZUh0bWwobi5tZXNzYWdlIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJuZlwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWl0ZW0tYWN0aW9uc1wiPic7XG4gICAgICBoICs9XG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwibWFya05vdGlmUmVhZChcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXG4gICAgICAgICdcXCcpXCI+TWFyY2FyIGxlaWRhPC9idXR0b24+JztcbiAgICAgIGggKz0gJzwvZGl2Pic7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdjbGllbnRfYXBwcm92YWwnKSB7XG4gICAgaCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJ0YXNrLXNlbmRlclwiPkRlICcgK1xuICAgICAgZXNjYXBlSHRtbChuLmZyb21OYW1lIHx8IG4uZnJvbUVtYWlsIHx8ICdWZW5kZWRvcicpICtcbiAgICAgICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLXRpdGxlXCI+JyArIGVzY2FwZUh0bWwobi50aXRsZSB8fCAnU29saWNpdHVkIGRlIGFsdGEnKSArICc8L2Rpdj4nO1xuICAgIGlmIChuLmRlc2NyaXB0aW9uKSBoICs9ICc8ZGl2IGNsYXNzPVwidGFzay1kZXNjXCI+JyArIGVzY2FwZUh0bWwobi5kZXNjcmlwdGlvbikgKyAnPC9kaXY+JztcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibmZcIiBzdHlsZT1cIm1hcmdpbi10b3A6NnB4XCI+PHNwYW4+JyArIGVzY2FwZUh0bWwoZHRTdHIpICsgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmIG4uc3RhdHVzICE9PSAnZG9uZScgJiYgIW9wdHMucmVhZG9ubHkpIHtcbiAgICAgIGggKz0gJzxkaXYgY2xhc3M9XCJub3RpZi1pdGVtLWFjdGlvbnNcIj4nO1xuICAgICAgaCArPVxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgb25jbGljaz1cIm9wZW5DbGllbnRBcHBsaWNhdGlvbkRldGFpbChcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihuLmFwcGxpY2F0aW9uSWQgfHwgJycpICtcbiAgICAgICAgXCInLCdcIiArXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMDg5MWIyXCI+VmVyIGRldGFsbGUgeSBkZWNpZGlyPC9idXR0b24+JztcbiAgICAgIGggKz0gJzwvZGl2Pic7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdjbGllbnRfYXBwcm92YWxfYWNrJykge1xuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdTb2xpY2l0dWQgZGUgYWx0YScpICsgJzwvaDQ+JztcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm1cIj4nICsgZXNjYXBlSHRtbChuLm1lc3NhZ2UgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5mXCI+PHNwYW4+JyArIGVzY2FwZUh0bWwoZHRTdHIpICsgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmICFvcHRzLnJlYWRvbmx5KSB7XG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIG9uY2xpY2s9XCJtYXJrTm90aWZSZWFkKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcbiAgICAgICAgJ1xcJylcIj5NYXJjYXIgbGVpZGE8L2J1dHRvbj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICB9XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3JlbmRpY2lvbl9hcHByb3ZhbCcpIHtcbiAgICBoICs9XG4gICAgICAnPGRpdiBjbGFzcz1cInRhc2stc2VuZGVyXCI+RGUgJyArXG4gICAgICBlc2NhcGVIdG1sKG4uZnJvbU5hbWUgfHwgbi5mcm9tRW1haWwgfHwgJ1ZlbmRlZG9yJykgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stdGl0bGVcIj4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdSZW5kaWNpb24gcGVuZGllbnRlJykgKyAnPC9kaXY+JztcbiAgICBpZiAobi5kZXNjcmlwdGlvbikgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stZGVzY1wiPicgKyBlc2NhcGVIdG1sKG4uZGVzY3JpcHRpb24pICsgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5mXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjZweFwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiBuLnN0YXR1cyAhPT0gJ2RvbmUnICYmICFvcHRzLnJlYWRvbmx5KSB7XG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIG9uY2xpY2s9XCJvcGVuUmVuZGljaW9uRGV0YWlsKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKG4ucmVuZGljaW9uSWQgfHwgJycpICtcbiAgICAgICAgXCInLCdcIiArXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xuICAgICAgICAnXFwnKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojYmUxODVkXCI+VmVyIGRldGFsbGUgeSBkZWNpZGlyPC9idXR0b24+JztcbiAgICAgIGggKz0gJzwvZGl2Pic7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdyZW5kaWNpb25fYXBwcm92YWxfYWNrJykge1xuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdSZW5kaWNpb24nKSArICc8L2g0Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5tXCI+JyArIGVzY2FwZUh0bWwobi5tZXNzYWdlIHx8ICcnKSArICc8L2Rpdj4nO1xuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJuZlwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWl0ZW0tYWN0aW9uc1wiPic7XG4gICAgICBoICs9XG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwibWFya05vdGlmUmVhZChcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXG4gICAgICAgICdcXCcpXCI+TWFyY2FyIGxlaWRhPC9idXR0b24+JztcbiAgICAgIGggKz0gJzwvZGl2Pic7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdhdXRvX2NvbmZpcm1fdGltZW91dCcpIHtcbiAgICAvLyB2OTIxICgyMDI2LTA5LTE0KTogcGVkaWRvIHBhc2FkbyBhdXRvbWF0aWNhbWVudGUgZGUgcGVuZGluZyBhIGNvbmZpcm1lZFxuICAgIC8vIHBvciBlbCBDRiBhdXRvQ29uZmlybVBlbmRpbmdQZWRpZG9zQ0YgdHJhcyBOIG1pbiBkZSBpbmFjdGl2aWRhZC4gRWwgVkRFXG4gICAgLy8gdmUgZWwgYWxlcnRhICsgbGluayBhIGxhIGNhcmQgY29uZmlybWFkYSBwYXJhIHJldmlzYXIgZWwgZW52aW8gYSBTQVAuXG4gICAgY29uc3QgbWludXRlcyA9IE51bWJlcihuLm1pbnV0ZXNJblBlbmRpbmcpIHx8IDEwO1xuICAgIGggKz0gJzxoNCBzdHlsZT1cImNvbG9yOiNiNDUzMDlcIj4mIzkyMDA7IFBlZGlkbyBhdXRvLWNvbmZpcm1hZG8gcG9yIHRpbWVvdXQ8L2g0Pic7XG4gICAgaCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJubVwiPlR1IHBlZGlkbyBkZSA8Yj4nICtcbiAgICAgIGVzY2FwZUh0bWwobi5jbGllbnROYW1lIHx8ICdjbGllbnRlJykgK1xuICAgICAgJzwvYj4nICtcbiAgICAgIChuLm1vbnRoID8gJyAoJyArIGVzY2FwZUh0bWwobi5tb250aCkgKyAnKScgOiAnJykgK1xuICAgICAgJyBxdWVkbyA8Yj4nICtcbiAgICAgIG1pbnV0ZXMgK1xuICAgICAgJyBtaW48L2I+IGVuIFBlbmRpZW50ZXMgc2luIGNvbmZpcm1hci4gU2UgcGFzbyBhIENvbmZpcm1hZG9zIGF1dG9tYXRpY2FtZW50ZSB5IHNlIGVudmlvIGEgU0FQLicgK1xuICAgICAgJzwvZGl2Pic7XG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5mXCI+PHNwYW4+JyArIGVzY2FwZUh0bWwoZHRTdHIpICsgJzwvc3Bhbj48L2Rpdj4nO1xuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmICFvcHRzLnJlYWRvbmx5KSB7XG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIG9uY2xpY2s9XCJtYXJrTm90aWZSZWFkKFxcJycgK1xuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcbiAgICAgICAgJ1xcJylcIj5NYXJjYXIgbGVpZGE8L2J1dHRvbj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gZGVyaXZhY2lvblxuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpZW5kYSB8fCAnU2luIHRpZW5kYScpICsgJzwvaDQ+JztcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm1cIj4nICsgZXNjYXBlSHRtbChuLm1lc3NhZ2UgfHwgJycpICsgJzwvZGl2Pic7XG4gICAgaCArPVxuICAgICAgJzxkaXYgY2xhc3M9XCJuZlwiPjxzcGFuPicgK1xuICAgICAgZXNjYXBlSHRtbCgobi5sb2NhbGlkYWQgfHwgJycpICsgJyAmbWlkZG90OyAnICsgKG4ucHJvdmluY2lhIHx8ICcnKSkgK1xuICAgICAgJzwvc3Bhbj48c3Bhbj4nICtcbiAgICAgIGVzY2FwZUh0bWwoZHRTdHIpICtcbiAgICAgICc8L3NwYW4+PC9kaXY+JztcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWl0ZW0tYWN0aW9uc1wiPic7XG4gICAgICBoICs9XG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwiY29udGFjdGFyRGVzZGVOb3RpZihcXCcnICtcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXG4gICAgICAgICdcXCcpXCI+Q29udGFjdGFyPC9idXR0b24+JztcbiAgICAgIGggKz1cbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1iZy1lbGV2YXRlZCk7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItZGVmYXVsdCk7bWFyZ2luLWxlZnQ6NnB4XCIgb25jbGljaz1cIm1hcmtOb3RpZlJlYWQoXFwnJyArXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiU29sbyBtYXJjYXIgY29tbyBsZWlkYSAoc2luIGNhcmdhciB2aXNpdGEpXCI+U29sbyBtYXJjYXIgbGVpZGE8L2J1dHRvbj4nO1xuICAgICAgaCArPSAnPC9kaXY+JztcbiAgICB9XG4gIH1cbiAgLy8gQm90b24gXCJFbGltaW5hclwiIGdlbmVyaWNvIHBhcmEgdG9kYXMgbGFzIG5vdGlmaWNhY2lvbmVzIHJlY2liaWRhc1xuICAvLyAoZXhjZXB0byBtb2RvIHJlYWRvbmx5KS4gTm8gZGVwZW5kZSBkZWwgdGlwbyAtIGN1YWxxdWllciBub3RpZlxuICAvLyBwdWVkZSBib3JyYXJzZSBkZSBsYSBsaXN0YSBwcm9waWEuXG4gIGlmICghb3B0cy5yZWFkb25seSkge1xuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJub3RpZi1pdGVtLWFjdGlvbnNcIiBzdHlsZT1cIm1hcmdpbi10b3A6NnB4O2p1c3RpZnktY29udGVudDpmbGV4LWVuZFwiPic7XG4gICAgaCArPVxuICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIHN0eWxlPVwiYmFja2dyb3VuZDp2YXIoLS1jb2xvci1kYW5nZXItYmcpO2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlci1zdHJvbmcpO2JvcmRlcjoxLjVweCBzb2xpZCAjZmNhNWE1O2ZvbnQtd2VpZ2h0OjcwMFwiIG9uY2xpY2s9XCJkZWxldGVOb3RpZihcXCcnICtcbiAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xuICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGEgbm90aWZpY2FjaW9uXCI+RWxpbWluYXI8L2J1dHRvbj4nO1xuICAgIGggKz0gJzwvZGl2Pic7XG4gIH1cbiAgaCArPSAnPC9kaXY+JztcbiAgcmV0dXJuIGg7XG59XG5cbndpbmRvdy5kZWxldGVOb3RpZiA9IGFzeW5jIGZ1bmN0aW9uIChmc0lkKSB7XG4gIGlmICghZnNJZCkgcmV0dXJuO1xuICBpZiAoIWNvbmZpcm0oJ0VsaW1pbmFyIGVzdGEgbm90aWZpY2FjaW9uPyBObyBzZSBwdWVkZSBkZXNoYWNlci4nKSkgcmV0dXJuO1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmRvYyhmc0lkKS5kZWxldGUoKTtcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnTm90aWZpY2FjaW9uIGVsaW1pbmFkYScpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignZGVsZXRlTm90aWYnLCBlKTtcbiAgICBhbGVydCgnRXJyb3IgZWxpbWluYW5kbyBsYSBub3RpZmljYWNpb246ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcmVuZGVyTm90aWZzTGlzdCgpIHtcbiAgLy8gUmVjaWJpZGFzID0gc29sbyBwZW5kaWVudGVzIChubyByZWFkLCBubyBkb25lKVxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25vdGlmcy1saXN0Jyk7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSAobXlOb3RpZmljYXRpb25zIHx8IFtdKS5maWx0ZXIoaXNOb3RpZlBlbmRpbmcpO1xuICBpZiAoIXBlbmRpZW50ZXMubGVuZ3RoKSB7XG4gICAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWVtcHR5XCI+Tm8gdGVuZXMgYWxlcnRhcyBuaSB0YXJlYXMgcGVuZGllbnRlcy4gPC9kaXY+JztcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gdjMyMSs6IGhlYWRlciBjb24gY29udGFkb3IgKyBib3RvbiBcIk1hcmNhciB0b2RhcyBjb21vIGxlaWRhc1wiIHBhcmFcbiAgLy8gbGltcGlhciBsYSBiYW5kZWphIGRlIHVuYS4gVXRpbCBjdWFuZG8gc2UgYWN1bXVsYW4gMTAwKyBub3RpZnMuXG4gIGNvbnN0IG5QZW5kID0gcGVuZGllbnRlcy5sZW5ndGg7XG4gIGxldCBodG1sID0gJyc7XG4gIGh0bWwgKz1cbiAgICAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtwYWRkaW5nOjhweCAxMHB4O21hcmdpbi1ib3R0b206OHB4O2JhY2tncm91bmQ6dmFyKC0tYmctbXV0ZWQpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyLWRlZmF1bHQpO2JvcmRlci1yYWRpdXM6NnB4XCI+JztcbiAgaHRtbCArPVxuICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2ZvbnQtd2VpZ2h0OjYwMFwiPicgK1xuICAgIG5QZW5kICtcbiAgICAnIHBlbmRpZW50ZScgK1xuICAgIChuUGVuZCA9PT0gMSA/ICcnIDogJ3MnKSArXG4gICAgJzwvZGl2Pic7XG4gIGh0bWwgKz1cbiAgICAnPGJ1dHRvbiBvbmNsaWNrPVwibWFya0FsbE5vdGlmc1JlYWQoKVwiIHN0eWxlPVwiYmFja2dyb3VuZDojMGQ5NDg4O2NvbG9yOiNmZmY7Ym9yZGVyOm5vbmU7cGFkZGluZzo3cHggMTJweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo4MDA7Ym9yZGVyLXJhZGl1czo1cHg7Y3Vyc29yOnBvaW50ZXI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi4zcHg7d2hpdGUtc3BhY2U6bm93cmFwXCI+JiMxMDAwMzsgTWFyY2FyIHRvZGFzIGNvbW8gbGVpZGFzPC9idXR0b24+JztcbiAgaHRtbCArPSAnPC9kaXY+JztcbiAgaHRtbCArPSBwZW5kaWVudGVzLm1hcCgobikgPT4gbm90aWZJdGVtSHRtbChuKSkuam9pbignJyk7XG4gIGNvbnQuaW5uZXJIVE1MID0gaHRtbDtcbn1cblxuLy8gdjMyMSs6IGJ1bGsgbWFyay1hcy1yZWFkLiBVc2Egd3JpdGVCYXRjaCBkZSBGaXJlc3RvcmUgKG1heCA1MDAgb3BzKS5cbi8vIExvb3AgZGUgYmF0Y2hlcyBkZSA0MDAgcGFyYSB0ZW5lciBtYXJnZW4uIENvbmZpcm1hIGFudGVzIHBvciBzaSBlbFxuLy8gdXNlciBhcHJpZXRhIHBvciBhY2NpZGVudGUgKDI4MCBub3RpZnMgZXMgbXVjaG8gcGFyYSBkZXNoYWNlcikuXG53aW5kb3cubWFya0FsbE5vdGlmc1JlYWQgPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHBlbmRpZW50ZXMgPSAobXlOb3RpZmljYXRpb25zIHx8IFtdKS5maWx0ZXIoaXNOb3RpZlBlbmRpbmcpO1xuICBpZiAoIXBlbmRpZW50ZXMubGVuZ3RoKSB7XG4gICAgYWxlcnQoJ05vIGhheSBub3RpZmljYWNpb25lcyBwZW5kaWVudGVzLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuID0gcGVuZGllbnRlcy5sZW5ndGg7XG4gIGlmIChcbiAgICAhY29uZmlybShcbiAgICAgICdNYXJjYXIgJyArXG4gICAgICAgIG4gK1xuICAgICAgICAnIG5vdGlmaWNhY2lvbicgK1xuICAgICAgICAobiA9PT0gMSA/ICcnIDogJ2VzJykgK1xuICAgICAgICAnIGNvbW8gbGVpZGEnICtcbiAgICAgICAgKG4gPT09IDEgPyAnJyA6ICdzJykgK1xuICAgICAgICAnP1xcblxcbkVzdGEgYWNjaW9uIG5vIHNlIHB1ZWRlIGRlc2hhY2VyIG1hc2l2YW1lbnRlIChwb2RyaWFzIHJlLWFicmlyIGNhZGEgdW5hIG1hbnVhbCBkZXNkZSBSZWFsaXphZGFzKS4nXG4gICAgKVxuICApXG4gICAgcmV0dXJuO1xuICBjb25zdCBidG4gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjbm90aWZzLWxpc3QgYnV0dG9uW29uY2xpY2sqPVwibWFya0FsbE5vdGlmc1JlYWRcIl0nKTtcbiAgaWYgKGJ0bikge1xuICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gICAgYnRuLnRleHRDb250ZW50ID0gJ01hcmNhbmRvLi4uJztcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IENIVU5LID0gNDAwOyAvLyBtYXJnZW4gc29icmUgZWwgbGltaXRlIGRlIDUwMFxuICAgIGxldCBvayA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwZW5kaWVudGVzLmxlbmd0aDsgaSArPSBDSFVOSykge1xuICAgICAgY29uc3Qgc2xpY2UgPSBwZW5kaWVudGVzLnNsaWNlKGksIGkgKyBDSFVOSyk7XG4gICAgICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcbiAgICAgIHNsaWNlLmZvckVhY2goKG4pID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuZG9jKG4uX2ZzSWQpO1xuICAgICAgICBiYXRjaC51cGRhdGUocmVmLCB7XG4gICAgICAgICAgc3RhdHVzOiAncmVhZCcsXG4gICAgICAgICAgcmVhZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IGJhdGNoLmNvbW1pdCgpO1xuICAgICAgb2sgKz0gc2xpY2UubGVuZ3RoO1xuICAgIH1cbiAgICBzaG93U3luY1RhZyhvayArICcgbm90aWZpY2FjaW9uZXMgbWFyY2FkYXMgY29tbyBsZWlkYXMnKTtcbiAgICAvLyBFbCBsaXN0ZW5lciBvblNuYXBzaG90IHJlcGludGEgYWwgdG9xdWUgY3VhbmRvIGxsZWdhbiBsb3MgdXBkYXRlcy5cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ21hcmtBbGxOb3RpZnNSZWFkJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIG1hcmNhbmRvIG5vdGlmaWNhY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnTWFyY2FyIHRvZGFzIGNvbW8gbGVpZGFzJztcbiAgICB9XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHJlbmRlck5vdGlmc1JlYWxpemFkYXMoKSB7XG4gIC8vIFJlYWxpemFkYXMgPSB5YSBjZXJyYWRhcyAocmVhZCBvIGRvbmUpLiBTb2xvIGxlY3R1cmEuXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLXJlYWxpemFkYXMtbGlzdCcpO1xuICBjb25zdCBjZXJyYWRhcyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcigobikgPT4gIWlzTm90aWZQZW5kaW5nKG4pKTtcbiAgaWYgKCFjZXJyYWRhcy5sZW5ndGgpIHtcbiAgICBjb250LmlubmVySFRNTCA9XG4gICAgICAnPGRpdiBjbGFzcz1cIm5vdGlmLWVtcHR5XCI+QWNhIHZhbiBhIGFwYXJlY2VyIGxhcyBhbGVydGFzIHkgdGFyZWFzIHF1ZSB5YSBjZXJyYXN0ZS48L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICBjb250LmlubmVySFRNTCA9IGNlcnJhZGFzLm1hcCgobikgPT4gbm90aWZJdGVtSHRtbChuLCB7IHJlYWRvbmx5OiB0cnVlIH0pKS5qb2luKCcnKTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTXlTZW50VGFza3MoKSB7XG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLXNlbnQtbGlzdCcpO1xuICBpZiAoIW15U2VudFRhc2tzLmxlbmd0aCkge1xuICAgIGNvbnQuaW5uZXJIVE1MID1cbiAgICAgICc8ZGl2IGNsYXNzPVwibm90aWYtZW1wdHlcIj5ObyBlbnZpYXN0ZSB0YXJlYXMgdG9kYXZpYS4gVXNcdTAwRTEgbGEgcGVzdGFcdTAwRjFhIDxiPkNyZWFyIHRhcmVhPC9iPi48L2Rpdj4nO1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgaHRtbCA9ICcnO1xuICBteVNlbnRUYXNrcy5mb3JFYWNoKChuKSA9PiB7XG4gICAgY29uc3QgaXNEb25lID0gbi5zdGF0dXMgPT09ICdkb25lJztcbiAgICBjb25zdCBjbHMgPSAnbm90aWYtaXRlbSB0eXBlLXRhc2snICsgKGlzRG9uZSA/ICcgcmVhZCcgOiAnJyk7XG4gICAgY29uc3QgZHRTdHIgPSBmbXROb3RpZkRhdGUobik7XG4gICAgY29uc3QgdGFyZ2V0TGFiZWwgPSBuLnRhcmdldE5hbWUgfHwgbi50YXJnZXRFbWFpbCB8fCBuLnRhcmdldFVpZCB8fCAnQWxndWllbic7XG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCI+JztcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwidGFzay1zZW5kZXJcIj5QYXJhICcgKyBlc2NhcGVIdG1sKHRhcmdldExhYmVsKSArICc8L2Rpdj4nO1xuICAgIGNvbnN0IHN0YXR1c1RhZyA9IGlzRG9uZVxuICAgICAgPyAnPHNwYW4gY2xhc3M9XCJ0YXNrLXN0YXR1cy10YWcgZG9uZVwiPiYjMTAwMDM7IENvbXBsZXRhZGE8L3NwYW4+J1xuICAgICAgOiAnPHNwYW4gY2xhc3M9XCJ0YXNrLXN0YXR1cy10YWcgcGVuZGluZ1wiPlBlbmRpZW50ZTwvc3Bhbj4nO1xuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLXRpdGxlXCI+JyArIGVzY2FwZUh0bWwobi50aXRsZSB8fCAnU2luIHRpdHVsbycpICsgc3RhdHVzVGFnICsgJzwvZGl2Pic7XG4gICAgaWYgKG4uZGVzY3JpcHRpb24pIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLWRlc2NcIj4nICsgZXNjYXBlSHRtbChuLmRlc2NyaXB0aW9uKSArICc8L2Rpdj4nO1xuICAgIGlmICgobi5pbWFnZXMgfHwgW10pLmxlbmd0aCkge1xuICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInRhc2staW1nc1wiPic7XG4gICAgICBuLmltYWdlcy5mb3JFYWNoKChpbWcsIGkpID0+IHtcbiAgICAgICAgY29uc3Qgc2FmZSA9IGltZy5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xuICAgICAgICBodG1sICs9XG4gICAgICAgICAgJzxpbWcgc3JjPVwiJyArXG4gICAgICAgICAgc2FmZSArXG4gICAgICAgICAgJ1wiIGNsYXNzPVwidGFzay1pbWctdGh1bWJcIiBvbmNsaWNrPVwib3BlbkltZ1ZpZXdlcihcXCcnICtcbiAgICAgICAgICBlc2NhcGVBdHRyKCdzZW50LScgKyBuLl9mc0lkICsgJy0nICsgaSkgK1xuICAgICAgICAgICdcXCcpXCIgaWQ9XCJzZW50LScgK1xuICAgICAgICAgIG4uX2ZzSWQgK1xuICAgICAgICAgICctJyArXG4gICAgICAgICAgaSArXG4gICAgICAgICAgJ1wiLz4nO1xuICAgICAgfSk7XG4gICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgIH1cbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibmZcIj48c3Bhbj4nICsgZXNjYXBlSHRtbChkdFN0cikgKyAnPC9zcGFuPic7XG4gICAgaWYgKGlzRG9uZSAmJiBuLmRvbmVBdCkge1xuICAgICAgY29uc3QgZGEgPSBuLmRvbmVBdC50b0RhdGUgPyBuLmRvbmVBdC50b0RhdGUoKSA6IG5ldyBEYXRlKG4uZG9uZUF0KTtcbiAgICAgIGh0bWwgKz1cbiAgICAgICAgJzxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7Zm9udC13ZWlnaHQ6NzAwXCI+JiMxMDAwMzsgTWFyY2FkYSAnICtcbiAgICAgICAgZGEudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgK1xuICAgICAgICAnPC9zcGFuPic7XG4gICAgfVxuICAgIGh0bWwgKz0gJzwvZGl2PjwvZGl2Pic7XG4gIH0pO1xuICBjb250LmlubmVySFRNTCA9IGh0bWw7XG59XG5cbi8vID09PSBJbWFnZSB2aWV3ZXIgKG1vZGFsIGZ1bGxzY3JlZW4pID09PVxud2luZG93Lm9wZW5JbWdWaWV3ZXIgPSBmdW5jdGlvbiAodGh1bWJJZCkge1xuICBjb25zdCB0aHVtYiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHRodW1iSWQpO1xuICBpZiAoIXRodW1iKSByZXR1cm47XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbWctdmlld2VyLWltZycpLnNyYyA9IHRodW1iLnNyYztcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ltZy12aWV3ZXItb3ZlcmxheScpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcbn07XG53aW5kb3cuY2xvc2VJbWdWaWV3ZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbWctdmlld2VyLW92ZXJsYXknKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XG59O1xuXG4vLyA9PT0gVGFyZWE6IHBvYmxhciBkZXN0aW5hdGFyaW8sIG1hbmVqYXIgaW1hZ2VuZXMsIGVudmlhciA9PT1cbi8vIElNUE9SVEFOVEU6IEZpcmVzdG9yZSBSdWxlcyBibG9xdWVhbiBhIHZlbmRlZG9yZXMgZGUgbGlzdGFyIC9yb2xlc1xuLy8gKHNvbG8gcHVlZGVuIGxlZXIgc3UgcHJvcGlvIGRvYykuIFBhcmEgcXVlIGVsIGRyb3Bkb3duIGRlIGRlc3RpbmF0YXJpb3Ncbi8vIGZ1bmNpb25lIHBhcmEgdG9kb3MgbG9zIHJvbGVzLCBsZWVtb3MgZGUgYXBwX2NvbmZpZy91c2Vyc19kaXJlY3Rvcnlcbi8vICh1biBtYXBhIHB1YmxpY28gcXVlIGVsIGFkbWluIG1hbnRpZW5lIHNpbmNyb25pemFkbykuIFNpIGVzYSBmdWVudGVcbi8vIG5vIGV4aXN0ZSB0b2RhdmlhLCBmYWxsYmFjayBhIC9yb2xlcyAoYWRtaW4gLyB2aWV3ZXIgc2kgZnVuY2lvbmFuKS5cbmZ1bmN0aW9uIHBvcHVsYXRlVGFza1RhcmdldFNlbGVjdCgpIHtcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stdGFyZ2V0Jyk7XG4gIGlmICghc2VsKSByZXR1cm47XG4gIGZ1bmN0aW9uIHJlbmRlckZyb21NYXAodXNlcnNNYXApIHtcbiAgICBjb25zdCBvcHRzID0gWyc8b3B0aW9uIHZhbHVlPVwiXCI+U2VsZWNjaW9uYXIuLi48L29wdGlvbj4nXTtcbiAgICBPYmplY3QuZW50cmllcyh1c2Vyc01hcCB8fCB7fSkuZm9yRWFjaCgoW3VpZCwgdV0pID0+IHtcbiAgICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkgcmV0dXJuO1xuICAgICAgaWYgKCF1IHx8ICF1LnJvbGUgfHwgdS5yb2xlID09PSAndW5hc3NpZ25lZCcpIHJldHVybjtcbiAgICAgIGNvbnN0IGxhYmVsID0gKHUuZGlzcGxheU5hbWUgfHwgdS5lbWFpbCB8fCB1aWQpICsgJyBcdTAwQjcgJyArICh1LnJvbGUgfHwgJycpO1xuICAgICAgb3B0cy5wdXNoKFxuICAgICAgICAnPG9wdGlvbiB2YWx1ZT1cIicgK1xuICAgICAgICAgIGVzY2FwZUF0dHIodWlkKSArXG4gICAgICAgICAgJ1wiIGRhdGEtZW1haWw9XCInICtcbiAgICAgICAgICBlc2NhcGVBdHRyKHUuZW1haWwgfHwgJycpICtcbiAgICAgICAgICAnXCIgZGF0YS1uYW1lPVwiJyArXG4gICAgICAgICAgZXNjYXBlQXR0cih1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgJycpICtcbiAgICAgICAgICAnXCI+JyArXG4gICAgICAgICAgZXNjYXBlSHRtbChsYWJlbCkgK1xuICAgICAgICAgICc8L29wdGlvbj4nXG4gICAgICApO1xuICAgIH0pO1xuICAgIHNlbC5pbm5lckhUTUwgPSBvcHRzLmpvaW4oJycpO1xuICB9XG4gIC8vIEludGVudG8gcHJpbmNpcGFsOiBkaXJlY3RvcmlvIHB1YmxpY28gbWFudGVuaWRvIHBvciBhZG1pbi5cbiAgZmJEYlxuICAgIC5jb2xsZWN0aW9uKCdhcHBfY29uZmlnJylcbiAgICAuZG9jKCd1c2Vyc19kaXJlY3RvcnknKVxuICAgIC5nZXQoKVxuICAgIC50aGVuKChzbmFwKSA9PiB7XG4gICAgICBpZiAoc25hcC5leGlzdHMgJiYgc25hcC5kYXRhKCkgJiYgc25hcC5kYXRhKCkudXNlcnMpIHtcbiAgICAgICAgcmVuZGVyRnJvbU1hcChzbmFwLmRhdGEoKS51c2Vycyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIEZhbGxiYWNrOiBsZWVyIC9yb2xlcyBkaXJlY3RhbWVudGUgKGZ1bmNpb25hIHBhcmEgYWRtaW4vdmlld2VyXG4gICAgICAvLyBwZXJvIE5PIHBhcmEgdmVuZGVkb3IgcG9yIHNlY3VyaXR5IHJ1bGVzKS5cbiAgICAgIGZiRGJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcbiAgICAgICAgLmdldCgpXG4gICAgICAgIC50aGVuKChxcykgPT4ge1xuICAgICAgICAgIGNvbnN0IHVzZXJzTWFwID0ge307XG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xuICAgICAgICAgICAgdXNlcnNNYXBbZC5pZF0gPSBkLmRhdGEoKSB8fCB7fTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZW5kZXJGcm9tTWFwKHVzZXJzTWFwKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICAgICAgY29uc29sZS53YXJuKCdwb3B1bGF0ZSB0YXNrIHRhcmdldCAtIHNpbiAvcm9sZXMgbmkgdXNlcnNfZGlyZWN0b3J5OicsIGUpO1xuICAgICAgICAgIHNlbC5pbm5lckhUTUwgPVxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj5TZWxlY2Npb25hci4uLiAoc2luIHVzdWFyaW9zIGRpc3BvbmlibGVzLCBwZWRpbGUgYWwgYWRtaW4gcXVlIGVudHJlIDEgdmV6IGFsIFBhbmVsIFVzdWFyaW9zKTwvb3B0aW9uPic7XG4gICAgICAgIH0pO1xuICAgIH0pXG4gICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICBjb25zb2xlLndhcm4oJ3BvcHVsYXRlIHRhc2sgdGFyZ2V0IC0gZmFsbGJhY2sgYSAvcm9sZXM6JywgZSk7XG4gICAgICBmYkRiXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXG4gICAgICAgIC5nZXQoKVxuICAgICAgICAudGhlbigocXMpID0+IHtcbiAgICAgICAgICBjb25zdCB1c2Vyc01hcCA9IHt9O1xuICAgICAgICAgIHFzLmZvckVhY2goKGQpID0+IHtcbiAgICAgICAgICAgIHVzZXJzTWFwW2QuaWRdID0gZC5kYXRhKCkgfHwge307XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmVuZGVyRnJvbU1hcCh1c2Vyc01hcCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgc2VsLmlubmVySFRNTCA9ICc8b3B0aW9uIHZhbHVlPVwiXCI+U2VsZWNjaW9uYXIuLi4gKHNpbiB1c3VhcmlvcyBkaXNwb25pYmxlcyk8L29wdGlvbj4nO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuLy8gQWRtaW4gc29sbzogc2luY3Jvbml6YXIgZWwgZGlyZWN0b3JpbyBwdWJsaWNvIGEgcGFydGlyIGRlbCB1c2Vyc0NhY2hlXG4vLyBxdWUgc2UgY2FyZ2EgZW4gb3BlbkFkbWluUGFuZWwuIExvcyBkZW1hcyByb2xlcyBsbyBsZWVuIHBhcmEgcG9ibGFyXG4vLyBlbCBkcm9wZG93biBkZSBkZXN0aW5hdGFyaW9zIGRlIHRhcmVhcy5cbmZ1bmN0aW9uIHN5bmNVc2Vyc0RpcmVjdG9yeSgpIHtcbiAgaWYgKHVzZXJSb2xlICE9PSAnYWRtaW4nKSByZXR1cm47XG4gIGlmICghQXJyYXkuaXNBcnJheSh1c2Vyc0NhY2hlKSB8fCAhdXNlcnNDYWNoZS5sZW5ndGgpIHJldHVybjtcbiAgY29uc3QgZGlyID0ge307XG4gIHVzZXJzQ2FjaGUuZm9yRWFjaCgodSkgPT4ge1xuICAgIGlmICghdSB8fCAhdS5fdWlkKSByZXR1cm47XG4gICAgaWYgKCF1LnJvbGUgfHwgdS5yb2xlID09PSAndW5hc3NpZ25lZCcpIHJldHVybjtcbiAgICBkaXJbdS5fdWlkXSA9IHtcbiAgICAgIGVtYWlsOiB1LmVtYWlsIHx8ICcnLFxuICAgICAgZGlzcGxheU5hbWU6IHUuZGlzcGxheU5hbWUgfHwgJycsXG4gICAgICByb2xlOiB1LnJvbGUsXG4gICAgfTtcbiAgfSk7XG4gIGZiRGJcbiAgICAuY29sbGVjdGlvbignYXBwX2NvbmZpZycpXG4gICAgLmRvYygndXNlcnNfZGlyZWN0b3J5JylcbiAgICAuc2V0KFxuICAgICAge1xuICAgICAgICB1c2VyczogZGlyLFxuICAgICAgICB1cGRhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgICB1cGRhdGVkQnk6IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJycsXG4gICAgICAgIHVzZXJDb3VudDogT2JqZWN0LmtleXMoZGlyKS5sZW5ndGgsXG4gICAgICB9LFxuICAgICAgeyBtZXJnZTogdHJ1ZSB9XG4gICAgKVxuICAgIC50aGVuKCgpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKCdbdXNlcnNfZGlyZWN0b3J5XSBzaW5jcm9uaXphZG86JywgT2JqZWN0LmtleXMoZGlyKS5sZW5ndGgsICd1c3VhcmlvcycpO1xuICAgIH0pXG4gICAgLmNhdGNoKChlKSA9PiBjb25zb2xlLndhcm4oJ3N5bmNVc2Vyc0RpcmVjdG9yeSBlcnJvcjonLCBlKSk7XG59XG53aW5kb3cuc3luY1VzZXJzRGlyZWN0b3J5ID0gc3luY1VzZXJzRGlyZWN0b3J5O1xuXG53aW5kb3cub25UYXNrSW1hZ2VJbnB1dCA9IGFzeW5jIGZ1bmN0aW9uIChpbnB1dCkge1xuICBjb25zdCBmaWxlcyA9IFsuLi4oaW5wdXQuZmlsZXMgfHwgW10pXTtcbiAgZm9yIChjb25zdCBmIG9mIGZpbGVzKSB7XG4gICAgaWYgKHRhc2tGb3JtSW1hZ2VzLmxlbmd0aCA+PSA1KSB7XG4gICAgICBhbGVydCgnTWF4aW1vIDUgaW1hZ2VuZXMgcG9yIHRhcmVhLicpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBiNjQgPSBhd2FpdCBjb21wcmVzc0ltYWdlKGYsIDEyMDAsIDAuNzUpO1xuICAgICAgdGFza0Zvcm1JbWFnZXMucHVzaChiNjQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignY29tcHJlc3MgdGFzayBpbWcnLCBlKTtcbiAgICB9XG4gIH1cbiAgaW5wdXQudmFsdWUgPSAnJztcbiAgcmVmcmVzaFRhc2tJbWFnZUdyaWQoKTtcbn07XG5cbndpbmRvdy5yZW1vdmVUYXNrRm9ybUltYWdlID0gZnVuY3Rpb24gKGlkeCkge1xuICB0YXNrRm9ybUltYWdlcy5zcGxpY2UoaWR4LCAxKTtcbiAgcmVmcmVzaFRhc2tJbWFnZUdyaWQoKTtcbn07XG5cbmZ1bmN0aW9uIHJlZnJlc2hUYXNrSW1hZ2VHcmlkKCkge1xuICBjb25zdCBncmlkID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2staW1nLWdyaWQnKTtcbiAgaWYgKCFncmlkKSByZXR1cm47XG4gIGNvbnN0IGNlbGxzID0gdGFza0Zvcm1JbWFnZXNcbiAgICAubWFwKFxuICAgICAgKGI2NCwgaSkgPT5cbiAgICAgICAgJzxkaXYgY2xhc3M9XCJwaG90by1jZWxsXCI+PGltZyBzcmM9XCInICtcbiAgICAgICAgYjY0ICtcbiAgICAgICAgJ1wiLz48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInJtXCIgb25jbGljaz1cInJlbW92ZVRhc2tGb3JtSW1hZ2UoJyArXG4gICAgICAgIGkgK1xuICAgICAgICAnKVwiPiZ0aW1lczs8L2J1dHRvbj48L2Rpdj4nXG4gICAgKVxuICAgIC5qb2luKCcnKTtcbiAgY29uc3QgYWRkQ2VsbCA9XG4gICAgdGFza0Zvcm1JbWFnZXMubGVuZ3RoIDwgNVxuICAgICAgPyAnPGxhYmVsIGNsYXNzPVwicGhvdG8tY2VsbCBhZGRcIj48aW5wdXQgdHlwZT1cImZpbGVcIiBhY2NlcHQ9XCJpbWFnZS8qXCIgbXVsdGlwbGUgb25jaGFuZ2U9XCJvblRhc2tJbWFnZUlucHV0KHRoaXMpXCIvPis8L2xhYmVsPidcbiAgICAgIDogJyc7XG4gIGdyaWQuaW5uZXJIVE1MID0gY2VsbHMgKyBhZGRDZWxsO1xufVxuXG53aW5kb3cuc2VuZFRhc2tOb3RpZmljYXRpb24gPSBhc3luYyBmdW5jdGlvbiAoKSB7XG4gIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0YXNrLXRhcmdldCcpO1xuICBjb25zdCB0YXJnZXRVaWQgPSBzZWwudmFsdWU7XG4gIGlmICghdGFyZ2V0VWlkKSB7XG4gICAgYWxlcnQoJ0VsZWdpIHVuIGRlc3RpbmF0YXJpby4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgb3B0ID0gc2VsLm9wdGlvbnNbc2VsLnNlbGVjdGVkSW5kZXhdO1xuICBjb25zdCB0YXJnZXRFbWFpbCA9IG9wdC5kYXRhc2V0LmVtYWlsIHx8ICcnO1xuICBjb25zdCB0YXJnZXROYW1lID0gb3B0LmRhdGFzZXQubmFtZSB8fCB0YXJnZXRFbWFpbDtcbiAgY29uc3QgdGl0bGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stdGl0bGUnKS52YWx1ZSB8fCAnJykudHJpbSgpO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndGFzay1kZXNjcmlwdGlvbicpLnZhbHVlIHx8ICcnKS50cmltKCk7XG4gIGlmICghdGl0bGUpIHtcbiAgICBhbGVydCgnRmFsdGEgZWwgdGl0dWxvLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIWRlc2NyaXB0aW9uKSB7XG4gICAgYWxlcnQoJ0ZhbHRhIGxhIGRlc2NyaXBjaW9uLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBidG4gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjbm90aWZzLXBhbmUtY3JlYXIgLnFtb2RhbC1idG4ucHJpbWFyeScpO1xuICBpZiAoYnRuKSB7XG4gICAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFuZG8uLi4nO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuYWRkKHtcbiAgICAgIHR5cGU6ICd0YXNrJyxcbiAgICAgIGZyb21VaWQ6IGN1cnJlbnRVc2VyLnVpZCxcbiAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICBmcm9tTmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICB0YXJnZXRVaWQ6IHRhcmdldFVpZCxcbiAgICAgIHRhcmdldEVtYWlsOiB0YXJnZXRFbWFpbCxcbiAgICAgIHRhcmdldE5hbWU6IHRhcmdldE5hbWUsXG4gICAgICB0aXRsZTogdGl0bGUsXG4gICAgICBkZXNjcmlwdGlvbjogZGVzY3JpcHRpb24sXG4gICAgICBpbWFnZXM6IHRhc2tGb3JtSW1hZ2VzLnNsaWNlKCksXG4gICAgICBzdGF0dXM6ICd1bnJlYWQnLFxuICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcbiAgICB9KTtcbiAgICAvLyBMaW1waWFyIGZvcm1cbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndGFzay10aXRsZScpLnZhbHVlID0gJyc7XG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stZGVzY3JpcHRpb24nKS52YWx1ZSA9ICcnO1xuICAgIHRhc2tGb3JtSW1hZ2VzID0gW107XG4gICAgcmVmcmVzaFRhc2tJbWFnZUdyaWQoKTtcbiAgICBzZWwudmFsdWUgPSAnJztcbiAgICBpZiAoYnRuKSB7XG4gICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICAgIGJ0bi50ZXh0Q29udGVudCA9ICdFbnZpYXIgdGFyZWEnO1xuICAgIH1cbiAgICBzaG93U3luY1RhZygnVGFyZWEgZW52aWFkYSBhICcgKyAodGFyZ2V0TmFtZSB8fCAnZGVzdGluYXRhcmlvJykpO1xuICAgIHNldE5vdGlmc1RhYignZW52aWFkYXMnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ3NlbmRUYXNrTm90aWZpY2F0aW9uJywgZSk7XG4gICAgYWxlcnQoJ0Vycm9yIGVudmlhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XG4gICAgaWYgKGJ0bikge1xuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFyIHRhcmVhJztcbiAgICB9XG4gIH1cbn07XG5cbndpbmRvdy5jb21wbGV0YXJUYXNrID0gYXN5bmMgZnVuY3Rpb24gKG5vdGlmSWQpIHtcbiAgaWYgKCFjb25maXJtKCdNYXJjYXIgbGEgdGFyZWEgY29tbyBjb21wbGV0YWRhPyBMZSB2YSBhIGxsZWdhciB1biBhdmlzbyBhbCBxdWUgbGEgZW52aW8uJykpIHJldHVybjtcbiAgY29uc3QgbiA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbmQoKHgpID0+IHguX2ZzSWQgPT09IG5vdGlmSWQpO1xuICBpZiAoIW4pIHtcbiAgICBhbGVydCgnVGFyZWEgbm8gZW5jb250cmFkYS4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICAvLyAxKSBVcGRhdGUgZGUgbGEgdGFyZWE6IHN0YXR1cyBkb25lXG4gICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuZG9jKG5vdGlmSWQpLnVwZGF0ZSh7XG4gICAgICBzdGF0dXM6ICdkb25lJyxcbiAgICAgIGRvbmVBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgfSk7XG4gICAgLy8gMikgTm90aWZpY2FjaW9uIGRlIEFDSyBhbCBxdWUgbGEgZW52aW8gKHNpIG5vIHNveSBlbCBtaXNtbywgcXVlIG5vIGRlYmVyaWEpXG4gICAgaWYgKG4uZnJvbVVpZCAmJiBuLmZyb21VaWQgIT09IGN1cnJlbnRVc2VyLnVpZCkge1xuICAgICAgY29uc3QgbXlOYW1lID0gY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJ2VsIGRlc3RpbmF0YXJpbyc7XG4gICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5hZGQoe1xuICAgICAgICB0eXBlOiAndGFza19hY2snLFxuICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXG4gICAgICAgIGZyb21OYW1lOiBteU5hbWUsXG4gICAgICAgIHRhcmdldFVpZDogbi5mcm9tVWlkLFxuICAgICAgICB0aXRsZTogJ1RhcmVhIGxlaWRhIHkgY29tcGxldGFkYScsXG4gICAgICAgIG1lc3NhZ2U6IG15TmFtZSArICcgbWFyY28gY29tbyBjb21wbGV0YWRhIHR1IHRhcmVhOiBcIicgKyAobi50aXRsZSB8fCAnJykgKyAnXCInLFxuICAgICAgICByZWxhdGVkVGFza0lkOiBub3RpZklkLFxuICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxuICAgICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHNob3dTeW5jVGFnKCdUYXJlYSBjb21wbGV0YWRhLiBBdmlzbyBlbnZpYWRvIGFsIGVtaXNvci4nKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ2NvbXBsZXRhclRhc2snLCBlKTtcbiAgICBhbGVydCgnRXJyb3I6ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcbiAgfVxufTtcblxud2luZG93Lm1hcmtOb3RpZlJlYWQgPSBhc3luYyBmdW5jdGlvbiAoZnNJZCkge1xuICB0cnkge1xuICAgIGF3YWl0IGZiRGJcbiAgICAgIC5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJylcbiAgICAgIC5kb2MoZnNJZClcbiAgICAgIC51cGRhdGUoeyBzdGF0dXM6ICdyZWFkJywgcmVhZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ21hcmsgcmVhZCcsIGUpO1xuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xuICB9XG59O1xuXG4vLyBDdWFuZG8gZWwgVkRJIHRvY2EgXCJDb250YWN0YXJcIiBlbiB1bmEgbm90aWY6IGNlcnJhbW9zIGVsIHBhbmVsIGRlIG5vdGlmcyxcbi8vIGFicmltb3MgZWwgZm9ybSBkZSB2aXNpdGEgeWEgcHJlLXBvYmxhZG8gY29uIGxhIHRpZW5kYSBkZXJpdmFkYSwgeSBndWFyZGFtb3Ncbi8vIGVsIG5vdGlmSWQgcGFyYSBtYXJjYXIgbGEgbm90aWYgY29tbyBsZWlkYSBjdWFuZG8gZWwgZm9ybSBzZSBlbnZpZSBjb24gZXhpdG8uXG4vLyB2MzYyOiBlbiB3aW5kb3cgKG5vIGxldCkgcG9ycXVlIHZpc2l0YXMuanMgbGEgbGVlL2VzY3JpYmUgYWwgc3VibWl0IGRlbFxuLy8gZm9ybS4gQ2FkYSBzcmMvZG9tYWlucy8qLmpzIGVzIHN1IHByb3BpbyBzY29wZSBlbiBlbCBidW5kbGUgSUlGRSBkZVxuLy8gZXNidWlsZCBcdTIwMTQgY3Jvc3MtbW9kdWxlIHJlYWRzIHJlcXVpZXJlbiB3aW5kb3cgKHJlZ2xhIENMQVVERS5tZCAjMTdcbi8vIGV4dGVuZGlkYTogYXBsaWNhIHRhbWJpZW4gZW50cmUgbW9kdWxvcyBkZWwgYnVuZGxlLCBubyBzb2xvIGJ1bmRsZSB2cyBpbmxpbmUpLlxuaWYgKHR5cGVvZiB3aW5kb3cucGVuZGluZ05vdGlmSWRUb01hcmtSZWFkID09PSAndW5kZWZpbmVkJykgd2luZG93LnBlbmRpbmdOb3RpZklkVG9NYXJrUmVhZCA9IG51bGw7XG53aW5kb3cuY29udGFjdGFyRGVzZGVOb3RpZiA9IGZ1bmN0aW9uIChub3RpZklkKSB7XG4gIGNvbnN0IG4gPSAobXlOb3RpZmljYXRpb25zIHx8IFtdKS5maW5kKCh4KSA9PiB4Ll9mc0lkID09PSBub3RpZklkKTtcbiAgaWYgKCFuKSB7XG4gICAgYWxlcnQoJ05vdGlmaWNhY2lvbiBubyBlbmNvbnRyYWRhLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoIW4udGllbmRhIHx8ICFuLnByb3ZpbmNpYSB8fCAhbi5sb2NhbGlkYWQpIHtcbiAgICBhbGVydChcbiAgICAgICdFc3RhIG5vdGlmaWNhY2lvbiBubyB0aWVuZSBkYXRvcyBjb21wbGV0b3MgZGUgdGllbmRhLiBNYXJjYWxhIGNvbW8gbGVpZGEgZGVzZGUgZWwgb3RybyBib3Rvbi4nXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgd2luZG93LnBlbmRpbmdOb3RpZklkVG9NYXJrUmVhZCA9IG5vdGlmSWQ7XG4gIGNsb3NlTm90aWZzUGFuZWwoKTtcbiAgLy8gQWJyaXIgZm9ybSBkZSB2aXNpdGEgeSBwcmUtY2FyZ2FyIGxhIHRpZW5kYSBkZXJpdmFkYS5cbiAgaWYgKHR5cGVvZiBhYnJpclZpc2l0YVBhcmFUaWVuZGEgPT09ICdmdW5jdGlvbicpIHtcbiAgICBhYnJpclZpc2l0YVBhcmFUaWVuZGEobi5sb2NhbGlkYWQsIG4ucHJvdmluY2lhLCBuLnRpZW5kYSk7XG4gIH0gZWxzZSB7XG4gICAgYWJyaXJWaXNpdGFQYXJhVGllbmRhX3JlYWwobi5sb2NhbGlkYWQsIG4ucHJvdmluY2lhLCBuLnRpZW5kYSk7XG4gIH1cbn07XG5cbndpbmRvdy5tYXJrQWxsTm90aWZzUmVhZCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgY29uc3QgcGVuZGluZyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcihpc05vdGlmUGVuZGluZyk7XG4gIGlmICghcGVuZGluZy5sZW5ndGgpIHJldHVybjtcbiAgaWYgKFxuICAgICFjb25maXJtKFxuICAgICAgJ01hcmNhciBsYXMgJyArIHBlbmRpbmcubGVuZ3RoICsgJyBhbGVydGFzL3RhcmVhcyBjb21vIGxlaWRhcz8gUGFzYW4gYSBsYSBwZXN0YW5hIFJlYWxpemFkYXMuJ1xuICAgIClcbiAgKVxuICAgIHJldHVybjtcbiAgdHJ5IHtcbiAgICBmb3IgKGNvbnN0IG4gb2YgcGVuZGluZykge1xuICAgICAgY29uc3QgaXNUYXNrID0gbi50eXBlID09PSAndGFzayc7XG4gICAgICBjb25zdCB1cGQgPSBpc1Rhc2tcbiAgICAgICAgPyB7IHN0YXR1czogJ2RvbmUnLCBkb25lQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpIH1cbiAgICAgICAgOiB7IHN0YXR1czogJ3JlYWQnLCByZWFkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpIH07XG4gICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5kb2Mobi5fZnNJZCkudXBkYXRlKHVwZCk7XG4gICAgICAvLyBTaSBlcyB1bmEgdGFyZWEsIG1hbmRvIEFDSyBhbCBlbWlzb3IgKG1pc21vIGZsdWpvIHF1ZSBjb21wbGV0YXJUYXNrLCBwZXJvIHNpbiBjb25maXJtYWNpb24pLlxuICAgICAgaWYgKGlzVGFzayAmJiBuLmZyb21VaWQgJiYgbi5mcm9tVWlkICE9PSBjdXJyZW50VXNlci51aWQpIHtcbiAgICAgICAgY29uc3QgbXlOYW1lID0gY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJ2VsIGRlc3RpbmF0YXJpbyc7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuYWRkKHtcbiAgICAgICAgICAgIHR5cGU6ICd0YXNrX2FjaycsXG4gICAgICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXG4gICAgICAgICAgICBmcm9tRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxuICAgICAgICAgICAgZnJvbU5hbWU6IG15TmFtZSxcbiAgICAgICAgICAgIHRhcmdldFVpZDogbi5mcm9tVWlkLFxuICAgICAgICAgICAgdGl0bGU6ICdUYXJlYSBsZWlkYSB5IGNvbXBsZXRhZGEnLFxuICAgICAgICAgICAgbWVzc2FnZTogbXlOYW1lICsgJyBtYXJjbyBjb21vIGNvbXBsZXRhZGEgdHUgdGFyZWE6IFwiJyArIChuLnRpdGxlIHx8ICcnKSArICdcIicsXG4gICAgICAgICAgICByZWxhdGVkVGFza0lkOiBuLl9mc0lkLFxuICAgICAgICAgICAgc3RhdHVzOiAndW5yZWFkJyxcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ2FjayBkZXNkZSBtYXJrQWxsJywgZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdtYXJrIGFsbCcsIGUpO1xuICB9XG59O1xuXG4vLyA9PT0gRXhwb3J0cyBhIHdpbmRvdyBwYXJhIGNhbGxlcnMgY3Jvc3Mtc2NvcGUgPT09XG4vLyAtIHJlbmRlck5vdGlmc0xpc3Q6IGxsYW1hZGEgZGVzZGUgbFx1MDBFRG5lYSAxMjA0NiAodGFiIGhhbmRsZXIpLCAxMjI4NCB5IDEyMzMxXG4vLyAoZGVudHJvIGRlIGVuc3VyZU5vdGlmc0xpc3RlbmVyICsgdXBkYXRlTm90aWZzQmFkZ2UgZGVsIGlubGluZSkuXG4vLyAtIHVwZGF0ZU5vdGlmc1RhYkNvdW50czogbGxhbWFkYSBkZXNkZSBsXHUwMEVEbmVhIDEyMzI5LTMwIGRlbCBpbmxpbmUuXG4vLyAtIHBvcHVsYXRlVGFza1RhcmdldHM6IHlhIGVzdFx1MDBFMSB3aW5kb3cucG9wdWxhdGVUYXNrVGFyZ2V0cyA9IGZ1bmN0aW9uLlxuLy8gLSBzeW5jVXNlcnNEaXJlY3Rvcnk6IHlhIGVzdFx1MDBFMSB3aW5kb3cuc3luY1VzZXJzRGlyZWN0b3J5ID0gc3luY1VzZXJzRGlyZWN0b3J5IChkZW50cm8gZGVsIGJsb3F1ZSkuXG4vLyAtIGVuc3VyZUFsdGFDbGlMaXN0ZW5lcjogbGxhbWFkYSBkZXNkZSBhcHBseVJvbGVQZXJtaXNzaW9ucyBpbmxpbmUgTDExNTQwLlxud2luZG93LnJlbmRlck5vdGlmc0xpc3QgPSByZW5kZXJOb3RpZnNMaXN0O1xud2luZG93LmVuc3VyZUFsdGFDbGlMaXN0ZW5lciA9IGVuc3VyZUFsdGFDbGlMaXN0ZW5lcjtcbndpbmRvdy51cGRhdGVOb3RpZnNUYWJDb3VudHMgPSB1cGRhdGVOb3RpZnNUYWJDb3VudHM7XG4vLyBFNiBob3RmaXggMjogcG9wdWxhdGVBbHRhQ2xpUHJvdmluY2lhcyBsbGFtYWRhIGRlc2RlIHNldFRhYignYWx0YWNsaScpIGlubGluZSBMODIyMS5cbndpbmRvdy5wb3B1bGF0ZUFsdGFDbGlQcm92aW5jaWFzID0gcG9wdWxhdGVBbHRhQ2xpUHJvdmluY2lhcztcbi8vIEU2IGhvdGZpeCAzOiBjcm9zcy1tb2R1bGUgYnVnIFx1MjAxNCByZW5kaWNpb25lcy5qcyBsbGFtYSBub3RpZkl0ZW1IdG1sLlxud2luZG93Lm5vdGlmSXRlbUh0bWwgPSBub3RpZkl0ZW1IdG1sO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBc0NBLE1BQUksT0FBTyxPQUFPLGNBQWMsWUFBYSxRQUFPLFlBQVk7QUFDaEUsTUFBSSxjQUFjLENBQUM7QUFDbkIsTUFBSSxPQUFPLE9BQU8scUJBQXFCLFlBQWEsUUFBTyxtQkFBbUI7QUFFOUUsTUFBSSxpQkFBaUIsQ0FBQztBQUV0QixXQUFTLDRCQUE0QjtBQUNuQyxRQUFJLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxLQUFNO0FBRy9DLFdBQU8sbUJBQW1CLEtBQ3ZCLFdBQVcsZUFBZSxFQUMxQixNQUFNLFdBQVcsTUFBTSxZQUFZLEdBQUcsRUFDdEM7QUFBQSxNQUNDLENBQUMsT0FBTztBQUNOLHNCQUFjLENBQUM7QUFDZixXQUFHLFFBQVEsQ0FBQyxNQUFNO0FBQ2hCLGdCQUFNLE9BQU8sRUFBRSxLQUFLLEtBQUssQ0FBQztBQUMxQixlQUFLLEtBQUssUUFBUSxrQkFBa0IsT0FBUTtBQUM1QyxzQkFBWSxLQUFLLE9BQU8sT0FBTyxFQUFFLE9BQU8sRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDO0FBQUEsUUFDdkQsQ0FBQztBQUNELG9CQUFZLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDekIsZ0JBQU0sS0FBSyxFQUFFLFlBQWEsRUFBRSxVQUFVLFdBQVcsRUFBRSxVQUFVLFNBQVMsSUFBSSxJQUFLO0FBQy9FLGdCQUFNLEtBQUssRUFBRSxZQUFhLEVBQUUsVUFBVSxXQUFXLEVBQUUsVUFBVSxTQUFTLElBQUksSUFB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
