/**
 * Y — Cerrar ingresos_reparto sin BO vigente (clientesBO stale).
 *
 * Precedente SATO 2026-10-23 (CLAUDE.md §64.3): draft_lock creó 2 pedidos
 * SATO que se facturaron/cancelaron antes del reparto. El ingreso para
 * EDUARDO SATO 21100400100E seguía abierto con `clientesBO` apuntando a
 * esas líneas con `qtyOpen=0` → al apretar "Aplicar reparto" la CF
 * rechazaba con "linea con qtyOpen=0 @ <pedidoId>:5 (pedido <pedidoId>)".
 *
 * Flow (read-only por default; `--apply` persiste):
 *   1. Lee `ingresos_reparto` status in ['pending','in_progress'].
 *   2. Para cada ingreso, chequea cada cliente de `clientesBO[]`:
 *      - Busca pedidos abiertos del cardCode (sin closedAt) con el SKU.
 *      - El cliente tiene BO vigente si existe al menos 1 línea
 *        state='BO' + qtyOpen > 0 para el SKU del ingreso.
 *   3. Si NINGÚN cliente tiene BO vigente → marcar para cerrar.
 *   4. Si HAY algunos con BO + otros sin → NO cerrar (deja que Pablo decida).
 *
 * Al aplicar: `status='done'`, `appliedAt`, `appliedBy=<este script>`,
 *   `closureReason='bo_vigente_cero_script_cleanup'`,
 *   `_backfill.<slug>.previousValues` para rollback.
 *
 * Output:
 *   - Tabla ASCII en stdout.
 *   - Markdown en `docs/auditoria/Y_cerrar_ingresos_sin_bo_vigente.md`.
 *
 * Uso:
 *   node scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs           (dry-run)
 *   node scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs --apply   (ejecuta)
 */

const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'app-vendedores-shimano';
const BACKFILL_SLUG = 'Y_cerrar_' + new Date().toISOString().slice(0, 10) + '_v1519';
const OUTPUT_MD = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'auditoria',
  'Y_cerrar_ingresos_sin_bo_vigente.md'
);

