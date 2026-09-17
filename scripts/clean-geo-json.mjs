/**
 * clean-geo-json.mjs (v967, 2026-09-17)
 *
 * Limpia el `geo.json` de departamentos + provincias INDEC para que los
 * vertices compartidos entre features vecinos sean IDENTICOS (no solo
 * "casi iguales"). Elimina las "grietas" residuales que aparecen al zoom
 * cercano en el mapa de vendedores porque la data INDEC tiene vertices
 * "compartidos" desalineados hasta 200m entre depts vecinos.
 *
 * Estrategia (mapshaper):
 *   1. Extraer FeatureCollection `dept` a JSON standalone en memoria.
 *   2. Correr `-clean snap gap-fill-area=1km2` que:
 *      - snapea vertices dentro del snap-interval auto-detectado al mismo punto.
 *      - cierra huecos <1km2 entre polygons.
 *      - fixea overlaps.
 *   3. Idem para FeatureCollection `prov` (contornos provinciales).
 *   4. Reconstruye `{dept, prov}` y lo guarda como `geo.json` sobreescribiendo.
 *
 * Uso:
 *   node scripts/clean-geo-json.mjs                    # limpia in-place
 *   node scripts/clean-geo-json.mjs --dry              # muestra stats, no escribe
 *
 * Backup: `geo.json.backup-pre-v967` ya existe si arrancas con esto.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mapshaper from 'mapshaper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEO_PATH = join(ROOT, 'geo.json');
const DRY = process.argv.includes('--dry');

function bytesToKb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}

function countVertices(feature) {
  const geom = feature.geometry;
  if (!geom) return 0;
  const coords = geom.coordinates;
  let n = 0;
  function walk(arr) {
    if (Array.isArray(arr) && typeof arr[0] === 'number') {
      n += 1;
      return;
    }
    for (const item of arr) walk(item);
  }
  walk(coords);
  return n;
}

function stripInnerRings(fc) {
  // Provincias NO tienen enclaves reales — CABA esta separada. Todo inner
  // ring en prov es artefacto de digitalizacion INDEC. Los strippeamos.
  let stripped = 0;
  for (const feat of fc.features) {
    const geom = feat.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      if (geom.coordinates.length > 1) {
        stripped += geom.coordinates.length - 1;
        geom.coordinates = [geom.coordinates[0]];
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (poly.length > 1) {
          stripped += poly.length - 1;
          poly.length = 1;
        }
      }
    }
  }
  return stripped;
}

async function cleanFeatureCollection(fc, name, opts) {
  const { snap, gapFill, stripInners } = opts;
  const before = fc.features.reduce((s, f) => s + countVertices(f), 0);
  const inputName = `${name}.json`;
  const outputName = `${name}-clean.json`;

  // mapshaper rechaza unidades metricas en datasets latlong (grados). Fix:
  // reproyectamos a mercator, corremos clean con unidades reales (m/km2),
  // y volvemos a wgs84 para exportar como GeoJSON standard.
  //
  //   dept: snap 100m + gap-fill 1km2  → preserva enclaves reales (CABA, etc)
  //   prov: snap 500m + gap-fill 100km2 + strip inners → provincias sin huecos
  const cmd = [
    `-i ${inputName}`,
    '-proj webmercator',
    `-clean snap-interval=${snap} gap-fill-area=${gapFill} rewind`,
    '-proj wgs84',
    // precision=0.00001 -> 5 decimales (~1m). Depts abarcan km, no perdemos
    // nada visible y bajamos ~50% el tamaño del JSON output.
    `-o ${outputName} format=geojson precision=0.00001`,
  ].join(' ');

  const output = await mapshaper.applyCommands(cmd, {
    [inputName]: JSON.stringify(fc),
  });

  const cleaned = JSON.parse(output[outputName].toString('utf8'));

  let strippedInners = 0;
  if (stripInners) {
    strippedInners = stripInnerRings(cleaned);
  }

  const after = cleaned.features.reduce((s, f) => s + countVertices(f), 0);

  console.log(
    `  [${name}] snap=${snap} gapFill=${gapFill}${stripInners ? ' +stripInners' : ''}: ${fc.features.length} features · vertices ${before.toLocaleString()} → ${after.toLocaleString()} (${(
      ((after - before) / before) *
      100
    ).toFixed(1)}%)${strippedInners ? ` · ${strippedInners} inner rings stripped` : ''}`
  );

  return cleaned;
}

async function main() {
  console.log(`===== CLEAN geo.json v967 ${DRY ? '(DRY RUN)' : ''} =====\n`);

  const raw = JSON.parse(readFileSync(GEO_PATH, 'utf8'));
  const sizeBefore = statSync(GEO_PATH).size;
  console.log(`Input: ${GEO_PATH}`);
  console.log(`  size: ${bytesToKb(sizeBefore)}`);
  console.log(`  dept: ${raw.dept.features.length} features`);
  console.log(`  prov: ${raw.prov.features.length} features`);
  console.log();

  console.log('Cleaning...');
  const [deptClean, provClean] = await Promise.all([
    cleanFeatureCollection(raw.dept, 'dept', {
      snap: '100m',
      gapFill: '1km2',
      stripInners: false,
    }),
    cleanFeatureCollection(raw.prov, 'prov', {
      snap: '500m',
      gapFill: '100km2',
      stripInners: true,
    }),
  ]);
  console.log();

  const merged = { dept: deptClean, prov: provClean };
  const serialized = JSON.stringify(merged);
  console.log(`Output size: ${bytesToKb(Buffer.byteLength(serialized, 'utf8'))} (${(
    ((Buffer.byteLength(serialized, 'utf8') - sizeBefore) / sizeBefore) *
    100
  ).toFixed(1)}% vs input)`);

  // Diagnostic: contar cuantos vertices son EXACTAMENTE compartidos entre
  // depts. Pre-clean: casi cero (INDEC digitalizado independiente). Post-clean:
  // deberia ser alto porque el snap forzo mismos coords.
  const vertexCounts = new Map();
  for (const f of deptClean.features) {
    const geom = f.geometry;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const ring of rings) {
      for (const [x, y] of ring) {
        const key = `${x},${y}`;
        vertexCounts.set(key, (vertexCounts.get(key) || 0) + 1);
      }
    }
  }
  const total = vertexCounts.size;
  const shared = [...vertexCounts.values()].filter((n) => n >= 2).length;
  console.log(
    `Topologia dept: ${shared.toLocaleString()} / ${total.toLocaleString()} vertices compartidos (${(
      (shared / total) *
      100
    ).toFixed(1)}%)`
  );

  // Sanity check: mapshaper puede stripping properties si no reconoce el esquema.
  const sampleDept = deptClean.features[0].properties;
  const sampleProv = provClean.features[0].properties;
  console.log('Sample dept props:', JSON.stringify(sampleDept));
  console.log('Sample prov props:', JSON.stringify(sampleProv));

  const requiredDeptKeys = ['name', 'province', 'vendor'];
  const missingDept = requiredDeptKeys.filter((k) => !(k in sampleDept));
  if (missingDept.length) {
    throw new Error(`dept perdio properties: ${missingDept.join(', ')}. Abortando (backup en geo.json.backup-pre-v967).`);
  }
  const requiredProvKeys = ['name', 'name_norm'];
  const missingProv = requiredProvKeys.filter((k) => !(k in sampleProv));
  if (missingProv.length) {
    throw new Error(`prov perdio properties: ${missingProv.join(', ')}. Abortando.`);
  }

  if (DRY) {
    console.log('\n[DRY] No escribo geo.json. Backup no tocado.');
    return;
  }

  writeFileSync(GEO_PATH, serialized, 'utf8');
  const sizeAfter = statSync(GEO_PATH).size;
  console.log(`\n✅ geo.json escrito: ${bytesToKb(sizeAfter)}`);
  console.log('   Backup previo: geo.json.backup-pre-v967');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
