const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./tmp_repartos.json', 'utf8'));
const lines = [];
lines.push('# 24 — Repartos pendientes para Pablo (post v1392 §40)');
lines.push('');
lines.push('**Fecha**: 2026-10-21');
lines.push('**Total SKUs con libre nuevo**: ' + data.length);
lines.push('**Total unidades que pasan a libre**: ' + data.reduce((s, d) => s + d.delta, 0));
lines.push('');
lines.push('Ordenados por mayor delta (unidades que pasan a libre con la regla §40).');
lines.push('');
lines.push('Cuando Pablo entra al modal "Reparto":');
lines.push('- Puede **asignar** a los clientes de la cola (BO → ASIG, reserva stock).');
lines.push('- Puede **cerrar con sobrante** (botón nuevo v1392): lo no asignado queda libre.');
lines.push('');
lines.push('---');
lines.push('');
for (const d of data) {
  lines.push('## ' + d.sku);
  lines.push('');
  lines.push('| Métrica | Valor |');
  lines.push('|---|---|');
  lines.push('| Físico dep 11 | ' + d.fisico + ' u |');
  lines.push('| Asignadas (ASIG vigente) | ' + d.asigV + ' u |');
  lines.push('| Confirmed vigente | ' + d.confV + ' u |');
  lines.push('| Back order vigente | ' + d.boV + ' u |');
  lines.push('| Libre pre-§40 | ' + d.libreV1 + ' u |');
  lines.push('| **Libre post-§40** | **' + d.libreV2 + ' u** |');
  lines.push('| **Delta** | **+' + d.delta + ' u** |');
  if (d.ir) {
    lines.push('| Reparto activo | id=' + d.ir.id + ' qtyIng=' + d.ir.qtyIng + ' status=' + d.ir.status + ' |');
  }
  lines.push('');
  if (d.clientesCola.length > 0) {
    lines.push('**Clientes en cola (BO vigente, FIFO):**');
    lines.push('');
    lines.push('| Cliente | Qty | createdAt |');
    lines.push('|---|---|---|');
    for (const c of d.clientesCola) {
      lines.push('| ' + c.clientName + ' | ' + c.qty + ' | ' + (c.createdAt || '').slice(0, 10) + ' |');
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
}
fs.writeFileSync('docs/auditoria/24_REPARTOS_PARA_PABLO.md', lines.join('\n'));
console.log('wrote ' + lines.length + ' lines');