async function main() {
  const admin = require('../../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();

  console.log('================================================================');
  console.log('Y — Cerrar ingresos_reparto sin BO vigente (CLAUDE.md §64.3)');
  console.log('================================================================');
  console.log('Modo:', APPLY ? '--apply (WRITES EN PROD)' : '--dry-run');
  console.log('Slug backfill:', BACKFILL_SLUG);
  console.log('');

  const nowIso = new Date().toISOString();

  // 1. Lee ingresos abiertos.
  console.log('[1/4] Leyendo ingresos_reparto abiertos...');
  const snap = await db
    .collection('ingresos_reparto')
    .where('status', 'in', ['pending', 'in_progress'])
    .get();
  console.log('  total abiertos: ' + snap.size);

  const ingresos = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    ingresos.push({
      id: d.id,
      ref: d.ref,
      sku: String(data.sku || '').toUpperCase().trim(),
      status: String(data.status || ''),
      qtyIngresada: Number(data.qtyIngresada || 0),
      clientesBO: Array.isArray(data.clientesBO) ? data.clientesBO : [],
      detectedAt: data.detectedAt || null,
      data,
    });
  });

  // 2. Pre-cargar todos los pedidos abiertos (sin closedAt).
  //    Firestore: `closedAt == null` o field ausente. Usamos != para capturar
  //    docs sin el campo (Firestore trata missing como no-match a '!=null').
  //    Alternativa segura: cargar todos y filtrar client-side.
  console.log('[2/4] Leyendo pedidos abiertos (sin closedAt)...');
  const pedSnap = await db.collection('pedidos').get();
  const pedidosByCard = new Map();
  pedSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.closedAt) return;
    const card = String(data.clientCardCode || '').trim();
    if (!card) return;
    const arr = pedidosByCard.get(card) || [];
    arr.push({ id: d.id, data });
    pedidosByCard.set(card, arr);
  });
  console.log('  cardCodes con pedidos abiertos: ' + pedidosByCard.size);

  // 3. Para cada ingreso, chequear por cada cliente del snapshot.
  console.log('[3/4] Evaluando ' + ingresos.length + ' ingresos...');
  const marcados = [];
  const skipped = [];
  const sinClientesBO = [];

  for (const ing of ingresos) {
    if (!ing.sku) {
      skipped.push({ ing, reason: 'ingreso sin sku' });
      continue;
    }
    if (ing.clientesBO.length === 0) {
      // Sin clientesBO el ingreso ya es raro; lo marcamos para revisar.
      sinClientesBO.push(ing);
      continue;
    }
    // Para cada cliente del snapshot, chequear si tiene BO vigente real.
    const perCliente = ing.clientesBO.map((c) => {
      const card = String(c.clientCardCode || '').trim();
      const pedsCliente = pedidosByCard.get(card) || [];
      let boVigente = 0;
      const detalles = [];
      for (const p of pedsCliente) {
        const lines = Array.isArray(p.data.lines) ? p.data.lines : [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i] || {};
          const code = String(l.code || '').toUpperCase().trim();
          if (code !== ing.sku) continue;
          const state = String(l.state || '');
          const qo = Number(l.qtyOpen || 0);
          if (state === 'BO' && qo > 0) {
            boVigente += qo;
            detalles.push({ pedidoId: p.id, lineIndex: i, qtyOpen: qo });
          }
        }
      }
      return {
        clientCardCode: card,
        clientName: String(c.clientName || ''),
        qtyBackorderSnapshot: Number(c.qtyBackorder || 0),
        boVigenteReal: boVigente,
        detalles,
      };
    });
    const conBO = perCliente.filter((x) => x.boVigenteReal > 0);
    const sinBO = perCliente.filter((x) => x.boVigenteReal === 0);
    if (conBO.length === 0) {
      marcados.push({ ing, perCliente });
    } else if (sinBO.length > 0) {
      // Mixto: no cerramos. Dejamos que Pablo decida (más complejo).
      skipped.push({
        ing,
        reason: 'mixto (' + conBO.length + ' con BO, ' + sinBO.length + ' sin)',
        perCliente,
      });
    } else {
      skipped.push({ ing, reason: 'todos con BO vigente', perCliente });
    }
  }

  console.log('  marcados a cerrar: ' + marcados.length);
  console.log('  ingresos SIN clientesBO (anómalos): ' + sinClientesBO.length);
  console.log('  skipped (todos OK o mixtos): ' + skipped.length);
  console.log('');

  // 4. Imprimir tabla + markdown.
  console.log('[4/4] Reporte:');
  console.log('');
  console.log('===== MARCADOS A CERRAR =====');
  console.log(_hR());
  console.log(_hC(['ingresoId', 'sku', 'status', 'qtyIng', 'clientes', 'detectedAt']));
  console.log(_hR());
  for (const m of marcados) {
    console.log(
      _hC([
        m.ing.id,
        m.ing.sku,
        m.ing.status,
        String(m.ing.qtyIngresada),
        String(m.perCliente.length),
        _isoShort(m.ing.detectedAt),
      ])
    );
  }
  console.log(_hR());
  console.log('');

  if (sinClientesBO.length > 0) {
    console.log('===== INGRESOS SIN clientesBO (revisar) =====');
    for (const ing of sinClientesBO) {
      console.log('  id=' + ing.id + ' sku=' + ing.sku + ' status=' + ing.status);
    }
    console.log('');
  }

  const md = _buildMd({ nowIso, marcados, sinClientesBO, skipped, apply: APPLY });
  try {
    fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
    fs.writeFileSync(OUTPUT_MD, md, 'utf8');
    console.log('Markdown escrito: ' + OUTPUT_MD);
  } catch (e) {
    console.warn('No se pudo escribir markdown: ' + e.message);
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY-RUN. Para ejecutar: --apply');
    return;
  }

  if (marcados.length === 0) {
    console.log('');
    console.log('Nada que cerrar. Done.');
    return;
  }

  console.log('');
  console.log('===== APLICANDO WRITES (' + marcados.length + ') =====');
  const BATCH_LIMIT = 400;
  let totalWrites = 0;
  for (let i = 0; i < marcados.length; i += BATCH_LIMIT) {
    const chunk = marcados.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const m of chunk) {
      batch.update(m.ing.ref, {
        status: 'done',
        appliedAt: nowIso,
        appliedBy: 'scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs',
        closureReason: 'bo_vigente_cero_script_cleanup',
        _backfill: Object.assign({}, m.ing.data._backfill || {}, {
          [BACKFILL_SLUG]: {
            previousValues: {
              status: m.ing.status,
              clientesBO: m.ing.clientesBO,
            },
            by: 'scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs',
            at: nowIso,
          },
        }),
        _lastBackfillAt: nowIso,
        _lastBackfillBy: 'scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs',
      });
    }
    await batch.commit();
    totalWrites += chunk.length;
    console.log('  batch commit: ' + chunk.length + ' (acum: ' + totalWrites + ')');
  }
  console.log('');
  console.log('OK: ' + totalWrites + ' ingresos cerrados con closureReason=bo_vigente_cero_script_cleanup.');
}

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------
const _COL_W = [26, 20, 12, 8, 8, 20];
function _hR() {
  return '+' + _COL_W.map((w) => '-'.repeat(w + 2)).join('+') + '+';
}
function _hC(cells) {
  return (
    '| ' +
    cells
      .map((c, i) => {
        const s = String(c || '');
        const w = _COL_W[i] || 10;
        return s.length > w ? s.slice(0, w) : s.padEnd(w);
      })
      .join(' | ') +
    ' |'
  );
}
function _isoShort(iso) {
  if (!iso) return '-';
  if (typeof iso === 'string') return iso.slice(0, 16).replace('T', ' ');
  if (iso && typeof iso.toDate === 'function') {
    try {
      return iso.toDate().toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      return '-';
    }
  }
  return '-';
}
function _buildMd({ nowIso, marcados, sinClientesBO, skipped, apply }) {
  const lines = [];
  lines.push('# Y — Cerrar ingresos_reparto sin BO vigente');
  lines.push('');
  lines.push('- Ejecutado: ' + nowIso);
  lines.push('- Modo: ' + (apply ? '**--apply (WRITES EN PROD)**' : 'dry-run'));
  lines.push('- Precedente: CLAUDE.md §64.3 (SATO 2026-10-23 draft_lock)');
  lines.push('- Script: `scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs`');
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('| Categoría | Cantidad |');
  lines.push('|---|---:|');
  lines.push('| Marcados a cerrar | ' + marcados.length + ' |');
  lines.push('| Sin clientesBO (anómalos) | ' + sinClientesBO.length + ' |');
  lines.push('| Skipped (con BO vigente o mixtos) | ' + skipped.length + ' |');
  lines.push('');
  lines.push('## Marcados a cerrar');
  lines.push('');
  if (marcados.length === 0) {
    lines.push('_Ningún ingreso cumple el criterio (todos tienen BO vigente o son mixtos)._');
  } else {
    lines.push('| ingresoId | SKU | status | qtyIng | #clientes | detectedAt |');
    lines.push('|---|---|---|---:|---:|---|');
    for (const m of marcados) {
      lines.push(
        '| `' +
          m.ing.id +
          '` | ' +
          m.ing.sku +
          ' | ' +
          m.ing.status +
          ' | ' +
          m.ing.qtyIngresada +
          ' | ' +
          m.perCliente.length +
          ' | ' +
          _isoShort(m.ing.detectedAt) +
          ' |'
      );
    }
    lines.push('');
    lines.push('### Detalle por cliente de cada ingreso marcado');
    lines.push('');
    for (const m of marcados) {
      lines.push('#### `' + m.ing.id + '` — ' + m.ing.sku);
      lines.push('');
      lines.push('| cardCode | cliente | qtyBackorderSnapshot | boVigenteReal |');
      lines.push('|---|---|---:|---:|');
      for (const c of m.perCliente) {
        lines.push(
          '| ' +
            c.clientCardCode +
            ' | ' +
            c.clientName +
            ' | ' +
            c.qtyBackorderSnapshot +
            ' | ' +
            c.boVigenteReal +
            ' |'
        );
      }
      lines.push('');
    }
  }
  if (skipped.length > 0) {
    lines.push('## Skipped');
    lines.push('');
    lines.push('| ingresoId | SKU | motivo |');
    lines.push('|---|---|---|');
    for (const s of skipped) {
      lines.push('| `' + s.ing.id + '` | ' + s.ing.sku + ' | ' + s.reason + ' |');
    }
    lines.push('');
  }
  if (sinClientesBO.length > 0) {
    lines.push('## Sin clientesBO (anómalos — revisar manual)');
    lines.push('');
    lines.push('| ingresoId | SKU | status |');
    lines.push('|---|---|---|');
    for (const ing of sinClientesBO) {
      lines.push('| `' + ing.id + '` | ' + ing.sku + ' | ' + ing.status + ' |');
    }
    lines.push('');
  }
  lines.push('## Rollback');
  lines.push('');
  lines.push(
    'Cada ingreso cerrado guarda snapshot `_backfill.' +
      '<slug>.previousValues' +
      '` con `status` y `clientesBO` previos. Para revertir uno:'
  );
  lines.push('');
  lines.push('```');
  lines.push('await db.collection("ingresos_reparto").doc(<id>).update({');
  lines.push('  status: previousValues.status,');
  lines.push('  clientesBO: previousValues.clientesBO,');
  lines.push('  appliedAt: null, appliedBy: null, closureReason: null,');
  lines.push('});');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
