/**
 * Detector de duplicados SAP vs Provisorios. Extracted de index.html:24996
 * para E4.
 *
 * Cuando finanzas carga a SAP un cliente que ya existía como Alta Rápida
 * (provisorio), la app termina con 2 docs para la misma tienda. Este
 * helper flaggea el provisorio para que admin lo elimine manualmente.
 *
 * Criterio de match (introducido v316):
 *   1. Candidato debe ser SAP habilitado (cardCodeSap + status='approved').
 *   2. Misma PROVINCIA normalizada.
 *   3. Misma LOCALIDAD normalizada.
 *   4. Nombre "similar": uno contiene al otro, o comparten ≥2 tokens
 *      significativos (≥3 chars, sin stopwords).
 *
 * REFACTOR para testeabilidad: la versión original leía `approvedAltasList`
 * como global. Acá se pasa como parámetro.
 */
import { normalizeSearch } from './normalize.js';

const STOPWORDS = new Set([
  'de','del','la','el','los','las','y','al','en','con',
  'pesca','pescas','pescador','tienda','store','shop',
  'sa','srl','sas','sac','sh',
]);

/**
 * @param {string} s
 * @returns {string[]}
 */
function nameTokens(s) {
  const n = normalizeSearch(s).replace(/[^a-z0-9\s]/g, ' ');
  return n.split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * @typedef {{
 *   _fsId?: string,
 *   manualSapPending?: boolean,
 *   cardCodeSap?: string | null,
 *   comercio?: string,
 *   fantasia?: string,
 *   titular?: string,
 *   provincia?: string,
 *   localidad?: string,
 *   localidadFinal?: string,
 * }} ClientCandidate
 */

/**
 * @param {ClientCandidate} prov Provisorio del que buscamos SAP duplicado.
 * @param {ClientCandidate[]} approvedAltasList Lista completa altas del sistema.
 * @returns {ClientCandidate | null} SAP habilitado que duplica al prov, o null.
 */
export function findSapDuplicateForProvisorio(prov, approvedAltasList) {
  if (!prov || !prov.manualSapPending || prov.cardCodeSap) return null;
  if (!Array.isArray(approvedAltasList)) return null;

  const provName = prov.comercio || prov.fantasia || '';
  if (!provName) return null;

  const provTokens = nameTokens(provName);
  if (!provTokens.length) return null;

  const provProv = normalizeSearch(prov.provincia || '').trim();
  const provLoc = normalizeSearch(prov.localidadFinal || prov.localidad || '').trim();
  if (!provProv || !provLoc) return null;

  const provNameNorm = normalizeSearch(provName);

  for (const cand of approvedAltasList) {
    if (!cand || !cand.cardCodeSap) continue;
    if (cand._fsId && cand._fsId === prov._fsId) continue;
    if (cand.manualSapPending) continue;

    const candProv = normalizeSearch(cand.provincia || '').trim();
    const candLoc = normalizeSearch(cand.localidadFinal || cand.localidad || '').trim();
    if (candProv !== provProv) continue;
    if (candLoc !== provLoc) continue;

    const candName = cand.comercio || cand.fantasia || cand.titular || '';
    if (!candName) continue;

    const candNameNorm = normalizeSearch(candName);
    let similar = provNameNorm.includes(candNameNorm) || candNameNorm.includes(provNameNorm);
    if (!similar) {
      const candTokens = nameTokens(candName);
      const common = provTokens.filter((t) => candTokens.includes(t));
      if (common.length >= 2) similar = true;
    }
    if (similar) return cand;
  }
  return null;
}
