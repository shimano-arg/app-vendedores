"""scripts/_lib/script_guard.py — adaptadores del guard `safe_target` (control C9).

Dos piezas, sin abrir conexiones por sí mismas:

1. `guard(...)`: igual que `safe_target.guard_or_exit`, pero entiende la cuenta
   de servicio que los scripts del repo reciben como JSON en la variable
   `FIREBASE_SERVICE_ACCOUNT` (o en un archivo fijo, ej. ~/Desktop/sa-key.json).
   Sin esto el guard vería "sin credencial" y bloquearía todo `--apply`.

2. `SapWriteGate`: compuerta para escrituras al SAP Service Layer.
   - El script declara una lista CERRADA de entidades que puede escribir
     (ej. {"Quotations", "Quotations/Cancel"}). Cualquier otra se bloquea siempre.
   - En DRY-RUN no manda nada: imprime método, ruta (host enmascarado) y cuerpo.
   - En APPLY exige, además del `--apply` del guard:
       --sap-allow=<Entidad>[,<Entidad>...]   (el operador nombra lo que autoriza)
       --confirm-sap-company=<CompanyDB>      (tipear la base SAP destino)
   - Nunca imprime el host del Service Layer ni la password.

Códigos de error nuevos (además de los de safe_target):
    E_SAP_ENTITY_NOT_ALLOWED   entidad fuera de la lista del script o del --sap-allow
    E_SAP_COMPANY_CONFIRMATION falta --confirm-sap-company o no coincide
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from typing import Callable, Iterable, Mapping, Optional, Sequence

from .safe_target import (
    SafeTargetError,
    Target,
    banner,
    confirm_if_needed,
    resolve_target,
)

SA_PSEUDO_PATH = "env:FIREBASE_SERVICE_ACCOUNT"
_HOST_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+")


def _stderr(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def decode_sa_json(raw: str) -> str:
    """Mismo criterio que parse_sa_json del repo: JSON directo o base64."""
    raw = (raw or "").strip()
    if raw and not raw.startswith("{"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except Exception:  # noqa: BLE001 - se valida después como JSON
            pass
    return raw


def guard(
    argv: Optional[Sequence[str]] = None,
    env: Optional[Mapping[str, str]] = None,
    requires_write: bool = True,
    sa_env: Optional[str] = "FIREBASE_SERVICE_ACCOUNT",
    sa_file: Optional[str] = None,
    is_tty: Optional[bool] = None,
    prompt: Optional[Callable[[str], str]] = None,
    log: Callable[[str], None] = _stderr,
    exit_on_error: bool = True,
    **kw,
) -> Target:
    """Valida destino/modo/credencial, imprime banner y confirma producción.

    Orden de búsqueda de la credencial:
      GOOGLE_APPLICATION_CREDENTIALS > variable `sa_env` > `sa_file` > ADC.
    Sale con código 2 si algo no cumple (o relanza si exit_on_error=False).
    """
    real_env = dict(os.environ if env is None else env)
    virtual_files = {}
    if not real_env.get("GOOGLE_APPLICATION_CREDENTIALS"):
        raw = (real_env.get(sa_env) or "").strip() if sa_env else ""
        if raw:
            real_env["GOOGLE_APPLICATION_CREDENTIALS"] = SA_PSEUDO_PATH
            virtual_files[SA_PSEUDO_PATH] = decode_sa_json(raw)
        elif sa_file and os.path.exists(sa_file):
            real_env["GOOGLE_APPLICATION_CREDENTIALS"] = sa_file

    def read_file(path: str) -> Optional[str]:
        if path in virtual_files:
            return virtual_files[path]
        try:
            with open(path, encoding="utf-8") as fh:
                return fh.read()
        except OSError:
            return None

    tty = sys.stdin.isatty() if is_tty is None else is_tty
    try:
        t = resolve_target(
            sys.argv[1:] if argv is None else argv,
            real_env,
            requires_write=requires_write,
            read_file=read_file,
            is_tty=tty,
            **kw,
        )
        t.log = log
        log(banner(t))
        confirm_if_needed(t, prompt if prompt is not None else (input if tty else None))
        return t
    except SafeTargetError as e:
        log(f"[safe-target] BLOQUEADO ({e.code}): {e}")
        if exit_on_error:
            sys.exit(2)
        raise


def mask_url(url: str) -> str:
    """Reemplaza esquema+host(+puerto) por <SAP_SL>. Nunca imprimir el host real."""
    return _HOST_RE.sub("<SAP_SL>", str(url or ""))


def _split_csv(v: str) -> list:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


class SapWriteGate:
    """Compuerta de escrituras al SAP Service Layer (ver docstring del módulo)."""

    def __init__(
        self,
        target: Target,
        script_entities: Iterable[str],
        company_db: Optional[str],
        log: Optional[Callable[[str], None]] = None,
    ):
        self.target = target
        self.script_entities = frozenset(script_entities)
        self.company_db = company_db or ""
        self.log = log or target.log
        self.operator_entities: frozenset = frozenset()
        self.confirm_company: Optional[str] = None
        rest = []
        for a in list(target.rest or []):
            if a.startswith("--sap-allow="):
                self.operator_entities = frozenset(_split_csv(a[len("--sap-allow="):]))
            elif a.startswith("--confirm-sap-company="):
                self.confirm_company = a[len("--confirm-sap-company="):]
            else:
                rest.append(a)
        # Los flags SAP no llegan al argparse del script.
        self.rest = rest
        target.rest = rest
        self.dry_log: list = []

    def check_apply(self) -> None:
        """Llamar antes de la primera escritura (y antes del Login en APPLY)."""
        if not self.target.apply:
            return
        extra = self.operator_entities - self.script_entities
        if not self.operator_entities or extra:
            raise SafeTargetError(
                "E_SAP_ENTITY_NOT_ALLOWED",
                "APPLY contra SAP exige --sap-allow=<Entidad,...> con entidades de esta lista: "
                + ", ".join(sorted(self.script_entities))
                + (f". No permitidas: {', '.join(sorted(extra))}" if extra else ""),
            )
        if not self.company_db or self.confirm_company != self.company_db:
            raise SafeTargetError(
                "E_SAP_COMPANY_CONFIRMATION",
                "APPLY contra SAP exige --confirm-sap-company=<CompanyDB> igual a la base configurada.",
            )

    def request(self, session, method: str, url: str, entity: str, json_body=None, **kw):
        """POST/PATCH/DELETE al SL. DRY-RUN: imprime y devuelve None."""
        if entity not in self.script_entities:
            raise SafeTargetError(
                "E_SAP_ENTITY_NOT_ALLOWED",
                f"Entidad SAP '{entity}' fuera de la lista del script.",
            )
        body_txt = "" if json_body is None else json.dumps(json_body, ensure_ascii=False, default=str)
        desc = f"{method.upper()} {mask_url(url)} [{entity}]" + (f" body={body_txt[:4000]}" if body_txt else "")
        if not self.target.apply:
            self.dry_log.append(desc)
            self.log(f"[DRY-RUN] haría: {desc}")
            return None
        if entity not in self.operator_entities:
            raise SafeTargetError(
                "E_SAP_ENTITY_NOT_ALLOWED",
                f"Entidad SAP '{entity}' no autorizada por --sap-allow.",
            )
        self.log(f"[APPLY] {desc}")
        return session.request(method.upper(), url, json=json_body, **kw)
