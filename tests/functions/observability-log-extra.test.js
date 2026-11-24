// @ts-check
/**
 * Incidente Fase 2 (2026-11-24, OBSERVABILIDAD).
 *
 * Fix al gap §64.2: los 8 throwError('ASIG_REF_INVALID', msg, {reason,
 * pedidoOrigenId, lineIndex, ...}) en commit-pedido-core.js:1388-1495 pasan
 * la metadata en `err._data` TOP-LEVEL — no bajo `_logExtra`. El catch
 * handler (línea ~439) sólo mergeaba `err._data._logExtra` → operations_log
 * quedaba sin sub-reason para ASIG_REF_INVALID.
 *
 * Fix (Option X): helper `extractWhitelistedForLog(errData)` centraliza la
 * whitelist de campos diagnósticos del `err._data` top-level; el catch
 * handler lo invoca y mergea con `_logExtra` (si viene) + `errMessage`.
 * Una sola touchpoint — cubre los 8 throwError existentes + cualquier
 * futuro `throwError(code, msg, {...})` sin más cambios.
 *
 * Este test verifica:
 *   (1) `extractWhitelistedForLog` devuelve sólo campos whitelisted.
 *   (2) `clientName`/`clientEmail`/free-text NUNCA se copian (PII guard).
 *   (3) `rows[]` de UNRESOLVED_BO_ENTRY_ROWS (potencialmente grande + nombres)
 *       NO se incluye.
 *   (4) Edge cases: errData null, undefined, non-object, vacío.
 *   (5) Contract integration: catch handler simulado → log entry incluye
 *       whitelist fields + preserva logExtra.
 */
import { describe, expect, it } from 'vitest';
import { extractWhitelistedForLog } from '../../functions/core/commit-pedido-core.js';

