// @ts-check
/**
 * §59 (2026-10-23) — tests para la función pura `isWaitlistVisibleForVendor`
 * + `filterWaitlistsForVendor`. Reemplaza el filtro inline buggy del sidebar
 * y del modal Estado.
 *
 * Precedente: ORDEN 516 BROBRO SA (CardCode C30718510291, vendedor master
 * Gonzalo De La Rosa) cargada por Pablo González (ownerUid != Gonzalo).
 * El filtro viejo (`w.ownerUid === myUid || w.ownerVendor === myVendor`)
 * la ocultaba a Gonzalo porque `ownerUid` era de Pablo y `ownerVendor`
 * pre-§44 podía ser incorrecto. Con §44 + §46 el campo autoritativo pasó
 * a ser `assignedVendorUid` (del cliente master).
 */
import { describe, expect, it } from 'vitest';
import {
  filterWaitlistsForVendor,
  isWaitlistVisibleForVendor,
} from '../../src/pure/waitlist-visibility.js';

const UID_GONZALO = 'WWuppaSQqeMZPIk8yvfctyhSQgu1';
const UID_PABLO = 'NKexDkWCGgcJb3KApk1bcIjT5MG3';
const UID_FEDERICO = 'fIWSP9wcXsNyPCaKEvAIT9avCFC3';
const VENDOR_GONZALO = 'GONZALO DE LA ROSA';
const VENDOR_FEDERICO = 'FEDERICO CASTELANELLI';

