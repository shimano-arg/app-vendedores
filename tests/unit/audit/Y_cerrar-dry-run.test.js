// @ts-check
/**
 * v1519 §64.3 — Dry-run test de scripts/audit/Y_cerrar_ingresos_sin_bo_vigente.cjs.
 *
 * El script usa firebase-admin + lee prod. Para test de la LÓGICA PURA de
 * decisión (qué ingresos marcar vs cuáles saltear), replicamos aquí el
 * algoritmo con fixtures.
 *
 * Contrato que verificamos:
 *   - Ingreso con TODOS los clientesBO sin BO vigente → marcado a cerrar.
 *   - Ingreso con AL MENOS 1 cliente con BO vigente → no se cierra.
 *   - Mix (algunos sí, algunos no) → no se cierra (dejamos que Pablo decida).
 */
import { describe, expect, it } from 'vitest';

/**
 * Replica la decisión del script Y por ingreso.
 * @param {{sku:string, clientesBO:Array<{clientCardCode:string, clientName:string, qtyBackorder:number}>}} ingreso
 * @param {Map<string, Array<{id:string, data:any}>>} pedidosByCard
 * @returns {{marcar:boolean, reason:string, perCliente:Array<{clientCardCode:string, boVigenteReal:number}>}}
 */
function evaluarIngreso(ingreso, pedidosByCard) {
  const sku = String(ingreso.sku || '').toUpperCase().trim();
  if (!sku) return { marcar: false, reason: 'ingreso sin sku', perCliente: [] };
  const cBO = Array.isArray(ingreso.clientesBO) ? ingreso.clientesBO : [];
  if (cBO.length === 0) return { marcar: false, reason: 'sin clientesBO', perCliente: [] };
  const perCliente = cBO.map((c) => {
    const card = String(c.clientCardCode || '').trim();
    const peds = pedidosByCard.get(card) || [];
    let boVigente = 0;
    for (const p of peds) {
      const lines = Array.isArray(p.data.lines) ? p.data.lines : [];
      for (const l of lines) {
        const code = String((l && l.code) || '').toUpperCase().trim();
        if (code !== sku) continue;
        if (l && l.state === 'BO' && Number(l.qtyOpen || 0) > 0) {
          boVigente += Number(l.qtyOpen);
        }
      }
    }
    return { clientCardCode: card, boVigenteReal: boVigente };
  });
  const conBO = perCliente.filter((x) => x.boVigenteReal > 0);
  const sinBO = perCliente.filter((x) => x.boVigenteReal === 0);
  if (conBO.length === 0) return { marcar: true, reason: 'todos sin BO', perCliente };
  if (sinBO.length > 0) return { marcar: false, reason: 'mixto', perCliente };
  return { marcar: false, reason: 'todos con BO vigente', perCliente };
}