describe('extractWhitelistedForLog — whitelist estricta (incidente Fase 2 2026-11-24)', () => {
  it('devuelve objeto vacío para null/undefined/string/number', () => {
    expect(extractWhitelistedForLog(null)).toEqual({});
    expect(extractWhitelistedForLog(undefined)).toEqual({});
    expect(extractWhitelistedForLog('foo')).toEqual({});
    expect(extractWhitelistedForLog(42)).toEqual({});
    expect(extractWhitelistedForLog(true)).toEqual({});
  });

  it('devuelve objeto vacío para objeto vacío', () => {
    expect(extractWhitelistedForLog({})).toEqual({});
  });

  it('ignora campos undefined incluso si la key existe (Object.hasOwnProperty)', () => {
    const errData = { reason: undefined, pedidoOrigenId: 'abc', lineIndex: 2 };
    const out = extractWhitelistedForLog(errData);
    expect(out).toEqual({ pedidoOrigenId: 'abc', lineIndex: 2 });
    expect(out.reason).toBeUndefined();
  });

  // ASIG_REF_INVALID sub-reasons — los 8 throwError de accumulateCancelAsigMutations.

  it('ASIG_REF_INVALID PEDIDO_ORIGEN_NOT_FOUND: reason + pedidoOrigenId', () => {
    const errData = {
      reason: 'PEDIDO_ORIGEN_NOT_FOUND',
      pedidoOrigenId: 'snakeSrl_origen_1',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'PEDIDO_ORIGEN_NOT_FOUND',
      pedidoOrigenId: 'snakeSrl_origen_1',
    });
  });

  it('ASIG_REF_INVALID LINE_INDEX_INVALID: reason + lineIndex + arrayLength + sku + pedidoOrigenId', () => {
    const errData = {
      reason: 'LINE_INDEX_INVALID',
      pedidoOrigenId: 'orig_1',
      lineIndex: 99,
      sku: 'CLC70H2PY',
      arrayLength: 30,
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'LINE_INDEX_INVALID',
      pedidoOrigenId: 'orig_1',
      lineIndex: 99,
      sku: 'CLC70H2PY',
      arrayLength: 30,
    });
  });

  it('ASIG_REF_INVALID SKU_MISMATCH: expectedSku + actualSku + lineIndex + pedidoOrigenId', () => {
    const errData = {
      reason: 'SKU_MISMATCH',
      pedidoOrigenId: 'orig_x',
      lineIndex: 7,
      expectedSku: 'CLC70H2PY',
      actualSku: 'CLC66H2PY',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'SKU_MISMATCH',
      pedidoOrigenId: 'orig_x',
      lineIndex: 7,
      expectedSku: 'CLC70H2PY',
      actualSku: 'CLC66H2PY',
    });
  });

  it('ASIG_REF_INVALID SKU_CONFLICT_IN_DUPES: conflictingSkus + actualLineCode', () => {
    const errData = {
      reason: 'SKU_CONFLICT_IN_DUPES',
      pedidoOrigenId: 'orig_dup',
      lineIndex: 3,
      conflictingSkus: ['SKU-A', 'SKU-B'],
      actualLineCode: 'SKU-A',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'SKU_CONFLICT_IN_DUPES',
      pedidoOrigenId: 'orig_dup',
      lineIndex: 3,
      conflictingSkus: ['SKU-A', 'SKU-B'],
      actualLineCode: 'SKU-A',
    });
  });

  it('ASIG_REF_INVALID STATE_MISMATCH: expectedState + actualState (caso SNAKE SRL típico)', () => {
    // Caso Gonzalo SNAKE SRL hoy: 4 refs STATE_MISMATCH porque las líneas
    // origen fueron revertidas a BO por §40.11 revertSobreAsignadas.
    const errData = {
      reason: 'STATE_MISMATCH',
      pedidoOrigenId: '53vbayoJzYqceThBKCY9',
      lineIndex: 23,
      expectedState: 'ASIG',
      actualState: 'BO',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'STATE_MISMATCH',
      pedidoOrigenId: '53vbayoJzYqceThBKCY9',
      lineIndex: 23,
      expectedState: 'ASIG',
      actualState: 'BO',
    });
  });

  it('ASIG_REF_INVALID QTY_ZERO: qtyOpen', () => {
    const errData = {
      reason: 'QTY_ZERO',
      pedidoOrigenId: 'orig_z',
      lineIndex: 12,
      qtyOpen: 0,
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'QTY_ZERO',
      pedidoOrigenId: 'orig_z',
      lineIndex: 12,
      qtyOpen: 0,
    });
  });

  it('ASIG_REF_INVALID QTY_INSUFFICIENT: qtyOpen + qtyAsignada', () => {
    const errData = {
      reason: 'QTY_INSUFFICIENT',
      pedidoOrigenId: 'orig_q',
      lineIndex: 5,
      qtyOpen: 2,
      qtyAsignada: 5,
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'QTY_INSUFFICIENT',
      pedidoOrigenId: 'orig_q',
      lineIndex: 5,
      qtyOpen: 2,
      qtyAsignada: 5,
    });
  });

  // Otros errorCodes con metadata top-level.

  it('CLIENT_HAS_OPEN_WAITLIST: conflictingWaitlistId + conflictingOrderNumber + conflictingItemsCount', () => {
    const errData = {
      conflictingWaitlistId: 'wl_abc',
      conflictingOrderNumber: 524,
      conflictingItemsCount: 29,
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      conflictingWaitlistId: 'wl_abc',
      conflictingOrderNumber: 524,
      conflictingItemsCount: 29,
    });
  });

  it('SNAPSHOT_TOO_OLD: snapshotAgeMinutes + snapshotUpdatedAt + snapshotOrigin + canRefresh', () => {
    const errData = {
      snapshotAgeMinutes: 42,
      snapshotUpdatedAt: '2026-11-24T10:00:00Z',
      snapshotOrigin: 'server:app_config/stock_snapshot',
      canRefresh: false,
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      snapshotAgeMinutes: 42,
      snapshotUpdatedAt: '2026-11-24T10:00:00Z',
      snapshotOrigin: 'server:app_config/stock_snapshot',
      canRefresh: false,
    });
  });

  it('VERSION_OLD: minVersion + currentVersion', () => {
    expect(extractWhitelistedForLog({ minVersion: 'v1500', currentVersion: 'v1420' })).toEqual({
      minVersion: 'v1500',
      currentVersion: 'v1420',
    });
  });

  it('PERMISSION_DENIED (G4.03): reason + existingPedidoId + sapDocNum + sapDocEntry + via', () => {
    const errData = {
      reason: 'pedido_ya_en_sap',
      existingPedidoId: 'ped_abc',
      sapDocNum: 2000500,
      sapDocEntry: 5000,
      via: 'draft_lock',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({
      reason: 'pedido_ya_en_sap',
      existingPedidoId: 'ped_abc',
      sapDocNum: 2000500,
      sapDocEntry: 5000,
      via: 'draft_lock',
    });
  });

  it('VENDOR_UID_MISSING (§89): resolvedVendorKey + resolvedVendorUid', () => {
    expect(
      extractWhitelistedForLog({
        resolvedVendorKey: 'MAURICIO GIL',
        resolvedVendorUid: 'uid-mauricio-xyz',
      })
    ).toEqual({
      resolvedVendorKey: 'MAURICIO GIL',
      resolvedVendorUid: 'uid-mauricio-xyz',
    });
  });

  // PII guard — campos sensibles NUNCA se copian.

  it('PII guard: clientName / clientEmail / telefono / direccion NO se copian', () => {
    const errData = {
      reason: 'STATE_MISMATCH',
      pedidoOrigenId: 'orig_x',
      lineIndex: 1,
      // PII nunca permitida:
      clientName: 'SNAKE SRL',
      clientEmail: 'ventas@snake.com.ar',
      telefono: '+54911...',
      direccion: 'Av. Siempre Viva 742',
      cardCode: 'C30719034914', // cardCode SÍ se loguea pero vía campo top-level de logCommitRejection, no acá.
    };
    const out = extractWhitelistedForLog(errData);
    expect(out).toEqual({
      reason: 'STATE_MISMATCH',
      pedidoOrigenId: 'orig_x',
      lineIndex: 1,
    });
    expect(out.clientName).toBeUndefined();
    expect(out.clientEmail).toBeUndefined();
    expect(out.telefono).toBeUndefined();
    expect(out.direccion).toBeUndefined();
    expect(out.cardCode).toBeUndefined();
  });

  it('PII guard: rows[] de UNRESOLVED_BO_ENTRY_ROWS NO se copia (array grande + nombres)', () => {
    const errData = {
      rows: [
        { sku: 'A', cantidad: 5, boAnterior: 2, clientName: 'CLIENTE X' },
        { sku: 'B', cantidad: 3, boAnterior: 1, clientName: 'CLIENTE Y' },
      ],
    };
    expect(extractWhitelistedForLog(errData)).toEqual({});
  });

  it('PII guard: free-text fields (observaciones, notas, mensajes) NO se copian', () => {
    const errData = {
      reason: 'STATE_MISMATCH',
      observaciones: 'cliente pide urgente blah blah',
      notas: 'contacto cell de ventas: +54911...',
      mensaje: 'texto libre con info de cliente',
    };
    expect(extractWhitelistedForLog(errData)).toEqual({ reason: 'STATE_MISMATCH' });
  });
});

