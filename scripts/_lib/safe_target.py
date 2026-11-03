"""scripts/_lib/safe_target.py — PROPUESTA (espejo de safe-target.cjs).

Guard común para scripts operativos (control C9). Mismas reglas que la
versión JS:
  1. --project <id> obligatorio, sin default ni lectura de entorno.
  2. Proyecto en lista permitida.
  3. Dry-run por defecto; --apply obligatorio para escribir; --apply + --dry-run = error.
  4. Producción + --apply: confirmación tipeando el project id (TTY) o
     --confirm-project=<id> (sin TTY / CI).
  5. Producción + --apply: cuenta de servicio obligatoria (no ADC de usuario).
  6. SA de otro proyecto o GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT distinto: bloqueo.
  7. Banner con destino, modo y credencial por stderr.

No abre conexiones. Lectura de archivos y prompt son inyectables para tests.
Uso típico:

    from _lib.safe_target import guard_or_exit
    t = guard_or_exit(requires_write=True)
    ...
    t.write("borrar pedidos/X", lambda: ref.delete())
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Callable, Mapping, Optional, Sequence

DEFAULT_ALLOWED_PROJECTS = ("app-vendedores-shimano", "app-vendedores-shimano-stg")
DEFAULT_PRODUCTION_PROJECTS = ("app-vendedores-shimano",)


class SafeTargetError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Credential:
    kind: str  # service_account | user_adc | external_account | none | unknown
    email: Optional[str] = None
    project_id: Optional[str] = None
    source: Optional[str] = None


@dataclass
class Target:
    project: str
    mode: str
    apply: bool
    is_production: bool
    credential: Credential
    confirm_project: Optional[str] = None
    rest: list = field(default_factory=list)
    is_tty: bool = False
    log: Callable[[str], None] = field(default=lambda m: print(m, file=sys.stderr))

    def write(self, description: str, fn: Callable[[], object]):
        """Ejecuta fn solo en APPLY; en DRY-RUN registra lo que haría."""
        if not self.apply:
            self.log(f"[DRY-RUN] haría: {description}")
            return None
        self.log(f"[APPLY] {description}")
        return fn()


def parse_args(argv: Sequence[str]):
    project = None
    confirm = None
    apply = False
    dry = False
    rest = []
    i = 0
    argv = list(argv)
    while i < len(argv):
        a = argv[i]
        if a == "--project":
            v = argv[i + 1] if i + 1 < len(argv) else None
            if not v or v.startswith("--"):
                raise SafeTargetError("E_NO_PROJECT", "--project requiere un valor")
            project = v
            i += 1
        elif a.startswith("--project="):
            project = a[len("--project="):]
        elif a.startswith("--confirm-project="):
            confirm = a[len("--confirm-project="):]
        elif a == "--apply":
            apply = True
        elif a in ("--dry-run", "--dry"):
            dry = True
        else:
            rest.append(a)
        i += 1
    return (project.strip() if project else None), apply, dry, confirm, rest


def _default_read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def detect_credential(env: Mapping[str, str], read_file: Callable[[str], Optional[str]]) -> Credential:
    gac = env.get("GOOGLE_APPLICATION_CREDENTIALS")
    raw = None
    source = None
    if gac:
        source = gac
        raw = read_file(gac)
        if raw is None:
            return Credential("unknown", source=source)
    else:
        cands = []
        if env.get("CLOUDSDK_CONFIG"):
            cands.append(env["CLOUDSDK_CONFIG"] + "/application_default_credentials.json")
        if env.get("APPDATA"):
            cands.append(env["APPDATA"] + "/gcloud/application_default_credentials.json")
        home = env.get("HOME") or env.get("USERPROFILE")
        if home:
            cands.append(home + "/.config/gcloud/application_default_credentials.json")
        for c in cands:
            r = read_file(c)
            if r is not None:
                raw, source = r, c
                break
        if raw is None:
            return Credential("none")
    try:
        j = json.loads(raw)
    except ValueError:
        return Credential("unknown", source=source)
    t = j.get("type") if isinstance(j, dict) else None
    if t == "service_account":
        return Credential("service_account", j.get("client_email"), j.get("project_id"), source)
    if t == "authorized_user":
        return Credential("user_adc", None, j.get("quota_project_id"), source)
    if t == "external_account":
        m = re.search(r"serviceAccounts/([^:]+):generateAccessToken", j.get("service_account_impersonation_url", ""))
        return Credential("external_account", m.group(1) if m else None, None, source)
    return Credential("unknown", source=source)


def resolve_target(
    argv: Sequence[str],
    env: Optional[Mapping[str, str]] = None,
    allowed_projects: Sequence[str] = DEFAULT_ALLOWED_PROJECTS,
    production_projects: Sequence[str] = DEFAULT_PRODUCTION_PROJECTS,
    requires_write: bool = True,
    read_file: Callable[[str], Optional[str]] = lambda p: None,
    is_tty: bool = False,
) -> Target:
    env = env or {}
    project, apply, dry, confirm, rest = parse_args(argv)
    if not project:
        raise SafeTargetError("E_NO_PROJECT", "Falta --project <id>. No hay proyecto por defecto.")
    if project not in allowed_projects:
        raise SafeTargetError("E_PROJECT_NOT_ALLOWED", f"Proyecto no permitido: {project}. Permitidos: {', '.join(allowed_projects)}")
    if apply and dry:
        raise SafeTargetError("E_CONFLICTING_FLAGS", "--apply y --dry-run no pueden ir juntos.")
    if apply and not requires_write:
        raise SafeTargetError("E_APPLY_ON_READONLY", "Este script es de solo lectura: --apply no aplica.")
    for k in ("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT"):
        if env.get(k) and env[k] != project:
            raise SafeTargetError("E_ENV_PROJECT_MISMATCH", f"{k}={env[k]} no coincide con --project {project}.")
    cred = detect_credential(env, read_file)
    is_prod = project in production_projects
    if cred.kind == "service_account" and cred.project_id and cred.project_id != project:
        raise SafeTargetError("E_CREDENTIAL_PROJECT_MISMATCH", f"La cuenta de servicio es del proyecto {cred.project_id}, no de {project}.")
    if apply and cred.kind == "none":
        raise SafeTargetError("E_NO_CREDENTIAL", "No se encontró credencial para escribir.")
    if apply and cred.kind == "unknown":
        raise SafeTargetError("E_UNKNOWN_CREDENTIAL", f"Credencial ilegible o de tipo desconocido ({cred.source}).")
    if apply and is_prod and cred.kind == "user_adc":
        raise SafeTargetError("E_USER_ADC_ON_PROD", "Escribir en producción con ADC de usuario está bloqueado: usar una cuenta de servicio dedicada.")
    return Target(project, "APPLY" if apply else "DRY-RUN", apply, is_prod, cred, confirm, rest, is_tty)


def banner(t: Target) -> str:
    if t.credential.kind in ("service_account", "external_account"):
        cred = f"cuenta de servicio {t.credential.email or '(sin email)'}"
    elif t.credential.kind == "user_adc":
        cred = "ADC de usuario"
    else:
        cred = t.credential.kind
    line = "=" * 64
    return "\n".join([
        line,
        f"DESTINO   : {t.project}{'   <<< PRODUCCION >>>' if t.is_production else ''}",
        f"MODO      : {t.mode}{'' if t.apply else ' (no se escribe nada)'}",
        f"CREDENCIAL: {cred}",
        line,
    ])


def confirm_if_needed(t: Target, prompt: Optional[Callable[[str], str]] = None) -> bool:
    if not (t.apply and t.is_production):
        return True
    if t.confirm_project is not None:
        if t.confirm_project != t.project:
            raise SafeTargetError("E_CONFIRMATION_MISMATCH", "--confirm-project no coincide con --project.")
        return True
    if not t.is_tty or prompt is None:
        raise SafeTargetError("E_CONFIRMATION_REQUIRED", f"Sin TTY: pasar --confirm-project={t.project} para escribir en producción.")
    typed = prompt(f"Vas a ESCRIBIR en {t.project}. Tipeá el project id para confirmar: ").strip()
    if typed != t.project:
        raise SafeTargetError("E_CONFIRMATION_MISMATCH", "Confirmación incorrecta. No se escribió nada.")
    return True


def guard_or_exit(requires_write: bool = True, **kw) -> Target:
    """Atajo para scripts: valida, imprime banner, confirma. Sale con 2 si falla."""
    try:
        t = resolve_target(sys.argv[1:], os.environ, requires_write=requires_write,
                           read_file=_default_read, is_tty=sys.stdin.isatty(), **kw)
        print(banner(t), file=sys.stderr)
        confirm_if_needed(t, input)
        return t
    except SafeTargetError as e:
        print(f"[safe-target] BLOQUEADO ({e.code}): {e}", file=sys.stderr)
        sys.exit(2)
