// v1540 APP-06: Pedidos del mes — contratos de pantalla, chunk y seguridad.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX = readFileSync('index.html', 'utf8');
const CHUNK = readFileSync('src/domains/pedidos-del-mes.js', 'utf8');
const BUILD = readFileSync('build.js', 'utf8');
const MAIN = readFileSync('src/main.js', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const FN = readFileSync('functions/index.js', 'utf8');

describe('v1540 APP-06 — botón', () => {
  it('está inmediatamente debajo de Forecast', () => {
    const f = INDEX.indexOf('<button class="btn-zonas" id="forecast-btn"');
    const p = INDEX.indexOf('id="pedidos-mes-btn"');
    expect(f).toBeGreaterThan(0);
    expect(p).toBeGreaterThan(f);
    const entre = INDEX.slice(f, p);
    // Entre los dos solo están las aperturas del propio Forecast y de Pedidos del mes.
    expect(entre.match(/<button /g)?.length ?? 0).toBe(2);
  });
  it('oculto por default y habilitado solo para admin, gerente y vendedor', () => {
    expect(INDEX).toMatch(/id="pedidos-mes-btn"[^>]*display:none/);
    expect(INDEX).toMatch(
      /const _pdmOk = userRole === 'admin' \|\| userRole === 'gerente' \|\| userRole === 'vendedor';/
    );
  });
  it('solo desktop: tablet, mobile y pantallas táctiles lo ocultan', () => {
    expect(INDEX).toContain(
      '@media (max-width:1024px),(hover:none),(pointer:coarse){#pedidos-mes-btn{display:none !important}}'
    );
  });
});

describe('v1540 APP-06 — chunk lazy sincronizado (CLAUDE.md §18)', () => {
  it('build.js, main.js y sw.js', () => {
    expect(BUILD).toMatch(/'pedidos-del-mes': \['openPedidosDelMes', 'closePedidosDelMes'\]/);
    expect(MAIN).toMatch(
      /installChunkStubs\('pedidos-del-mes', \['openPedidosDelMes', 'closePedidosDelMes'\]\)/
    );
    expect(SW).toContain("'./chunks/pedidos-del-mes.js'");
  });
  it('modal presente en index.html', () => {
    expect(INDEX).toContain('id="pedidos-mes-modal"');
    for (const id of ['pdm-filtros', 'pdm-kpis', 'pdm-list']) expect(INDEX).toContain(`id="${id}"`);
  });
});

describe('v1540 APP-06 — fuente de datos y seguridad', () => {
  it('la pantalla solo consulta pedidosDelMesCF (nada de pedidos, espera, backorder ni Firestore)', () => {
    expect(CHUNK).toContain("httpsCallable('pedidosDelMesCF')");
    // Sin comentarios: los comentarios nombran a propósito lo que NO se lee.
    const code = CHUNK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fbDb|collection\(|globalPedidos|revisionWaitlist|backorder/i);
  });
  it('la pantalla no manda vendedor al servidor (el alcance lo decide el servidor)', () => {
    expect(CHUNK).toMatch(/callable\(\{ anio: state\.anio, mes: state\.mes \}\)/);
  });
  it('el wrapper lee el rol de roles/{uid} en el servidor y usa el core', () => {
    const i = FN.indexOf('export const pedidosDelMesCF');
    const bloque = FN.slice(i, FN.indexOf('\n);\n', i));
    expect(bloque).toContain("db.collection('roles').doc(uid).get()");
    expect(bloque).toContain('pedidosDelMesCore(');
    expect(bloque).toContain('region: REGION');
  });
  it('las filas se despliegan como Stock Asignado (▶/▼, varias abiertas)', () => {
    expect(CHUNK).toContain("caret.textContent = abrir ? '▼' : '▶'");
    expect(CHUNK).toContain('state.abiertos');
  });
});
