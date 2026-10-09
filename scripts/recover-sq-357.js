// Snippet one-shot: reconstruye ORDEN 357 en revision_waitlist desde SAP SQ 2000349.
// Uso desde la consola del browser (sesion admin activa):
//   fetch('./scripts/recover-sq-357.js').then(r=>r.text()).then(eval)
//
// Flow: fetch SAP SL → mapea DocumentLines a items → confirm → write Firestore.
(async () => {
  const SAP_DOC_NUM = 2000349;
  const ORDER_NUM = 357;
  const CLIENT_LOC = 'CORDOBA';
  const VENDOR = 'SANTIAGO ESTEBAN';
  console.log('[recover] 1/4 Consultando SAP SQ ' + SAP_DOC_NUM + '...');
  const sap = window.__phase0.sap.createSapClient(window.firebase);
  const path =
    '/b1s/v1/Quotations?$filter=DocNum eq ' +
    SAP_DOC_NUM +
    '&$expand=DocumentLines' +
    '&$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,DocumentLines';
  const sqRes = await sap.fetchWithSession(path);
  if (!sqRes.ok) {
    console.error('[recover] FALLO SAP:', sqRes);
    return;
  }
  const sq = sqRes.body && sqRes.body.value && sqRes.body.value[0];
  if (!sq) {
    console.error('[recover] SQ ' + SAP_DOC_NUM + ' NO EXISTE en SAP');
    return;
  }
  console.log('[recover] 2/4 SQ encontrada:', {
    DocEntry: sq.DocEntry,
    DocNum: sq.DocNum,
    CardCode: sq.CardCode,
    CardName: sq.CardName,
    lines: (sq.DocumentLines || []).length,
  });

  const items = (sq.DocumentLines || [])
    .map((l) => ({
      code: l.ItemCode || '',
      desc: l.ItemDescription || '',
      qty: Number(l.Quantity) || 0,
      firstStockTotal: null,
      firstBackorder: 0,
      firstDisponible: null,
      _originalPrecio: Number(l.Price) || 0,
    }))
    .filter((it) => it.qty > 0);
  const totalU = items.reduce((a, i) => a + i.qty, 0);
  console.log('[recover] 3/4 Items mapeados:', items.length, 'total u:', totalU);

  const msg =
    'Reconstruir pedido en revision_waitlist?\n\n' +
    'Cliente: ' +
    sq.CardName +
    ' (' +
    sq.CardCode +
    ')\n' +
    'Items: ' +
    items.length +
    '\n' +
    'Total unidades: ' +
    totalU +
    '\n' +
    'ORDEN: ' +
    ORDER_NUM +
    ' · SAP DocNum: ' +
    sq.DocNum +
    '\n\n' +
    'Confirmar?';
  if (!confirm(msg)) {
    console.log('[recover] cancelado');
    return;
  }

  const payload = {
    clientName: sq.CardName || '',
    clientProvince: '',
    clientLocality: CLIENT_LOC,
    clientCardCode: sq.CardCode || '',
    vendorAssigned: VENDOR,
    ownerUid: (window.currentUser && window.currentUser.uid) || '',
    ownerEmail: (window.currentUser && window.currentUser.email) || '',
    ownerDisplayName:
      (window.currentUser && (window.currentUser.displayName || window.currentUser.email)) || '',
    ownerVendor: VENDOR,
    orderNumber: ORDER_NUM,
    items,
    fromPedidoFsId: null,
    fromPedidoMonth: 'Octubre 2026',
    fromPedidoStage: 'confirmed',
    _movedByScript: {
      script: 'recover-sq-357.js',
      at: new Date().toISOString(),
      sapDocNum: sq.DocNum,
      sapDocEntry: sq.DocEntry,
    },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  console.log('[recover] 4/4 Escribiendo revision_waitlist...');
  const ref = await fbDb.collection('revision_waitlist').add(payload);
  console.log('[recover] OK revision_waitlist/' + ref.id + ' creado. Refresca para verlo.');
})();
