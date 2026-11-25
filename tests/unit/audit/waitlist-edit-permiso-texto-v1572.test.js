/**
 * N4 (re-revisión adversarial #1422 R2, 2026-11-25) — §68.
 *
 * Las ediciones de una orden en espera que vuelven sin permiso (orden de otro
 * vendedor, firestore.rules) muestran un texto humano con código técnico en
 * vez del error crudo de Firestore. El guard §42.2 de pedidos-modal.js no
 * mezcla las líneas en el pedido local hasta que el update se confirma.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatMensajeConCodigo,
  MENSAJES_VENDEDOR,
  PALABRAS_PROHIBIDAS,
  SERVER_ERROR_CODES_MAPEADOS,
} from '../../../src/pure/mensajes-vendedor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const modal = readFileSync(resolve(ROOT, 'src/domains/pedidos-modal.js'), 'utf8');

describe('N4 — texto humano para permiso denegado al editar una orden en espera', () => {
  it('MENSAJES_VENDEDOR tiene WAITLIST_FUERA_DE_PAREJA sin jerga', () => {
    const m = MENSAJES_VENDEDOR.WAITLIST_FUERA_DE_PAREJA;
    expect(m && m.texto).toBeTruthy();
    for (const p of PALABRAS_PROHIBIDAS) {
      expect(m.texto.toLowerCase()).not.toContain(String(p).toLowerCase());
    }
    expect(formatMensajeConCodigo('WAITLIST_FUERA_DE_PAREJA')).toContain(
      'Código técnico: WAITLIST_FUERA_DE_PAREJA'
    );
  });

  it('index.html define _waitlistEditErrorText solo para permission-denied, con fallback inline', () => {
    const i = html.indexOf('window._waitlistEditErrorText = function(e)');
    expect(i).toBeGreaterThan(-1);
    const body = html.slice(i, i + 800);
    expect(body).toContain("c !== 'permission-denied'");
    expect(body).toContain("formatMensajeConCodigo('WAITLIST_FUERA_DE_PAREJA')");
    expect(body).toContain('Código técnico: WAITLIST_FUERA_DE_PAREJA');
  });

  it('las ediciones de orden en espera pasan el error por _waitlistEditErrorText', () => {
    const esperados = [
      "('Error agregando: ' + (e.message || e))",
      "('Error reemplazando: ' + (e.message || e))",
      "('Error unificando: ' + (e.message || e))",
      "('Error al cambiar estado: ' + (err?.message || err))",
    ];
    for (const frag of esperados) {
      expect(html).toContain(`window._waitlistEditErrorText(`);
      const idx = html.indexOf(frag);
      expect(idx, frag).toBeGreaterThan(-1);
      expect(html.slice(idx - 60, idx)).toContain('_waitlistEditErrorText(');
    }
    const usos = html.split('alert(window._waitlistEditErrorText(').length - 1;
    expect(usos).toBeGreaterThanOrEqual(9);
    // Ningún alert de edición de orden queda con el error crudo de Firestore
    // en los sitios migrados (agregar / reemplazar / unificar).
    expect(html).not.toMatch(/^\s*alert\('Error agregando: ' \+ \(e\.message \|\| e\)\);/m);
    expect(html).not.toMatch(/^\s*alert\('Error unificando: ' \+ \(e\.message \|\| e\)\);/m);
  });

  it('WAITLIST_BORRAR_SOLO_PROPIA (releaseAsigCF rechazo_cpst, N5) se muestra con texto propio', () => {
    expect(SERVER_ERROR_CODES_MAPEADOS).toContain('WAITLIST_BORRAR_SOLO_PROPIA');
    const i = html.indexOf('window._SERVER_ERROR_FALLBACK_TEXTS = {');
    const end = html.indexOf('};', i);
    expect(html.slice(i, end)).toContain('WAITLIST_BORRAR_SOLO_PROPIA:');
  });
});

describe('N4 — guard §42.2 no muta el pedido local antes de confirmar el update', () => {
  it('mezcla sobre una copia y asigna al pedido local recién después del update', () => {
    const iCopy = modal.indexOf('const ord = (orders[currentOrderKey] || []).slice();');
    const iUpdate = modal.indexOf(
      "await fbDb.collection('revision_waitlist').doc(target._id).update(updatePayload);"
    );
    const iAssign = modal.indexOf('orders[currentOrderKey] = ord;');
    expect(iCopy).toBeGreaterThan(-1);
    expect(iUpdate).toBeGreaterThan(iCopy);
    expect(iAssign).toBeGreaterThan(iUpdate);
    // Una sola asignación (no queda la vieja antes del update).
    expect(modal.split('orders[currentOrderKey] = ord;').length - 1).toBe(1);
  });

  it('el error de la unificación usa _waitlistEditErrorText cuando es por permiso', () => {
    const i = modal.indexOf("console.error('[§42.2 review guard] fallo unificacion:'");
    expect(i).toBeGreaterThan(-1);
    expect(modal.slice(i, i + 600)).toContain('window._waitlistEditErrorText(eUnify)');
  });
});
