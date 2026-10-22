// @ts-check
/**
 * E3 §auditgrises G5.15 — vendor_outlines cleanup extensión v13-v16:
 * `forceUpdateApp` debe limpiar TODAS las versiones legacy de
 * `shimano_vendor_outlines_vX` en localStorage. Precedente: v4..v12
 * cubiertos; v13..v16 faltaban → users con cache stale residual.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync('index.html', 'utf8');

describe('G5.15 — vendor_outlines cleanup cobertura completa', () => {
  for (let v = 4; v <= 16; v++) {
    it(`forceUpdateApp borra shimano_vendor_outlines_v${v}`, () => {
      expect(INDEX_HTML).toContain(`localStorage.removeItem('shimano_vendor_outlines_v${v}')`);
    });
  }
});
