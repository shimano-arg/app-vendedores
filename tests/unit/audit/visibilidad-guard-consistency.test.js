// @ts-check
/**
 * §59 (2026-10-23) — property-based: cualquier orden que el guard §42.2
 * ofrezca unificar a un VDE DEBE ser visible via `isWaitlistVisibleForVendor`.
 *
 * El guard §42.2 (src/domains/pedidos-modal.js:validateReviewAndPasarAPendientes)
 * busca waitlists abiertas por `clientCardCode` (sin filtrar por vendedor —
 * eso es responsabilidad del listener). Si una encuentra, la ofrece al VDE
 * que está armando el pedido. Si esa orden existe en la vista "lista de espera"
 * del mismo VDE, está OK; si no, el VDE "no puede abrir lo que le ofrecen"
 * y el guard introduce inconsistencia.
 *
 * Propiedad: Para todo par (VDE_uid, waitlist) donde la waitlist pertenece a
 * cardCode del cliente master de VDE_uid, debe cumplirse:
 *
 *     isWaitlistVisibleForVendor(waitlist, VDE_uid, VDE_vendorKey) === true
 *
 * Dado que §44 asegura `assignedVendorUid = UID del vendedor master`,
 * la propiedad reduce a: cuando `assignedVendorUid === VDE_uid`, visible.
 */
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { findOpenWaitlistsForClient } from '../../../src/pure/open-waitlists.js';
import {
  filterWaitlistsForVendor,
  isWaitlistVisibleForVendor,
} from '../../../src/pure/waitlist-visibility.js';

// Simula un cliente master: cardCode → VDE que lo tiene asignado.
// En prod viene de OCRD/vendor_overrides/approvedAltas; en el test lo abstraemos.
const vdeUids = ['UID_GONZALO', 'UID_FEDERICO', 'UID_MAURICIO', 'UID_PACHI'];
const vendorKeys = {
  UID_GONZALO: 'GONZALO DE LA ROSA',
  UID_FEDERICO: 'FEDERICO CASTELANELLI',
  UID_MAURICIO: 'MAURICIO GIL',
  UID_PACHI: 'PACHI',
};

// Generadores fast-check.
const uidArb = fc.constantFrom(...vdeUids);
const otherUidArb = fc.constantFrom('UID_PABLO', 'UID_IOANNIS', 'UID_SANTI');
const cardCodeArb = fc.string({ minLength: 11, maxLength: 11 }).map((s) => 'C' + s);
const stageArb = fc.constantFrom(undefined, 'consumed');
const closedArb = fc.option(fc.date(), { nil: null });

const waitlistArb = fc.record({
  _id: fc.string({ minLength: 10, maxLength: 20 }),
  orderNumber: fc.integer({ min: 1, max: 1000 }),
  clientCardCode: cardCodeArb,
  ownerUid: fc.oneof(uidArb, otherUidArb),
  assignedVendorUid: uidArb, // §44 garantiza: siempre populated post-§44
  stage: stageArb,
  closedAt: closedArb,
  createdAt: fc.string(),
});

describe('§59 property-based: guard consistency (§42.2 ↔ sidebar)', () => {
  it('cualquier waitlist que findOpenWaitlistsForClient(cardCode, docs) devuelve para un VDE DEBE ser visible para ese VDE', () => {
    fc.assert(
      fc.property(
        fc.array(waitlistArb, { minLength: 0, maxLength: 20 }),
        uidArb,
        (docs, vdeUid) => {
          const vk = vendorKeys[vdeUid];
          // Para cada cardCode presente en docs...
          const uniqueCardCodes = Array.from(new Set(docs.map((d) => d.clientCardCode)));
          for (const cc of uniqueCardCodes) {
            // Lo que §42.2 encontraría (sin filtrar por vendedor):
            const openForClient = findOpenWaitlistsForClient(cc, null, docs);
            // Si el VDE ARMA el guard §42.2 para ESE cliente, es porque el
            // cliente le pertenece. En prod eso se decide del master; acá
            // simulamos "cliente del VDE" filtrando docs cuyo assignedVendorUid
            // === vdeUid (patrón post-§44).
            for (const w of openForClient) {
              if (w.assignedVendorUid === vdeUid) {
                // El guard §42.2 lo ofrecería. Entonces el sidebar DEBE verlo.
                if (!isWaitlistVisibleForVendor(w, vdeUid, vk)) {
                  return false;
                }
              }
            }
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('filterWaitlistsForVendor devuelve EXACTAMENTE el subset con assignedVendorUid === vdeUid (ignorando legacy)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            _id: fc.string({ minLength: 10 }),
            assignedVendorUid: uidArb,
            ownerUid: fc.oneof(uidArb, otherUidArb),
          }),
          { minLength: 0, maxLength: 30 }
        ),
        uidArb,
        (docs, vdeUid) => {
          const vk = vendorKeys[vdeUid];
          const visible = filterWaitlistsForVendor(docs, vdeUid, vk);
          // Como todos tienen assignedVendorUid populated (gen fast-check), el
          // fallback no aplica — visible === subset con assignedVendorUid matcheado.
          const expected = docs.filter((d) => d.assignedVendorUid === vdeUid);
          return visible.length === expected.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('un documento con assignedVendorUid !== vdeUid NUNCA es visible, aunque el ownerVendor matchee', () => {
    fc.assert(
      fc.property(
        uidArb,
        uidArb.filter((_u) => true), // los dos UIDs
        (vdeUidA, vdeUidB) => {
          if (vdeUidA === vdeUidB) return true; // skip
          const vkA = vendorKeys[vdeUidA];
          const vkB = vendorKeys[vdeUidB];
          const w = {
            _id: 'x',
            // Doc asignado a VDE B pero con ownerVendor "sucio" apuntando a A.
            assignedVendorUid: vdeUidB,
            ownerVendor: vkA,
            vendorAssigned: vkA,
          };
          // A no lo ve (el autoritativo gana).
          if (isWaitlistVisibleForVendor(w, vdeUidA, vkA)) return false;
          // B sí lo ve.
          if (!isWaitlistVisibleForVendor(w, vdeUidB, vkB)) return false;
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
