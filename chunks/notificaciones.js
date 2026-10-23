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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2RvbWFpbnMvbm90aWZpY2FjaW9uZXMuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIEB0cy1ub2NoZWNrXHJcbi8vIEdsb2JhbHMgbGVcdTAwRURkb3MgZGVsIGVudG9ybm8gKGRlY2xhcmFkb3MgZW4gaW5kZXguaHRtbCBpbmxpbmUpOlxyXG4vLyBmYkRiLCBmaXJlYmFzZSwgY3VycmVudFVzZXIsIHVzZXJSb2xlLCBlc2NhcGVIdG1sLCBlc2NhcGVBdHRyLCB0aXRsZUNhc2UsXHJcbi8vIHNob3dTeW5jVGFnLCBjb21wcmVzc0ltYWdlLCBvcGVuUmVuZGljaW9uRGV0YWlsIChidW5kbGUgcmVuZGljaW9uZXMpLFxyXG4vLyBvcGVuQ2xpZW50QXBwbGljYXRpb25EZXRhaWwgKGlubGluZSksIGFicmlyVmlzaXRhUGFyYVRpZW5kYV9yZWFsIChidW5kbGUgcnV0YXMpLFxyXG4vLyBteU5vdGlmaWNhdGlvbnMgKyB1bnN1Yk15Tm90aWZzICh0b3AtbGV2ZWwgbGV0cyBkZWwgaW5saW5lLCB2aXNpYmxlcyB2aWFcclxuLy8gZnJlZSByZWZlcmVuY2UgZ3JhY2lhcyBhbCBHbG9iYWwgRW52aXJvbm1lbnQgUmVjb3JkIGNvbXBhcnRpZG8pLFxyXG4vLyBlbnN1cmVOb3RpZnNMaXN0ZW5lciArIHVwZGF0ZU5vdGlmc0JhZGdlICh0b3AtbGV2ZWwgZnVuY3MgZGVsIGlubGluZSxcclxuLy8gbWlzbW8gbWVjYW5pc21vKS5cclxuLy8gTVx1MDBGM2R1bG8gZXh0cmFcdTAwRURkbyB2ZXJiYXRpbTogdGlwYWRvIHJlYWwgZnVlcmEgZGUgc2NvcGUgRTIuZy5cclxuLy9cclxuLy8gUEFORUwgQUxFUlRBUyBZIFRBUkVBUyAoTm90aWZpY2FjaW9uZXMpIFx1MjAxNCBwYW5lbCBVSSArIHRhYnMgKFJlY2liaWRhcyAvXHJcbi8vIFJlYWxpemFkYXMgLyBDcmVhciB0YXJlYSAvIEVudmlhZGFzKSArIGJyb2FkY2FzdCArIHRhc2sgYWN0aW9ucy5cclxuLy8gRXh0cmFcdTAwRURkbyB2ZXJiYXRpbSBkZSBpbmRleC5odG1sIChsXHUwMEVEbmVhcyAxMjUxMi0xMzczMCBwcmUtRTIuZykgY29tbyBwYXJ0ZVxyXG4vLyBkZSBFMi5nIChlMmItcGVyZiAyMDI2LTA3LTI4KS4gUHJlc2VydmEgMTAwJSBjb21wb3J0YW1pZW50by5cclxuLy9cclxuLy8gTk9UQTogRnJhZ21lbnRvIHBhcmNpYWwgZGVsIGRvbWluaW8gbm90aWZpY2FjaW9uZXMuIExhcyBkZWNsYXJhY2lvbmVzXHJcbi8vIG15Tm90aWZpY2F0aW9ucy91bnN1Yk15Tm90aWZzIChsXHUwMEVEbmVhcyAxMjA2OC02OSBwcmUtRTIuZykgZXN0XHUwMEUxbiBkZW50cm9cclxuLy8gZGVsIGJsb3F1ZSBWREUtVkRJIGNvbXBhcnRpZG8geSBzZSBkZWphbiBlbiBlbCBpbmxpbmUuIExhcyBmdW5jaW9uZXNcclxuLy8gZW5zdXJlTm90aWZzTGlzdGVuZXIgKDEyMjY5KSArIGVuc3VyZVZpc2l0c1BhcnRuZXJMaXN0ZW5lciAoMTIzMDQpICtcclxuLy8gdXBkYXRlTm90aWZzQmFkZ2UgKDEyMzE4KSB0YW1iaVx1MDBFOW4gc2UgZGVqYW4gZW4gZWwgaW5saW5lIHBvcnF1ZSBlc3RcdTAwRTFuXHJcbi8vIGludGVyY2FsYWRhcyBjb24gVkRFLVZESSB5IG1vZGFsIHJlYWdlbmRhbWllbnRvICgxMjMzNS0xMjUxMSkuIEV4dHJhZXJcclxuLy8gZXNhcyByZXF1ZXJpclx1MDBFRGEgdW4gbWluaS1wbGFuIGRlIHJlb3JnYW5pemFjaVx1MDBGM24sIGZ1ZXJhIGRlIHNjb3BlIEUyLmcuXHJcbi8vXHJcbi8vIEtOT1dOIEJVRyAodmVyYmF0aW0gcHJlc2VydmFkbyk6IHdpbmRvdy5tYXJrQWxsTm90aWZzUmVhZCBlc3RcdTAwRTEgZGVjbGFyYWRhXHJcbi8vIERPUyB2ZWNlcyBlbiBlbCBibG9xdWUgKGxcdTAwRURuZWFzIH4xMzQwOSB5IH4xMzY5OSBwcmUtRTIuZykuIExhIDJkYSBzb2JyZXNjcmliZVxyXG4vLyBsYSAxcmEgZW4gcnVudGltZS4gVE9ETyBFNiBjb2RlIHJldmlldzogY29uc29saWRhciBlbiB1bmEgc29sYSBpbXBsZW1lbnRhY2lcdTAwRjNuLlxyXG4vL1xyXG4vLyBDcm9zcy1zY29wZSBzdGF0ZSAodmlhIHdpbmRvdyk6XHJcbi8vIC0gd2luZG93LnVuc3ViTXlTZW50VGFza3M6IGxpc3RlbmVyIGNvbiBjbGVhbnVwIGVuIGRldGFjaEZpcmViYXNlTGlzdGVuZXJzKClcclxuLy8gZGVsIGlubGluZSAobFx1MDBFRG5lYSB+MjM4NjkgcHJlLUUyLmcpLlxyXG4vLyBMb2NhbHMgYWwgbVx1MDBGM2R1bG86IHdpbmRvdy5ub3RpZnNUYWIsIG15U2VudFRhc2tzLCB0YXNrRm9ybUltYWdlcywgcGVuZGluZ05vdGlmSWRUb01hcmtSZWFkLlxyXG4vLyA9PT0gTm90aWZpY2FjaW9uZXMgcGFuZWwgPT09XHJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4vLyBQQU5FTCBBTEVSVEFTIFkgVEFSRUFTICh0YWJzOiBSZWNpYmlkYXMgLyBDcmVhciB0YXJlYSAvIEVudmlhZGFzKVxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQ1JPU1MtU0NPUEUgKEU2IGZpeCBDMyk6IHVwZGF0ZU5vdGlmc0JhZGdlIGRlbCBpbmxpbmUgKEw4NTE5KSBsZWUgd2luZG93Lm5vdGlmc1RhYi5cclxuLy8gQnVuZGxlIHN0cmljdCB0aXJhIFJlZmVyZW5jZUVycm9yIFx1MjE5MiBsaXN0YSBub3RpZiBubyByZS1yZW5kZXJlYSBlbiBzbmFwc2hvdC5cclxuaWYgKHR5cGVvZiB3aW5kb3cubm90aWZzVGFiID09PSAndW5kZWZpbmVkJykgd2luZG93Lm5vdGlmc1RhYiA9ICdyZWNpYmlkYXMnO1xyXG5sZXQgbXlTZW50VGFza3MgPSBbXTsgLy8gbm90aWZzIGNyZWFkYXMgcG9yIG1pIHRpcG8gdGFzayAoY29uIHN0YXR1cyBkZWwgZGVzdGluYXRhcmlvKVxyXG5pZiAodHlwZW9mIHdpbmRvdy51bnN1Yk15U2VudFRhc2tzID09PSAndW5kZWZpbmVkJykgd2luZG93LnVuc3ViTXlTZW50VGFza3MgPSBudWxsO1xyXG4vLyBFc3RhZG8gZGVsIGZvcm0gXCJDcmVhciB0YXJlYVwiXHJcbmxldCB0YXNrRm9ybUltYWdlcyA9IFtdOyAvLyBiYXNlNjQgc3RyaW5nc1xyXG5cclxuZnVuY3Rpb24gZW5zdXJlTXlTZW50VGFza3NMaXN0ZW5lcigpIHtcclxuICBpZiAodW5zdWJNeVNlbnRUYXNrcyB8fCAhY3VycmVudFVzZXIgfHwgIWZiRGIpIHJldHVybjtcclxuICAvLyBTb2xvIGZpbHRyYW1vcyBwb3IgZnJvbVVpZCAoZXZpdGEgbmVjZXNpZGFkIGRlIGluZGljZSBjb21wdWVzdG8pLlxyXG4gIC8vIEVsIGZpbHRybyBwb3IgdHlwZSA9PT0gJ3Rhc2snIHNlIGFwbGljYSBlbiBjbGllbnRlLlxyXG4gIHdpbmRvdy51bnN1Yk15U2VudFRhc2tzID0gZmJEYlxyXG4gICAgLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKVxyXG4gICAgLndoZXJlKCdmcm9tVWlkJywgJz09JywgY3VycmVudFVzZXIudWlkKVxyXG4gICAgLm9uU25hcHNob3QoXHJcbiAgICAgIChxcykgPT4ge1xyXG4gICAgICAgIG15U2VudFRhc2tzID0gW107XHJcbiAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgZGF0YSA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICAgICAgaWYgKChkYXRhLnR5cGUgfHwgJ2Rlcml2YWNpb24nKSAhPT0gJ3Rhc2snKSByZXR1cm47XHJcbiAgICAgICAgICBteVNlbnRUYXNrcy5wdXNoKE9iamVjdC5hc3NpZ24oeyBfZnNJZDogZC5pZCB9LCBkYXRhKSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgbXlTZW50VGFza3Muc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICAgICAgY29uc3QgdGEgPSBhLmNyZWF0ZWRBdCA/IChhLmNyZWF0ZWRBdC50b01pbGxpcyA/IGEuY3JlYXRlZEF0LnRvTWlsbGlzKCkgOiAwKSA6IDA7XHJcbiAgICAgICAgICBjb25zdCB0YiA9IGIuY3JlYXRlZEF0ID8gKGIuY3JlYXRlZEF0LnRvTWlsbGlzID8gYi5jcmVhdGVkQXQudG9NaWxsaXMoKSA6IDApIDogMDtcclxuICAgICAgICAgIHJldHVybiB0YiAtIHRhO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnN0IHBhbmVQZWVrID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BhbmUtbm90aWYnKTtcclxuICAgICAgICBjb25zdCBwYW5lVmlzaWJsZSA9IHBhbmVQZWVrICYmIHBhbmVQZWVrLnN0eWxlLmRpc3BsYXkgIT09ICdub25lJztcclxuICAgICAgICBpZiAocGFuZVZpc2libGUgJiYgd2luZG93Lm5vdGlmc1RhYiA9PT0gJ2VudmlhZGFzJykgcmVuZGVyTXlTZW50VGFza3MoKTtcclxuICAgICAgICB1cGRhdGVOb3RpZnNUYWJDb3VudHMoKTtcclxuICAgICAgfSxcclxuICAgICAgKGVycikgPT4gY29uc29sZS53YXJuKCdzZW50IHRhc2tzIGxpc3RlbmVyJywgZXJyKVxyXG4gICAgKTtcclxufVxyXG5cclxuLy8gb3Blbk5vdGlmc1BhbmVsL2Nsb3NlTm90aWZzUGFuZWwgcXVlZGFyb24gY29tbyBzaGltcyBwYXJhIHJldHJvLWNvbXBhdDpcclxuLy8gZWwgXCJtb2RhbFwiIGRlIG5vdGlmaWNhY2lvbmVzIGFob3JhIGVzIGxhIHBlc3RhbmEgJ25vdGlmJyBkZWwgc2lkZWJhci5cclxud2luZG93Lm9wZW5Ob3RpZnNQYW5lbCA9IGZ1bmN0aW9uICgpIHtcclxuICBzZXRUYWIoJ25vdGlmJyk7XHJcbiAgZW5zdXJlTXlTZW50VGFza3NMaXN0ZW5lcigpO1xyXG4gIHNldE5vdGlmc1RhYih3aW5kb3cubm90aWZzVGFiIHx8ICdyZWNpYmlkYXMnKTtcclxuICBwb3B1bGF0ZVRhc2tUYXJnZXRTZWxlY3QoKTtcclxuICB1cGRhdGVOb3RpZnNUYWJDb3VudHMoKTtcclxufTtcclxud2luZG93LmNsb3NlTm90aWZzUGFuZWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgLy8gQW50ZXMgY2VycmFiYSBlbCBtb2RhbC4gQWhvcmEgbm8gaGFjZSBmYWx0YSBoYWNlciBuYWRhIHBvcnF1ZSBlcyB1bmFcclxuICAvLyBwZXN0YW5hOyBlbCB1c3VhcmlvIHB1ZWRlIHNpbXBsZW1lbnRlIGNhbWJpYXIgYSBvdHJhIHBlc3RhbmEuIExvXHJcbiAgLy8gZGVqYW1vcyBjb21vIG5vLW9wIHBhcmEgbm8gcm9tcGVyIGxsYW1hZGFzIGxlZ2FjeS5cclxufTtcclxud2luZG93LnBvcHVsYXRlVGFza1RhcmdldHMgPSBmdW5jdGlvbiAoKSB7XHJcbiAgLy8gQWxpYXMgZGVmZW5zaXZvOiBzaSBlbiBlbCBmdXR1cm8gc2UgbGxhbWEgZGVzZGUgc2V0VGFiLCBnYXJhbnRpemEgcXVlXHJcbiAgLy8gZWwgZHJvcGRvd24gZGUgZGVzdGluYXRhcmlvcyBzZSBsbGVuZS5cclxuICB0cnkge1xyXG4gICAgcG9wdWxhdGVUYXNrVGFyZ2V0U2VsZWN0KCk7XHJcbiAgfSBjYXRjaCAoX2UpIHt9XHJcbn07XHJcblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gQUxUQSBDTElFTlRFUyAtIHNvbGljaXR1ZCBkZSBhbHRhICsgYXByb2JhY2lvbiAoU2FudGlhZ28gKyBEaWVnbylcclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIEFwcm9iYWRvcmVzOiBzZSBpZGVudGlmaWNhbiBwb3IgZW1haWwuIFNpIG5lY2VzaXRhcyBjYW1iaWFybG9zLCBlZGl0YXIgbGEgbGlzdGEuXHJcbmNvbnN0IENMSUVOVF9BUFBMSUNBVElPTl9BUFBST1ZFUl9FTUFJTFMgPSBbJ3NyYjkwMjg0QGdtYWlsLmNvbScsICdxdWlsZ3ltQGdtYWlsLmNvbSddO1xyXG5jb25zdCBBTFRBX0NMSV9NQVhfRk9UT1MgPSA1O1xyXG5sZXQgYWx0YUNsaUZpbGVzID0geyBhcmNhOiBudWxsLCBpaWJiOiBudWxsLCBmb3RvczogW10gfTtcclxubGV0IGFsdGFDbGlNaW5lID0gW107IC8vIG1pcyBzb2xpY2l0dWRlcyAodmVuZGVkb3IgbG9ndWVhZG8pXHJcbi8vIENyb3NzLXNjb3BlOiBlbCBpbmxpbmUgZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMgaGFjZVxyXG4vLyBvZmYoJ3Vuc3ViQWx0YUNsaU1pbmUnLCB1bnN1YkFsdGFDbGlNaW5lLCAoKSA9PiB1bnN1YkFsdGFDbGlNaW5lID0gbnVsbClcclxuLy8gZG9uZGUgYHVuc3ViQWx0YUNsaU1pbmVgIGVzIGZyZWUgcmVmZXJlbmNlLiBTaW4gYHdpbmRvdy5gIGV4cGxcdTAwRURjaXRvLCBlbFxyXG4vLyBgbGV0YCBkZWwgYnVuZGxlIElJRkUgTk8gZXMgdmlzaWJsZSBhbCBpbmxpbmUgXHUyMTkyIG9mZiBza2lwZWFiYSBcdTIxOTIgbGlzdGVuZXIgbGVhay5cclxuaWYgKHR5cGVvZiB3aW5kb3cudW5zdWJBbHRhQ2xpTWluZSA9PT0gJ3VuZGVmaW5lZCcpIHdpbmRvdy51bnN1YkFsdGFDbGlNaW5lID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIGVuc3VyZUFsdGFDbGlMaXN0ZW5lcigpIHtcclxuICBpZiAod2luZG93LnVuc3ViQWx0YUNsaU1pbmUgfHwgIWN1cnJlbnRVc2VyIHx8ICFmYkRiKSByZXR1cm47XHJcbiAgLy8gU29sbyBuZWNlc2l0byBtaXMgcHJvcGlhcyBzb2xpY2l0dWRlcyBwYXJhIGxhIHN1Yi10YWIgXCJNaXMgc29saWNpdHVkZXNcIlxyXG4gIHdpbmRvdy51bnN1YkFsdGFDbGlNaW5lID0gZmJEYlxyXG4gICAgLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKVxyXG4gICAgLndoZXJlKCdvd25lclVpZCcsICc9PScsIGN1cnJlbnRVc2VyLnVpZClcclxuICAgIC5vblNuYXBzaG90KFxyXG4gICAgICAocXMpID0+IHtcclxuICAgICAgICBhbHRhQ2xpTWluZSA9IFtdO1xyXG4gICAgICAgIHFzLmZvckVhY2goKGQpID0+IGFsdGFDbGlNaW5lLnB1c2goT2JqZWN0LmFzc2lnbih7IF9mc0lkOiBkLmlkIH0sIGQuZGF0YSgpKSkpO1xyXG4gICAgICAgIGFsdGFDbGlNaW5lLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgICAgIGNvbnN0IHRhID0gYS5jcmVhdGVkQXQgPyAoYS5jcmVhdGVkQXQudG9NaWxsaXMgPyBhLmNyZWF0ZWRBdC50b01pbGxpcygpIDogMCkgOiAwO1xyXG4gICAgICAgICAgY29uc3QgdGIgPSBiLmNyZWF0ZWRBdCA/IChiLmNyZWF0ZWRBdC50b01pbGxpcyA/IGIuY3JlYXRlZEF0LnRvTWlsbGlzKCkgOiAwKSA6IDA7XHJcbiAgICAgICAgICByZXR1cm4gdGIgLSB0YTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBwYW5lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjLXBhbmUtbWlhcycpO1xyXG4gICAgICAgIGlmIChwYW5lICYmIHBhbmUuc3R5bGUuZGlzcGxheSAhPT0gJ25vbmUnKSByZW5kZXJBbHRhQ2xpTWlzU29saWNpdHVkZXMoKTtcclxuICAgICAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjLXN1Yi1jb3VudC1taWFzJyk7XHJcbiAgICAgICAgaWYgKGMpIHtcclxuICAgICAgICAgIGNvbnN0IHBlbmRpZW50ZXMgPSBhbHRhQ2xpTWluZS5maWx0ZXIoKGEpID0+IGEuc3RhdHVzID09PSAncGVuZGluZ19hcHByb3ZhbCcpLmxlbmd0aDtcclxuICAgICAgICAgIGMudGV4dENvbnRlbnQgPSBwZW5kaWVudGVzID4gMCA/IHBlbmRpZW50ZXMgOiAnJztcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIChlcnIpID0+IGNvbnNvbGUud2FybignYWx0YSBjbGkgbGlzdGVuZXInLCBlcnIpXHJcbiAgICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBwb3B1bGF0ZUFsdGFDbGlQcm92aW5jaWFzKCkge1xyXG4gIGNvbnN0IHByb3ZzID0gbmV3IFNldCgpO1xyXG4gIChQT0lOVFMgfHwgW10pLmZvckVhY2goKHApID0+IHByb3ZzLmFkZChwLnByb3ZpbmNlKSk7XHJcbiAgY29uc3Qgc29ydGVkID0gWy4uLnByb3ZzXS5zb3J0KCk7XHJcbiAgLy8gTGxlbm8gZWwgc2VsZWN0IGRlIFwiTnVldmEgc29saWNpdHVkXCIgeSB0YW1iaWVuIGVsIGRlIFwiQWx0YSByYXBpZGFcIi5cclxuICBbJ2FjLXByb3ZpbmNpYScsICdhci1wcm92aW5jaWEnXS5mb3JFYWNoKChpZCkgPT4ge1xyXG4gICAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpO1xyXG4gICAgaWYgKCFzZWwgfHwgc2VsLm9wdGlvbnMubGVuZ3RoID4gMSkgcmV0dXJuO1xyXG4gICAgc29ydGVkLmZvckVhY2goKHByKSA9PiB7XHJcbiAgICAgIGNvbnN0IG8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdvcHRpb24nKTtcclxuICAgICAgby52YWx1ZSA9IHByO1xyXG4gICAgICBvLnRleHRDb250ZW50ID0gdGl0bGVDYXNlKHByKTtcclxuICAgICAgc2VsLmFwcGVuZENoaWxkKG8pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJ1aWxkQWx0YUNsaVNoYXJlVXJsKCkge1xyXG4gIC8vIEJhc2UgPSBtaXNtYSBVUkwgcGVybyBhcHVudGFuZG8gYSBhbHRhLWNsaWVudGUuaHRtbFxyXG4gIGNvbnN0IGJhc2UgPVxyXG4gICAgd2luZG93LmxvY2F0aW9uLm9yaWdpbiArIHdpbmRvdy5sb2NhdGlvbi5wYXRobmFtZS5yZXBsYWNlKC9bXi9dKiQvLCAnJykgKyAnYWx0YS1jbGllbnRlLmh0bWwnO1xyXG4gIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoKTtcclxuICBpZiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIudWlkKSBwYXJhbXMuc2V0KCd2ZW5kb3InLCBjdXJyZW50VXNlci51aWQpO1xyXG4gIGNvbnN0IHZuYW1lID1cclxuICAgIChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSkgfHwgKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLmVtYWlsKSB8fCAnJztcclxuICBpZiAodm5hbWUpIHBhcmFtcy5zZXQoJ3ZlbmRvck5hbWUnLCB2bmFtZSk7XHJcbiAgaWYgKGN1cnJlbnRVc2VyICYmIGN1cnJlbnRVc2VyLmVtYWlsKSBwYXJhbXMuc2V0KCd2ZW5kb3JFbWFpbCcsIGN1cnJlbnRVc2VyLmVtYWlsKTtcclxuICByZXR1cm4gYmFzZSArICc/JyArIHBhcmFtcy50b1N0cmluZygpO1xyXG59XHJcblxyXG53aW5kb3cuY29weUFsdGFDbGlTaGFyZUxpbmsgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgdXJsID0gYnVpbGRBbHRhQ2xpU2hhcmVVcmwoKTtcclxuICAvLyBJbnRlbnRhciBDbGlwYm9hcmQgQVBJOyBmYWxsYmFjayBhIHByb21wdFxyXG4gIGlmIChuYXZpZ2F0b3IuY2xpcGJvYXJkICYmIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KSB7XHJcbiAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkXHJcbiAgICAgIC53cml0ZVRleHQodXJsKVxyXG4gICAgICAudGhlbigoKSA9PiB7XHJcbiAgICAgICAgc2hvd1N5bmNUYWcoJ0xpbmsgY29waWFkby4gUGVnYWxvIHkgbWFuZGFsbyBhbCBjbGllbnRlLicpO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goKCkgPT4gcHJvbXB0KCdDb3BpYSBlbCBsaW5rOicsIHVybCkpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBwcm9tcHQoJ0NvcGlhIGVsIGxpbms6JywgdXJsKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuc2hhcmVBbHRhQ2xpVmlhV2hhdHNhcHAgPSBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgdXJsID0gYnVpbGRBbHRhQ2xpU2hhcmVVcmwoKTtcclxuICBjb25zdCB2bmFtZSA9XHJcbiAgICAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZGlzcGxheU5hbWUpIHx8IChjdXJyZW50VXNlciAmJiBjdXJyZW50VXNlci5lbWFpbCkgfHwgJ1NoaW1hbm8nO1xyXG4gIGNvbnN0IG1zZyA9XHJcbiAgICAnSG9sYSEgU295ICcgK1xyXG4gICAgdm5hbWUgK1xyXG4gICAgJyBkZSBTaGltYW5vIEFyZ2VudGluYS4gUGFyYSBkYXJ0ZSBkZSBhbHRhIGNvbW8gY2xpZW50ZSwgJyArXHJcbiAgICAnY29tcGxldGEgcG9yIGZhdm9yIGVzdGUgZm9ybXVsYXJpbyBjb24gbG9zIGRhdG9zIGRlIHR1IGNvbWVyY2lvLiBVbmEgdmV6IGFwcm9iYWRvLCAnICtcclxuICAgICdwb2RlcyBlbXBlemFyIGEgY29tcHJhci4gQ3VhbHF1aWVyIGR1ZGEgbWUgYXZpc2FzLlxcblxcbicgK1xyXG4gICAgdXJsO1xyXG4gIGNvbnN0IHdhVXJsID0gJ2h0dHBzOi8vd2EubWUvP3RleHQ9JyArIGVuY29kZVVSSUNvbXBvbmVudChtc2cpO1xyXG4gIHdpbmRvdy5vcGVuKHdhVXJsLCAnX2JsYW5rJyk7XHJcbn07XHJcblxyXG53aW5kb3cuc2V0QWx0YUNsaVN1YnRhYiA9IGZ1bmN0aW9uIChzdWIpIHtcclxuICBkb2N1bWVudFxyXG4gICAgLnF1ZXJ5U2VsZWN0b3JBbGwoJy5hYy1zdWJ0YWItYnRuJylcclxuICAgIC5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGIuZGF0YXNldC5hY3N1YiA9PT0gc3ViKSk7XHJcbiAgLy8gdjM0MSsgKDIwMjYtMDctMjgpOiBzdWItdGFiICdudWV2bycgKyBwYW5lICNhYy1wYW5lLW51ZXZvIHJlbW92aWRvcy4gTG9zXHJcbiAgLy8gZ2V0RWxlbWVudEJ5SWQgc2UgaGFjZW4gY29uIGd1YXJkIHBhcmEgdG9sZXJhciBlbCBwYW5lIGVsaW1pbmFkbyBzaW4gdGlyYXIuXHJcbiAgY29uc3QgbnVldm9QYW5lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjLXBhbmUtbnVldm8nKTtcclxuICBpZiAobnVldm9QYW5lKSBudWV2b1BhbmUuc3R5bGUuZGlzcGxheSA9IHN1YiA9PT0gJ251ZXZvJyA/ICcnIDogJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhYy1wYW5lLW1pYXMnKS5zdHlsZS5kaXNwbGF5ID0gc3ViID09PSAnbWlhcycgPyAnJyA6ICdub25lJztcclxuICBjb25zdCByYXBpZGFQYW5lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjLXBhbmUtcmFwaWRhJyk7XHJcbiAgaWYgKHJhcGlkYVBhbmUpIHJhcGlkYVBhbmUuc3R5bGUuZGlzcGxheSA9IHN1YiA9PT0gJ3JhcGlkYScgPyAnJyA6ICdub25lJztcclxuICBpZiAoc3ViID09PSAnbWlhcycpIHJlbmRlckFsdGFDbGlNaXNTb2xpY2l0dWRlcygpO1xyXG59O1xyXG5cclxuLy8gQWx0YSByYXBpZGEgKHByb3Zpc29yaWEpOiBzb2xvIDMgY2FtcG9zLCBzaW4gU0FQLCBzaW4gYXByb2JhY2lvbi4gU2VcclxuLy8gY3JlYSB1biBkb2MgZW4gY2xpZW50X2FwcGxpY2F0aW9ucyBjb24gc3RhdHVzPSdhcHByb3ZlZCcgKGFzaSBlbnRyYVxyXG4vLyBkaXJlY3RvIGEgbGFzIGxpc3RhcyBkZSB0aWVuZGFzIGhhYmlsaXRhZGFzKSB5IHVuIGZsYWcgbWFudWFsU2FwUGVuZGluZ1xyXG4vLyA9IHRydWUgcGFyYSBxdWUgYWRtaW4gc2VwYSBxdWUgaGF5IHF1ZSBjYXJnYXJsbyBhIG1hbm8gZW4gU0FQLlxyXG53aW5kb3cuc3VibWl0QWx0YVJhcGlkYSA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBpZiAoIWN1cnJlbnRVc2VyKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IHNlc2lcdTAwRjNuIGFjdGl2YS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgY29tZXJjaW8gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLWNvbWVyY2lvJykudmFsdWUgfHwgJycpLnRyaW0oKTtcclxuICBjb25zdCBwcm92aW5jaWEgPSAoKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhci1wcm92aW5jaWEnKSB8fCB7fSkudmFsdWUgfHwgJycpXHJcbiAgICAudHJpbSgpXHJcbiAgICAudG9VcHBlckNhc2UoKTtcclxuICBjb25zdCBsb2NhbGlkYWQgPSAoKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhci1sb2NhbGlkYWQnKSB8fCB7fSkudmFsdWUgfHwgJycpLnRyaW0oKTtcclxuICBjb25zdCBkaXJlY2Npb24gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLWRpcmVjY2lvbicpLnZhbHVlIHx8ICcnKS50cmltKCk7XHJcbiAgY29uc3QgZHVlbm8gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FyLWR1ZW5vJykudmFsdWUgfHwgJycpLnRyaW0oKTtcclxuICBjb25zdCB0ZWxlZm9ubyA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXItdGVsZWZvbm8nKS52YWx1ZSB8fCAnJykudHJpbSgpO1xyXG4gIC8vIENVSVQgb3BjaW9uYWwuIFNvbG8gZGlnaXRvcyBwYXJhIHBvZGVyIG1hdGNoZWFyIGNvbiBTQVAgKHF1ZSBhIHZlY2VzXHJcbiAgLy8gdHJhZSAyMC0xMjM0NTY3OC05LCBvdHJhcyAyMDEyMzQ1Njc4OSkuIFNpIGVsIHZlbmRlZG9yIGVzY3JpYmUgYWxnb1xyXG4gIC8vIHF1ZSBubyBlcyB1biBDVUlUIHZhbGlkbyAobWVub3MgZGUgMTEgZGlnaXRvcyksIGd1YXJkYW1vcyBpZ3VhbCBwZXJvXHJcbiAgLy8gYXZpc2Ftb3MgLSBlbCBtYXRjaCBhdXRvbWF0aWNvIHVzYSBzdHJpY3QgZXF1YWxpdHkgc29icmUgZGlnaXRvcy5cclxuICBjb25zdCBjdWl0UmF3ID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhci1jdWl0JykgfHwgeyB2YWx1ZTogJycgfSkudmFsdWUgfHwgJyc7XHJcbiAgY29uc3QgY3VpdCA9IGN1aXRSYXcucmVwbGFjZSgvXFxEL2csICcnKTtcclxuICBpZiAoY29tZXJjaW8ubGVuZ3RoIDwgMikge1xyXG4gICAgYWxlcnQoJ0NvbXBsZXRcdTAwRTEgZWwgbm9tYnJlIGRlbCBsb2NhbC4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKCFwcm92aW5jaWEpIHtcclxuICAgIGFsZXJ0KCdFbGVnXHUwMEVEIGxhIHByb3ZpbmNpYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGxvY2FsaWRhZC5sZW5ndGggPCAyKSB7XHJcbiAgICBhbGVydCgnQ29tcGxldFx1MDBFMSBsYSBsb2NhbGlkYWQuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChkaXJlY2Npb24ubGVuZ3RoIDwgNSkge1xyXG4gICAgYWxlcnQoJ0NvbXBsZXRcdTAwRTEgbGEgZGlyZWNjaVx1MDBGM24uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChkdWVuby5sZW5ndGggPCAyKSB7XHJcbiAgICBhbGVydCgnQ29tcGxldFx1MDBFMSBlbCBub21icmUgZGVsIGR1ZVx1MDBGMW8gLyBjb250YWN0by4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgaWYgKGN1aXQgJiYgY3VpdC5sZW5ndGggIT09IDExKSB7XHJcbiAgICBpZiAoXHJcbiAgICAgICFjb25maXJtKCdFbCBDVUlUIGluZ3Jlc2FkbyB0aWVuZSAnICsgY3VpdC5sZW5ndGggKyAnIGRpZ2l0b3MgKGVzcGVyYWJhIDExKS4gR3VhcmRhciBpZ3VhbD8nKVxyXG4gICAgKVxyXG4gICAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnQ29uZmlybWFyIGFsdGEgclx1MDBFMXBpZGEgZGUgXCInICtcclxuICAgICAgICBjb21lcmNpbyArXHJcbiAgICAgICAgJ1wiP1xcblxcbicgK1xyXG4gICAgICAgICdQcm92aW5jaWE6ICcgK1xyXG4gICAgICAgIHRpdGxlQ2FzZShwcm92aW5jaWEpICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJ0xvY2FsaWRhZDogJyArXHJcbiAgICAgICAgbG9jYWxpZGFkICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJ0RpcmVjY2lvbjogJyArXHJcbiAgICAgICAgZGlyZWNjaW9uICtcclxuICAgICAgICAnXFxuJyArXHJcbiAgICAgICAgJ0R1ZVx1MDBGMW86ICcgK1xyXG4gICAgICAgIGR1ZW5vICtcclxuICAgICAgICAodGVsZWZvbm8gPyAnXFxuVGVsOiAnICsgdGVsZWZvbm8gOiAnJykgK1xyXG4gICAgICAgIChjdWl0ID8gJ1xcbkNVSVQ6ICcgKyBjdWl0IDogJycpICtcclxuICAgICAgICAnXFxuXFxuJyArXHJcbiAgICAgICAgJ0VsIGNsaWVudGUgcXVlZGEgaGFiaWxpdGFkbyBQUk9WSVNPUklBTUVOVEUgKGFtYXJpbGxvKS5cXG4nICtcclxuICAgICAgICAnVmFzIGEgcG9kZXIgY2FyZ2FybGUgcGVkaWRvcyB5IHZpc2l0YXMsIHBlcm8gbG9zIHBlZGlkb3MgTk8gc2UgZW52aWFuXFxuJyArXHJcbiAgICAgICAgJ2EgU0FQIGhhc3RhIHF1ZSBhZG1pbmlzdHJhY2lvbiBjcmVlIGVsIGNsaWVudGUgYWxsaS4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNhbHRhLXJhcGlkYS1mb3JtIC5idG4tY29uZmlybScpO1xyXG4gIGlmIChidG4pIHtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnR3VhcmRhbmRvLi4uJztcclxuICB9XHJcbiAgLy8gVmVuZG9yIGVmZWN0aXZvOiBlbCBkZWwgdmVuZGVkb3IgbG9ndWVhZG8gKGFzc2lnbmVkVmVuZG9yKSBvIGFkbWluLlxyXG4gIGNvbnN0IG15VmVuZG9yID0gdHlwZW9mIGFzc2lnbmVkVmVuZG9yICE9PSAndW5kZWZpbmVkJyAmJiBhc3NpZ25lZFZlbmRvciA/IGFzc2lnbmVkVmVuZG9yIDogJyc7XHJcbiAgLy8gR2VvY29kaW5nIGZpcmUtYW5kLWZvcmdldDogaW50ZW50YW1vcyBwZXJvIG5vIGJsb3F1ZWFtb3MgZWwgYWx0YS5cclxuICBsZXQgZ2VvUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShudWxsKTtcclxuICBpZiAodHlwZW9mIGdlb2NvZGVDbGllbnRBZGRyZXNzID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICBnZW9Qcm9taXNlID0gZ2VvY29kZUNsaWVudEFkZHJlc3MoZGlyZWNjaW9uLCAnJywgJycpLmNhdGNoKCgpID0+IG51bGwpO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgY29uc3QgZG9jUmVmID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuYWRkKHtcclxuICAgICAgY29tZXJjaW86IGNvbWVyY2lvLFxyXG4gICAgICBmYW50YXNpYTogY29tZXJjaW8sXHJcbiAgICAgIGNhbGxlOiBkaXJlY2Npb24sXHJcbiAgICAgIHByb3ZpbmNpYTogcHJvdmluY2lhLFxyXG4gICAgICBsb2NhbGlkYWQ6IGxvY2FsaWRhZCxcclxuICAgICAgbG9jYWxpZGFkRmluYWw6IGxvY2FsaWRhZCxcclxuICAgICAgZHVlbm9Ob21icmU6IGR1ZW5vLFxyXG4gICAgICB0ZWxlZm9ub0NvbnRhY3RvOiB0ZWxlZm9ubyB8fCAnJyxcclxuICAgICAgY3VpdDogY3VpdCB8fCAnJywgLy8gdjI5Mys6IENVSVQgb3BjaW9uYWwgcGFyYSBtYXRjaCBhdXRvbWF0aWNvIGNvbiBTQVBcclxuICAgICAgc3RhdHVzOiAnYXBwcm92ZWQnLFxyXG4gICAgICBzb3VyY2U6ICdhbHRhX3JhcGlkYScsXHJcbiAgICAgIG1hbnVhbFNhcFBlbmRpbmc6IHRydWUsIC8vIEZMQUc6IGFkbWluIHRpZW5lIHF1ZSBjYXJnYXIgYSBTQVAgbWFudWFsXHJcbiAgICAgIGFzc2lnbmVkVmVuZG9yOiBteVZlbmRvcixcclxuICAgICAgb3duZXJVaWQ6IGN1cnJlbnRVc2VyLnVpZCxcclxuICAgICAgb3duZXJFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIG93bmVyTmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIGFwcHJvdmFsczoge1xyXG4gICAgICAgIFtjdXJyZW50VXNlci51aWRdOiB7XHJcbiAgICAgICAgICBhcHByb3ZlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICAgIGVtYWlsOiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICAgIG5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8ICcnLFxyXG4gICAgICAgICAgbm90ZTogJ0FsdGEgcmFwaWRhIGF1dG8tYXByb2JhZGEgcG9yIGVsIHZlbmRlZG9yJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBhcHByb3ZlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgdXBkYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgIH0pO1xyXG4gICAgLy8gR2VvY29kaW5nIGVuIGJhY2tncm91bmQgKG5vIGJsb3F1ZWEpLlxyXG4gICAgZ2VvUHJvbWlzZS50aGVuKChnZW8pID0+IHtcclxuICAgICAgaWYgKGdlbyAmJiBnZW8ubGF0ICE9IG51bGwgJiYgZ2VvLmxuZyAhPSBudWxsKSB7XHJcbiAgICAgICAgY29uc3QgdXBkYXRlID0ge1xyXG4gICAgICAgICAgbGF0OiBnZW8ubGF0LFxyXG4gICAgICAgICAgbG5nOiBnZW8ubG5nLFxyXG4gICAgICAgICAgZ2VvRGlzcGxheTogZ2VvLmRpc3BsYXkgfHwgJycsXHJcbiAgICAgICAgICBnZW9Qcm92aWRlcjogZ2VvLnByb3ZpZGVyIHx8ICdvc20nLFxyXG4gICAgICAgICAgZ2VvQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29uc3QgZGV0ZWN0ZWRMb2MgPSAoZ2VvLmxvY2FsaXR5IHx8ICcnKS50cmltKCk7XHJcbiAgICAgICAgaWYgKGRldGVjdGVkTG9jKSB7XHJcbiAgICAgICAgICB1cGRhdGUubG9jYWxpZGFkID0gZGV0ZWN0ZWRMb2M7XHJcbiAgICAgICAgICB1cGRhdGUubG9jYWxpZGFkRmluYWwgPSBkZXRlY3RlZExvYztcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgZGV0ZWN0ZWRQcm92ID0gKGdlby5wcm92aW5jZSB8fCAnJykudHJpbSgpO1xyXG4gICAgICAgIGlmIChkZXRlY3RlZFByb3YpIHVwZGF0ZS5wcm92aW5jaWEgPSBkZXRlY3RlZFByb3YudG9VcHBlckNhc2UoKTtcclxuICAgICAgICBkb2NSZWZcclxuICAgICAgICAgIC5zZXQodXBkYXRlLCB7IG1lcmdlOiB0cnVlIH0pXHJcbiAgICAgICAgICAuY2F0Y2goKGUpID0+IGNvbnNvbGUud2FybignZ2VvY29kZSB1cGRhdGUgYWx0YSByYXBpZGEnLCBlKSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgLy8gTm90aWZpY2FyIGFsIGFkbWluIHBhcmEgcXVlIHNlcGEgcXVlIGhheSB1biBhbHRhIHByb3Zpc29yaWEgcXVlIGNhcmdhci5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGFkbWluc1NuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ3JvbGVzJykud2hlcmUoJ3JvbGUnLCAnPT0nLCAnYWRtaW4nKS5nZXQoKTtcclxuICAgICAgY29uc3QgbWUgPSBjdXJyZW50VXNlci5kaXNwbGF5TmFtZSB8fCBjdXJyZW50VXNlci5lbWFpbCB8fCAnVmVuZGVkb3InO1xyXG4gICAgICBhZG1pbnNTbmFwLmZvckVhY2goKGQpID0+IHtcclxuICAgICAgICBmYkRiXHJcbiAgICAgICAgICAuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpXHJcbiAgICAgICAgICAuYWRkKHtcclxuICAgICAgICAgICAgdHlwZTogJ2FsdGFfcmFwaWRhX2NyZWFkYScsXHJcbiAgICAgICAgICAgIHRhcmdldFVpZDogZC5pZCxcclxuICAgICAgICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgICAgICBmcm9tRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgICB0aXRsZTogJ0FsdGEgcmFwaWRhIHBlbmRpZW50ZSBkZSBjYXJnYSBtYW51YWwgZW4gU0FQJyxcclxuICAgICAgICAgICAgYm9keTpcclxuICAgICAgICAgICAgICBtZSArXHJcbiAgICAgICAgICAgICAgJyBkaW8gZGUgYWx0YSByYXBpZGEgYSBcIicgK1xyXG4gICAgICAgICAgICAgIGNvbWVyY2lvICtcclxuICAgICAgICAgICAgICAnXCIgKCcgK1xyXG4gICAgICAgICAgICAgIGRpcmVjY2lvbiArXHJcbiAgICAgICAgICAgICAgJywgZHVlXHUwMEYxbyAnICtcclxuICAgICAgICAgICAgICBkdWVubyArXHJcbiAgICAgICAgICAgICAgJykuIEhheSBxdWUgY2FyZ2FybG8gbWFudWFsbWVudGUgZW4gU0FQLicsXHJcbiAgICAgICAgICAgIGNvbWVyY2lvOiBjb21lcmNpbyxcclxuICAgICAgICAgICAgc3RhdHVzOiAndW5yZWFkJyxcclxuICAgICAgICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuY2F0Y2goKCkgPT4ge30pO1xyXG4gICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdub3RpZnkgYWRtaW4gYWx0YSByYXBpZGEnLCBlKTtcclxuICAgIH1cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhbHRhLXJhcGlkYS1mb3JtJykucmVzZXQoKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi50ZXh0Q29udGVudCA9ICdDb25maXJtYXIgY2xpZW50ZSB5IGhhYmlsaXRhcic7XHJcbiAgICB9XHJcbiAgICBhbGVydChcclxuICAgICAgJ0NsaWVudGUgaGFiaWxpdGFkbyBwcm92aXNvcmlhbWVudGUuXFxuXFxuWWEgcG9kZXMgY2FyZ2FybGUgcGVkaWRvcyBkZXNkZSBsYSBzb2xhcGEgUEVESURPUy4nXHJcbiAgICApO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3N1Ym1pdEFsdGFSYXBpZGEnLCBlKTtcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi50ZXh0Q29udGVudCA9ICdDb25maXJtYXIgY2xpZW50ZSB5IGhhYmlsaXRhcic7XHJcbiAgICB9XHJcbiAgICBhbGVydCgnRXJyb3IgZ3VhcmRhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93Lm9uQWx0YUNsaUZpbGUgPSBhc3luYyBmdW5jdGlvbiAoaW5wdXQsIGtpbmQpIHtcclxuICBjb25zdCBmaWxlcyA9IFsuLi4oaW5wdXQuZmlsZXMgfHwgW10pXTtcclxuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGI2NCA9IGF3YWl0IGNvbXByZXNzSW1hZ2UoZiwgMTQwMCwgMC43OCk7XHJcbiAgICAgIGlmIChraW5kID09PSAnZm90b3MnKSB7XHJcbiAgICAgICAgaWYgKGFsdGFDbGlGaWxlcy5mb3Rvcy5sZW5ndGggPj0gQUxUQV9DTElfTUFYX0ZPVE9TKSB7XHJcbiAgICAgICAgICBhbGVydCgnTWF4aW1vICcgKyBBTFRBX0NMSV9NQVhfRk9UT1MgKyAnIGZvdG9zIGRlbCBsb2NhbC4nKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhbHRhQ2xpRmlsZXMuZm90b3MucHVzaChiNjQpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGFsdGFDbGlGaWxlc1traW5kXSA9IGI2NDsgLy8gcmVlbXBsYXphIGVsIGFudGVyaW9yXHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdjb21wcmVzcyBhbHRhIGNsaScsIGUpO1xyXG4gICAgfVxyXG4gIH1cclxuICBpbnB1dC52YWx1ZSA9ICcnO1xyXG4gIHJlZnJlc2hBbHRhQ2xpR3JpZChraW5kKTtcclxufTtcclxuXHJcbndpbmRvdy5yZW1vdmVBbHRhQ2xpRmlsZSA9IGZ1bmN0aW9uIChraW5kLCBpZHgpIHtcclxuICBpZiAoa2luZCA9PT0gJ2ZvdG9zJykgYWx0YUNsaUZpbGVzLmZvdG9zLnNwbGljZShpZHgsIDEpO1xyXG4gIGVsc2UgYWx0YUNsaUZpbGVzW2tpbmRdID0gbnVsbDtcclxuICByZWZyZXNoQWx0YUNsaUdyaWQoa2luZCk7XHJcbn07XHJcblxyXG5mdW5jdGlvbiByZWZyZXNoQWx0YUNsaUdyaWQoa2luZCkge1xyXG4gIGNvbnN0IGdyaWRJZCA9XHJcbiAgICBraW5kID09PSAnYXJjYScgPyAnYWMtYXJjYS1ncmlkJyA6IGtpbmQgPT09ICdpaWJiJyA/ICdhYy1paWJiLWdyaWQnIDogJ2FjLWZvdG9zLWdyaWQnO1xyXG4gIGNvbnN0IGdyaWQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChncmlkSWQpO1xyXG4gIGlmICghZ3JpZCkgcmV0dXJuO1xyXG4gIGxldCBjZWxscyA9ICcnO1xyXG4gIGlmIChraW5kID09PSAnZm90b3MnKSB7XHJcbiAgICBjZWxscyA9IGFsdGFDbGlGaWxlcy5mb3Rvc1xyXG4gICAgICAubWFwKFxyXG4gICAgICAgIChiNjQsIGkpID0+XHJcbiAgICAgICAgICAnPGRpdiBjbGFzcz1cInBob3RvLWNlbGxcIj48aW1nIHNyYz1cIicgK1xyXG4gICAgICAgICAgYjY0ICtcclxuICAgICAgICAgICdcIi8+PGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJybVwiIG9uY2xpY2s9XCJyZW1vdmVBbHRhQ2xpRmlsZShcXCdmb3Rvc1xcJywnICtcclxuICAgICAgICAgIGkgK1xyXG4gICAgICAgICAgJylcIj4mdGltZXM7PC9idXR0b24+PC9kaXY+J1xyXG4gICAgICApXHJcbiAgICAgIC5qb2luKCcnKTtcclxuICAgIGlmIChhbHRhQ2xpRmlsZXMuZm90b3MubGVuZ3RoIDwgQUxUQV9DTElfTUFYX0ZPVE9TKSB7XHJcbiAgICAgIGNlbGxzICs9XHJcbiAgICAgICAgJzxsYWJlbCBjbGFzcz1cInBob3RvLWNlbGwgYWRkXCI+PGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiaW1hZ2UvKlwiIG11bHRpcGxlIG9uY2hhbmdlPVwib25BbHRhQ2xpRmlsZSh0aGlzLFxcJ2ZvdG9zXFwnKVwiLz4rPC9sYWJlbD4nO1xyXG4gICAgfVxyXG4gIH0gZWxzZSB7XHJcbiAgICBjb25zdCB2ID0gYWx0YUNsaUZpbGVzW2tpbmRdO1xyXG4gICAgaWYgKHYpIHtcclxuICAgICAgY2VsbHMgPVxyXG4gICAgICAgICc8ZGl2IGNsYXNzPVwicGhvdG8tY2VsbFwiPjxpbWcgc3JjPVwiJyArXHJcbiAgICAgICAgdiArXHJcbiAgICAgICAgJ1wiLz48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInJtXCIgb25jbGljaz1cInJlbW92ZUFsdGFDbGlGaWxlKFxcJycgK1xyXG4gICAgICAgIGtpbmQgK1xyXG4gICAgICAgICdcXCcpXCI+JnRpbWVzOzwvYnV0dG9uPjwvZGl2Pic7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjZWxscyA9XHJcbiAgICAgICAgJzxsYWJlbCBjbGFzcz1cInBob3RvLWNlbGwgYWRkXCI+PGlucHV0IHR5cGU9XCJmaWxlXCIgYWNjZXB0PVwiaW1hZ2UvKiwucGRmXCIgb25jaGFuZ2U9XCJvbkFsdGFDbGlGaWxlKHRoaXMsXFwnJyArXHJcbiAgICAgICAga2luZCArXHJcbiAgICAgICAgJ1xcJylcIi8+KzwvbGFiZWw+JztcclxuICAgIH1cclxuICB9XHJcbiAgZ3JpZC5pbm5lckhUTUwgPSBjZWxscztcclxufVxyXG5cclxuZnVuY3Rpb24gcmVzZXRBbHRhQ2xpRm9ybSgpIHtcclxuICBjb25zdCBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FsdGEtY2xpLWZvcm0nKTtcclxuICBpZiAoZikgZi5yZXNldCgpO1xyXG4gIGFsdGFDbGlGaWxlcyA9IHsgYXJjYTogbnVsbCwgaWliYjogbnVsbCwgZm90b3M6IFtdIH07XHJcbiAgcmVmcmVzaEFsdGFDbGlHcmlkKCdhcmNhJyk7XHJcbiAgcmVmcmVzaEFsdGFDbGlHcmlkKCdpaWJiJyk7XHJcbiAgcmVmcmVzaEFsdGFDbGlHcmlkKCdmb3RvcycpO1xyXG59XHJcblxyXG53aW5kb3cuc3VibWl0Q2xpZW50QXBwbGljYXRpb24gPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgLy8gVmFsaWRhclxyXG4gIGNvbnN0IGVycm9ycyA9IFtdO1xyXG4gIGZ1bmN0aW9uIHJlYWQoaWQpIHtcclxuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpO1xyXG4gICAgcmV0dXJuIGVsID8gKGVsLnZhbHVlIHx8ICcnKS50cmltKCkgOiAnJztcclxuICB9XHJcbiAgY29uc3QgZmllbGRzID0gW1xyXG4gICAgWydhYy1lbWFpbCcsICdFLW1haWwgY29tZXJjaW8nXSxcclxuICAgIFsnYWMtY29tZXJjaW8nLCAnTm9tYnJlIGRlbCBjb21lcmNpbyddLFxyXG4gICAgWydhYy1mYW50YXNpYScsICdOb21icmUgZmFudGFzaWEnXSxcclxuICAgIFsnYWMtY3VpdCcsICdDVUlUJ10sXHJcbiAgICBbJ2FjLWNvbmRmaXNjYWwnLCAnQ29uZGljaW9uIGZpc2NhbCddLFxyXG4gICAgWydhYy1jYWxsZScsICdDYWxsZSddLFxyXG4gICAgWydhYy1udW1lcm8nLCAnTnVtZXJvJ10sXHJcbiAgICBbJ2FjLWxvY2FsaWRhZCcsICdMb2NhbGlkYWQnXSxcclxuICAgIFsnYWMtcHJvdmluY2lhJywgJ1Byb3ZpbmNpYSddLFxyXG4gICAgWydhYy1jcCcsICdDb2RpZ28gUG9zdGFsJ10sXHJcbiAgICBbJ2FjLXRlbGVmb25vJywgJ1RlbGVmb25vJ10sXHJcbiAgICBbJ2FjLXdlYicsICdQYWdpbmEgd2ViJ10sXHJcbiAgICBbJ2FjLXJlZGVzJywgJ1JlZGVzJ10sXHJcbiAgICBbJ2FjLWNvbnRhY3RvLW5vbWJyZScsICdOb21icmUgY29udGFjdG8nXSxcclxuICAgIFsnYWMtY29udGFjdG8tdGVscGFydCcsICdUZWxlZm9ubyBwYXJ0aWN1bGFyIGNvbnRhY3RvJ10sXHJcbiAgICBbJ2FjLWNvbnRhY3RvLXdzcCcsICdXaGF0c0FwcCBjb250YWN0byddLFxyXG4gICAgWydhYy1jb250YWN0by1lbWFpbCcsICdFbWFpbCBjb250YWN0byddLFxyXG4gICAgWydhYy10aXBvY29tZXJjaW8nLCAnVGlwbyBkZSBjb21lcmNpbyddLFxyXG4gICAgWydhYy10aWVuZGFvbmxpbmUnLCAnVGllbmRhIG9ubGluZSddLFxyXG4gIF07XHJcbiAgZmllbGRzLmZvckVhY2goKFtpZCwgbGFiZWxdKSA9PiB7XHJcbiAgICBpZiAoIXJlYWQoaWQpKSBlcnJvcnMucHVzaChsYWJlbCk7XHJcbiAgfSk7XHJcbiAgaWYgKCFhbHRhQ2xpRmlsZXMuYXJjYSkgZXJyb3JzLnB1c2goJ0NvbnN0YW5jaWEgQVJDQScpO1xyXG4gIC8vIENvbnN0YW5jaWEgSUlCQiBlcyBPUENJT05BTDogbXVjaGFzIHRpZW5kYXMgKG1vbm90cmlidXRpc3Rhcykgbm8gdGllbmVuLlxyXG4gIGlmICghYWx0YUNsaUZpbGVzLmZvdG9zLmxlbmd0aCkgZXJyb3JzLnB1c2goJ0ZvdG9zIGRlbCBsb2NhbCAoYWwgbWVub3MgMSknKTtcclxuICBpZiAoZXJyb3JzLmxlbmd0aCkge1xyXG4gICAgYWxlcnQoJ0ZhbHRhbiBjb21wbGV0YXI6XFxuXFxuLSAnICsgZXJyb3JzLmpvaW4oJ1xcbi0gJykpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbnZpYXIgbGEgc29saWNpdHVkIGRlIGFsdGEgZGUgXCInICtcclxuICAgICAgICByZWFkKCdhYy1jb21lcmNpbycpICtcclxuICAgICAgICAnXCI/XFxuXFxuTGVzIHZhIGEgbGxlZ2FyIGNvbW8gdGFyZWEgYSBsb3MgYXByb2JhZG9yZXMgKFNhbnRpYWdvIHkgRGllZ28pLiBDdWFuZG8gYW1ib3MgYXBydWViZW4sIGVsIGNsaWVudGUgcXVlZGEgZGFkbyBkZSBhbHRhIHkgdmFzIGEgcG9kZXIgY2FyZ2FybGUgcGVkaWRvcy4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG5cclxuICBjb25zdCBkYXRhID0ge1xyXG4gICAgLy8gRGF0b3MgY29tZXJjaW9cclxuICAgIGVtYWlsOiByZWFkKCdhYy1lbWFpbCcpLFxyXG4gICAgY29tZXJjaW86IHJlYWQoJ2FjLWNvbWVyY2lvJyksXHJcbiAgICBmYW50YXNpYTogcmVhZCgnYWMtZmFudGFzaWEnKSxcclxuICAgIGN1aXQ6IHJlYWQoJ2FjLWN1aXQnKSxcclxuICAgIGNvbmRpY2lvbkZpc2NhbDogcmVhZCgnYWMtY29uZGZpc2NhbCcpLFxyXG4gICAgY2FsbGU6IHJlYWQoJ2FjLWNhbGxlJyksXHJcbiAgICBudW1lcm86IHJlYWQoJ2FjLW51bWVybycpLFxyXG4gICAgbG9jYWxpZGFkOiByZWFkKCdhYy1sb2NhbGlkYWQnKSxcclxuICAgIHByb3ZpbmNpYTogcmVhZCgnYWMtcHJvdmluY2lhJyksXHJcbiAgICBjcDogcmVhZCgnYWMtY3AnKSxcclxuICAgIHRlbGVmb25vOiByZWFkKCdhYy10ZWxlZm9ubycpLFxyXG4gICAgd2ViOiByZWFkKCdhYy13ZWInKSxcclxuICAgIHJlZGVzOiByZWFkKCdhYy1yZWRlcycpLFxyXG4gICAgLy8gQ29udGFjdG9cclxuICAgIGNvbnRhY3RvTm9tYnJlOiByZWFkKCdhYy1jb250YWN0by1ub21icmUnKSxcclxuICAgIGNvbnRhY3RvVGVsUGFydGljdWxhcjogcmVhZCgnYWMtY29udGFjdG8tdGVscGFydCcpLFxyXG4gICAgY29udGFjdG9XaGF0c2FwcDogcmVhZCgnYWMtY29udGFjdG8td3NwJyksXHJcbiAgICBjb250YWN0b0VtYWlsOiByZWFkKCdhYy1jb250YWN0by1lbWFpbCcpLFxyXG4gICAgdGlwb0NvbWVyY2lvOiByZWFkKCdhYy10aXBvY29tZXJjaW8nKSxcclxuICAgIHRpZW5kYU9ubGluZTogcmVhZCgnYWMtdGllbmRhb25saW5lJyksXHJcbiAgICAvLyBEb2N1bWVudG9zXHJcbiAgICBjb25zdGFuY2lhQXJjYTogYWx0YUNsaUZpbGVzLmFyY2EsXHJcbiAgICBjb25zdGFuY2lhSUlCQjogYWx0YUNsaUZpbGVzLmlpYmIsXHJcbiAgICBmb3Rvc0xvY2FsOiBhbHRhQ2xpRmlsZXMuZm90b3Muc2xpY2UoKSxcclxuICAgIC8vIE1ldGFkYXRhXHJcbiAgICBvd25lclVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgb3duZXJFbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICBvd25lck5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgdmVuZG9yOiBhc3NpZ25lZFZlbmRvciB8fCBudWxsLFxyXG4gICAgc3RhdHVzOiAncGVuZGluZ19hcHByb3ZhbCcsXHJcbiAgICBhcHByb3ZhbHM6IHt9LFxyXG4gICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICB9O1xyXG4gIGNvbnN0IGJ0biA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNhbHRhLWNsaS1mb3JtIC5idG4tY29uZmlybScpO1xyXG4gIGlmIChidG4pIHtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFuZG8uLi4nO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgY29uc3QgZG9jUmVmID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuYWRkKGRhdGEpO1xyXG4gICAgLy8gTm90aWZpY2FyIGEgY2FkYSBhcHJvYmFkb3JcclxuICAgIGNvbnN0IGFwcHJvdmVycyA9IGF3YWl0IGZpbmRBcHByb3ZlclVpZHMoKTtcclxuICAgIGZvciAoY29uc3QgdSBvZiBhcHByb3ZlcnMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5hZGQoe1xyXG4gICAgICAgICAgdHlwZTogJ2NsaWVudF9hcHByb3ZhbCcsXHJcbiAgICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICBmcm9tRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgZnJvbU5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgdGFyZ2V0VWlkOiB1LnVpZCxcclxuICAgICAgICAgIHRhcmdldEVtYWlsOiB1LmVtYWlsLFxyXG4gICAgICAgICAgdGl0bGU6ICdOdWV2YSBzb2xpY2l0dWQgZGUgYWx0YTogJyArIGRhdGEuY29tZXJjaW8sXHJcbiAgICAgICAgICBkZXNjcmlwdGlvbjpcclxuICAgICAgICAgICAgJ1ZlbmRlZG9yOiAnICtcclxuICAgICAgICAgICAgKGRhdGEub3duZXJOYW1lIHx8IGRhdGEub3duZXJFbWFpbCkgK1xyXG4gICAgICAgICAgICAnXFxuQ1VJVDogJyArXHJcbiAgICAgICAgICAgIGRhdGEuY3VpdCArXHJcbiAgICAgICAgICAgICdcXG5Mb2NhbGlkYWQ6ICcgK1xyXG4gICAgICAgICAgICBkYXRhLmxvY2FsaWRhZCArXHJcbiAgICAgICAgICAgICcsICcgK1xyXG4gICAgICAgICAgICB0aXRsZUNhc2UoZGF0YS5wcm92aW5jaWEpICtcclxuICAgICAgICAgICAgJ1xcbkNvbmRpY2lcdTAwRjNuIGZpc2NhbDogJyArXHJcbiAgICAgICAgICAgIGRhdGEuY29uZGljaW9uRmlzY2FsLFxyXG4gICAgICAgICAgYXBwbGljYXRpb25JZDogZG9jUmVmLmlkLFxyXG4gICAgICAgICAgc3RhdHVzOiAndW5yZWFkJyxcclxuICAgICAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ25vdGlmIGFwcHJvdmVyJywgdS5lbWFpbCwgZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHNob3dTeW5jVGFnKCdTb2xpY2l0dWQgZW52aWFkYS4gQXByb2JhZG9yZXMgbm90aWZpY2Fkb3MuJyk7XHJcbiAgICByZXNldEFsdGFDbGlGb3JtKCk7XHJcbiAgICBzZXRBbHRhQ2xpU3VidGFiKCdtaWFzJyk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgY29uc29sZS5lcnJvcignc3VibWl0IGNsaWVudCBhcHAnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBlbnZpYW5kbzogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH0gZmluYWxseSB7XHJcbiAgICBpZiAoYnRuKSB7XHJcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFyIHNvbGljaXR1ZCBkZSBhbHRhJztcclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmaW5kQXBwcm92ZXJVaWRzKCkge1xyXG4gIC8vIEJ1c2NhIGVuIC9yb2xlcyBsb3MgdWlkcyBkZSBsb3MgYXByb2JhZG9yZXMgcG9yIGVtYWlsXHJcbiAgY29uc3Qgb3V0ID0gW107XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHFzID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdyb2xlcycpLmdldCgpO1xyXG4gICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICBjb25zdCBkYXRhID0gZC5kYXRhKCkgfHwge307XHJcbiAgICAgIGNvbnN0IGVtID0gKGRhdGEuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICAgIGlmIChDTElFTlRfQVBQTElDQVRJT05fQVBQUk9WRVJfRU1BSUxTLmluZGV4T2YoZW0pID49IDApIHtcclxuICAgICAgICBvdXQucHVzaCh7IHVpZDogZC5pZCwgZW1haWw6IGVtIH0pO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLndhcm4oJ2ZpbmRBcHByb3ZlclVpZHMnLCBlKTtcclxuICB9XHJcbiAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyQWx0YUNsaU1pc1NvbGljaXR1ZGVzKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWMtbWlhcy1saXN0Jyk7XHJcbiAgaWYgKCFjb250KSByZXR1cm47XHJcbiAgaWYgKCFhbHRhQ2xpTWluZS5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJub3RpZi1lbXB0eVwiPk5vIGVudmlhc3RlIHNvbGljaXR1ZGVzIHRvZGF2aWEuIFVzYSBsYSBwZXN0YVx1MDBGMWEgPGI+TnVldmEgc29saWNpdHVkPC9iPi48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBsZXQgaHRtbCA9ICcnO1xyXG4gIGFsdGFDbGlNaW5lLmZvckVhY2goKGEpID0+IHtcclxuICAgIGNvbnN0IHN0Q2xzID1cclxuICAgICAgYS5zdGF0dXMgPT09ICdhcHByb3ZlZCcgPyAnYXBwcm92ZWQnIDogYS5zdGF0dXMgPT09ICdyZWplY3RlZCcgPyAncmVqZWN0ZWQnIDogJ3BlbmRpbmcnO1xyXG4gICAgY29uc3Qgc3RMYmwgPVxyXG4gICAgICBhLnN0YXR1cyA9PT0gJ2FwcHJvdmVkJyA/ICdBcHJvYmFkYScgOiBhLnN0YXR1cyA9PT0gJ3JlamVjdGVkJyA/ICdSZWNoYXphZGEnIDogJ1BlbmRpZW50ZSc7XHJcbiAgICBjb25zdCBkdCA9IGEuY3JlYXRlZEF0ID8gKGEuY3JlYXRlZEF0LnRvRGF0ZSA/IGEuY3JlYXRlZEF0LnRvRGF0ZSgpIDogbnVsbCkgOiBudWxsO1xyXG4gICAgY29uc3QgZHRTdHIgPSBkdCA/IGR0LnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpIDogJyc7XHJcbiAgICBjb25zdCBhcENvdW50ID0gYS5hcHByb3ZhbHMgPyBPYmplY3Qua2V5cyhhLmFwcHJvdmFscykubGVuZ3RoIDogMDtcclxuICAgIGNvbnN0IGlzUmFwaWRhID0gYS5zb3VyY2UgPT09ICdhbHRhX3JhcGlkYSc7XHJcbiAgICBjb25zdCBoYXNTYXAgPSAhIWEuY2FyZENvZGVTYXA7XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiYWMtYXBwLWNhcmQgJyArIHN0Q2xzICsgJ1wiPic7XHJcbiAgICBodG1sICs9ICc8aDU+JyArIGVzY2FwZUh0bWwoYS5jb21lcmNpbyB8fCAnLScpICsgJzwvaDU+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJhYy1hcHAtbWV0YVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGEuZmFudGFzaWEgfHwgJycpICtcclxuICAgICAgJyAmbWlkZG90OyBDVUlUICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKGEuY3VpdCB8fCAnJykgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGh0bWwgKz1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJhYy1hcHAtbWV0YVwiPicgK1xyXG4gICAgICBlc2NhcGVIdG1sKGEubG9jYWxpZGFkIHx8ICcnKSArXHJcbiAgICAgICcgJm1pZGRvdDsgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwodGl0bGVDYXNlKGEucHJvdmluY2lhIHx8ICcnKSkgK1xyXG4gICAgICAnICZtaWRkb3Q7IEVudmlhZGEgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwoZHRTdHIpICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICBodG1sICs9ICc8ZGl2PjxzcGFuIGNsYXNzPVwiYWMtYXBwLXN0YXR1c1wiPicgKyBzdExibCArICc8L3NwYW4+JztcclxuICAgIGlmIChhLnN0YXR1cyA9PT0gJ3BlbmRpbmdfYXBwcm92YWwnKSB7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnIDxzcGFuIHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLWxlZnQ6NnB4XCI+JyArXHJcbiAgICAgICAgYXBDb3VudCArXHJcbiAgICAgICAgJy8yIGFwcm9iYWNpb25lczwvc3Bhbj4nO1xyXG4gICAgfVxyXG4gICAgaWYgKGEuc3RhdHVzID09PSAncmVqZWN0ZWQnICYmIGEucmVqZWN0ZWRSZWFzb24pIHtcclxuICAgICAgaHRtbCArPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7bWFyZ2luLXRvcDo0cHhcIj48Yj5Nb3Rpdm86PC9iPiAnICtcclxuICAgICAgICBlc2NhcGVIdG1sKGEucmVqZWN0ZWRSZWFzb24pICtcclxuICAgICAgICAnPC9kaXY+JztcclxuICAgIH1cclxuICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICAvLyBCb3RvbiBlbGltaW5hci4gUGFyYSBhbHRhcyByYXBpZGFzIHNlIHBlcm1pdGUgc2llbXByZSAobWllbnRyYXNcclxuICAgIC8vIG5vIGVzdGVuIGNhcmdhZGFzIGVuIFNBUCkuIFBhcmEgYWx0YXMgZm9ybWFsZXMgc2UgcGVybWl0ZSBjdWFuZG9cclxuICAgIC8vIGVzdGFuIHBlbmRpZW50ZXMgbyByZWNoYXphZGFzIC0gYXByb2JhZGFzIGNvbiBjYXJkQ29kZSBubyBzZSBwdWVkZW5cclxuICAgIC8vIGJvcnJhciBkZXNkZSBhY2EgKHNlIG1hbmVqYW4gZGVzZGUgU0FQKS5cclxuICAgIGNvbnN0IGNhbkRlbGV0ZSA9IGlzUmFwaWRhID8gIWhhc1NhcCA6IGEuc3RhdHVzICE9PSAnYXBwcm92ZWQnIHx8ICFoYXNTYXA7XHJcbiAgICBpZiAoY2FuRGVsZXRlKSB7XHJcbiAgICAgIGNvbnN0IHNhZmVJZCA9IGVzY2FwZUF0dHIoYS5fZnNJZCB8fCAnJyk7XHJcbiAgICAgIGNvbnN0IHNhZmVOYW1lID0gSlNPTi5zdHJpbmdpZnkoYS5jb21lcmNpbyB8fCAnJykucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xyXG4gICAgICBodG1sICs9ICc8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo4cHg7dGV4dC1hbGlnbjpyaWdodFwiPic7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPGJ1dHRvbiBvbmNsaWNrPVwiZGVsZXRlTXlBbHRhQ2xpKFxcJycgK1xyXG4gICAgICAgIHNhZmVJZCArXHJcbiAgICAgICAgXCInLCBcIiArXHJcbiAgICAgICAgc2FmZU5hbWUgK1xyXG4gICAgICAgICcpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlci1iZyk7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7Ym9yZGVyOjEuNXB4IHNvbGlkICNmY2E1YTU7Ym9yZGVyLXJhZGl1czo1cHg7cGFkZGluZzo2cHggMTJweDtmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y3Vyc29yOnBvaW50ZXJcIj5FbGltaW5hcjwvYnV0dG9uPic7XHJcbiAgICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgICBodG1sICs9ICc8L2Rpdj4nO1xyXG4gIH0pO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG5cclxud2luZG93LmRlbGV0ZU15QWx0YUNsaSA9IGFzeW5jIGZ1bmN0aW9uIChmc0lkLCBjb21lcmNpbykge1xyXG4gIGlmICghZnNJZCkgcmV0dXJuO1xyXG4gIGNvbnN0IG5vbWJyZSA9IGNvbWVyY2lvIHx8ICdlc3RhIHNvbGljaXR1ZCc7XHJcbiAgaWYgKFxyXG4gICAgIWNvbmZpcm0oXHJcbiAgICAgICdFbGltaW5hciBcIicgK1xyXG4gICAgICAgIG5vbWJyZSArXHJcbiAgICAgICAgJ1wiP1xcblxcbkxhIGFsdGEgc2UgYm9ycmEgZGUgdHVzIHNvbGljaXR1ZGVzIHkgZGVqYSBkZSBhcGFyZWNlciBlbiBQRURJRE9TIC8gVklTSVRBUyAvIG1hcGEuIE5vIHNlIHB1ZWRlIGRlc2hhY2VyLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpLmRvYyhmc0lkKS5kZWxldGUoKTtcclxuICAgIGlmICh0eXBlb2Ygc2hvd1N5bmNUYWcgPT09ICdmdW5jdGlvbicpIHNob3dTeW5jVGFnKCdBbHRhIGVsaW1pbmFkYScpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZU15QWx0YUNsaScsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGVsaW1pbmFuZG8gbGEgc29saWNpdHVkOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbi8vIFJFTkRJQ0lPTkVTIC0gc29saWNpdHVkIGFudGljaXBvICsgZ2FzdG9zIGNvbiBmb3RvICsgYXByb2JhY2lvblxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuLy8gRTIuZSAoZTJiLXBlcmYgMjAyNi0wNy0yOCk6IG1vdmlkbyBhIHNyYy9kb21haW5zL3JlbmRpY2lvbmVzLmpzICg5MDEgTE9DKS5cclxuLy8gQnVuZGxlIHJlZ2lzdHJhIHdpbmRvdy5lbnN1cmVSZW5kaWNpb25lc0xpc3RlbmVyLCB3aW5kb3cub3BlblJlbmRpY2lvbkRldGFpbCxcclxuLy8gd2luZG93LnNldFJlbmRTdWJ0YWIsIHdpbmRvdy5zdWJtaXRSZW5kU29saWNpdHVkLCB3aW5kb3cuc3VibWl0UmVuZEdhc3RvLFxyXG4vLyB3aW5kb3cuYXBwcm92ZVJlbmRpY2lvbiwgd2luZG93LnJlamVjdFJlbmRpY2lvbiwgd2luZG93LmV4cG9ydE1pc1JlbmRpY2lvbmVzRXhjZWwsXHJcbi8vIHdpbmRvdy5zZXRUb2Rhc1JlbmRGaWx0ZXIgKyB+NSBoYW5kbGVycyBkZSBVSSAoYWRqdW50b3MgKyBmb3RvcyArIE9DUiByZXRyeSkuXHJcbi8vIENhbGxlcnMgZGVsIGlubGluZSBsYXMgdXNhbiBzaW4gcHJlZml4LlxyXG4vLyBDcm9zcy1zY29wZSBzdGF0ZTogd2luZG93LnVuc3ViTWlzUmVuZGljaW9uZXMgKyB3aW5kb3cudW5zdWJUb2Rhc1JlbmRpY2lvbmVzXHJcbi8vIChsaXN0ZW5lcnMgY29uIGNsZWFudXAgZW4gZGV0YWNoRmlyZWJhc2VMaXN0ZW5lcnMpIGluaWNpYWxpemFkb3MgcG9yIGVsIGJ1bmRsZS5cclxuLy8gTm90YTogbXlSZW5kaWNpb25lc0FwcHJvdmVyVWlkL0VtYWlsIHNpZ3VlbiBkZWNsYXJhZGFzIGNvbW8gbGV0IGVuIGVsIGlubGluZTtcclxuLy8gZWwgYnVuZGxlIGxhcyBsZWUgdmlhIGZyZWUgcmVmZXJlbmNlIChHbG9iYWwgRW52aXJvbm1lbnQgUmVjb3JkIGNvbXBhcnRpZG8pLlxyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbi8vIERldGFsbGUgZGUgc29saWNpdHVkIGRlIGFsdGEgLT4gYXByb2JhciAvIHJlY2hhemFyXHJcbndpbmRvdy5vcGVuQ2xpZW50QXBwbGljYXRpb25EZXRhaWwgPSBhc3luYyBmdW5jdGlvbiAoYXBwSWQsIG5vdGlmSWQpIHtcclxuICBpZiAoIWFwcElkKSB7XHJcbiAgICBhbGVydCgnU29saWNpdHVkIG5vIGVuY29udHJhZGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS5nZXQoKTtcclxuICAgIGlmICghc25hcC5leGlzdHMpIHtcclxuICAgICAgYWxlcnQoJ0xhIHNvbGljaXR1ZCB5YSBubyBleGlzdGUuJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGEgPSBPYmplY3QuYXNzaWduKHsgX2lkOiBhcHBJZCB9LCBzbmFwLmRhdGEoKSk7XHJcbiAgICBjb25zdCBjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWRldGFpbC1jb250ZW50Jyk7XHJcbiAgICBsZXQgaCA9XHJcbiAgICAgICc8ZGl2IHN0eWxlPVwicGFkZGluZzoxOHB4IDIwcHg7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dC1wcmltYXJ5KTtsaW5lLWhlaWdodDoxLjZcIj4nO1xyXG4gICAgaCArPVxyXG4gICAgICAnPGg0IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6IzA4OTFiMjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjVweDttYXJnaW4tYm90dG9tOjhweDtwYWRkaW5nLWJvdHRvbTo1cHg7Ym9yZGVyLWJvdHRvbToxLjVweCBzb2xpZCAjNjdlOGY5XCI+Q29tZXJjaW88L2g0Pic7XHJcbiAgICBoICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoMiwxZnIpO2dhcDo2cHggMTRweFwiPic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPk5vbWJyZTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY29tZXJjaW8gfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPkZhbnRhc2lhOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5mYW50YXNpYSB8fCAnJykgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+Q1VJVDo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY3VpdCB8fCAnJykgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+Q29uZC4gZmlzY2FsOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jb25kaWNpb25GaXNjYWwgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9XHJcbiAgICAgICc8ZGl2PjxiPkRpcmVjY2lvbjo8L2I+ICcgK1xyXG4gICAgICBlc2NhcGVIdG1sKGEuY2FsbGUgfHwgJycpICtcclxuICAgICAgJyAnICtcclxuICAgICAgZXNjYXBlSHRtbChhLm51bWVybyB8fCAnJykgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+Q1A6PC9iPiAnICsgZXNjYXBlSHRtbChhLmNwIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdj48Yj5Mb2NhbGlkYWQ6PC9iPiAnICsgZXNjYXBlSHRtbChhLmxvY2FsaWRhZCB8fCAnJykgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+UHJvdmluY2lhOjwvYj4gJyArIGVzY2FwZUh0bWwodGl0bGVDYXNlKGEucHJvdmluY2lhIHx8ICcnKSkgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+VGVsZWZvbm86PC9iPiAnICsgZXNjYXBlSHRtbChhLnRlbGVmb25vIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdj48Yj5FbWFpbDo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuZW1haWwgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2IHN0eWxlPVwiZ3JpZC1jb2x1bW46MS8tMVwiPjxiPldlYjo8L2I+ICcgKyBlc2NhcGVIdG1sKGEud2ViIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdiBzdHlsZT1cImdyaWQtY29sdW1uOjEvLTFcIj48Yj5SZWRlczo8L2I+ICcgKyBlc2NhcGVIdG1sKGEucmVkZXMgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8L2Rpdj4nO1xyXG4gICAgaCArPVxyXG4gICAgICAnPGg0IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6IzA4OTFiMjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjVweDttYXJnaW46MTRweCAwIDhweDtwYWRkaW5nLWJvdHRvbTo1cHg7Ym9yZGVyLWJvdHRvbToxLjVweCBzb2xpZCAjNjdlOGY5XCI+Q29udGFjdG88L2g0Pic7XHJcbiAgICBoICs9ICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoMiwxZnIpO2dhcDo2cHggMTRweFwiPic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPk5vbWJyZTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEuY29udGFjdG9Ob21icmUgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPlRlbCBwYXJ0aWN1bGFyOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jb250YWN0b1RlbFBhcnRpY3VsYXIgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPldoYXRzQXBwOjwvYj4gJyArIGVzY2FwZUh0bWwoYS5jb250YWN0b1doYXRzYXBwIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdj48Yj5FLW1haWw6PC9iPiAnICsgZXNjYXBlSHRtbChhLmNvbnRhY3RvRW1haWwgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2PjxiPlRpcG8gY29tZXJjaW86PC9iPiAnICsgZXNjYXBlSHRtbChhLnRpcG9Db21lcmNpbyB8fCAnJykgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXY+PGI+VGllbmRhIG9ubGluZTo8L2I+ICcgKyBlc2NhcGVIdG1sKGEudGllbmRhT25saW5lIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPC9kaXY+JztcclxuICAgIGggKz1cclxuICAgICAgJzxoNCBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2NvbG9yOiMwODkxYjI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi41cHg7bWFyZ2luOjE0cHggMCA4cHg7cGFkZGluZy1ib3R0b206NXB4O2JvcmRlci1ib3R0b206MS41cHggc29saWQgIzY3ZThmOVwiPkRvY3VtZW50YWNpJm9hY3V0ZTtuPC9oND4nO1xyXG4gICAgaCArPSAnPGRpdiBzdHlsZT1cImRpc3BsYXk6ZmxleDtmbGV4LXdyYXA6d3JhcDtnYXA6OHB4XCI+JztcclxuICAgIGlmIChhLmNvbnN0YW5jaWFBcmNhKVxyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXJnaW4tYm90dG9tOjNweDtmb250LXdlaWdodDo3MDA7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+QVJDQTwvZGl2PjxpbWcgc3JjPVwiJyArXHJcbiAgICAgICAgYS5jb25zdGFuY2lhQXJjYSArXHJcbiAgICAgICAgJ1wiIGlkPVwiY2EtYXJjYS1pbWdcIiBjbGFzcz1cInRhc2staW1nLXRodW1iXCIgc3R5bGU9XCJ3aWR0aDo5MHB4O2hlaWdodDo5MHB4XCIgb25jbGljaz1cIm9wZW5JbWdWaWV3ZXIoXFwnY2EtYXJjYS1pbWdcXCcpXCIvPjwvZGl2Pic7XHJcbiAgICBpZiAoYS5jb25zdGFuY2lhSUlCQilcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjpjZW50ZXJcIj48ZGl2IHN0eWxlPVwiZm9udC1zaXplOjlweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7bWFyZ2luLWJvdHRvbTozcHg7Zm9udC13ZWlnaHQ6NzAwO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZVwiPklJQkI8L2Rpdj48aW1nIHNyYz1cIicgK1xyXG4gICAgICAgIGEuY29uc3RhbmNpYUlJQkIgK1xyXG4gICAgICAgICdcIiBpZD1cImNhLWlpYmItaW1nXCIgY2xhc3M9XCJ0YXNrLWltZy10aHVtYlwiIHN0eWxlPVwid2lkdGg6OTBweDtoZWlnaHQ6OTBweFwiIG9uY2xpY2s9XCJvcGVuSW1nVmlld2VyKFxcJ2NhLWlpYmItaW1nXFwnKVwiLz48L2Rpdj4nO1xyXG4gICAgKGEuZm90b3NMb2NhbCB8fCBbXSkuZm9yRWFjaCgoZiwgaSkgPT4ge1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlclwiPjxkaXYgc3R5bGU9XCJmb250LXNpemU6OXB4O2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTttYXJnaW4tYm90dG9tOjNweDtmb250LXdlaWdodDo3MDA7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlXCI+TG9jYWwgJyArXHJcbiAgICAgICAgKGkgKyAxKSArXHJcbiAgICAgICAgJzwvZGl2PjxpbWcgc3JjPVwiJyArXHJcbiAgICAgICAgZiArXHJcbiAgICAgICAgJ1wiIGlkPVwiY2EtZm90by0nICtcclxuICAgICAgICBpICtcclxuICAgICAgICAnXCIgY2xhc3M9XCJ0YXNrLWltZy10aHVtYlwiIHN0eWxlPVwid2lkdGg6OTBweDtoZWlnaHQ6OTBweFwiIG9uY2xpY2s9XCJvcGVuSW1nVmlld2VyKFxcJ2NhLWZvdG8tJyArXHJcbiAgICAgICAgaSArXHJcbiAgICAgICAgJ1xcJylcIi8+PC9kaXY+JztcclxuICAgIH0pO1xyXG4gICAgaCArPSAnPC9kaXY+JztcclxuICAgIGggKz1cclxuICAgICAgJzxoNCBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2NvbG9yOiMwODkxYjI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi41cHg7bWFyZ2luOjE0cHggMCA4cHg7cGFkZGluZy1ib3R0b206NXB4O2JvcmRlci1ib3R0b206MS41cHggc29saWQgIzY3ZThmOVwiPk9yaWdlbjwvaDQ+JztcclxuICAgIGggKz0gJzxkaXY+VmVuZGVkb3I6IDxiPicgKyBlc2NhcGVIdG1sKGEub3duZXJOYW1lIHx8IGEub3duZXJFbWFpbCB8fCAnLScpICsgJzwvYj48L2Rpdj4nO1xyXG4gICAgY29uc3QgYXBOID0gYS5hcHByb3ZhbHMgPyBPYmplY3Qua2V5cyhhLmFwcHJvdmFscykubGVuZ3RoIDogMDtcclxuICAgIGggKz0gJzxkaXY+QXByb2JhY2lvbmVzIHJlY2liaWRhczogPGI+JyArIGFwTiArICcgLyAyPC9iPjwvZGl2Pic7XHJcbiAgICBpZiAoYS5hcHByb3ZhbHMpIHtcclxuICAgICAgT2JqZWN0LmtleXMoYS5hcHByb3ZhbHMpLmZvckVhY2goKHVpZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGFwID0gYS5hcHByb3ZhbHNbdWlkXTtcclxuICAgICAgICBoICs9XHJcbiAgICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLWNvbG9yLXN1Y2Nlc3MpO21hcmdpbi1sZWZ0OjhweFwiPiYjMTAwMDM7ICcgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbChhcC5lbWFpbCB8fCB1aWQpICtcclxuICAgICAgICAgICc8L2Rpdj4nO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIGlmIChhLnN0YXR1cyA9PT0gJ3JlamVjdGVkJykge1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlci1iZyk7Ym9yZGVyOjFweCBzb2xpZCAjZmNhNWE1O2JvcmRlci1yYWRpdXM6NHB4O3BhZGRpbmc6OHB4O21hcmdpbi10b3A6OHB4O2NvbG9yOnZhcigtLWNvbG9yLWRhbmdlci1zdHJvbmcpXCI+PGI+UkVDSEFaQURBPC9iPiBwb3IgJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbChhLnJlamVjdGVkQnlFbWFpbCB8fCAnJykgK1xyXG4gICAgICAgICcuIE1vdGl2bzogJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbChhLnJlamVjdGVkUmVhc29uIHx8ICctJykgK1xyXG4gICAgICAgICc8L2Rpdj4nO1xyXG4gICAgfVxyXG4gICAgLy8gQmxvcXVlIGRlIFwiZGF0b3MgZGVsIGFwcm9iYWRvclwiIC0gc29sbyB2aXNpYmxlIHNpIHNveSBhcHJvYmFkb3IgeSBub1xyXG4gICAgLy8gZGkgbWkgYXByb2JhY2lvbiB0b2RhdmlhLiBBY2EgZWwgYXByb2JhZG9yIGNvbXBsZXRhIGluZm8gcXVlIGxhXHJcbiAgICAvLyBzb2xpY2l0dWQgbm8gdHJhZSBkZWwgbGFkbyBkZWwgdmVuZGVkb3I6XHJcbiAgICAvLyAtIGNhcmRDb2RlIFNBUDogQlAgYSB1c2FyIGVuIHBlZGlkb3MgKHNpbiBlc3RvIG5vIGVudHJhIGVsIFpJUCBEVFcpXHJcbiAgICAvLyAtIGFzc2lnbmVkVmVuZG9yOiB2ZW5kb3IgcXVlIHZhIGEgYXRlbmRlciBsYSB0aWVuZGEgKGFwYXJlY2UgZW4gc3UgbWFwYSlcclxuICAgIC8vIC0gbG9jYWxpZGFkRmluYWw6IHBvciBzaSBsYSBsb2NhbGlkYWQgZGVjbGFyYWRhIG5vIG1hdGNoZWEgY29uIGVsIG1hcGFcclxuICAgIGNvbnN0IG1lRW1haWwgPSAoY3VycmVudFVzZXIuZW1haWwgfHwgJycpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCBpQW1BcHByb3ZlciA9IENMSUVOVF9BUFBMSUNBVElPTl9BUFBST1ZFUl9FTUFJTFMuaW5kZXhPZihtZUVtYWlsKSA+PSAwO1xyXG4gICAgY29uc3QgaUFscmVhZHlBcHByb3ZlZCA9IGEuYXBwcm92YWxzICYmIGEuYXBwcm92YWxzW2N1cnJlbnRVc2VyLnVpZF07XHJcbiAgICBpZiAoYS5zdGF0dXMgPT09ICdwZW5kaW5nX2FwcHJvdmFsJyAmJiBpQW1BcHByb3ZlciAmJiAhaUFscmVhZHlBcHByb3ZlZCkge1xyXG4gICAgICBjb25zdCBwcmVDYXJkQ29kZSA9IGEuY2FyZENvZGVTYXAgfHwgJyc7XHJcbiAgICAgIGNvbnN0IHByZVZlbmRvciA9IGEuYXNzaWduZWRWZW5kb3IgfHwgJyc7XHJcbiAgICAgIGNvbnN0IHByZUxvYyA9IGEubG9jYWxpZGFkRmluYWwgfHwgYS5sb2NhbGlkYWQgfHwgJyc7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGg0IHN0eWxlPVwiZm9udC1zaXplOjEycHg7Y29sb3I6IzA4OTFiMjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjVweDttYXJnaW46MTRweCAwIDhweDtwYWRkaW5nLWJvdHRvbTo1cHg7Ym9yZGVyLWJvdHRvbToxLjVweCBzb2xpZCAjNjdlOGY5XCI+RGF0b3MgZGVsIGFwcm9iYWRvcjwvaDQ+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnI7Z2FwOjhweDtiYWNrZ3JvdW5kOnZhcigtLWJnLXNlY29uZGFyeSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXItc3VidGxlKTtib3JkZXItcmFkaXVzOjZweDtwYWRkaW5nOjEycHhcIj4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXY+PGxhYmVsIHN0eWxlPVwiZm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQtc2Vjb25kYXJ5KTtkaXNwbGF5OmJsb2NrO21hcmdpbi1ib3R0b206NHB4XCI+Q2FyZENvZGUgU0FQIEIxIDxzcGFuIHN0eWxlPVwiY29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyKVwiPio8L3NwYW4+PC9sYWJlbD4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxpbnB1dCBpZD1cImNhLWNhcmRjb2RlXCIgdHlwZT1cInRleHRcIiBwbGFjZWhvbGRlcj1cIkMtMTIzNDUgLyBkZWphciB2YWNpbyBzaSB0b2RhdmlhIG5vIHNlIGNyZW8gZWwgQlBcIiB2YWx1ZT1cIicgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIocHJlQ2FyZENvZGUpICtcclxuICAgICAgICAnXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6N3B4IDEwcHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTJweDtmb250LWZhbWlseTpDb25zb2xhcyxtb25vc3BhY2U7Zm9udC13ZWlnaHQ6NzAwXCIvPic7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMHB4O2NvbG9yOnZhcigtLXRleHQtbXV0ZWQpO21hcmdpbi10b3A6M3B4XCI+U2luIENhcmRDb2RlIGxhIHRpZW5kYSBhcGFyZWNlIGVuIGVsIG1hcGEgcGVybyBubyBzZSBwdWVkZSBjcmVhciBwZWRpZG8gKERUVyBsbyBuZWNlc2l0YSkuPC9kaXY+PC9kaXY+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8ZGl2PjxsYWJlbCBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7ZGlzcGxheTpibG9jazttYXJnaW4tYm90dG9tOjRweFwiPkFzaWduYXIgYSB2ZW5kZWRvciA8c3BhbiBzdHlsZT1cImNvbG9yOnZhcigtLWNvbG9yLWRhbmdlcilcIj4qPC9zcGFuPjwvbGFiZWw+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8c2VsZWN0IGlkPVwiY2EtdmVuZG9yXCIgc3R5bGU9XCJ3aWR0aDoxMDAlO3BhZGRpbmc6N3B4IDEwcHg7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjVweDtmb250LXNpemU6MTJweDtiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKVwiPic7XHJcbiAgICAgIGggKz0gJzxvcHRpb24gdmFsdWU9XCJcIj4tIEVsZWdpciB2ZW5kZWRvciAtPC9vcHRpb24+JztcclxuICAgICAgaCArPSAnPG9wdGdyb3VwIGxhYmVsPVwiVmVuZGVkb3JlcyBleHRlcm5vcyAoVkRFKVwiPic7XHJcbiAgICAgIFZFTkRPUlMuZmlsdGVyKCh2KSA9PiBWREVfVkVORE9SX0tFWVMuaGFzKHYua2V5KSkuZm9yRWFjaCgodikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHNlbCA9IHYua2V5ID09PSBwcmVWZW5kb3IgPyAnIHNlbGVjdGVkJyA6ICcnO1xyXG4gICAgICAgIGggKz1cclxuICAgICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHYua2V5KSArXHJcbiAgICAgICAgICAnXCInICtcclxuICAgICAgICAgIHNlbCArXHJcbiAgICAgICAgICAnPicgK1xyXG4gICAgICAgICAgZXNjYXBlSHRtbCh2LnpvbmUgKyAnIC0gJyArIHRpdGxlQ2FzZSh2LmtleSkpICtcclxuICAgICAgICAgICc8L29wdGlvbj4nO1xyXG4gICAgICB9KTtcclxuICAgICAgaCArPSAnPC9vcHRncm91cD4nO1xyXG4gICAgICBoICs9ICc8b3B0Z3JvdXAgbGFiZWw9XCJWZW5kZWRvcmVzIGludGVybm9zIChWREkpXCI+JztcclxuICAgICAgVkVORE9SUy5maWx0ZXIoKHYpID0+IFZESV9WRU5ET1JfS0VZUy5oYXModi5rZXkpKS5mb3JFYWNoKCh2KSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc2VsID0gdi5rZXkgPT09IHByZVZlbmRvciA/ICcgc2VsZWN0ZWQnIDogJyc7XHJcbiAgICAgICAgaCArPVxyXG4gICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCInICtcclxuICAgICAgICAgIGVzY2FwZUF0dHIodi5rZXkpICtcclxuICAgICAgICAgICdcIicgK1xyXG4gICAgICAgICAgc2VsICtcclxuICAgICAgICAgICc+JyArXHJcbiAgICAgICAgICBlc2NhcGVIdG1sKHRpdGxlQ2FzZSh2LmtleSkpICtcclxuICAgICAgICAgICc8L29wdGlvbj4nO1xyXG4gICAgICB9KTtcclxuICAgICAgaCArPSAnPC9vcHRncm91cD4nO1xyXG4gICAgICBoICs9ICc8b3B0Z3JvdXAgbGFiZWw9XCJPdHJhcyBhc2lnbmFjaW9uZXNcIj4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJfX0RJU1RSSUJVVE9SX19cIicgK1xyXG4gICAgICAgIChwcmVWZW5kb3IgPT09ICdfX0RJU1RSSUJVVE9SX18nID8gJyBzZWxlY3RlZCcgOiAnJykgK1xyXG4gICAgICAgICc+RElTVFJJQlVJRE9SPC9vcHRpb24+JztcclxuICAgICAgaCArPSAnPC9vcHRncm91cD4nO1xyXG4gICAgICBoICs9ICc8L3NlbGVjdD4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS10ZXh0LW11dGVkKTttYXJnaW4tdG9wOjNweFwiPkVsIHZlbmRlZG9yIGVsZWdpZG8gdmEgYSB2ZXIgbGEgdGllbmRhIGVuIHN1IG1hcGEgcGFyYSBjcmVhciBwZWRpZG9zLjwvZGl2PjwvZGl2Pic7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGRpdj48bGFiZWwgc3R5bGU9XCJmb250LXNpemU6MTFweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dC1zZWNvbmRhcnkpO2Rpc3BsYXk6YmxvY2s7bWFyZ2luLWJvdHRvbTo0cHhcIj5Mb2NhbGlkYWQgZmluYWwgKGNvbW8gYXBhcmVjZSBlbiBlbCBtYXBhKTwvbGFiZWw+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8aW5wdXQgaWQ9XCJjYS1sb2MtZmluYWxcIiB0eXBlPVwidGV4dFwiIHBsYWNlaG9sZGVyPVwiJyArXHJcbiAgICAgICAgZXNjYXBlQXR0cihhLmxvY2FsaWRhZCB8fCAnJykgK1xyXG4gICAgICAgICdcIiB2YWx1ZT1cIicgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIocHJlTG9jKSArXHJcbiAgICAgICAgJ1wiIHN0eWxlPVwid2lkdGg6MTAwJTtwYWRkaW5nOjdweCAxMHB4O2JvcmRlcjoxLjVweCBzb2xpZCB2YXIoLS1ib3JkZXItZGVmYXVsdCk7Ym9yZGVyLXJhZGl1czo1cHg7Zm9udC1zaXplOjEycHhcIi8+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEwcHg7Y29sb3I6dmFyKC0tdGV4dC1tdXRlZCk7bWFyZ2luLXRvcDozcHhcIj5TaSBsYSBsb2NhbGlkYWQgZGVjbGFyYWRhIHBvciBlbCB2ZW5kZWRvciAoJyArXHJcbiAgICAgICAgZXNjYXBlSHRtbChhLmxvY2FsaWRhZCB8fCAnLScpICtcclxuICAgICAgICAnKSBubyBtYXRjaGVhIGNvbiBlbCBtYXBhLCBhanVzdGFsYSBhY2EuPC9kaXY+PC9kaXY+JztcclxuICAgICAgaCArPSAnPC9kaXY+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2dhcDoxMHB4O21hcmdpbi10b3A6MTZweDtwYWRkaW5nLXRvcDoxNHB4O2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1zdWJ0bGUpXCI+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwicW1vZGFsLWJ0biBwcmltYXJ5XCIgc3R5bGU9XCJmbGV4OjFcIiBvbmNsaWNrPVwiYXBwcm92ZUNsaWVudEFwcGxpY2F0aW9uKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIoYXBwSWQpICtcclxuICAgICAgICBcIicsJ1wiICtcclxuICAgICAgICBlc2NhcGVBdHRyKG5vdGlmSWQgfHwgJycpICtcclxuICAgICAgICAnXFwnKVwiPkFwcm9iYXI8L2J1dHRvbj4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJxbW9kYWwtYnRuIGRhbmdlclwiIHN0eWxlPVwiZmxleDoxXCIgb25jbGljaz1cInJlamVjdENsaWVudEFwcGxpY2F0aW9uKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIoYXBwSWQpICtcclxuICAgICAgICBcIicsJ1wiICtcclxuICAgICAgICBlc2NhcGVBdHRyKG5vdGlmSWQgfHwgJycpICtcclxuICAgICAgICAnXFwnKVwiPlJlY2hhemFyPC9idXR0b24+JztcclxuICAgICAgaCArPSAnPC9kaXY+JztcclxuICAgIH0gZWxzZSBpZiAoaUFscmVhZHlBcHByb3ZlZCkge1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLXN1Y2Nlc3MtYmcpO2JvcmRlcjoxcHggc29saWQgIzg2ZWZhYztib3JkZXItcmFkaXVzOjRweDtwYWRkaW5nOjhweDttYXJnaW4tdG9wOjE0cHg7Y29sb3I6dmFyKC0tY29sb3Itc3VjY2Vzcyk7dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC13ZWlnaHQ6NzAwXCI+JiMxMDAwMzsgWWEgYXByb2Jhc3RlIGVzdGEgc29saWNpdHVkPC9kaXY+JztcclxuICAgIH1cclxuICAgIGggKz0gJzwvZGl2Pic7XHJcbiAgICBjLmlubmVySFRNTCA9IGg7XHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2EtZGV0YWlsLW1vZGFsJykuY2xhc3NMaXN0LmFkZCgnb3BlbicpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ29wZW4gY2xpZW50IGFwcCBkZXRhaWwnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxud2luZG93LmNsb3NlQ2xpZW50QXBwbGljYXRpb25EZXRhaWwgPSBmdW5jdGlvbiAoKSB7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWRldGFpbC1tb2RhbCcpLmNsYXNzTGlzdC5yZW1vdmUoJ29wZW4nKTtcclxufTtcclxuXHJcbndpbmRvdy5hcHByb3ZlQ2xpZW50QXBwbGljYXRpb24gPSBhc3luYyBmdW5jdGlvbiAoYXBwSWQsIG5vdGlmSWQpIHtcclxuICAvLyBMZWVyIGxvcyAzIGlucHV0cyBkZWwgYmxvcXVlIFwiRGF0b3MgZGVsIGFwcm9iYWRvclwiIGFudGVzIGRlIGNvbmZpcm1hci5cclxuICAvLyBDYXJkQ29kZSB5IHZlbmRvciBzb24gb2JsaWdhdG9yaW9zOyBsb2NhbGlkYWRGaW5hbCBwdWVkZSBxdWVkYXIgdmFjaWFcclxuICAvLyAoZmFsbGJhY2sgYSBsYSBkZWNsYXJhZGEgcG9yIGVsIHZlbmRlZG9yKS5cclxuICBjb25zdCBjYXJkQ29kZUVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NhLWNhcmRjb2RlJyk7XHJcbiAgY29uc3QgdmVuZG9yRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2EtdmVuZG9yJyk7XHJcbiAgY29uc3QgbG9jRmluYWxFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjYS1sb2MtZmluYWwnKTtcclxuICBjb25zdCBjYXJkQ29kZSA9IGNhcmRDb2RlRWwgPyBjYXJkQ29kZUVsLnZhbHVlLnRyaW0oKSA6ICcnO1xyXG4gIGNvbnN0IGFzc2lnbmVkVmVuZG9yID0gdmVuZG9yRWwgPyB2ZW5kb3JFbC52YWx1ZSA6ICcnO1xyXG4gIGNvbnN0IGxvY2FsaWRhZEZpbmFsID0gbG9jRmluYWxFbCA/IGxvY0ZpbmFsRWwudmFsdWUudHJpbSgpIDogJyc7XHJcbiAgaWYgKCFjYXJkQ29kZSkge1xyXG4gICAgaWYgKFxyXG4gICAgICAhY29uZmlybShcclxuICAgICAgICAnTm8gY2FyZ2FzdGUgQ2FyZENvZGUgU0FQLiBMYSB0aWVuZGEgdmEgYSBhcGFyZWNlciBlbiBlbCBtYXBhIHBlcm8gTk8gc2UgdmEgYSBwb2RlciBjcmVhciBwZWRpZG8gaGFzdGEgcXVlIHNlIGNhcmd1ZS4gXHUwMEJGQXByb2JhciBpZ3VhbD8nXHJcbiAgICAgIClcclxuICAgIClcclxuICAgICAgcmV0dXJuO1xyXG4gIH1cclxuICBpZiAoIWFzc2lnbmVkVmVuZG9yKSB7XHJcbiAgICBhbGVydChcclxuICAgICAgJ1RlbmVzIHF1ZSBlbGVnaXIgdW4gdmVuZGVkb3IgcGFyYSBhc2lnbmFyIGxhIHRpZW5kYS4gU2luIHZlbmRlZG9yIG5vIHNlIHNhYmUgZW4gcXVcdTAwRTkgem9uYSBkZWwgbWFwYSBhcGFyZWNlLidcclxuICAgICk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghY29uZmlybSgnQ29uZmlybWFyIGFwcm9iYWNpb24gZGUgZXN0YSBzb2xpY2l0dWQ/JykpIHJldHVybjtcclxuICB0cnkge1xyXG4gICAgY29uc3QgdXBkID0ge307XHJcbiAgICB1cGRbJ2FwcHJvdmFscy4nICsgY3VycmVudFVzZXIudWlkXSA9IHtcclxuICAgICAgYXBwcm92ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgIGVtYWlsOiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgbmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgJycsXHJcbiAgICB9O1xyXG4gICAgLy8gR3VhcmRhbW9zIGxvcyBkYXRvcyBkZWwgYXByb2JhZG9yIGVuIGxhIHNvbGljaXR1ZC4gU2kgeWEgZXN0YWJhblxyXG4gICAgLy8gY2FyZ2Fkb3MgKG90cm8gYXByb2JhZG9yIGxvcyBsbGVubyBhbnRlcyksIG5vIGxvcyBzb2JyZXNjcmliaW1vc1xyXG4gICAgLy8gYSBtZW5vcyBxdWUgYWhvcmEgc2UgcGFzZW4gdmFsb3JlcyBubyB2YWNpb3MuXHJcbiAgICBpZiAoY2FyZENvZGUpIHVwZC5jYXJkQ29kZVNhcCA9IGNhcmRDb2RlO1xyXG4gICAgaWYgKGFzc2lnbmVkVmVuZG9yKSB1cGQuYXNzaWduZWRWZW5kb3IgPSBhc3NpZ25lZFZlbmRvcjtcclxuICAgIGlmIChsb2NhbGlkYWRGaW5hbCkgdXBkLmxvY2FsaWRhZEZpbmFsID0gbG9jYWxpZGFkRmluYWw7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5kb2MoYXBwSWQpLnVwZGF0ZSh1cGQpO1xyXG4gICAgLy8gUmVsZWVyIHBhcmEgY2hlcXVlYXIgc2kgYW1ib3MgYXByb2Jhcm9uXHJcbiAgICBjb25zdCBzbmFwID0gYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS5nZXQoKTtcclxuICAgIGNvbnN0IGEgPSBzbmFwLmRhdGEoKSB8fCB7fTtcclxuICAgIGNvbnN0IGFwTiA9IGEuYXBwcm92YWxzID8gT2JqZWN0LmtleXMoYS5hcHByb3ZhbHMpLmxlbmd0aCA6IDA7XHJcbiAgICBpZiAoYXBOID49IDIgJiYgYS5zdGF0dXMgPT09ICdwZW5kaW5nX2FwcHJvdmFsJykge1xyXG4gICAgICAvLyBNYXJjYXIgY29tbyBhcHJvYmFkYSBkZWZpbml0aXZhbWVudGVcclxuICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdjbGllbnRfYXBwbGljYXRpb25zJykuZG9jKGFwcElkKS51cGRhdGUoe1xyXG4gICAgICAgIHN0YXR1czogJ2FwcHJvdmVkJyxcclxuICAgICAgICBhcHByb3ZlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICAgIC8vIE5vdGlmaWNhciBhbCB2ZW5kZWRvclxyXG4gICAgICBpZiAoYS5vd25lclVpZCkge1xyXG4gICAgICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmFkZCh7XHJcbiAgICAgICAgICB0eXBlOiAnY2xpZW50X2FwcHJvdmFsX2FjaycsXHJcbiAgICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICBmcm9tRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgZnJvbU5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgICAgdGFyZ2V0VWlkOiBhLm93bmVyVWlkLFxyXG4gICAgICAgICAgdGl0bGU6ICdTb2xpY2l0dWQgZGUgYWx0YSBBUFJPQkFEQScsXHJcbiAgICAgICAgICBtZXNzYWdlOlxyXG4gICAgICAgICAgICAnVHUgc29saWNpdHVkIHBhcmEgZGFyIGRlIGFsdGEgYSBcIicgK1xyXG4gICAgICAgICAgICAoYS5jb21lcmNpbyB8fCAnJykgK1xyXG4gICAgICAgICAgICAnXCIgZnVlIGFwcm9iYWRhIHBvciBsb3MgMiByZXZpc29yZXMuIFlhIHBvZGVzIGNhcmdhcmxlIHBlZGlkb3MuJyxcclxuICAgICAgICAgIGFwcGxpY2F0aW9uSWQ6IGFwcElkLFxyXG4gICAgICAgICAgc3RhdHVzOiAndW5yZWFkJyxcclxuICAgICAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIE1hcmNhciBsYSBub3RpZiBkZWwgYXByb2JhZG9yIGNvbW8gZG9uZVxyXG4gICAgaWYgKG5vdGlmSWQpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBmYkRiXHJcbiAgICAgICAgICAuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpXHJcbiAgICAgICAgICAuZG9jKG5vdGlmSWQpXHJcbiAgICAgICAgICAudXBkYXRlKHsgc3RhdHVzOiAnZG9uZScsIGRvbmVBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCkgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKF9lKSB7fVxyXG4gICAgfVxyXG4gICAgc2hvd1N5bmNUYWcoXHJcbiAgICAgIGFwTiA+PSAyID8gJ1NvbGljaXR1ZCBhcHJvYmFkYSAoZGVmaW5pdGl2YSknIDogJ0Fwcm9iYXN0ZS4gRmFsdGEgMSBhcHJvYmFjaW9uIG1hcy4nXHJcbiAgICApO1xyXG4gICAgY2xvc2VDbGllbnRBcHBsaWNhdGlvbkRldGFpbCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2FwcHJvdmUnLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvciBhcHJvYmFuZG86ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cucmVqZWN0Q2xpZW50QXBwbGljYXRpb24gPSBhc3luYyBmdW5jdGlvbiAoYXBwSWQsIG5vdGlmSWQpIHtcclxuICBjb25zdCByZWFzb24gPSBwcm9tcHQoJ01vdGl2byBkZWwgcmVjaGF6byAoc2Ugbm90aWZpY2EgYWwgdmVuZGVkb3IpOicsICcnKTtcclxuICBpZiAocmVhc29uID09PSBudWxsKSByZXR1cm47XHJcbiAgaWYgKCFyZWFzb24udHJpbSgpKSB7XHJcbiAgICBhbGVydCgnVGVuZXMgcXVlIGluZGljYXIgdW4gbW90aXZvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignY2xpZW50X2FwcGxpY2F0aW9ucycpXHJcbiAgICAgIC5kb2MoYXBwSWQpXHJcbiAgICAgIC51cGRhdGUoe1xyXG4gICAgICAgIHN0YXR1czogJ3JlamVjdGVkJyxcclxuICAgICAgICByZWplY3RlZEJ5OiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgcmVqZWN0ZWRCeUVtYWlsOiBjdXJyZW50VXNlci5lbWFpbCB8fCAnJyxcclxuICAgICAgICByZWplY3RlZFJlYXNvbjogcmVhc29uLnRyaW0oKSxcclxuICAgICAgICByZWplY3RlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICAvLyBOb3RpZmljYXIgYWwgdmVuZGVkb3JcclxuICAgIGNvbnN0IHNuYXAgPSBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ2NsaWVudF9hcHBsaWNhdGlvbnMnKS5kb2MoYXBwSWQpLmdldCgpO1xyXG4gICAgY29uc3QgYSA9IHNuYXAuZGF0YSgpIHx8IHt9O1xyXG4gICAgaWYgKGEub3duZXJVaWQpIHtcclxuICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuYWRkKHtcclxuICAgICAgICB0eXBlOiAnY2xpZW50X2FwcHJvdmFsX2FjaycsXHJcbiAgICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgZnJvbU5hbWU6IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICAgIHRhcmdldFVpZDogYS5vd25lclVpZCxcclxuICAgICAgICB0aXRsZTogJ1NvbGljaXR1ZCBkZSBhbHRhIFJFQ0hBWkFEQScsXHJcbiAgICAgICAgbWVzc2FnZTpcclxuICAgICAgICAgICdUdSBzb2xpY2l0dWQgcGFyYSBcIicgKyAoYS5jb21lcmNpbyB8fCAnJykgKyAnXCIgZnVlIHJlY2hhemFkYS5cXG5Nb3Rpdm86ICcgKyByZWFzb24udHJpbSgpLFxyXG4gICAgICAgIGFwcGxpY2F0aW9uSWQ6IGFwcElkLFxyXG4gICAgICAgIHN0YXR1czogJ3VucmVhZCcsXHJcbiAgICAgICAgY3JlYXRlZEF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBpZiAobm90aWZJZCkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGZiRGJcclxuICAgICAgICAgIC5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJylcclxuICAgICAgICAgIC5kb2Mobm90aWZJZClcclxuICAgICAgICAgIC51cGRhdGUoeyBzdGF0dXM6ICdkb25lJywgZG9uZUF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSB9KTtcclxuICAgICAgfSBjYXRjaCAoX2UpIHt9XHJcbiAgICB9XHJcbiAgICBzaG93U3luY1RhZygnU29saWNpdHVkIHJlY2hhemFkYScpO1xyXG4gICAgY2xvc2VDbGllbnRBcHBsaWNhdGlvbkRldGFpbCgpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ3JlamVjdCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxud2luZG93LnNldE5vdGlmc1RhYiA9IGZ1bmN0aW9uICh0YWIpIHtcclxuICB3aW5kb3cubm90aWZzVGFiID0gdGFiO1xyXG4gIGRvY3VtZW50XHJcbiAgICAucXVlcnlTZWxlY3RvckFsbCgnLm50YWItYnRuJylcclxuICAgIC5mb3JFYWNoKChiKSA9PiBiLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIGIuZGF0YXNldC5udGFiID09PSB0YWIpKTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLXBhbmUtcmVjaWJpZGFzJykuc3R5bGUuZGlzcGxheSA9XHJcbiAgICB0YWIgPT09ICdyZWNpYmlkYXMnID8gJycgOiAnbm9uZSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25vdGlmcy1wYW5lLXJlYWxpemFkYXMnKS5zdHlsZS5kaXNwbGF5ID1cclxuICAgIHRhYiA9PT0gJ3JlYWxpemFkYXMnID8gJycgOiAnbm9uZSc7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25vdGlmcy1wYW5lLWNyZWFyJykuc3R5bGUuZGlzcGxheSA9IHRhYiA9PT0gJ2NyZWFyJyA/ICcnIDogJ25vbmUnO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdub3RpZnMtcGFuZS1lbnZpYWRhcycpLnN0eWxlLmRpc3BsYXkgPSB0YWIgPT09ICdlbnZpYWRhcycgPyAnJyA6ICdub25lJztcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLWZvb3RlcicpLnN0eWxlLmRpc3BsYXkgPSB0YWIgPT09ICdyZWNpYmlkYXMnID8gJycgOiAnbm9uZSc7XHJcbiAgaWYgKHRhYiA9PT0gJ3JlY2liaWRhcycpIHJlbmRlck5vdGlmc0xpc3QoKTtcclxuICBlbHNlIGlmICh0YWIgPT09ICdyZWFsaXphZGFzJykgcmVuZGVyTm90aWZzUmVhbGl6YWRhcygpO1xyXG4gIGVsc2UgaWYgKHRhYiA9PT0gJ2VudmlhZGFzJykgcmVuZGVyTXlTZW50VGFza3MoKTtcclxufTtcclxuXHJcbmZ1bmN0aW9uIGlzTm90aWZQZW5kaW5nKG4pIHtcclxuICAvLyBQZW5kaWVudGUgPSBubyBsZWlkYSB5IG5vIGNvbXBsZXRhZGEgKHNlZ3VuIHRpcG8pLlxyXG4gIHJldHVybiBuLnN0YXR1cyAhPT0gJ3JlYWQnICYmIG4uc3RhdHVzICE9PSAnZG9uZSc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHVwZGF0ZU5vdGlmc1RhYkNvdW50cygpIHtcclxuICBjb25zdCBwZW5kaW5nID0gKG15Tm90aWZpY2F0aW9ucyB8fCBbXSkuZmlsdGVyKGlzTm90aWZQZW5kaW5nKS5sZW5ndGg7XHJcbiAgY29uc3QgcmVhbGl6YWRhcyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcigobikgPT4gIWlzTm90aWZQZW5kaW5nKG4pKS5sZW5ndGg7XHJcbiAgY29uc3QgcmVjRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbnRhYi1yZWNpYmlkYXMtY291bnQnKTtcclxuICBpZiAocmVjRWwpIHtcclxuICAgIHJlY0VsLnRleHRDb250ZW50ID0gcGVuZGluZyA+IDAgPyBwZW5kaW5nIDogJyc7XHJcbiAgICByZWNFbC5jbGFzc0xpc3QudG9nZ2xlKCd6ZXJvJywgcGVuZGluZyA9PT0gMCk7XHJcbiAgfVxyXG4gIGNvbnN0IHJlYWxFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdudGFiLXJlYWxpemFkYXMtY291bnQnKTtcclxuICBpZiAocmVhbEVsKSB7XHJcbiAgICByZWFsRWwudGV4dENvbnRlbnQgPSByZWFsaXphZGFzID4gMCA/IHJlYWxpemFkYXMgOiAnJztcclxuICAgIHJlYWxFbC5jbGFzc0xpc3QudG9nZ2xlKCd6ZXJvJywgcmVhbGl6YWRhcyA9PT0gMCk7XHJcbiAgfVxyXG4gIC8vIEVudmlhZGFzOiB0YXJlYXMgcXVlIG1hbmRlIHkgcXVlIGVzdGFuIHBlbmRpZW50ZXMgKG5vIGRvbmUpXHJcbiAgY29uc3QgcGVuZFNlbnQgPSAobXlTZW50VGFza3MgfHwgW10pLmZpbHRlcigodCkgPT4gdC5zdGF0dXMgIT09ICdkb25lJykubGVuZ3RoO1xyXG4gIGNvbnN0IHNlbnRFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdudGFiLWVudmlhZGFzLWNvdW50Jyk7XHJcbiAgaWYgKHNlbnRFbCkge1xyXG4gICAgc2VudEVsLnRleHRDb250ZW50ID0gcGVuZFNlbnQgPiAwID8gcGVuZFNlbnQgOiAnJztcclxuICAgIHNlbnRFbC5jbGFzc0xpc3QudG9nZ2xlKCd6ZXJvJywgcGVuZFNlbnQgPT09IDApO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZm10Tm90aWZEYXRlKG4pIHtcclxuICBjb25zdCBkdCA9IG4uY3JlYXRlZEF0XHJcbiAgICA/IG4uY3JlYXRlZEF0LnRvRGF0ZVxyXG4gICAgICA/IG4uY3JlYXRlZEF0LnRvRGF0ZSgpXHJcbiAgICAgIDogbmV3IERhdGUobi5jcmVhdGVkQXQpXHJcbiAgICA6IG51bGw7XHJcbiAgcmV0dXJuIGR0ID8gZHQudG9Mb2NhbGVTdHJpbmcoJ2VzLUFSJykgOiAnJztcclxufVxyXG5cclxuZnVuY3Rpb24gbm90aWZJdGVtSHRtbChuLCBvcHRzKSB7XHJcbiAgb3B0cyA9IG9wdHMgfHwge307XHJcbiAgY29uc3QgdHlwZSA9IG4udHlwZSB8fCAnZGVyaXZhY2lvbic7XHJcbiAgY29uc3QgaXNDbG9zZWQgPSBuLnN0YXR1cyA9PT0gJ3JlYWQnIHx8IG4uc3RhdHVzID09PSAnZG9uZSc7XHJcbiAgY29uc3QgY2xzID0gJ25vdGlmLWl0ZW0gdHlwZS0nICsgdHlwZSArIChpc0Nsb3NlZCA/ICcgcmVhZCcgOiAnJyk7XHJcbiAgY29uc3QgZHRTdHIgPSBmbXROb3RpZkRhdGUobik7XHJcbiAgbGV0IGggPSAnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCI+JztcclxuICBpZiAodHlwZSA9PT0gJ3Rhc2snKSB7XHJcbiAgICBjb25zdCBmcm9tTGFiZWwgPSBuLmZyb21OYW1lIHx8IG4uZnJvbUVtYWlsIHx8ICdBbGd1aWVuJztcclxuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLXNlbmRlclwiPkRlICcgKyBlc2NhcGVIdG1sKGZyb21MYWJlbCkgKyAnPC9kaXY+JztcclxuICAgIGNvbnN0IHN0YXR1c1RhZyA9XHJcbiAgICAgIG4uc3RhdHVzID09PSAnZG9uZSdcclxuICAgICAgICA/ICc8c3BhbiBjbGFzcz1cInRhc2stc3RhdHVzLXRhZyBkb25lXCI+JiMxMDAwMzsgQ29tcGxldGFkYTwvc3Bhbj4nXHJcbiAgICAgICAgOiAnPHNwYW4gY2xhc3M9XCJ0YXNrLXN0YXR1cy10YWcgcGVuZGluZ1wiPlBlbmRpZW50ZTwvc3Bhbj4nO1xyXG4gICAgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stdGl0bGVcIj4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdTaW4gdGl0dWxvJykgKyBzdGF0dXNUYWcgKyAnPC9kaXY+JztcclxuICAgIGlmIChuLmRlc2NyaXB0aW9uKSBoICs9ICc8ZGl2IGNsYXNzPVwidGFzay1kZXNjXCI+JyArIGVzY2FwZUh0bWwobi5kZXNjcmlwdGlvbikgKyAnPC9kaXY+JztcclxuICAgIGlmICgobi5pbWFnZXMgfHwgW10pLmxlbmd0aCkge1xyXG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwidGFzay1pbWdzXCI+JztcclxuICAgICAgbi5pbWFnZXMuZm9yRWFjaCgoaW1nLCBpKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc2FmZSA9IGltZy5yZXBsYWNlKC8nL2csICcmIzM5OycpO1xyXG4gICAgICAgIGggKz1cclxuICAgICAgICAgICc8aW1nIHNyYz1cIicgK1xyXG4gICAgICAgICAgc2FmZSArXHJcbiAgICAgICAgICAnXCIgY2xhc3M9XCJ0YXNrLWltZy10aHVtYlwiIG9uY2xpY2s9XCJvcGVuSW1nVmlld2VyKFxcJycgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cigndGFzay0nICsgbi5fZnNJZCArICctJyArIGkpICtcclxuICAgICAgICAgICdcXCcpXCIgaWQ9XCJ0YXNrLScgK1xyXG4gICAgICAgICAgbi5fZnNJZCArXHJcbiAgICAgICAgICAnLScgK1xyXG4gICAgICAgICAgaSArXHJcbiAgICAgICAgICAnXCIvPic7XHJcbiAgICAgIH0pO1xyXG4gICAgICBoICs9ICc8L2Rpdj4nO1xyXG4gICAgfVxyXG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5mXCI+PHNwYW4+JyArIGVzY2FwZUh0bWwoZHRTdHIpICsgJzwvc3Bhbj48L2Rpdj4nO1xyXG4gICAgaWYgKG4uc3RhdHVzICE9PSAnZG9uZScgJiYgIW9wdHMucmVhZG9ubHkpIHtcclxuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWl0ZW0tYWN0aW9uc1wiPic7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgb25jbGljaz1cImNvbXBsZXRhclRhc2soXFwnJyArXHJcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXHJcbiAgICAgICAgJ1xcJylcIj5NYXJjYXIgY29tbyBjb21wbGV0YWRhPC9idXR0b24+JztcclxuICAgICAgaCArPSAnPC9kaXY+JztcclxuICAgIH0gZWxzZSBpZiAobi5zdGF0dXMgPT09ICdkb25lJyAmJiBuLmRvbmVBdCkge1xyXG4gICAgICBjb25zdCBkYSA9IG4uZG9uZUF0LnRvRGF0ZSA/IG4uZG9uZUF0LnRvRGF0ZSgpIDogbmV3IERhdGUobi5kb25lQXQpO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTBweDtjb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzKTttYXJnaW4tdG9wOjZweDtmb250LXdlaWdodDo2MDBcIj4mIzEwMDAzOyBDb21wbGV0YWRhIGVsICcgK1xyXG4gICAgICAgIGRhLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgICAnPC9kaXY+JztcclxuICAgIH1cclxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICd0YXNrX2FjaycpIHtcclxuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdDb25maXJtYWNpb24gZGUgdGFyZWEnKSArICc8L2g0Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm1cIj4nICsgZXNjYXBlSHRtbChuLm1lc3NhZ2UgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibmZcIj48c3Bhbj4nICsgZXNjYXBlSHRtbChkdFN0cikgKyAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xyXG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwibWFya05vdGlmUmVhZChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcclxuICAgICAgICAnXFwnKVwiPk1hcmNhciBsZWlkYTwvYnV0dG9uPic7XHJcbiAgICAgIGggKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnY2xpZW50X2FwcHJvdmFsJykge1xyXG4gICAgaCArPVxyXG4gICAgICAnPGRpdiBjbGFzcz1cInRhc2stc2VuZGVyXCI+RGUgJyArXHJcbiAgICAgIGVzY2FwZUh0bWwobi5mcm9tTmFtZSB8fCBuLmZyb21FbWFpbCB8fCAnVmVuZGVkb3InKSArXHJcbiAgICAgICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stdGl0bGVcIj4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdTb2xpY2l0dWQgZGUgYWx0YScpICsgJzwvZGl2Pic7XHJcbiAgICBpZiAobi5kZXNjcmlwdGlvbikgaCArPSAnPGRpdiBjbGFzcz1cInRhc2stZGVzY1wiPicgKyBlc2NhcGVIdG1sKG4uZGVzY3JpcHRpb24pICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibmZcIiBzdHlsZT1cIm1hcmdpbi10b3A6NnB4XCI+PHNwYW4+JyArIGVzY2FwZUh0bWwoZHRTdHIpICsgJzwvc3Bhbj48L2Rpdj4nO1xyXG4gICAgaWYgKG4uc3RhdHVzICE9PSAncmVhZCcgJiYgbi5zdGF0dXMgIT09ICdkb25lJyAmJiAhb3B0cy5yZWFkb25seSkge1xyXG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwib3BlbkNsaWVudEFwcGxpY2F0aW9uRGV0YWlsKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIobi5hcHBsaWNhdGlvbklkIHx8ICcnKSArXHJcbiAgICAgICAgXCInLCdcIiArXHJcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImJhY2tncm91bmQ6IzA4OTFiMlwiPlZlciBkZXRhbGxlIHkgZGVjaWRpcjwvYnV0dG9uPic7XHJcbiAgICAgIGggKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnY2xpZW50X2FwcHJvdmFsX2FjaycpIHtcclxuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdTb2xpY2l0dWQgZGUgYWx0YScpICsgJzwvaDQ+JztcclxuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJubVwiPicgKyBlc2NhcGVIdG1sKG4ubWVzc2FnZSB8fCAnJykgKyAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJuZlwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmICFvcHRzLnJlYWRvbmx5KSB7XHJcbiAgICAgIGggKz0gJzxkaXYgY2xhc3M9XCJub3RpZi1pdGVtLWFjdGlvbnNcIj4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIG9uY2xpY2s9XCJtYXJrTm90aWZSZWFkKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xyXG4gICAgICAgICdcXCcpXCI+TWFyY2FyIGxlaWRhPC9idXR0b24+JztcclxuICAgICAgaCArPSAnPC9kaXY+JztcclxuICAgIH1cclxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdyZW5kaWNpb25fYXBwcm92YWwnKSB7XHJcbiAgICBoICs9XHJcbiAgICAgICc8ZGl2IGNsYXNzPVwidGFzay1zZW5kZXJcIj5EZSAnICtcclxuICAgICAgZXNjYXBlSHRtbChuLmZyb21OYW1lIHx8IG4uZnJvbUVtYWlsIHx8ICdWZW5kZWRvcicpICtcclxuICAgICAgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwidGFzay10aXRsZVwiPicgKyBlc2NhcGVIdG1sKG4udGl0bGUgfHwgJ1JlbmRpY2lvbiBwZW5kaWVudGUnKSArICc8L2Rpdj4nO1xyXG4gICAgaWYgKG4uZGVzY3JpcHRpb24pIGggKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLWRlc2NcIj4nICsgZXNjYXBlSHRtbChuLmRlc2NyaXB0aW9uKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5mXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjZweFwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmIG4uc3RhdHVzICE9PSAnZG9uZScgJiYgIW9wdHMucmVhZG9ubHkpIHtcclxuICAgICAgaCArPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWl0ZW0tYWN0aW9uc1wiPic7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgb25jbGljaz1cIm9wZW5SZW5kaWNpb25EZXRhaWwoXFwnJyArXHJcbiAgICAgICAgZXNjYXBlQXR0cihuLnJlbmRpY2lvbklkIHx8ICcnKSArXHJcbiAgICAgICAgXCInLCdcIiArXHJcbiAgICAgICAgZXNjYXBlQXR0cihuLl9mc0lkKSArXHJcbiAgICAgICAgJ1xcJylcIiBzdHlsZT1cImJhY2tncm91bmQ6I2JlMTg1ZFwiPlZlciBkZXRhbGxlIHkgZGVjaWRpcjwvYnV0dG9uPic7XHJcbiAgICAgIGggKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmICh0eXBlID09PSAncmVuZGljaW9uX2FwcHJvdmFsX2FjaycpIHtcclxuICAgIGggKz0gJzxoND4nICsgZXNjYXBlSHRtbChuLnRpdGxlIHx8ICdSZW5kaWNpb24nKSArICc8L2g0Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm1cIj4nICsgZXNjYXBlSHRtbChuLm1lc3NhZ2UgfHwgJycpICsgJzwvZGl2Pic7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibmZcIj48c3Bhbj4nICsgZXNjYXBlSHRtbChkdFN0cikgKyAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xyXG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwibWFya05vdGlmUmVhZChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcclxuICAgICAgICAnXFwnKVwiPk1hcmNhciBsZWlkYTwvYnV0dG9uPic7XHJcbiAgICAgIGggKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnYXV0b19jb25maXJtX3RpbWVvdXQnKSB7XHJcbiAgICAvLyB2OTIxICgyMDI2LTA5LTE0KTogcGVkaWRvIHBhc2FkbyBhdXRvbWF0aWNhbWVudGUgZGUgcGVuZGluZyBhIGNvbmZpcm1lZFxyXG4gICAgLy8gcG9yIGVsIENGIGF1dG9Db25maXJtUGVuZGluZ1BlZGlkb3NDRiB0cmFzIE4gbWluIGRlIGluYWN0aXZpZGFkLiBFbCBWREVcclxuICAgIC8vIHZlIGVsIGFsZXJ0YSArIGxpbmsgYSBsYSBjYXJkIGNvbmZpcm1hZGEgcGFyYSByZXZpc2FyIGVsIGVudmlvIGEgU0FQLlxyXG4gICAgY29uc3QgbWludXRlcyA9IE51bWJlcihuLm1pbnV0ZXNJblBlbmRpbmcpIHx8IDEwO1xyXG4gICAgaCArPSAnPGg0IHN0eWxlPVwiY29sb3I6I2I0NTMwOVwiPiYjOTIwMDsgUGVkaWRvIGF1dG8tY29uZmlybWFkbyBwb3IgdGltZW91dDwvaDQ+JztcclxuICAgIGggKz1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJubVwiPlR1IHBlZGlkbyBkZSA8Yj4nICtcclxuICAgICAgZXNjYXBlSHRtbChuLmNsaWVudE5hbWUgfHwgJ2NsaWVudGUnKSArXHJcbiAgICAgICc8L2I+JyArXHJcbiAgICAgIChuLm1vbnRoID8gJyAoJyArIGVzY2FwZUh0bWwobi5tb250aCkgKyAnKScgOiAnJykgK1xyXG4gICAgICAnIHF1ZWRvIDxiPicgK1xyXG4gICAgICBtaW51dGVzICtcclxuICAgICAgJyBtaW48L2I+IGVuIFBlbmRpZW50ZXMgc2luIGNvbmZpcm1hci4gU2UgcGFzbyBhIENvbmZpcm1hZG9zIGF1dG9tYXRpY2FtZW50ZSB5IHNlIGVudmlvIGEgU0FQLicgK1xyXG4gICAgICAnPC9kaXY+JztcclxuICAgIGggKz0gJzxkaXYgY2xhc3M9XCJuZlwiPjxzcGFuPicgKyBlc2NhcGVIdG1sKGR0U3RyKSArICc8L3NwYW4+PC9kaXY+JztcclxuICAgIGlmIChuLnN0YXR1cyAhPT0gJ3JlYWQnICYmICFvcHRzLnJlYWRvbmx5KSB7XHJcbiAgICAgIGggKz0gJzxkaXYgY2xhc3M9XCJub3RpZi1pdGVtLWFjdGlvbnNcIj4nO1xyXG4gICAgICBoICs9XHJcbiAgICAgICAgJzxidXR0b24gY2xhc3M9XCJidG4tcmVhZFwiIG9uY2xpY2s9XCJtYXJrTm90aWZSZWFkKFxcJycgK1xyXG4gICAgICAgIGVzY2FwZUF0dHIobi5fZnNJZCkgK1xyXG4gICAgICAgICdcXCcpXCI+TWFyY2FyIGxlaWRhPC9idXR0b24+JztcclxuICAgICAgaCArPSAnPC9kaXY+JztcclxuICAgIH1cclxuICB9IGVsc2Uge1xyXG4gICAgLy8gZGVyaXZhY2lvblxyXG4gICAgaCArPSAnPGg0PicgKyBlc2NhcGVIdG1sKG4udGllbmRhIHx8ICdTaW4gdGllbmRhJykgKyAnPC9oND4nO1xyXG4gICAgaCArPSAnPGRpdiBjbGFzcz1cIm5tXCI+JyArIGVzY2FwZUh0bWwobi5tZXNzYWdlIHx8ICcnKSArICc8L2Rpdj4nO1xyXG4gICAgaCArPVxyXG4gICAgICAnPGRpdiBjbGFzcz1cIm5mXCI+PHNwYW4+JyArXHJcbiAgICAgIGVzY2FwZUh0bWwoKG4ubG9jYWxpZGFkIHx8ICcnKSArICcgJm1pZGRvdDsgJyArIChuLnByb3ZpbmNpYSB8fCAnJykpICtcclxuICAgICAgJzwvc3Bhbj48c3Bhbj4nICtcclxuICAgICAgZXNjYXBlSHRtbChkdFN0cikgK1xyXG4gICAgICAnPC9zcGFuPjwvZGl2Pic7XHJcbiAgICBpZiAobi5zdGF0dXMgIT09ICdyZWFkJyAmJiAhb3B0cy5yZWFkb25seSkge1xyXG4gICAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCI+JztcclxuICAgICAgaCArPVxyXG4gICAgICAgICc8YnV0dG9uIGNsYXNzPVwiYnRuLXJlYWRcIiBvbmNsaWNrPVwiY29udGFjdGFyRGVzZGVOb3RpZihcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcclxuICAgICAgICAnXFwnKVwiPkNvbnRhY3RhcjwvYnV0dG9uPic7XHJcbiAgICAgIGggKz1cclxuICAgICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWJnLWVsZXZhdGVkKTtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7Ym9yZGVyOjEuNXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTttYXJnaW4tbGVmdDo2cHhcIiBvbmNsaWNrPVwibWFya05vdGlmUmVhZChcXCcnICtcclxuICAgICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcclxuICAgICAgICAnXFwnKVwiIHRpdGxlPVwiU29sbyBtYXJjYXIgY29tbyBsZWlkYSAoc2luIGNhcmdhciB2aXNpdGEpXCI+U29sbyBtYXJjYXIgbGVpZGE8L2J1dHRvbj4nO1xyXG4gICAgICBoICs9ICc8L2Rpdj4nO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyBCb3RvbiBcIkVsaW1pbmFyXCIgZ2VuZXJpY28gcGFyYSB0b2RhcyBsYXMgbm90aWZpY2FjaW9uZXMgcmVjaWJpZGFzXHJcbiAgLy8gKGV4Y2VwdG8gbW9kbyByZWFkb25seSkuIE5vIGRlcGVuZGUgZGVsIHRpcG8gLSBjdWFscXVpZXIgbm90aWZcclxuICAvLyBwdWVkZSBib3JyYXJzZSBkZSBsYSBsaXN0YSBwcm9waWEuXHJcbiAgaWYgKCFvcHRzLnJlYWRvbmx5KSB7XHJcbiAgICBoICs9ICc8ZGl2IGNsYXNzPVwibm90aWYtaXRlbS1hY3Rpb25zXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjZweDtqdXN0aWZ5LWNvbnRlbnQ6ZmxleC1lbmRcIj4nO1xyXG4gICAgaCArPVxyXG4gICAgICAnPGJ1dHRvbiBjbGFzcz1cImJ0bi1yZWFkXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOnZhcigtLWNvbG9yLWRhbmdlci1iZyk7Y29sb3I6dmFyKC0tY29sb3ItZGFuZ2VyLXN0cm9uZyk7Ym9yZGVyOjEuNXB4IHNvbGlkICNmY2E1YTU7Zm9udC13ZWlnaHQ6NzAwXCIgb25jbGljaz1cImRlbGV0ZU5vdGlmKFxcJycgK1xyXG4gICAgICBlc2NhcGVBdHRyKG4uX2ZzSWQpICtcclxuICAgICAgJ1xcJylcIiB0aXRsZT1cIkVsaW1pbmFyIGVzdGEgbm90aWZpY2FjaW9uXCI+RWxpbWluYXI8L2J1dHRvbj4nO1xyXG4gICAgaCArPSAnPC9kaXY+JztcclxuICB9XHJcbiAgaCArPSAnPC9kaXY+JztcclxuICByZXR1cm4gaDtcclxufVxyXG5cclxud2luZG93LmRlbGV0ZU5vdGlmID0gYXN5bmMgZnVuY3Rpb24gKGZzSWQpIHtcclxuICBpZiAoIWZzSWQpIHJldHVybjtcclxuICBpZiAoIWNvbmZpcm0oJ0VsaW1pbmFyIGVzdGEgbm90aWZpY2FjaW9uPyBObyBzZSBwdWVkZSBkZXNoYWNlci4nKSkgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5kb2MoZnNJZCkuZGVsZXRlKCk7XHJcbiAgICBpZiAodHlwZW9mIHNob3dTeW5jVGFnID09PSAnZnVuY3Rpb24nKSBzaG93U3luY1RhZygnTm90aWZpY2FjaW9uIGVsaW1pbmFkYScpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2RlbGV0ZU5vdGlmJywgZSk7XHJcbiAgICBhbGVydCgnRXJyb3IgZWxpbWluYW5kbyBsYSBub3RpZmljYWNpb246ICcgKyAoZS5tZXNzYWdlIHx8IGUpKTtcclxuICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiByZW5kZXJOb3RpZnNMaXN0KCkge1xyXG4gIC8vIFJlY2liaWRhcyA9IHNvbG8gcGVuZGllbnRlcyAobm8gcmVhZCwgbm8gZG9uZSlcclxuICBjb25zdCBjb250ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25vdGlmcy1saXN0Jyk7XHJcbiAgY29uc3QgcGVuZGllbnRlcyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcihpc05vdGlmUGVuZGluZyk7XHJcbiAgaWYgKCFwZW5kaWVudGVzLmxlbmd0aCkge1xyXG4gICAgY29udC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz1cIm5vdGlmLWVtcHR5XCI+Tm8gdGVuZXMgYWxlcnRhcyBuaSB0YXJlYXMgcGVuZGllbnRlcy4gPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgLy8gdjMyMSs6IGhlYWRlciBjb24gY29udGFkb3IgKyBib3RvbiBcIk1hcmNhciB0b2RhcyBjb21vIGxlaWRhc1wiIHBhcmFcclxuICAvLyBsaW1waWFyIGxhIGJhbmRlamEgZGUgdW5hLiBVdGlsIGN1YW5kbyBzZSBhY3VtdWxhbiAxMDArIG5vdGlmcy5cclxuICBjb25zdCBuUGVuZCA9IHBlbmRpZW50ZXMubGVuZ3RoO1xyXG4gIGxldCBodG1sID0gJyc7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHg7cGFkZGluZzo4cHggMTBweDttYXJnaW4tYm90dG9tOjhweDtiYWNrZ3JvdW5kOnZhcigtLWJnLW11dGVkKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlci1kZWZhdWx0KTtib3JkZXItcmFkaXVzOjZweFwiPic7XHJcbiAgaHRtbCArPVxyXG4gICAgJzxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0LXNlY29uZGFyeSk7Zm9udC13ZWlnaHQ6NjAwXCI+JyArXHJcbiAgICBuUGVuZCArXHJcbiAgICAnIHBlbmRpZW50ZScgK1xyXG4gICAgKG5QZW5kID09PSAxID8gJycgOiAncycpICtcclxuICAgICc8L2Rpdj4nO1xyXG4gIGh0bWwgKz1cclxuICAgICc8YnV0dG9uIG9uY2xpY2s9XCJtYXJrQWxsTm90aWZzUmVhZCgpXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwZDk0ODg7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtwYWRkaW5nOjdweCAxMnB4O2ZvbnQtc2l6ZToxMXB4O2ZvbnQtd2VpZ2h0OjgwMDtib3JkZXItcmFkaXVzOjVweDtjdXJzb3I6cG9pbnRlcjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjNweDt3aGl0ZS1zcGFjZTpub3dyYXBcIj4mIzEwMDAzOyBNYXJjYXIgdG9kYXMgY29tbyBsZWlkYXM8L2J1dHRvbj4nO1xyXG4gIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgaHRtbCArPSBwZW5kaWVudGVzLm1hcCgobikgPT4gbm90aWZJdGVtSHRtbChuKSkuam9pbignJyk7XHJcbiAgY29udC5pbm5lckhUTUwgPSBodG1sO1xyXG59XHJcblxyXG4vLyB2MzIxKzogYnVsayBtYXJrLWFzLXJlYWQuIFVzYSB3cml0ZUJhdGNoIGRlIEZpcmVzdG9yZSAobWF4IDUwMCBvcHMpLlxyXG4vLyBMb29wIGRlIGJhdGNoZXMgZGUgNDAwIHBhcmEgdGVuZXIgbWFyZ2VuLiBDb25maXJtYSBhbnRlcyBwb3Igc2kgZWxcclxuLy8gdXNlciBhcHJpZXRhIHBvciBhY2NpZGVudGUgKDI4MCBub3RpZnMgZXMgbXVjaG8gcGFyYSBkZXNoYWNlcikuXHJcbndpbmRvdy5tYXJrQWxsTm90aWZzUmVhZCA9IGFzeW5jIGZ1bmN0aW9uICgpIHtcclxuICBjb25zdCBwZW5kaWVudGVzID0gKG15Tm90aWZpY2F0aW9ucyB8fCBbXSkuZmlsdGVyKGlzTm90aWZQZW5kaW5nKTtcclxuICBpZiAoIXBlbmRpZW50ZXMubGVuZ3RoKSB7XHJcbiAgICBhbGVydCgnTm8gaGF5IG5vdGlmaWNhY2lvbmVzIHBlbmRpZW50ZXMuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGNvbnN0IG4gPSBwZW5kaWVudGVzLmxlbmd0aDtcclxuICBpZiAoXHJcbiAgICAhY29uZmlybShcclxuICAgICAgJ01hcmNhciAnICtcclxuICAgICAgICBuICtcclxuICAgICAgICAnIG5vdGlmaWNhY2lvbicgK1xyXG4gICAgICAgIChuID09PSAxID8gJycgOiAnZXMnKSArXHJcbiAgICAgICAgJyBjb21vIGxlaWRhJyArXHJcbiAgICAgICAgKG4gPT09IDEgPyAnJyA6ICdzJykgK1xyXG4gICAgICAgICc/XFxuXFxuRXN0YSBhY2Npb24gbm8gc2UgcHVlZGUgZGVzaGFjZXIgbWFzaXZhbWVudGUgKHBvZHJpYXMgcmUtYWJyaXIgY2FkYSB1bmEgbWFudWFsIGRlc2RlIFJlYWxpemFkYXMpLidcclxuICAgIClcclxuICApXHJcbiAgICByZXR1cm47XHJcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI25vdGlmcy1saXN0IGJ1dHRvbltvbmNsaWNrKj1cIm1hcmtBbGxOb3RpZnNSZWFkXCJdJyk7XHJcbiAgaWYgKGJ0bikge1xyXG4gICAgYnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgIGJ0bi50ZXh0Q29udGVudCA9ICdNYXJjYW5kby4uLic7XHJcbiAgfVxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBDSFVOSyA9IDQwMDsgLy8gbWFyZ2VuIHNvYnJlIGVsIGxpbWl0ZSBkZSA1MDBcclxuICAgIGxldCBvayA9IDA7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBlbmRpZW50ZXMubGVuZ3RoOyBpICs9IENIVU5LKSB7XHJcbiAgICAgIGNvbnN0IHNsaWNlID0gcGVuZGllbnRlcy5zbGljZShpLCBpICsgQ0hVTkspO1xyXG4gICAgICBjb25zdCBiYXRjaCA9IGZiRGIuYmF0Y2goKTtcclxuICAgICAgc2xpY2UuZm9yRWFjaCgobikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlZiA9IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmRvYyhuLl9mc0lkKTtcclxuICAgICAgICBiYXRjaC51cGRhdGUocmVmLCB7XHJcbiAgICAgICAgICBzdGF0dXM6ICdyZWFkJyxcclxuICAgICAgICAgIHJlYWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0pO1xyXG4gICAgICBhd2FpdCBiYXRjaC5jb21taXQoKTtcclxuICAgICAgb2sgKz0gc2xpY2UubGVuZ3RoO1xyXG4gICAgfVxyXG4gICAgc2hvd1N5bmNUYWcob2sgKyAnIG5vdGlmaWNhY2lvbmVzIG1hcmNhZGFzIGNvbW8gbGVpZGFzJyk7XHJcbiAgICAvLyBFbCBsaXN0ZW5lciBvblNuYXBzaG90IHJlcGludGEgYWwgdG9xdWUgY3VhbmRvIGxsZWdhbiBsb3MgdXBkYXRlcy5cclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdtYXJrQWxsTm90aWZzUmVhZCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIG1hcmNhbmRvIG5vdGlmaWNhY2lvbmVzOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICBpZiAoYnRuKSB7XHJcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnTWFyY2FyIHRvZGFzIGNvbW8gbGVpZGFzJztcclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG5mdW5jdGlvbiByZW5kZXJOb3RpZnNSZWFsaXphZGFzKCkge1xyXG4gIC8vIFJlYWxpemFkYXMgPSB5YSBjZXJyYWRhcyAocmVhZCBvIGRvbmUpLiBTb2xvIGxlY3R1cmEuXHJcbiAgY29uc3QgY29udCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdub3RpZnMtcmVhbGl6YWRhcy1saXN0Jyk7XHJcbiAgY29uc3QgY2VycmFkYXMgPSAobXlOb3RpZmljYXRpb25zIHx8IFtdKS5maWx0ZXIoKG4pID0+ICFpc05vdGlmUGVuZGluZyhuKSk7XHJcbiAgaWYgKCFjZXJyYWRhcy5sZW5ndGgpIHtcclxuICAgIGNvbnQuaW5uZXJIVE1MID1cclxuICAgICAgJzxkaXYgY2xhc3M9XCJub3RpZi1lbXB0eVwiPkFjYSB2YW4gYSBhcGFyZWNlciBsYXMgYWxlcnRhcyB5IHRhcmVhcyBxdWUgeWEgY2VycmFzdGUuPC9kaXY+JztcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29udC5pbm5lckhUTUwgPSBjZXJyYWRhcy5tYXAoKG4pID0+IG5vdGlmSXRlbUh0bWwobiwgeyByZWFkb25seTogdHJ1ZSB9KSkuam9pbignJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlck15U2VudFRhc2tzKCkge1xyXG4gIGNvbnN0IGNvbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbm90aWZzLXNlbnQtbGlzdCcpO1xyXG4gIGlmICghbXlTZW50VGFza3MubGVuZ3RoKSB7XHJcbiAgICBjb250LmlubmVySFRNTCA9XHJcbiAgICAgICc8ZGl2IGNsYXNzPVwibm90aWYtZW1wdHlcIj5ObyBlbnZpYXN0ZSB0YXJlYXMgdG9kYXZpYS4gVXNcdTAwRTEgbGEgcGVzdGFcdTAwRjFhIDxiPkNyZWFyIHRhcmVhPC9iPi48L2Rpdj4nO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBsZXQgaHRtbCA9ICcnO1xyXG4gIG15U2VudFRhc2tzLmZvckVhY2goKG4pID0+IHtcclxuICAgIGNvbnN0IGlzRG9uZSA9IG4uc3RhdHVzID09PSAnZG9uZSc7XHJcbiAgICBjb25zdCBjbHMgPSAnbm90aWYtaXRlbSB0eXBlLXRhc2snICsgKGlzRG9uZSA/ICcgcmVhZCcgOiAnJyk7XHJcbiAgICBjb25zdCBkdFN0ciA9IGZtdE5vdGlmRGF0ZShuKTtcclxuICAgIGNvbnN0IHRhcmdldExhYmVsID0gbi50YXJnZXROYW1lIHx8IG4udGFyZ2V0RW1haWwgfHwgbi50YXJnZXRVaWQgfHwgJ0FsZ3VpZW4nO1xyXG4gICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCI+JztcclxuICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLXNlbmRlclwiPlBhcmEgJyArIGVzY2FwZUh0bWwodGFyZ2V0TGFiZWwpICsgJzwvZGl2Pic7XHJcbiAgICBjb25zdCBzdGF0dXNUYWcgPSBpc0RvbmVcclxuICAgICAgPyAnPHNwYW4gY2xhc3M9XCJ0YXNrLXN0YXR1cy10YWcgZG9uZVwiPiYjMTAwMDM7IENvbXBsZXRhZGE8L3NwYW4+J1xyXG4gICAgICA6ICc8c3BhbiBjbGFzcz1cInRhc2stc3RhdHVzLXRhZyBwZW5kaW5nXCI+UGVuZGllbnRlPC9zcGFuPic7XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwidGFzay10aXRsZVwiPicgKyBlc2NhcGVIdG1sKG4udGl0bGUgfHwgJ1NpbiB0aXR1bG8nKSArIHN0YXR1c1RhZyArICc8L2Rpdj4nO1xyXG4gICAgaWYgKG4uZGVzY3JpcHRpb24pIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLWRlc2NcIj4nICsgZXNjYXBlSHRtbChuLmRlc2NyaXB0aW9uKSArICc8L2Rpdj4nO1xyXG4gICAgaWYgKChuLmltYWdlcyB8fCBbXSkubGVuZ3RoKSB7XHJcbiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ0YXNrLWltZ3NcIj4nO1xyXG4gICAgICBuLmltYWdlcy5mb3JFYWNoKChpbWcsIGkpID0+IHtcclxuICAgICAgICBjb25zdCBzYWZlID0gaW1nLnJlcGxhY2UoLycvZywgJyYjMzk7Jyk7XHJcbiAgICAgICAgaHRtbCArPVxyXG4gICAgICAgICAgJzxpbWcgc3JjPVwiJyArXHJcbiAgICAgICAgICBzYWZlICtcclxuICAgICAgICAgICdcIiBjbGFzcz1cInRhc2staW1nLXRodW1iXCIgb25jbGljaz1cIm9wZW5JbWdWaWV3ZXIoXFwnJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKCdzZW50LScgKyBuLl9mc0lkICsgJy0nICsgaSkgK1xyXG4gICAgICAgICAgJ1xcJylcIiBpZD1cInNlbnQtJyArXHJcbiAgICAgICAgICBuLl9mc0lkICtcclxuICAgICAgICAgICctJyArXHJcbiAgICAgICAgICBpICtcclxuICAgICAgICAgICdcIi8+JztcclxuICAgICAgfSk7XHJcbiAgICAgIGh0bWwgKz0gJzwvZGl2Pic7XHJcbiAgICB9XHJcbiAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibmZcIj48c3Bhbj4nICsgZXNjYXBlSHRtbChkdFN0cikgKyAnPC9zcGFuPic7XHJcbiAgICBpZiAoaXNEb25lICYmIG4uZG9uZUF0KSB7XHJcbiAgICAgIGNvbnN0IGRhID0gbi5kb25lQXQudG9EYXRlID8gbi5kb25lQXQudG9EYXRlKCkgOiBuZXcgRGF0ZShuLmRvbmVBdCk7XHJcbiAgICAgIGh0bWwgKz1cclxuICAgICAgICAnPHNwYW4gc3R5bGU9XCJjb2xvcjp2YXIoLS1jb2xvci1zdWNjZXNzKTtmb250LXdlaWdodDo3MDBcIj4mIzEwMDAzOyBNYXJjYWRhICcgK1xyXG4gICAgICAgIGRhLnRvTG9jYWxlU3RyaW5nKCdlcy1BUicpICtcclxuICAgICAgICAnPC9zcGFuPic7XHJcbiAgICB9XHJcbiAgICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xyXG4gIH0pO1xyXG4gIGNvbnQuaW5uZXJIVE1MID0gaHRtbDtcclxufVxyXG5cclxuLy8gPT09IEltYWdlIHZpZXdlciAobW9kYWwgZnVsbHNjcmVlbikgPT09XHJcbndpbmRvdy5vcGVuSW1nVmlld2VyID0gZnVuY3Rpb24gKHRodW1iSWQpIHtcclxuICBjb25zdCB0aHVtYiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHRodW1iSWQpO1xyXG4gIGlmICghdGh1bWIpIHJldHVybjtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnaW1nLXZpZXdlci1pbWcnKS5zcmMgPSB0aHVtYi5zcmM7XHJcbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ltZy12aWV3ZXItb3ZlcmxheScpLmNsYXNzTGlzdC5hZGQoJ29wZW4nKTtcclxufTtcclxud2luZG93LmNsb3NlSW1nVmlld2VyID0gZnVuY3Rpb24gKCkge1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdpbWctdmlld2VyLW92ZXJsYXknKS5jbGFzc0xpc3QucmVtb3ZlKCdvcGVuJyk7XHJcbn07XHJcblxyXG4vLyA9PT0gVGFyZWE6IHBvYmxhciBkZXN0aW5hdGFyaW8sIG1hbmVqYXIgaW1hZ2VuZXMsIGVudmlhciA9PT1cclxuLy8gSU1QT1JUQU5URTogRmlyZXN0b3JlIFJ1bGVzIGJsb3F1ZWFuIGEgdmVuZGVkb3JlcyBkZSBsaXN0YXIgL3JvbGVzXHJcbi8vIChzb2xvIHB1ZWRlbiBsZWVyIHN1IHByb3BpbyBkb2MpLiBQYXJhIHF1ZSBlbCBkcm9wZG93biBkZSBkZXN0aW5hdGFyaW9zXHJcbi8vIGZ1bmNpb25lIHBhcmEgdG9kb3MgbG9zIHJvbGVzLCBsZWVtb3MgZGUgYXBwX2NvbmZpZy91c2Vyc19kaXJlY3RvcnlcclxuLy8gKHVuIG1hcGEgcHVibGljbyBxdWUgZWwgYWRtaW4gbWFudGllbmUgc2luY3Jvbml6YWRvKS4gU2kgZXNhIGZ1ZW50ZVxyXG4vLyBubyBleGlzdGUgdG9kYXZpYSwgZmFsbGJhY2sgYSAvcm9sZXMgKGFkbWluIC8gdmlld2VyIHNpIGZ1bmNpb25hbikuXHJcbmZ1bmN0aW9uIHBvcHVsYXRlVGFza1RhcmdldFNlbGVjdCgpIHtcclxuICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndGFzay10YXJnZXQnKTtcclxuICBpZiAoIXNlbCkgcmV0dXJuO1xyXG4gIGZ1bmN0aW9uIHJlbmRlckZyb21NYXAodXNlcnNNYXApIHtcclxuICAgIGNvbnN0IG9wdHMgPSBbJzxvcHRpb24gdmFsdWU9XCJcIj5TZWxlY2Npb25hci4uLjwvb3B0aW9uPiddO1xyXG4gICAgT2JqZWN0LmVudHJpZXModXNlcnNNYXAgfHwge30pLmZvckVhY2goKFt1aWQsIHVdKSA9PiB7XHJcbiAgICAgIGlmICh1aWQgPT09IGN1cnJlbnRVc2VyLnVpZCkgcmV0dXJuO1xyXG4gICAgICBpZiAoIXUgfHwgIXUucm9sZSB8fCB1LnJvbGUgPT09ICd1bmFzc2lnbmVkJykgcmV0dXJuO1xyXG4gICAgICBjb25zdCBsYWJlbCA9ICh1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgdWlkKSArICcgXHUwMEI3ICcgKyAodS5yb2xlIHx8ICcnKTtcclxuICAgICAgb3B0cy5wdXNoKFxyXG4gICAgICAgICc8b3B0aW9uIHZhbHVlPVwiJyArXHJcbiAgICAgICAgICBlc2NhcGVBdHRyKHVpZCkgK1xyXG4gICAgICAgICAgJ1wiIGRhdGEtZW1haWw9XCInICtcclxuICAgICAgICAgIGVzY2FwZUF0dHIodS5lbWFpbCB8fCAnJykgK1xyXG4gICAgICAgICAgJ1wiIGRhdGEtbmFtZT1cIicgK1xyXG4gICAgICAgICAgZXNjYXBlQXR0cih1LmRpc3BsYXlOYW1lIHx8IHUuZW1haWwgfHwgJycpICtcclxuICAgICAgICAgICdcIj4nICtcclxuICAgICAgICAgIGVzY2FwZUh0bWwobGFiZWwpICtcclxuICAgICAgICAgICc8L29wdGlvbj4nXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICAgIHNlbC5pbm5lckhUTUwgPSBvcHRzLmpvaW4oJycpO1xyXG4gIH1cclxuICAvLyBJbnRlbnRvIHByaW5jaXBhbDogZGlyZWN0b3JpbyBwdWJsaWNvIG1hbnRlbmlkbyBwb3IgYWRtaW4uXHJcbiAgZmJEYlxyXG4gICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgLmRvYygndXNlcnNfZGlyZWN0b3J5JylcclxuICAgIC5nZXQoKVxyXG4gICAgLnRoZW4oKHNuYXApID0+IHtcclxuICAgICAgaWYgKHNuYXAuZXhpc3RzICYmIHNuYXAuZGF0YSgpICYmIHNuYXAuZGF0YSgpLnVzZXJzKSB7XHJcbiAgICAgICAgcmVuZGVyRnJvbU1hcChzbmFwLmRhdGEoKS51c2Vycyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIEZhbGxiYWNrOiBsZWVyIC9yb2xlcyBkaXJlY3RhbWVudGUgKGZ1bmNpb25hIHBhcmEgYWRtaW4vdmlld2VyXHJcbiAgICAgIC8vIHBlcm8gTk8gcGFyYSB2ZW5kZWRvciBwb3Igc2VjdXJpdHkgcnVsZXMpLlxyXG4gICAgICBmYkRiXHJcbiAgICAgICAgLmNvbGxlY3Rpb24oJ3JvbGVzJylcclxuICAgICAgICAuZ2V0KClcclxuICAgICAgICAudGhlbigocXMpID0+IHtcclxuICAgICAgICAgIGNvbnN0IHVzZXJzTWFwID0ge307XHJcbiAgICAgICAgICBxcy5mb3JFYWNoKChkKSA9PiB7XHJcbiAgICAgICAgICAgIHVzZXJzTWFwW2QuaWRdID0gZC5kYXRhKCkgfHwge307XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHJlbmRlckZyb21NYXAodXNlcnNNYXApO1xyXG4gICAgICAgIH0pXHJcbiAgICAgICAgLmNhdGNoKChlKSA9PiB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ3BvcHVsYXRlIHRhc2sgdGFyZ2V0IC0gc2luIC9yb2xlcyBuaSB1c2Vyc19kaXJlY3Rvcnk6JywgZSk7XHJcbiAgICAgICAgICBzZWwuaW5uZXJIVE1MID1cclxuICAgICAgICAgICAgJzxvcHRpb24gdmFsdWU9XCJcIj5TZWxlY2Npb25hci4uLiAoc2luIHVzdWFyaW9zIGRpc3BvbmlibGVzLCBwZWRpbGUgYWwgYWRtaW4gcXVlIGVudHJlIDEgdmV6IGFsIFBhbmVsIFVzdWFyaW9zKTwvb3B0aW9uPic7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9KVxyXG4gICAgLmNhdGNoKChlKSA9PiB7XHJcbiAgICAgIGNvbnNvbGUud2FybigncG9wdWxhdGUgdGFzayB0YXJnZXQgLSBmYWxsYmFjayBhIC9yb2xlczonLCBlKTtcclxuICAgICAgZmJEYlxyXG4gICAgICAgIC5jb2xsZWN0aW9uKCdyb2xlcycpXHJcbiAgICAgICAgLmdldCgpXHJcbiAgICAgICAgLnRoZW4oKHFzKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCB1c2Vyc01hcCA9IHt9O1xyXG4gICAgICAgICAgcXMuZm9yRWFjaCgoZCkgPT4ge1xyXG4gICAgICAgICAgICB1c2Vyc01hcFtkLmlkXSA9IGQuZGF0YSgpIHx8IHt9O1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICByZW5kZXJGcm9tTWFwKHVzZXJzTWFwKTtcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7XHJcbiAgICAgICAgICBzZWwuaW5uZXJIVE1MID0gJzxvcHRpb24gdmFsdWU9XCJcIj5TZWxlY2Npb25hci4uLiAoc2luIHVzdWFyaW9zIGRpc3BvbmlibGVzKTwvb3B0aW9uPic7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuLy8gQWRtaW4gc29sbzogc2luY3Jvbml6YXIgZWwgZGlyZWN0b3JpbyBwdWJsaWNvIGEgcGFydGlyIGRlbCB1c2Vyc0NhY2hlXHJcbi8vIHF1ZSBzZSBjYXJnYSBlbiBvcGVuQWRtaW5QYW5lbC4gTG9zIGRlbWFzIHJvbGVzIGxvIGxlZW4gcGFyYSBwb2JsYXJcclxuLy8gZWwgZHJvcGRvd24gZGUgZGVzdGluYXRhcmlvcyBkZSB0YXJlYXMuXHJcbmZ1bmN0aW9uIHN5bmNVc2Vyc0RpcmVjdG9yeSgpIHtcclxuICBpZiAodXNlclJvbGUgIT09ICdhZG1pbicpIHJldHVybjtcclxuICBpZiAoIUFycmF5LmlzQXJyYXkodXNlcnNDYWNoZSkgfHwgIXVzZXJzQ2FjaGUubGVuZ3RoKSByZXR1cm47XHJcbiAgY29uc3QgZGlyID0ge307XHJcbiAgdXNlcnNDYWNoZS5mb3JFYWNoKCh1KSA9PiB7XHJcbiAgICBpZiAoIXUgfHwgIXUuX3VpZCkgcmV0dXJuO1xyXG4gICAgaWYgKCF1LnJvbGUgfHwgdS5yb2xlID09PSAndW5hc3NpZ25lZCcpIHJldHVybjtcclxuICAgIGRpclt1Ll91aWRdID0ge1xyXG4gICAgICBlbWFpbDogdS5lbWFpbCB8fCAnJyxcclxuICAgICAgZGlzcGxheU5hbWU6IHUuZGlzcGxheU5hbWUgfHwgJycsXHJcbiAgICAgIHJvbGU6IHUucm9sZSxcclxuICAgIH07XHJcbiAgfSk7XHJcbiAgZmJEYlxyXG4gICAgLmNvbGxlY3Rpb24oJ2FwcF9jb25maWcnKVxyXG4gICAgLmRvYygndXNlcnNfZGlyZWN0b3J5JylcclxuICAgIC5zZXQoXHJcbiAgICAgIHtcclxuICAgICAgICB1c2VyczogZGlyLFxyXG4gICAgICAgIHVwZGF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgICAgdXBkYXRlZEJ5OiAoY3VycmVudFVzZXIgJiYgY3VycmVudFVzZXIuZW1haWwpIHx8ICcnLFxyXG4gICAgICAgIHVzZXJDb3VudDogT2JqZWN0LmtleXMoZGlyKS5sZW5ndGgsXHJcbiAgICAgIH0sXHJcbiAgICAgIHsgbWVyZ2U6IHRydWUgfVxyXG4gICAgKVxyXG4gICAgLnRoZW4oKCkgPT4ge1xyXG4gICAgICBjb25zb2xlLmxvZygnW3VzZXJzX2RpcmVjdG9yeV0gc2luY3Jvbml6YWRvOicsIE9iamVjdC5rZXlzKGRpcikubGVuZ3RoLCAndXN1YXJpb3MnKTtcclxuICAgIH0pXHJcbiAgICAuY2F0Y2goKGUpID0+IGNvbnNvbGUud2Fybignc3luY1VzZXJzRGlyZWN0b3J5IGVycm9yOicsIGUpKTtcclxufVxyXG53aW5kb3cuc3luY1VzZXJzRGlyZWN0b3J5ID0gc3luY1VzZXJzRGlyZWN0b3J5O1xyXG5cclxud2luZG93Lm9uVGFza0ltYWdlSW5wdXQgPSBhc3luYyBmdW5jdGlvbiAoaW5wdXQpIHtcclxuICBjb25zdCBmaWxlcyA9IFsuLi4oaW5wdXQuZmlsZXMgfHwgW10pXTtcclxuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcclxuICAgIGlmICh0YXNrRm9ybUltYWdlcy5sZW5ndGggPj0gNSkge1xyXG4gICAgICBhbGVydCgnTWF4aW1vIDUgaW1hZ2VuZXMgcG9yIHRhcmVhLicpO1xyXG4gICAgICBicmVhaztcclxuICAgIH1cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGI2NCA9IGF3YWl0IGNvbXByZXNzSW1hZ2UoZiwgMTIwMCwgMC43NSk7XHJcbiAgICAgIHRhc2tGb3JtSW1hZ2VzLnB1c2goYjY0KTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdjb21wcmVzcyB0YXNrIGltZycsIGUpO1xyXG4gICAgfVxyXG4gIH1cclxuICBpbnB1dC52YWx1ZSA9ICcnO1xyXG4gIHJlZnJlc2hUYXNrSW1hZ2VHcmlkKCk7XHJcbn07XHJcblxyXG53aW5kb3cucmVtb3ZlVGFza0Zvcm1JbWFnZSA9IGZ1bmN0aW9uIChpZHgpIHtcclxuICB0YXNrRm9ybUltYWdlcy5zcGxpY2UoaWR4LCAxKTtcclxuICByZWZyZXNoVGFza0ltYWdlR3JpZCgpO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gcmVmcmVzaFRhc2tJbWFnZUdyaWQoKSB7XHJcbiAgY29uc3QgZ3JpZCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd0YXNrLWltZy1ncmlkJyk7XHJcbiAgaWYgKCFncmlkKSByZXR1cm47XHJcbiAgY29uc3QgY2VsbHMgPSB0YXNrRm9ybUltYWdlc1xyXG4gICAgLm1hcChcclxuICAgICAgKGI2NCwgaSkgPT5cclxuICAgICAgICAnPGRpdiBjbGFzcz1cInBob3RvLWNlbGxcIj48aW1nIHNyYz1cIicgK1xyXG4gICAgICAgIGI2NCArXHJcbiAgICAgICAgJ1wiLz48YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cInJtXCIgb25jbGljaz1cInJlbW92ZVRhc2tGb3JtSW1hZ2UoJyArXHJcbiAgICAgICAgaSArXHJcbiAgICAgICAgJylcIj4mdGltZXM7PC9idXR0b24+PC9kaXY+J1xyXG4gICAgKVxyXG4gICAgLmpvaW4oJycpO1xyXG4gIGNvbnN0IGFkZENlbGwgPVxyXG4gICAgdGFza0Zvcm1JbWFnZXMubGVuZ3RoIDwgNVxyXG4gICAgICA/ICc8bGFiZWwgY2xhc3M9XCJwaG90by1jZWxsIGFkZFwiPjxpbnB1dCB0eXBlPVwiZmlsZVwiIGFjY2VwdD1cImltYWdlLypcIiBtdWx0aXBsZSBvbmNoYW5nZT1cIm9uVGFza0ltYWdlSW5wdXQodGhpcylcIi8+KzwvbGFiZWw+J1xyXG4gICAgICA6ICcnO1xyXG4gIGdyaWQuaW5uZXJIVE1MID0gY2VsbHMgKyBhZGRDZWxsO1xyXG59XHJcblxyXG53aW5kb3cuc2VuZFRhc2tOb3RpZmljYXRpb24gPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3Qgc2VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stdGFyZ2V0Jyk7XHJcbiAgY29uc3QgdGFyZ2V0VWlkID0gc2VsLnZhbHVlO1xyXG4gIGlmICghdGFyZ2V0VWlkKSB7XHJcbiAgICBhbGVydCgnRWxlZ2kgdW4gZGVzdGluYXRhcmlvLicpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICBjb25zdCBvcHQgPSBzZWwub3B0aW9uc1tzZWwuc2VsZWN0ZWRJbmRleF07XHJcbiAgY29uc3QgdGFyZ2V0RW1haWwgPSBvcHQuZGF0YXNldC5lbWFpbCB8fCAnJztcclxuICBjb25zdCB0YXJnZXROYW1lID0gb3B0LmRhdGFzZXQubmFtZSB8fCB0YXJnZXRFbWFpbDtcclxuICBjb25zdCB0aXRsZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndGFzay10aXRsZScpLnZhbHVlIHx8ICcnKS50cmltKCk7XHJcbiAgY29uc3QgZGVzY3JpcHRpb24gPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stZGVzY3JpcHRpb24nKS52YWx1ZSB8fCAnJykudHJpbSgpO1xyXG4gIGlmICghdGl0bGUpIHtcclxuICAgIGFsZXJ0KCdGYWx0YSBlbCB0aXR1bG8uJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghZGVzY3JpcHRpb24pIHtcclxuICAgIGFsZXJ0KCdGYWx0YSBsYSBkZXNjcmlwY2lvbi4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgY29uc3QgYnRuID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI25vdGlmcy1wYW5lLWNyZWFyIC5xbW9kYWwtYnRuLnByaW1hcnknKTtcclxuICBpZiAoYnRuKSB7XHJcbiAgICBidG4uZGlzYWJsZWQgPSB0cnVlO1xyXG4gICAgYnRuLnRleHRDb250ZW50ID0gJ0VudmlhbmRvLi4uJztcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmFkZCh7XHJcbiAgICAgIHR5cGU6ICd0YXNrJyxcclxuICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICBmcm9tRW1haWw6IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICcnLFxyXG4gICAgICBmcm9tTmFtZTogY3VycmVudFVzZXIuZGlzcGxheU5hbWUgfHwgY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgIHRhcmdldFVpZDogdGFyZ2V0VWlkLFxyXG4gICAgICB0YXJnZXRFbWFpbDogdGFyZ2V0RW1haWwsXHJcbiAgICAgIHRhcmdldE5hbWU6IHRhcmdldE5hbWUsXHJcbiAgICAgIHRpdGxlOiB0aXRsZSxcclxuICAgICAgZGVzY3JpcHRpb246IGRlc2NyaXB0aW9uLFxyXG4gICAgICBpbWFnZXM6IHRhc2tGb3JtSW1hZ2VzLnNsaWNlKCksXHJcbiAgICAgIHN0YXR1czogJ3VucmVhZCcsXHJcbiAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICB9KTtcclxuICAgIC8vIExpbXBpYXIgZm9ybVxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stdGl0bGUnKS52YWx1ZSA9ICcnO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Rhc2stZGVzY3JpcHRpb24nKS52YWx1ZSA9ICcnO1xyXG4gICAgdGFza0Zvcm1JbWFnZXMgPSBbXTtcclxuICAgIHJlZnJlc2hUYXNrSW1hZ2VHcmlkKCk7XHJcbiAgICBzZWwudmFsdWUgPSAnJztcclxuICAgIGlmIChidG4pIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIGJ0bi50ZXh0Q29udGVudCA9ICdFbnZpYXIgdGFyZWEnO1xyXG4gICAgfVxyXG4gICAgc2hvd1N5bmNUYWcoJ1RhcmVhIGVudmlhZGEgYSAnICsgKHRhcmdldE5hbWUgfHwgJ2Rlc3RpbmF0YXJpbycpKTtcclxuICAgIHNldE5vdGlmc1RhYignZW52aWFkYXMnKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdzZW5kVGFza05vdGlmaWNhdGlvbicsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yIGVudmlhbmRvOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgICBpZiAoYnRuKSB7XHJcbiAgICAgIGJ0bi5kaXNhYmxlZCA9IGZhbHNlO1xyXG4gICAgICBidG4udGV4dENvbnRlbnQgPSAnRW52aWFyIHRhcmVhJztcclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cuY29tcGxldGFyVGFzayA9IGFzeW5jIGZ1bmN0aW9uIChub3RpZklkKSB7XHJcbiAgaWYgKCFjb25maXJtKCdNYXJjYXIgbGEgdGFyZWEgY29tbyBjb21wbGV0YWRhPyBMZSB2YSBhIGxsZWdhciB1biBhdmlzbyBhbCBxdWUgbGEgZW52aW8uJykpIHJldHVybjtcclxuICBjb25zdCBuID0gKG15Tm90aWZpY2F0aW9ucyB8fCBbXSkuZmluZCgoeCkgPT4geC5fZnNJZCA9PT0gbm90aWZJZCk7XHJcbiAgaWYgKCFuKSB7XHJcbiAgICBhbGVydCgnVGFyZWEgbm8gZW5jb250cmFkYS4nKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcbiAgdHJ5IHtcclxuICAgIC8vIDEpIFVwZGF0ZSBkZSBsYSB0YXJlYTogc3RhdHVzIGRvbmVcclxuICAgIGF3YWl0IGZiRGIuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpLmRvYyhub3RpZklkKS51cGRhdGUoe1xyXG4gICAgICBzdGF0dXM6ICdkb25lJyxcclxuICAgICAgZG9uZUF0OiBmaXJlYmFzZS5maXJlc3RvcmUuRmllbGRWYWx1ZS5zZXJ2ZXJUaW1lc3RhbXAoKSxcclxuICAgIH0pO1xyXG4gICAgLy8gMikgTm90aWZpY2FjaW9uIGRlIEFDSyBhbCBxdWUgbGEgZW52aW8gKHNpIG5vIHNveSBlbCBtaXNtbywgcXVlIG5vIGRlYmVyaWEpXHJcbiAgICBpZiAobi5mcm9tVWlkICYmIG4uZnJvbVVpZCAhPT0gY3VycmVudFVzZXIudWlkKSB7XHJcbiAgICAgIGNvbnN0IG15TmFtZSA9IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICdlbCBkZXN0aW5hdGFyaW8nO1xyXG4gICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5hZGQoe1xyXG4gICAgICAgIHR5cGU6ICd0YXNrX2FjaycsXHJcbiAgICAgICAgZnJvbVVpZDogY3VycmVudFVzZXIudWlkLFxyXG4gICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgZnJvbU5hbWU6IG15TmFtZSxcclxuICAgICAgICB0YXJnZXRVaWQ6IG4uZnJvbVVpZCxcclxuICAgICAgICB0aXRsZTogJ1RhcmVhIGxlaWRhIHkgY29tcGxldGFkYScsXHJcbiAgICAgICAgbWVzc2FnZTogbXlOYW1lICsgJyBtYXJjbyBjb21vIGNvbXBsZXRhZGEgdHUgdGFyZWE6IFwiJyArIChuLnRpdGxlIHx8ICcnKSArICdcIicsXHJcbiAgICAgICAgcmVsYXRlZFRhc2tJZDogbm90aWZJZCxcclxuICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCksXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgc2hvd1N5bmNUYWcoJ1RhcmVhIGNvbXBsZXRhZGEuIEF2aXNvIGVudmlhZG8gYWwgZW1pc29yLicpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ2NvbXBsZXRhclRhc2snLCBlKTtcclxuICAgIGFsZXJ0KCdFcnJvcjogJyArIChlLm1lc3NhZ2UgfHwgZSkpO1xyXG4gIH1cclxufTtcclxuXHJcbndpbmRvdy5tYXJrTm90aWZSZWFkID0gYXN5bmMgZnVuY3Rpb24gKGZzSWQpIHtcclxuICB0cnkge1xyXG4gICAgYXdhaXQgZmJEYlxyXG4gICAgICAuY29sbGVjdGlvbignbm90aWZpY2F0aW9ucycpXHJcbiAgICAgIC5kb2MoZnNJZClcclxuICAgICAgLnVwZGF0ZSh7IHN0YXR1czogJ3JlYWQnLCByZWFkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpIH0pO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ21hcmsgcmVhZCcsIGUpO1xyXG4gICAgYWxlcnQoJ0Vycm9yOiAnICsgKGUubWVzc2FnZSB8fCBlKSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gQ3VhbmRvIGVsIFZESSB0b2NhIFwiQ29udGFjdGFyXCIgZW4gdW5hIG5vdGlmOiBjZXJyYW1vcyBlbCBwYW5lbCBkZSBub3RpZnMsXHJcbi8vIGFicmltb3MgZWwgZm9ybSBkZSB2aXNpdGEgeWEgcHJlLXBvYmxhZG8gY29uIGxhIHRpZW5kYSBkZXJpdmFkYSwgeSBndWFyZGFtb3NcclxuLy8gZWwgbm90aWZJZCBwYXJhIG1hcmNhciBsYSBub3RpZiBjb21vIGxlaWRhIGN1YW5kbyBlbCBmb3JtIHNlIGVudmllIGNvbiBleGl0by5cclxuLy8gdjM2MjogZW4gd2luZG93IChubyBsZXQpIHBvcnF1ZSB2aXNpdGFzLmpzIGxhIGxlZS9lc2NyaWJlIGFsIHN1Ym1pdCBkZWxcclxuLy8gZm9ybS4gQ2FkYSBzcmMvZG9tYWlucy8qLmpzIGVzIHN1IHByb3BpbyBzY29wZSBlbiBlbCBidW5kbGUgSUlGRSBkZVxyXG4vLyBlc2J1aWxkIFx1MjAxNCBjcm9zcy1tb2R1bGUgcmVhZHMgcmVxdWllcmVuIHdpbmRvdyAocmVnbGEgQ0xBVURFLm1kICMxN1xyXG4vLyBleHRlbmRpZGE6IGFwbGljYSB0YW1iaWVuIGVudHJlIG1vZHVsb3MgZGVsIGJ1bmRsZSwgbm8gc29sbyBidW5kbGUgdnMgaW5saW5lKS5cclxuaWYgKHR5cGVvZiB3aW5kb3cucGVuZGluZ05vdGlmSWRUb01hcmtSZWFkID09PSAndW5kZWZpbmVkJykgd2luZG93LnBlbmRpbmdOb3RpZklkVG9NYXJrUmVhZCA9IG51bGw7XHJcbndpbmRvdy5jb250YWN0YXJEZXNkZU5vdGlmID0gZnVuY3Rpb24gKG5vdGlmSWQpIHtcclxuICBjb25zdCBuID0gKG15Tm90aWZpY2F0aW9ucyB8fCBbXSkuZmluZCgoeCkgPT4geC5fZnNJZCA9PT0gbm90aWZJZCk7XHJcbiAgaWYgKCFuKSB7XHJcbiAgICBhbGVydCgnTm90aWZpY2FjaW9uIG5vIGVuY29udHJhZGEuJyk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIGlmICghbi50aWVuZGEgfHwgIW4ucHJvdmluY2lhIHx8ICFuLmxvY2FsaWRhZCkge1xyXG4gICAgYWxlcnQoXHJcbiAgICAgICdFc3RhIG5vdGlmaWNhY2lvbiBubyB0aWVuZSBkYXRvcyBjb21wbGV0b3MgZGUgdGllbmRhLiBNYXJjYWxhIGNvbW8gbGVpZGEgZGVzZGUgZWwgb3RybyBib3Rvbi4nXHJcbiAgICApO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuICB3aW5kb3cucGVuZGluZ05vdGlmSWRUb01hcmtSZWFkID0gbm90aWZJZDtcclxuICBjbG9zZU5vdGlmc1BhbmVsKCk7XHJcbiAgLy8gQWJyaXIgZm9ybSBkZSB2aXNpdGEgeSBwcmUtY2FyZ2FyIGxhIHRpZW5kYSBkZXJpdmFkYS5cclxuICBpZiAodHlwZW9mIGFicmlyVmlzaXRhUGFyYVRpZW5kYSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgYWJyaXJWaXNpdGFQYXJhVGllbmRhKG4ubG9jYWxpZGFkLCBuLnByb3ZpbmNpYSwgbi50aWVuZGEpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBhYnJpclZpc2l0YVBhcmFUaWVuZGFfcmVhbChuLmxvY2FsaWRhZCwgbi5wcm92aW5jaWEsIG4udGllbmRhKTtcclxuICB9XHJcbn07XHJcblxyXG53aW5kb3cubWFya0FsbE5vdGlmc1JlYWQgPSBhc3luYyBmdW5jdGlvbiAoKSB7XHJcbiAgY29uc3QgcGVuZGluZyA9IChteU5vdGlmaWNhdGlvbnMgfHwgW10pLmZpbHRlcihpc05vdGlmUGVuZGluZyk7XHJcbiAgaWYgKCFwZW5kaW5nLmxlbmd0aCkgcmV0dXJuO1xyXG4gIGlmIChcclxuICAgICFjb25maXJtKFxyXG4gICAgICAnTWFyY2FyIGxhcyAnICsgcGVuZGluZy5sZW5ndGggKyAnIGFsZXJ0YXMvdGFyZWFzIGNvbW8gbGVpZGFzPyBQYXNhbiBhIGxhIHBlc3RhbmEgUmVhbGl6YWRhcy4nXHJcbiAgICApXHJcbiAgKVxyXG4gICAgcmV0dXJuO1xyXG4gIHRyeSB7XHJcbiAgICBmb3IgKGNvbnN0IG4gb2YgcGVuZGluZykge1xyXG4gICAgICBjb25zdCBpc1Rhc2sgPSBuLnR5cGUgPT09ICd0YXNrJztcclxuICAgICAgY29uc3QgdXBkID0gaXNUYXNrXHJcbiAgICAgICAgPyB7IHN0YXR1czogJ2RvbmUnLCBkb25lQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpIH1cclxuICAgICAgICA6IHsgc3RhdHVzOiAncmVhZCcsIHJlYWRBdDogZmlyZWJhc2UuZmlyZXN0b3JlLkZpZWxkVmFsdWUuc2VydmVyVGltZXN0YW1wKCkgfTtcclxuICAgICAgYXdhaXQgZmJEYi5jb2xsZWN0aW9uKCdub3RpZmljYXRpb25zJykuZG9jKG4uX2ZzSWQpLnVwZGF0ZSh1cGQpO1xyXG4gICAgICAvLyBTaSBlcyB1bmEgdGFyZWEsIG1hbmRvIEFDSyBhbCBlbWlzb3IgKG1pc21vIGZsdWpvIHF1ZSBjb21wbGV0YXJUYXNrLCBwZXJvIHNpbiBjb25maXJtYWNpb24pLlxyXG4gICAgICBpZiAoaXNUYXNrICYmIG4uZnJvbVVpZCAmJiBuLmZyb21VaWQgIT09IGN1cnJlbnRVc2VyLnVpZCkge1xyXG4gICAgICAgIGNvbnN0IG15TmFtZSA9IGN1cnJlbnRVc2VyLmRpc3BsYXlOYW1lIHx8IGN1cnJlbnRVc2VyLmVtYWlsIHx8ICdlbCBkZXN0aW5hdGFyaW8nO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBhd2FpdCBmYkRiLmNvbGxlY3Rpb24oJ25vdGlmaWNhdGlvbnMnKS5hZGQoe1xyXG4gICAgICAgICAgICB0eXBlOiAndGFza19hY2snLFxyXG4gICAgICAgICAgICBmcm9tVWlkOiBjdXJyZW50VXNlci51aWQsXHJcbiAgICAgICAgICAgIGZyb21FbWFpbDogY3VycmVudFVzZXIuZW1haWwgfHwgJycsXHJcbiAgICAgICAgICAgIGZyb21OYW1lOiBteU5hbWUsXHJcbiAgICAgICAgICAgIHRhcmdldFVpZDogbi5mcm9tVWlkLFxyXG4gICAgICAgICAgICB0aXRsZTogJ1RhcmVhIGxlaWRhIHkgY29tcGxldGFkYScsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IG15TmFtZSArICcgbWFyY28gY29tbyBjb21wbGV0YWRhIHR1IHRhcmVhOiBcIicgKyAobi50aXRsZSB8fCAnJykgKyAnXCInLFxyXG4gICAgICAgICAgICByZWxhdGVkVGFza0lkOiBuLl9mc0lkLFxyXG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlYWQnLFxyXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IGZpcmViYXNlLmZpcmVzdG9yZS5GaWVsZFZhbHVlLnNlcnZlclRpbWVzdGFtcCgpLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCdhY2sgZGVzZGUgbWFya0FsbCcsIGUpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ21hcmsgYWxsJywgZSk7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gPT09IEV4cG9ydHMgYSB3aW5kb3cgcGFyYSBjYWxsZXJzIGNyb3NzLXNjb3BlID09PVxyXG4vLyAtIHJlbmRlck5vdGlmc0xpc3Q6IGxsYW1hZGEgZGVzZGUgbFx1MDBFRG5lYSAxMjA0NiAodGFiIGhhbmRsZXIpLCAxMjI4NCB5IDEyMzMxXHJcbi8vIChkZW50cm8gZGUgZW5zdXJlTm90aWZzTGlzdGVuZXIgKyB1cGRhdGVOb3RpZnNCYWRnZSBkZWwgaW5saW5lKS5cclxuLy8gLSB1cGRhdGVOb3RpZnNUYWJDb3VudHM6IGxsYW1hZGEgZGVzZGUgbFx1MDBFRG5lYSAxMjMyOS0zMCBkZWwgaW5saW5lLlxyXG4vLyAtIHBvcHVsYXRlVGFza1RhcmdldHM6IHlhIGVzdFx1MDBFMSB3aW5kb3cucG9wdWxhdGVUYXNrVGFyZ2V0cyA9IGZ1bmN0aW9uLlxyXG4vLyAtIHN5bmNVc2Vyc0RpcmVjdG9yeTogeWEgZXN0XHUwMEUxIHdpbmRvdy5zeW5jVXNlcnNEaXJlY3RvcnkgPSBzeW5jVXNlcnNEaXJlY3RvcnkgKGRlbnRybyBkZWwgYmxvcXVlKS5cclxuLy8gLSBlbnN1cmVBbHRhQ2xpTGlzdGVuZXI6IGxsYW1hZGEgZGVzZGUgYXBwbHlSb2xlUGVybWlzc2lvbnMgaW5saW5lIEwxMTU0MC5cclxud2luZG93LnJlbmRlck5vdGlmc0xpc3QgPSByZW5kZXJOb3RpZnNMaXN0O1xyXG53aW5kb3cuZW5zdXJlQWx0YUNsaUxpc3RlbmVyID0gZW5zdXJlQWx0YUNsaUxpc3RlbmVyO1xyXG53aW5kb3cudXBkYXRlTm90aWZzVGFiQ291bnRzID0gdXBkYXRlTm90aWZzVGFiQ291bnRzO1xyXG4vLyBFNiBob3RmaXggMjogcG9wdWxhdGVBbHRhQ2xpUHJvdmluY2lhcyBsbGFtYWRhIGRlc2RlIHNldFRhYignYWx0YWNsaScpIGlubGluZSBMODIyMS5cclxud2luZG93LnBvcHVsYXRlQWx0YUNsaVByb3ZpbmNpYXMgPSBwb3B1bGF0ZUFsdGFDbGlQcm92aW5jaWFzO1xyXG4vLyBFNiBob3RmaXggMzogY3Jvc3MtbW9kdWxlIGJ1ZyBcdTIwMTQgcmVuZGljaW9uZXMuanMgbGxhbWEgbm90aWZJdGVtSHRtbC5cclxud2luZG93Lm5vdGlmSXRlbUh0bWwgPSBub3RpZkl0ZW1IdG1sO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFzQ0EsTUFBSSxPQUFPLE9BQU8sY0FBYyxZQUFhLFFBQU8sWUFBWTtBQUNoRSxNQUFJLGNBQWMsQ0FBQztBQUNuQixNQUFJLE9BQU8sT0FBTyxxQkFBcUIsWUFBYSxRQUFPLG1CQUFtQjtBQUU5RSxNQUFJLGlCQUFpQixDQUFDO0FBRXRCLFdBQVMsNEJBQTRCO0FBQ25DLFFBQUksb0JBQW9CLENBQUMsZUFBZSxDQUFDLEtBQU07QUFHL0MsV0FBTyxtQkFBbUIsS0FDdkIsV0FBVyxlQUFlLEVBQzFCLE1BQU0sV0FBVyxNQUFNLFlBQVksR0FBRyxFQUN0QztBQUFBLE1BQ0MsQ0FBQyxPQUFPO0FBQ04sc0JBQWMsQ0FBQztBQUNmLFdBQUcsUUFBUSxDQUFDLE1BQU07QUFDaEIsZ0JBQU0sT0FBTyxFQUFFLEtBQUssS0FBSyxDQUFDO0FBQzFCLGVBQUssS0FBSyxRQUFRLGtCQUFrQixPQUFRO0FBQzVDLHNCQUFZLEtBQUssT0FBTyxPQUFPLEVBQUUsT0FBTyxFQUFFLEdBQUcsR0FBRyxJQUFJLENBQUM7QUFBQSxRQUN2RCxDQUFDO0FBQ0Qsb0JBQVksS0FBSyxDQUFDLEdBQUcsTUFBTTtBQUN6QixnQkFBTSxLQUFLLEVBQUUsWUFBYSxFQUFFLFVBQVUsV0FBVyxFQUFFLFVBQVUsU0FBUyxJQUFJLElBQUs7QUFDL0UsZ0JB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
