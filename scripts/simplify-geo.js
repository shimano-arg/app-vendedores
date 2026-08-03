#!/usr/bin/env node
// Simplifica geo.json (provincias + departamentos) con Douglas-Peucker + redondeo de coords.
// Objetivo: bajar de 1.6 MB a ~400-500 KB manteniendo la forma visible en zoom 4-14.
//
// Tolerancias (en grados, ~lat/lng):
//   0.001° ≈ 111 m
//   0.005° ≈ 555 m  ← usado para dept (invisible en zoom country/regional 4-9)
//   0.003° ≈ 333 m  ← usado para prov (contornos mas importantes)
//
// Ejecutar desde la raiz del repo:
//   node scripts/simplify-geo.js
//
// Escribe geo.json en el mismo lugar (backup manual antes si querés preservar el original).

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_PATH = join(ROOT, 'geo.json');

const DEPT_TOL = 0.005;
const PROV_TOL = 0.003;
const DECIMALS = 4;

function perpendicularDistance(pt, lineStart, lineEnd) {
  const [x, y] = pt;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function roundCoord([x, y]) {
  const f = 10 ** DECIMALS;
  return [Math.round(x * f) / f, Math.round(y * f) / f];
}

function simplifyRing(ring, tolerance) {
  // ring cerrado: primer y ultimo point iguales. DP los conserva.
  const simplified = douglasPeucker(ring, tolerance).map(roundCoord);
  // Cerrar de nuevo por seguridad (redondeo puede haber cambiado un decimal en el ultimo).
  if (simplified.length > 0) {
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push([first[0], first[1]]);
    }
  }
  return simplified;
}

function simplifyGeometry(geom, tolerance) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates
        .map((ring) => simplifyRing(ring, tolerance))
        .filter((ring) => ring.length >= 4),
    };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates
        .map((poly) =>
          poly.map((ring) => simplifyRing(ring, tolerance)).filter((ring) => ring.length >= 4)
        )
        .filter((poly) => poly.length > 0),
    };
  }
  return geom;
}

function countCoords(fc) {
  let n = 0;
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'Polygon') g.coordinates.forEach((r) => (n += r.length));
    else if (g.type === 'MultiPolygon')
      g.coordinates.forEach((p) => p.forEach((r) => (n += r.length)));
  };
  fc.features.forEach((f) => walk(f.geometry));
  return n;
}

const beforeBytes = statSync(GEO_PATH).size;
const geo = JSON.parse(readFileSync(GEO_PATH, 'utf8'));

const beforeDept = countCoords(geo.dept);
const beforeProv = countCoords(geo.prov);

geo.dept.features = geo.dept.features
  .map((f) => ({ ...f, geometry: simplifyGeometry(f.geometry, DEPT_TOL) }))
  .filter((f) => {
    const g = f.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') return g.coordinates.length > 0;
    if (g.type === 'MultiPolygon') return g.coordinates.length > 0;
    return false;
  });

geo.prov.features = geo.prov.features
  .map((f) => ({ ...f, geometry: simplifyGeometry(f.geometry, PROV_TOL) }))
  .filter((f) => {
    const g = f.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') return g.coordinates.length > 0;
    if (g.type === 'MultiPolygon') return g.coordinates.length > 0;
    return false;
  });

const out = JSON.stringify(geo);
writeFileSync(GEO_PATH, out);

const afterBytes = statSync(GEO_PATH).size;
const afterDept = countCoords(geo.dept);
const afterProv = countCoords(geo.prov);

const pct = (before, after) => `${((1 - after / before) * 100).toFixed(1)}%`;
console.log(
  `geo.json:  ${(beforeBytes / 1024).toFixed(0)} KB → ${(afterBytes / 1024).toFixed(0)} KB  (${pct(beforeBytes, afterBytes)} menor)`
);
console.log(
  `dept coords: ${beforeDept} → ${afterDept}  (${pct(beforeDept, afterDept)} menor)  [tol ${DEPT_TOL}°]`
);
console.log(
  `prov coords: ${beforeProv} → ${afterProv}  (${pct(beforeProv, afterProv)} menor)  [tol ${PROV_TOL}°]`
);
