// Config compartido de los scripts perf. Detecta Chrome de Windows y define
// throttling comunes (Slow 4G + CPU 4x). Los scripts individuales importan
// esto para no repetir constants.

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Path de Chrome auto-detectado 2026-07-27 en el sistema de Mariano.
// Si Mariano tiene Chrome en otra ubicación, override con env CHROME_PATH.
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\shimano.sandbox\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChrome() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'Chrome no encontrado. Setear env CHROME_PATH o instalar Chrome en una ubicación estándar.\nCandidatos probados: ' +
      CHROME_CANDIDATES.join('; ')
  );
}

// URL del servidor local. Mariano corre `python -m http.server 8000` desde el
// repo root en otra consola antes de invocar los scripts.
export const LOCAL_URL = 'http://localhost:8000/';

// Throttling: Slow 4G + CPU 4x (Lighthouse defaults). Representa un celular
// típico de vendedor en la calle. NO es un celular real — es una simulación
// predictiva. Suficiente para comparar antes/después del split.
export const THROTTLING = {
  rttMs: 150,
  throughputKbps: 1638.4, // 1.6 Mbps down
  requestLatencyMs: 562.5,
  downloadThroughputKbps: 1474.56,
  uploadThroughputKbps: 675,
  cpuSlowdownMultiplier: 4,
};

// Cuántas corridas por escenario. Median de 3 mitiga single-run noise.
export const RUNS_PER_SCENARIO = 3;

// Dónde guardar los reportes. fileURLToPath maneja bien paths con espacios
// (URL.pathname deja %20 encoded → Windows crea path malformado).
export const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));

// Fecha del baseline "oficial" (E0). Los scripts de re-medición (E6) comparan
// contra este archivo.
export const BASELINE_DATE = '2026-07-27';