describe('Catch handler integration (simulación §64.2 extensión)', () => {
  /**
   * Simula el catch handler del retry loop de commitPedidoCore.
   * Igual al código real (functions/core/commit-pedido-core.js:433-453).
   */
  function simulateCatchMerge(err) {
    const logExtra = err._data && err._data._logExtra ? err._data._logExtra : {};
    const fromDataTop = extractWhitelistedForLog(err._data);
    return Object.assign({}, fromDataTop, logExtra, {
      errMessage: err.message || null,
    });
  }

  it('ASIG_REF_INVALID STATE_MISMATCH (caso SNAKE SRL): log entry tiene reason + pedidoOrigenId + lineIndex + expectedState + actualState', () => {
    // Replica throwError('ASIG_REF_INVALID', 'línea no está en estado ASIG', {...})
    // de commit-pedido-core.js:1472.
    const err = {
      _errorCode: 'ASIG_REF_INVALID',
      message: 'línea no está en estado ASIG',
      _data: {
        reason: 'STATE_MISMATCH',
        pedidoOrigenId: '53vbayoJzYqceThBKCY9',
        lineIndex: 23,
        expectedState: 'ASIG',
        actualState: 'BO',
      },
    };
    const merged = simulateCatchMerge(err);
    expect(merged.reason).toBe('STATE_MISMATCH');
    expect(merged.pedidoOrigenId).toBe('53vbayoJzYqceThBKCY9');
    expect(merged.lineIndex).toBe(23);
    expect(merged.expectedState).toBe('ASIG');
    expect(merged.actualState).toBe('BO');
    expect(merged.errMessage).toBe('línea no está en estado ASIG');
  });

  it('ASIG_REF_INVALID QTY_INSUFFICIENT: log tiene qtyOpen + qtyAsignada', () => {
    const err = {
      _errorCode: 'ASIG_REF_INVALID',
      message: 'qtyAsignada excede qtyOpen de la línea',
      _data: {
        reason: 'QTY_INSUFFICIENT',
        pedidoOrigenId: 'orig_q',
        lineIndex: 5,
        qtyOpen: 2,
        qtyAsignada: 5,
      },
    };
    const merged = simulateCatchMerge(err);
    expect(merged.reason).toBe('QTY_INSUFFICIENT');
    expect(merged.qtyOpen).toBe(2);
    expect(merged.qtyAsignada).toBe(5);
  });

  it('STOCK_CHANGED (legacy path con _logExtra): mergea whitelist top-level + _logExtra', () => {
    // El pattern STOCK_CHANGED usa _logExtra (compat §64 v1443).
    // Verifica que el fix no rompe el path legacy.
    const err = {
      _errorCode: 'STOCK_CHANGED',
      message: 'stock cambió',
      _data: {
        _logExtra: {
          skuDetails: [{ sku: 'X', pediste: 5, server: { libre: 2 } }],
          totalSkuChanged: 1,
          totalUnitsToBO: 3,
        },
      },
    };
    const merged = simulateCatchMerge(err);
    expect(merged.skuDetails).toBeDefined();
    expect(merged.totalSkuChanged).toBe(1);
    expect(merged.totalUnitsToBO).toBe(3);
  });

  it('_logExtra wins over whitelist (nested metadata gana sobre top-level)', () => {
    // Si un throwError pasa reason tanto en top-level como en _logExtra,
    // _logExtra wins (es el patrón explícito del core).
    const err = {
      _errorCode: 'STOCK_CHANGED',
      message: 'stock cambió',
      _data: {
        reason: 'FROM_TOP_LEVEL',
        _logExtra: {
          reason: 'FROM_LOGEXTRA',
        },
      },
    };
    const merged = simulateCatchMerge(err);
    expect(merged.reason).toBe('FROM_LOGEXTRA');
  });

  it('errData sin reason ni _logExtra: merge sólo con errMessage', () => {
    const err = {
      _errorCode: 'SAP_UNAVAILABLE',
      message: 'SAP no responde',
      _data: {},
    };
    const merged = simulateCatchMerge(err);
    expect(merged.errMessage).toBe('SAP no responde');
    expect(Object.keys(merged)).toEqual(['errMessage']);
  });

  it('errData null (ej. error no-negocio sin _data): merge sólo con errMessage', () => {
    const err = {
      _errorCode: 'CONTENTION_RETRY_EXHAUSTED',
      message: 'Reintenta en 10 segundos',
      _data: null,
    };
    const merged = simulateCatchMerge(err);
    expect(merged.errMessage).toBe('Reintenta en 10 segundos');
    expect(Object.keys(merged)).toEqual(['errMessage']);
  });

  it('PII en errData ANIDADA en objeto no-whitelist: NO se copia', () => {
    // Defense in depth: si un nuevo throwError accidentalmente mete un
    // objeto con PII bajo una key no-whitelisted, no se filtra.
    const err = {
      _errorCode: 'ASIG_REF_INVALID',
      message: 'mismatch',
      _data: {
        reason: 'SKU_MISMATCH',
        customData: {
          clientName: 'SNAKE SRL',
          telefono: '+54911',
        },
      },
    };
    const merged = simulateCatchMerge(err);
    expect(merged.reason).toBe('SKU_MISMATCH');
    expect(merged.customData).toBeUndefined();
  });
});

