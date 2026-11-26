// S-9 c2 (2026-11-26): test de contrato para la extraccion de `forceUpdateApp`
// + `CLEAN_RELOAD_PRESERVE_KEYS` del inline a `src/domains/force-update-app.js`.
//
// Protege:
//   - La definicion vive en el bundle (no en el inline).
//   - El inline carga el bundle via `src/main.js`.
//   - El RefreshAppControl del mapa usa `window.forceUpdateApp` explicito.
//   - `CLEAN_RELOAD_PRESERVE_KEYS` preserva las 2 claves de CLAUDE.md §101
//     (`shimano_zonas_pending_v1` + `shimano_price_cache_v1`).
//
// Si en el futuro alguien revierte la extraccion o cambia el shape del
// preserve-keys, este test falla antes del merge.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const DOMAIN_FILE = path.join(ROOT, 'src', 'domains', 'force-update-app.js');

describe('S-9 c2 — force-update-app extraido', () => {
  it('src/domains/force-update-app.js existe y declara window.forceUpdateApp', () => {
    expect(fs.existsSync(DOMAIN_FILE)).toBe(true);
    const content = fs.readFileSync(DOMAIN_FILE, 'utf8');
    expect(content).toContain('win.forceUpdateApp = forceUpdateApp');
    expect(content).toContain('async function forceUpdateApp');
  });

  it('src/domains/force-update-app.js expone CLEAN_RELOAD_PRESERVE_KEYS con las 2 claves canonicas', () => {
    const content = fs.readFileSync(DOMAIN_FILE, 'utf8');
    expect(content).toContain('win.CLEAN_RELOAD_PRESERVE_KEYS = CLEAN_RELOAD_PRESERVE_KEYS');
    expect(content).toContain("'shimano_zonas_pending_v1'");
    expect(content).toContain("'shimano_price_cache_v1'");
  });

  it('src/main.js importa el modulo force-update-app', () => {
    expect(MAIN_JS).toMatch(/import\s+['"]\.\/domains\/force-update-app\.js['"]/);
  });

  it('index.html NO define async function forceUpdateApp inline', () => {
    expect(INDEX_HTML).not.toMatch(/async\s+function\s+forceUpdateApp\s*\(/);
  });

  it('index.html NO declara const CLEAN_RELOAD_PRESERVE_KEYS inline', () => {
    expect(INDEX_HTML).not.toMatch(/const\s+CLEAN_RELOAD_PRESERVE_KEYS\s*=/);
  });

  it('index.html mantiene el RefreshAppControl y llama a window.forceUpdateApp', () => {
    expect(INDEX_HTML).toContain('RefreshAppControl');
    expect(INDEX_HTML).toContain("L.DomEvent.on(btn, 'click', window.forceUpdateApp)");
  });

  it('index.html incluye el comentario-stub que apunta al bundle', () => {
    expect(INDEX_HTML).toContain('forceUpdateApp + CLEAN_RELOAD_PRESERVE_KEYS extraidos');
    expect(INDEX_HTML).toContain('src/domains/force-update-app.js');
  });

  it('src/domains/force-update-app.js NO toca pedidos/stock/reservas/descuentos', () => {
    const content = fs.readFileSync(DOMAIN_FILE, 'utf8').toLowerCase();
    // Palabras prohibidas segun el prompt S-9 c2.
    const forbidden = [
      'commitpedido',
      'revisionwaitlist',
      'operations_log',
      'sapproxy',
      'backorder',
      'reparto',
      'asig',
      'descount',
      'discountpct',
    ];
    for (const word of forbidden) {
      expect(content).not.toContain(word);
    }
  });

  it('src/domains/force-update-app.js preserva los 7 pasos del pipeline §101', () => {
    const content = fs.readFileSync(DOMAIN_FILE, 'utf8');
    // 1. Confirmación.
    expect(content).toContain('confirm(confirmMsg)');
    // 2. Overlay.
    expect(content).toContain('clean-reload-overlay');
    // 3. Firestore terminate.
    expect(content).toContain('w.fbDb.terminate');
    // 4. clearPersistence.
    expect(content).toContain('clearPersistence');
    // 5. localStorage respeta preserve.
    expect(content).toContain('preserve.has(key)');
    // 6. sessionStorage.
    expect(content).toContain('sessionStorage.clear');
    // 7. SW unregister + caches + reload.
    expect(content).toContain('serviceWorker.getRegistrations');
    expect(content).toContain('caches.delete');
    expect(content).toContain('window.location.replace');
  });
});
