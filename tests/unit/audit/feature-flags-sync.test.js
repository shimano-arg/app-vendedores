import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * §57 sync: src/pure/feature-flags.js y functions/core/feature-flags.js son
 * byte-equivalent (post header). Si cambiás uno, cambiá el otro.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PURE_PATH = join(REPO_ROOT, 'src', 'pure', 'feature-flags.js');
const MIRROR_PATH = join(REPO_ROOT, 'functions', 'core', 'feature-flags.js');

function stripHeader(src) {
  return src.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();
}

describe('§57 sync — feature-flags pure vs mirror', () => {
  it('src/pure vs functions/core byte-equivalent (post header)', () => {
    const pure = stripHeader(readFileSync(PURE_PATH, 'utf-8'));
    const mirror = stripHeader(readFileSync(MIRROR_PATH, 'utf-8'));
    expect(mirror).toBe(pure);
  });

  it('readFlag devuelve defaultValue si doc ausente', async () => {
    const mod = await import(pathToFileURL(PURE_PATH).href);
    expect(mod.readFlag(null, 'x', false)).toBe(false);
    expect(mod.readFlag(undefined, 'x', true)).toBe(true);
    expect(mod.readFlag({}, 'x', false)).toBe(false);
  });

  it('isDep12RepartoEnabled default false (safety-off)', async () => {
    const mod = await import(pathToFileURL(PURE_PATH).href);
    expect(mod.isDep12RepartoEnabled(null)).toBe(false);
    expect(mod.isDep12RepartoEnabled({})).toBe(false);
    expect(mod.isDep12RepartoEnabled({ dep12_reparto_enabled: true })).toBe(true);
    expect(mod.isDep12RepartoEnabled({ dep12_reparto_enabled: false })).toBe(false);
    expect(mod.isDep12RepartoEnabled({ dep12_reparto_enabled: 'yes' })).toBe(false);
  });

  it('FEATURE_FLAG_DOC_PATH exportado desde ambos', async () => {
    const pure = await import(pathToFileURL(PURE_PATH).href);
    const mirror = await import(pathToFileURL(MIRROR_PATH).href);
    expect(pure.FEATURE_FLAG_DOC_PATH).toBe('app_config/feature_flags');
    expect(mirror.FEATURE_FLAG_DOC_PATH).toBe('app_config/feature_flags');
  });
});