describe('Contrato de persistencia operations_log (shape)', () => {
  it('log entry generado por el catch simulado incluye SIEMPRE errMessage', () => {
    const err = { _errorCode: 'X', message: 'test', _data: { reason: 'R' } };
    const logExtra = err._data._logExtra || {};
    const fromDataTop = extractWhitelistedForLog(err._data);
    const merged = Object.assign({}, fromDataTop, logExtra, {
      errMessage: err.message || null,
    });
    expect(merged.errMessage).toBe('test');
  });

  it('`_logExtra` scrubbed del response al cliente (contrato §64.2 preservado)', () => {
    // El core hace: dataForClient = {...err._data}; delete dataForClient._logExtra;
    // Aca verificamos que la operación no afecta extractWhitelistedForLog.
    const errData = {
      reason: 'STATE_MISMATCH',
      pedidoOrigenId: 'orig',
      lineIndex: 1,
      _logExtra: { internal: 'x' },
    };
    const fromLog = extractWhitelistedForLog(errData);
    // _logExtra NO está en la whitelist → nunca llega al log.
    expect(fromLog._logExtra).toBeUndefined();

    // Client-side scrub (patrón del core):
    const dataForClient = Object.assign({}, errData);
    delete dataForClient._logExtra;
    expect(dataForClient._logExtra).toBeUndefined();
    expect(dataForClient.reason).toBe('STATE_MISMATCH');
  });
});