describe('Y_cerrar — dry-run plan logic', () => {
  it('ingreso SATO con 2 pedidos facturados (qtyOpen=0 ambos) → marcar a cerrar', () => {
    const ing = {
      sku: '21100400100E',
      clientesBO: [
        {
          clientCardCode: 'C-SATO',
          clientName: 'EDUARDO SATO',
          qtyBackorder: 2,
        },
        {
          clientCardCode: 'C-SATO',
          clientName: 'EDUARDO SATO',
          qtyBackorder: 2,
        },
      ],
    };
    const peds = new Map();
    peds.set('C-SATO', [
      {
        id: '6LhigQdzUmEcOHcRUEjl',
        data: {
          lines: [
            { code: '21100400100E', state: 'BO', qtyOpen: 0 }, // facturada
          ],
        },
      },
      {
        id: 'qlB4FpI3R9Rhu5sLZvbf',
        data: {
          lines: [
            { code: '21100400100E', state: 'BO', qtyOpen: 0 }, // cancelada
          ],
        },
      },
    ]);
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(true);
    expect(result.reason).toBe('todos sin BO');
    expect(result.perCliente.every((c) => c.boVigenteReal === 0)).toBe(true);
  });

  it('ingreso con BO vigente (qtyOpen>0) → NO marcar', () => {
    const ing = {
      sku: 'STRADIC',
      clientesBO: [
        { clientCardCode: 'CA', clientName: 'ANDRILI', qtyBackorder: 5 },
      ],
    };
    const peds = new Map();
    peds.set('CA', [
      {
        id: 'pA',
        data: {
          lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }],
        },
      },
    ]);
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(false);
    expect(result.reason).toBe('todos con BO vigente');
    expect(result.perCliente[0].boVigenteReal).toBe(5);
  });

  it('mock Firestore 2 ingresos (uno con BO vigente, otro sin) → solo el 2do entra al plan', () => {
    const ingresos = [
      {
        id: 'ir_con_bo',
        data: {
          sku: 'STRADIC',
          clientesBO: [{ clientCardCode: 'CA', clientName: 'ANDRILI', qtyBackorder: 5 }],
        },
      },
      {
        id: 'ir_sin_bo_sato',
        data: {
          sku: '21100400100E',
          clientesBO: [
            { clientCardCode: 'C-SATO', clientName: 'EDUARDO SATO', qtyBackorder: 4 },
          ],
        },
      },
    ];
    const peds = new Map();
    peds.set('CA', [
      {
        id: 'pA',
        data: { lines: [{ code: 'STRADIC', state: 'BO', qtyOpen: 5 }] },
      },
    ]);
    peds.set('C-SATO', [
      {
        id: '6LhigQdzUmEcOHcRUEjl',
        data: { lines: [{ code: '21100400100E', state: 'BO', qtyOpen: 0 }] },
      },
    ]);
    const plan = ingresos.map((ing) => ({
      id: ing.id,
      ...evaluarIngreso(ing.data, peds),
    }));
    expect(plan.find((p) => p.id === 'ir_con_bo').marcar).toBe(false);
    expect(plan.find((p) => p.id === 'ir_sin_bo_sato').marcar).toBe(true);
    const marcados = plan.filter((p) => p.marcar);
    expect(marcados).toHaveLength(1);
    expect(marcados[0].id).toBe('ir_sin_bo_sato');
  });

  it('ingreso mixto (1 con BO, 1 sin) → NO marcar (dejar que Pablo decida)', () => {
    const ing = {
      sku: 'MIX',
      clientesBO: [
        { clientCardCode: 'C-A', clientName: 'A', qtyBackorder: 3 },
        { clientCardCode: 'C-B', clientName: 'B', qtyBackorder: 2 },
      ],
    };
    const peds = new Map();
    peds.set('C-A', [
      {
        id: 'pA',
        data: { lines: [{ code: 'MIX', state: 'BO', qtyOpen: 3 }] },
      },
    ]);
    peds.set('C-B', [
      {
        id: 'pB',
        data: { lines: [{ code: 'MIX', state: 'BO', qtyOpen: 0 }] },
      },
    ]);
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(false);
    expect(result.reason).toBe('mixto');
  });

  it('ingreso con cardCode sin pedidos abiertos → cuenta como sin BO', () => {
    const ing = {
      sku: 'FOO',
      clientesBO: [{ clientCardCode: 'C-NADA', clientName: 'N', qtyBackorder: 1 }],
    };
    const peds = new Map(); // vacío
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(true);
    expect(result.perCliente[0].boVigenteReal).toBe(0);
  });

  it('ingreso con línea BO pero qtyOpen=0 (facturada) → cuenta como sin BO', () => {
    const ing = {
      sku: 'FACT',
      clientesBO: [{ clientCardCode: 'C-F', clientName: 'F', qtyBackorder: 2 }],
    };
    const peds = new Map();
    peds.set('C-F', [
      {
        id: 'p1',
        data: { lines: [{ code: 'FACT', state: 'BO', qtyOpen: 0 }] },
      },
    ]);
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(true);
    expect(result.perCliente[0].boVigenteReal).toBe(0);
  });

  it('línea en state ASIG (no BO) no cuenta como BO vigente', () => {
    const ing = {
      sku: 'ASIG1',
      clientesBO: [{ clientCardCode: 'C-X', clientName: 'X', qtyBackorder: 2 }],
    };
    const peds = new Map();
    peds.set('C-X', [
      {
        id: 'pX',
        data: {
          lines: [
            { code: 'ASIG1', state: 'ASIG', qtyOpen: 5 }, // ASIG, no BO
          ],
        },
      },
    ]);
    const result = evaluarIngreso(ing, peds);
    expect(result.marcar).toBe(true);
    expect(result.perCliente[0].boVigenteReal).toBe(0);
  });
});
