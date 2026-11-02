// @ts-check
/**
 * v1535 (APP-02) — textos del boton "Sincronizar con SAP" (Master de Clientes).
 * Regla §68: lenguaje simple, codigo tecnico solo al final en errores.
 */
import { describe, expect, it } from 'vitest';
import { PALABRAS_PROHIBIDAS } from '../../src/pure/mensajes-vendedor.js';
import {
  mensajeSyncClientesSap,
  SYNC_CLIENTES_SAP_TEXTOS,
} from '../../src/pure/sync-clientes-sap-mensajes.js';

describe('v1535 APP-02 — mensajeSyncClientesSap', () => {
  it('M1 exito con N nuevos', () => {
    expect(mensajeSyncClientesSap({ ok: true, nuevos: 3, actualizados: 5, total: 8 })).toEqual({
      tipo: 'ok',
      texto: 'Se incorporaron 3 clientes nuevos',
    });
  });

  it('M2 exito con 1 nuevo (singular)', () => {
    expect(mensajeSyncClientesSap({ ok: true, nuevos: 1 }).texto).toBe(
      'Se incorporó 1 cliente nuevo'
    );
  });

  it('M3 exito sin nuevos', () => {
    expect(mensajeSyncClientesSap({ ok: true, nuevos: 0, actualizados: 40 })).toEqual({
      tipo: 'ok',
      texto: 'Sincronización terminada: no hay clientes nuevos',
    });
  });

  it('M4 EN_CURSO', () => {
    expect(mensajeSyncClientesSap({ ok: false, code: 'EN_CURSO' })).toEqual({
      tipo: 'info',
      texto: 'Ya hay una sincronización en curso, probá en un minuto',
    });
  });

  it.each([['SYNC_FALLO'], ['SAP_INCOMPLETO'], ['SAP_NO_CONFIGURADO'], ['permission-denied']])(
    'M5 error %s → nunca dice exito, codigo tecnico al final',
    (code) => {
      const m = mensajeSyncClientesSap({ ok: false, code });
      expect(m.tipo).toBe('error');
      expect(m.texto).not.toMatch(/incorpor|terminada/i);
      expect(m.texto.endsWith('Código técnico: ' + code)).toBe(true);
    }
  );

  it('M6 respuesta vacia / rara → error (nunca exito)', () => {
    expect(mensajeSyncClientesSap(null).tipo).toBe('error');
    expect(mensajeSyncClientesSap(/** @type {any} */ ({})).tipo).toBe('error');
  });

  it('M7 ok:true con nuevos invalido → trata como 0', () => {
    expect(mensajeSyncClientesSap({ ok: true, nuevos: /** @type {any} */ ('x') }).texto).toBe(
      SYNC_CLIENTES_SAP_TEXTOS.sinNuevos
    );
  });

  it('M8 ningun texto (sin la linea del codigo) usa jerga prohibida', () => {
    const casos = [
      mensajeSyncClientesSap({ ok: true, nuevos: 2 }),
      mensajeSyncClientesSap({ ok: true, nuevos: 0 }),
      mensajeSyncClientesSap({ ok: false, code: 'EN_CURSO' }),
      mensajeSyncClientesSap({ ok: false, code: 'SYNC_FALLO' }),
      mensajeSyncClientesSap({ ok: false, code: 'SAP_INCOMPLETO' }),
    ];
    for (const c of casos) {
      const principal = c.texto.split('\n')[0];
      for (const p of PALABRAS_PROHIBIDAS) {
        expect(principal.toLowerCase()).not.toContain(String(p).toLowerCase());
      }
    }
  });
});
