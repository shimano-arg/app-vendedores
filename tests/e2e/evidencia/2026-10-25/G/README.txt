SPEC G v1454 Sect 60 UPDATE - escrito 2026-10-25
Spec: tests/e2e/g_snapshot_30min.spec.js
Env bloqueo ejecucion: playwright.config.js NO existe en el repo + secrets gcloud (test-user-email/password) no accesibles desde el worktree.
Smoke manual pendiente post-deploy:
  1. Verificar en el header el badge "Sync stock: X min" con formato correcto.
  2. Verificar que la clase CSS cambia a sap-ok/sap-warn/sap-err segun umbrales 5/30 min.
  3. Verificar que el tooltip menciona Cloud Scheduler.
