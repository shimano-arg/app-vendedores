// @ts-check
import { describe, it, expect } from 'vitest';
import {
  hashToBucket,
  shouldSampleUser,
  createBatchCollector,
  buildInstrumentationBatchEntry,
} from '../../src/pure/instrumentation-helpers.js';

describe('hashToBucket', () => {
  it('returns deterministic value for same input', () => {
    const uid = 'abc123';
    expect(hashToBucket(uid)).toBe(hashToBucket(uid));
  });
  it('returns value in [0, 100)', () => {
    for (let i = 0; i < 50; i++) {
      const b = hashToBucket('uid-' + i);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
  it('empty string returns 0', () => {
    expect(hashToBucket('')).toBe(0);
    expect(hashToBucket(null)).toBe(0);
    expect(hashToBucket(undefined)).toBe(0);
  });
  it('different inputs typically produce different buckets', () => {
    const buckets = new Set();
    for (let i = 0; i < 100; i++) buckets.add(hashToBucket('uid-' + i));
    // At least 20 distinct buckets out of 100 inputs — not perfect uniform
    // but enough to confirm the hash spreads.
    expect(buckets.size).toBeGreaterThan(20);
  });
});

describe('shouldSampleUser', () => {
  it('0% → always false', () => {
    for (let i = 0; i < 10; i++) {
      expect(shouldSampleUser('uid-' + i, 0)).toBe(false);
    }
  });
  it('100% → always true', () => {
    for (let i = 0; i < 10; i++) {
      expect(shouldSampleUser('uid-' + i, 100)).toBe(true);
    }
  });
  it('20% → ~20% of users sampled', () => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSampleUser('uid-' + i, 20)) count++;
    }
    // 20% ± 5% tolerance
    expect(count).toBeGreaterThan(150);
    expect(count).toBeLessThan(250);
  });
  it('deterministic per user', () => {
    const uid = 'stable-uid';
    const a = shouldSampleUser(uid, 20);
    const b = shouldSampleUser(uid, 20);
    expect(a).toBe(b);
  });
  it('clamps negative + >100', () => {
    expect(shouldSampleUser('x', -5)).toBe(false);
    expect(shouldSampleUser('x', 150)).toBe(true);
  });
});

describe('createBatchCollector', () => {
  it('shouldFlush false when empty', () => {
    const b = createBatchCollector({ maxBatchSize: 5, maxAgeMs: 1000 });
    expect(b.shouldFlush(Date.now())).toBe(false);
  });
  it('shouldFlush true when buffer reaches maxBatchSize', () => {
    const b = createBatchCollector({ maxBatchSize: 3, maxAgeMs: 999999 });
    b.push({ x: 1 });
    b.push({ x: 2 });
    expect(b.shouldFlush(Date.now())).toBe(false);
    b.push({ x: 3 });
    expect(b.shouldFlush(Date.now())).toBe(true);
  });
  it('shouldFlush true when age exceeds maxAgeMs', () => {
    const b = createBatchCollector({ maxBatchSize: 100, maxAgeMs: 1000 });
    const now = Date.now();
    b.push({ x: 1 });
    expect(b.shouldFlush(now + 500)).toBe(false);
    expect(b.shouldFlush(now + 1500)).toBe(true);
  });
  it('drain empties buffer', () => {
    const b = createBatchCollector({ maxBatchSize: 10, maxAgeMs: 1000 });
    b.push({ x: 1 });
    b.push({ x: 2 });
    expect(b.size()).toBe(2);
    const out = b.drain();
    expect(out).toHaveLength(2);
    expect(b.size()).toBe(0);
    expect(b.shouldFlush(Date.now())).toBe(false);
  });
  it('defaults when opts missing', () => {
    const b = createBatchCollector({});
    expect(b.size()).toBe(0);
    b.push({ x: 1 });
    expect(b.size()).toBe(1);
  });
});

describe('buildInstrumentationBatchEntry', () => {
  it('shapes entry with required fields', () => {
    const entry = buildInstrumentationBatchEntry({
      events: [{ kind: 'lcp', value: 1234 }],
      userUid: 'uid-1',
      userEmail: 'a@b.c',
      clientVersion: 'v1587',
    });
    expect(entry.type).toBe('client_instrumentation');
    expect(entry.userUid).toBe('uid-1');
    expect(entry.userEmail).toBe('a@b.c');
    expect(entry.clientVersion).toBe('v1587');
    expect(entry.events).toHaveLength(1);
    expect(entry.eventCount).toBe(1);
    expect(entry.timestamp instanceof Date).toBe(true);
  });
  it('caps events to 50', () => {
    const many = [];
    for (let i = 0; i < 100; i++) many.push({ kind: 'cache_hit', i });
    const entry = buildInstrumentationBatchEntry({
      events: many, userUid: 'x', userEmail: '', clientVersion: 'v1',
    });
    expect(entry.events).toHaveLength(50);
    expect(entry.eventCount).toBe(100);
  });
  it('handles missing fields', () => {
    const entry = buildInstrumentationBatchEntry({});
    expect(entry.type).toBe('client_instrumentation');
    expect(entry.userUid).toBe('');
    expect(entry.events).toEqual([]);
  });
});
