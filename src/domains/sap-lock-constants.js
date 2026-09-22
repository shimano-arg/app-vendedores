// @ts-check
// SAP lock TTL — fuente unica de verdad para client-side.
//
// v1005 (2026-09-22): extraido a modulo compartido tras el bug v1004:
// el batch handler "Carga a SAP" (sap-admin-panel.js:911) tenia el TTL
// hardcodeado en 60_000 mientras el auto-send listener y el CF trigger
// usaban 300_000. Con los 3 flows activos post-v999, el batch podia
// pasar por encima de un lock aun activo -> SQ duplicado en SAP.
//
// v577 (2026-08-21) subio el listener de 60s -> 300s tras incidente
// Ioannis+Jonatan (SQ #2000079 + #2000080 duplicados). El batch handler
// se quedo en 60s (deuda oculta hasta v1004).
//
// La CF (functions/core/auto-send-sap-core.js) usa el mismo valor por
// default (deps.lockTtlMs ?? 300000). Debe mantenerse SIEMPRE sincronizado
// con SAP_LOCK_TTL_MS de aca abajo. Test unit (tests/unit/sap-lock-ttl.test.js)
// valida que ambos coincidan.

export const SAP_LOCK_TTL_MS = 300000; // 5 min