describe('§59 isWaitlistVisibleForVendor', () => {
  it('orden cargada por Pablo pero asignada al vendedor master Gonzalo → visible para Gonzalo', () => {
    // Caso real: ORDEN 516 BROBRO SA (2026-10-22).
    const w = {
      orderNumber: 516,
      clientCardCode: 'C30718510291',
      clientName: 'BROBRO SA',
      ownerUid: UID_PABLO,
      ownerVendor: 'GONZALO DE LA ROSA',
      vendorAssigned: 'GONZALO DE LA ROSA',
      assignedVendorUid: UID_GONZALO,
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(true);
  });

  it('misma orden NO es visible para Pablo si él no es el vendedor master (admin ve todo por otro camino)', () => {
    const w = {
      orderNumber: 516,
      ownerUid: UID_PABLO,
      assignedVendorUid: UID_GONZALO,
    };
    // Pablo es admin/gerente/interno — admin/gerente NO llama este filtro.
    // Si por error se llama con el UID de otro VDE (Federico), NO ve.
    expect(isWaitlistVisibleForVendor(w, UID_FEDERICO, VENDOR_FEDERICO)).toBe(false);
  });

  it('orden cargada por el propio vendedor → visible (assignedVendorUid matchea)', () => {
    const w = {
      orderNumber: 537,
      ownerUid: UID_FEDERICO,
      assignedVendorUid: UID_FEDERICO,
      vendorAssigned: VENDOR_FEDERICO,
    };
    expect(isWaitlistVisibleForVendor(w, UID_FEDERICO, VENDOR_FEDERICO)).toBe(true);
  });

  it('orden de un cliente que NO es del vendedor → NO visible', () => {
    const w = {
      orderNumber: 538,
      ownerUid: UID_FEDERICO,
      assignedVendorUid: UID_FEDERICO,
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(false);
  });

  it('doc legacy pre-§44 (sin assignedVendorUid) + ownerUid del VDE → visible via fallback', () => {
    const w = {
      orderNumber: 100,
      ownerUid: UID_GONZALO,
      ownerVendor: 'GONZALO DE LA ROSA',
      // assignedVendorUid ausente (doc legacy)
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(true);
  });

  it('doc legacy sin assignedVendorUid + ownerUid de otro + ownerVendor del VDE → visible via fallback', () => {
    const w = {
      orderNumber: 101,
      ownerUid: UID_PABLO,
      ownerVendor: 'GONZALO DE LA ROSA',
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(true);
  });

  it('doc legacy sin assignedVendorUid + ownerUid de otro + vendorAssigned del VDE → visible via fallback', () => {
    const w = {
      orderNumber: 102,
      ownerUid: UID_PABLO,
      vendorAssigned: 'GONZALO DE LA ROSA',
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(true);
  });

  it('doc legacy sin assignedVendorUid + nada del VDE → NO visible', () => {
    const w = {
      orderNumber: 103,
      ownerUid: UID_PABLO,
      ownerVendor: 'IOANNIS PALKOUDAKIS',
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(false);
  });

  it('assignedVendorUid presente SIEMPRE gana sobre fallback — el VDE equivocado NO ve aunque figure en ownerVendor', () => {
    // Caso raro: doc post-§44 con assignedVendorUid del cliente master correcto
    // pero ownerVendor "sucio" (quizá by backfill ambiguo). Nos quedamos con
    // el campo autoritativo.
    const w = {
      orderNumber: 104,
      ownerUid: UID_PABLO,
      ownerVendor: 'GONZALO DE LA ROSA', // sucio: NO debería dar visibilidad a Gonzalo
      assignedVendorUid: UID_FEDERICO, // el cliente es de Federico
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(false);
    expect(isWaitlistVisibleForVendor(w, UID_FEDERICO, VENDOR_FEDERICO)).toBe(true);
  });

  it('empty uid → false', () => {
    expect(isWaitlistVisibleForVendor({ assignedVendorUid: UID_GONZALO }, '', VENDOR_GONZALO)).toBe(
      false
    );
  });

  it('null doc → false', () => {
    // @ts-expect-error — testeando defensa
    expect(isWaitlistVisibleForVendor(null, UID_GONZALO, VENDOR_GONZALO)).toBe(false);
  });

  it('assignedVendorUid=="" (string vacío) cae al fallback', () => {
    const w = {
      orderNumber: 534,
      ownerUid: UID_GONZALO,
      ownerVendor: 'GONZALO DE LA ROSA',
      assignedVendorUid: '', // explícito vacío (encontrado en prod: ORDEN 534 TESI)
    };
    expect(isWaitlistVisibleForVendor(w, UID_GONZALO, VENDOR_GONZALO)).toBe(true);
  });
});

describe('§59 filterWaitlistsForVendor', () => {
  it('devuelve solo waitlists visibles para el VDE', () => {
    const list = [
      // Visible por assignedVendorUid.
      { orderNumber: 516, ownerUid: UID_PABLO, assignedVendorUid: UID_GONZALO },
      // No visible — assigned a otro.
      { orderNumber: 537, ownerUid: UID_FEDERICO, assignedVendorUid: UID_FEDERICO },
      // Visible por fallback ownerUid (legacy).
      { orderNumber: 100, ownerUid: UID_GONZALO },
      // Visible por fallback ownerVendor (legacy).
      { orderNumber: 101, ownerUid: UID_PABLO, ownerVendor: 'GONZALO DE LA ROSA' },
    ];
    const r = filterWaitlistsForVendor(list, UID_GONZALO, VENDOR_GONZALO);
    expect(r.map((w) => w.orderNumber).sort((a, b) => a - b)).toEqual([100, 101, 516]);
  });

  it('array vacío', () => {
    expect(filterWaitlistsForVendor([], UID_GONZALO, VENDOR_GONZALO)).toEqual([]);
  });

  it('sin uid → vacío', () => {
    expect(
      filterWaitlistsForVendor([{ assignedVendorUid: UID_GONZALO }], '', VENDOR_GONZALO)
    ).toEqual([]);
  });

  it('null → vacío', () => {
    // @ts-expect-error — testeando defensa
    expect(filterWaitlistsForVendor(null, UID_GONZALO, VENDOR_GONZALO)).toEqual([]);
  });
});
