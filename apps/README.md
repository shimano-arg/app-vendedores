# Monorepo apps/

Subcarpeta para apps hermanas de app-vendedores que mantienen su propio stack
pero viven en el mismo repo para facilitar edicion unificada.

## Apps actuales

### `app-reclamos/` (v1254, 2026-10-13)

Kanban Shimano ↔ Deposito. Stack separado de app-vendedores:

| Capa | app-vendedores | app-reclamos |
|---|---|---|
| Framework | HTML estatico inline | Next.js 16 |
| DB | Firebase Firestore | Supabase |
| Auth | Firebase Auth | Supabase Auth |
| Email | Cloud Function → Gmail SMTP | nodemailer → Gmail SMTP (comparten bot) |
| Deploy | GitHub Pages (automatico desde main) | Vercel (desde repo viejo erbinomariano-propio/app-reclamos-shimano, TODO migrar al monorepo) |

Punto de entrada: boton "App Reclamos" en el header de app-vendedores (gate admin + whitelist Mariano).

**Codigo canonico**: `apps/app-reclamos/` dentro de este repo.
**URL prod**: https://app-reclamos-shimano.vercel.app
**Repo viejo (DEPRECATED)**: `erbinomariano-propio/app-reclamos-shimano`. Sigue siendo la fuente del deploy Vercel hasta que Mariano reconfigure. Ver `apps/app-reclamos/CLAUDE.md §0`.

## CI

Workflows en `.github/workflows/`:
- `reclamos-ci.yml` → typecheck + unit tests (`paths: apps/app-reclamos/**`)
- `reclamos-keepalive.yml` → ping cron a Supabase cada 3 dias
- `test-and-lint.yml` → CI de app-vendedores (ignora apps/ por diferencia de stack)

Si agregas una nueva app:
1. Crear `apps/<nombre>/` con su propio stack.
2. Agregar workflows CI con prefix `<nombre>-*.yml` + `paths: ['apps/<nombre>/**']`.
3. Documentar en este README.
4. Si tiene deploy propio (Vercel, Cloud Run, etc), documentar la Git integration en `apps/<nombre>/CLAUDE.md`.

## Local dev

Cada app es independiente — su `package.json` + `node_modules` propios. NO hay workspaces npm por ahora (ni se planean porque los stacks son totalmente distintos y comparten cero código).

```powershell
# Trabajar en app-reclamos:
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES\apps\app-reclamos"
npm install
npm run dev

# Trabajar en app-vendedores (root):
cd "C:\Users\shimano.sandbox\Desktop\APP VENDEDORES"
# edicion directa de index.html + rebuild bundle
```
