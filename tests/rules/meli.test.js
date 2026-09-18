/**
 * Tests de rules para las 4 colecciones MERCADOLIBRE (Mariano-only).
 * Ver docs/specs/2026-09-18-mercadolibre-crm-section-design.md § 5.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  anonDb,
  assertFails,
  assertSucceeds,
  authedDb,
  cleanupTestEnv,
  collection,
  doc,
  getDoc,
  getDocs,
  initTestEnv,
  seedCanonicalRoles,
  setDoc,
  UID,
} from './setup.js';

beforeAll(async () => { await initTestEnv(); });
afterAll(async () => { await cleanupTestEnv(); });
beforeEach(async () => { await seedCanonicalRoles(); });

const MARIANO_EMAILS = ['erbinomariano@gmail.com', 'mariano.erbino@shimano.com.ar'];

describe('meli_* (Mariano-only)', () => {
  describe('read: solo Mariano', () => {
    for (const email of MARIANO_EMAILS) {
      it(`Mariano (${email}) lee meli/state`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDoc(doc(db, 'meli', 'state')));
      });
      it(`Mariano (${email}) lista meli_products`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_products')));
      });
      it(`Mariano (${email}) lista meli_categories`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_categories')));
      });
      it(`Mariano (${email}) lista meli_map_alerts`, async () => {
        const db = authedDb('uid-mariano', { email });
        await assertSucceeds(getDocs(collection(db, 'meli_map_alerts')));
      });
    }

    it('admin NO-Mariano NO lee meli/state', async () => {
      const db = authedDb(UID.admin, { email: 'otro-admin@shimano.com.ar' });
      await assertFails(getDoc(doc(db, 'meli', 'state')));
    });
    it('vendor NO lista meli_products', async () => {
      const db = authedDb(UID.vendor, { email: 'vendedor@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_products')));
    });
    it('gerente NO lista meli_map_alerts', async () => {
      const db = authedDb(UID.gerente, { email: 'gerente@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_map_alerts')));
    });
    it('interno NO lista meli_categories', async () => {
      const db = authedDb(UID.interno, { email: 'interno@shimano.com.ar' });
      await assertFails(getDocs(collection(db, 'meli_categories')));
    });
    it('viewer NO lee meli/state', async () => {
      const db = authedDb(UID.viewer, { email: 'viewer@shimano.com.ar' });
      await assertFails(getDoc(doc(db, 'meli', 'state')));
    });
    it('anon NO lee nada', async () => {
      await assertFails(getDoc(doc(anonDb(), 'meli', 'state')));
      await assertFails(getDocs(collection(anonDb(), 'meli_products')));
    });
  });

  describe('write: nadie escribe desde client', () => {
    it('Mariano NO escribe meli/state (solo SA del GHA)', async () => {
      const db = authedDb('uid-mariano', { email: 'erbinomariano@gmail.com' });
      await assertFails(setDoc(doc(db, 'meli', 'state'), { snapshot_date: '2026-09-18' }));
    });
    it('Mariano NO crea docs en meli_products', async () => {
      const db = authedDb('uid-mariano', { email: 'erbinomariano@gmail.com' });
      await assertFails(setDoc(doc(db, 'meli_products', 'MLAtest'), { name: 'test' }));
    });
    it('admin NO escribe meli_map_alerts', async () => {
      const db = authedDb(UID.admin, { email: 'otro-admin@shimano.com.ar' });
      await assertFails(setDoc(doc(db, 'meli_map_alerts', 'MLAtest'), { sku: 'X' }));
    });
  });
});
