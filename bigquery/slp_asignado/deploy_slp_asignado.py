#!/usr/bin/env python
"""
Deploy aditivo de slp_asignado (INT64) a 13 vistas + creacion de
v_visitas_full y v_clientes_360_dedup.

v2 (2026-09-29): slp_asignado se calcula SOLO por texto del vendedor
asignado (assigned_vendor / vendor / vendedor). NO se prioriza el
sales_person_code del documento SAP porque en pesca el codigo SAP
difiere del asignado en ~65% de las ventas ($585M/$910M ARS). Para
conservar el SlpCode del documento SAP como referencia, agregamos
slp_documento_sap aparte en las vistas donde existe.

Estrategia: fetch DDL crudo desde BQ (preserva U+FFFD del mojibake del
catalogo), inyecta columna aditiva al final del SELECT top-level, y ejecuta
CREATE OR REPLACE VIEW. Si el DDL ya trae slp_asignado/slp_documento_sap
de una corrida previa, se strippean antes de re-inyectar (idempotente).

Maestro canonico (v_targets + v2 add DIEGO VALSI 56):
  50 = GONZALO DE LA ROSA
  51 = MAURICIO GIL
  52 = IOANNIS PALKOUDAKIS
  53 = SANTIAGO ESTEBAN     + alias PACHI -> 53 (cartera de Santi)
  54 = FEDERICO CASTELANELLI
  55 = MARTIN BOIERO
  56 = DIEGO VALSI          (VDT, factura pesca segun modelo PBI)

Uso: python bigquery/slp_asignado/deploy_slp_asignado.py [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
import re
from pathlib import Path

try:
    from google.cloud import bigquery
except ImportError:
    print("ERROR: pip install google-cloud-bigquery", file=sys.stderr)
    sys.exit(1)

PROJECT = "app-vendedores-shimano"
DATASET = "shimano_app"
LOCATION = "southamerica-east1"

# Fragmento reutilizable: mapeo texto -> SlpCode con regla PACHI + DIEGO VALSI.
MAPPING_CASE_BODY = """      WHEN 'GONZALO DE LA ROSA'    THEN 50
      WHEN 'MAURICIO GIL'          THEN 51
      WHEN 'IOANNIS PALKOUDAKIS'   THEN 52
      WHEN 'SANTIAGO ESTEBAN'      THEN 53
      WHEN 'PACHI'                 THEN 53
      WHEN 'FEDERICO CASTELANELLI' THEN 54
      WHEN 'MARTIN BOIERO'         THEN 55
      WHEN 'DIEGO VALSI'           THEN 56
      ELSE NULL"""


def slp_asignado_expr(text_col: str) -> str:
    """slp_asignado: mapeo canonico SOLO por texto."""
    return (
        f"CASE UPPER(TRIM({text_col}))\n"
        f"{MAPPING_CASE_BODY}\n"
        f"    END"
    )


# Configuracion por vista: (spc_col opcional, text_col opcional).
# spc_col: nombre calificado del SlpCode SAP dentro del SELECT (None si no aplica).
# text_col: nombre calificado del texto del vendedor (None si no aplica).
VIEW_SPECS = {
    "v_ventas_lineas": {
        "spc": "inv.sales_person_code",
        "text": "ca.assigned_vendor_app",
    },
    "v_facturas_sap": {
        "spc": "inv.sales_person_code",
        "text": "ca.assigned_vendor_app",
    },
    "v_ofertas_lineas": {
        "spc": "sq.sales_person_code",
        "text": "ca.assigned_vendor_app",
    },
    "v_remitos_lineas": {
        "spc": "u.sales_person_code",
        "text": "ca.assigned_vendor_app",
    },
    "v_backorder": {
        "spc": None,
        "text": "vendor",
    },
    "v_stock_asignado": {
        "spc": None,
        "text": "vendor",
    },
    "v_visitas": {
        "spc": None,
        "text": "JSON_VALUE(data, '$.vendor')",
    },
    "v_visitas_enriquecida": {
        # Es SELECT v.* de v_visitas + match. Como v_visitas ya tendra
        # slp_asignado, v.* lo hereda. Igual lo agregamos explicito para
        # que el DDL indique la columna.
        "spc": None,
        "text": "JSON_VALUE(v.data, '$.vendor')",
        # Overrides especiales: la vista original hace SELECT v.*. Como
        # v.slp_asignado ya viene por el join, no hace falta inyectar.
        "skip_injection_use_star": True,
    },
    "v_campanias_ventas_detalle": {
        "spc": "v.sales_person_code",
        "text": "v.assigned_vendor",
    },
    "v_leads_detalle": {
        "spc": None,
        "text": "assigned_vendor",
    },
    "v_leads_vs_clientes_por_vendedor": {
        # Vista agregada (GROUP BY assigned_vendor). Cada grupo tiene un
        # unico valor de assigned_vendor -> MAX(CASE ...) equivale al
        # mapeo directo pero satisface el analizador de agregacion.
        "spc": None,
        "text": "IFNULL(NULLIF(JSON_VALUE(data, '$.assignedVendor'), ''), '(SIN ASIGNAR)')",
        "wrap_max": True,
    },
    "v_conversion_leads_mensual": {
        "spc": None,
        "text": "vxm.assigned_vendor",
    },
    "v_leads_snapshot_fin_mes": {
        "spc": None,
        "text": "assigned_vendor",
    },
}


def fetch_view_query(client: bigquery.Client, view_name: str) -> str:
    """Fetch the exact query text stored for a view (preserves bytes)."""
    table = client.get_table(f"{PROJECT}.{DATASET}.{view_name}")
    if table.view_query is None:
        raise RuntimeError(f"{view_name} no es una VIEW (o view_query es None)")
    return table.view_query


def strip_previous_slp_cols(query: str) -> str:
    """
    Remueve las columnas slp_asignado / slp_documento_sap agregadas por
    corridas previas del script. Busca el bloque:
      [<coma final linea previa>]
      -- slp_XXX (2026-09-29...)
      <expr multilinea> AS slp_XXX,?
    y lo elimina. Idempotente: si no encuentra, no toca nada.

    Robusto ante: comentario opcional, expresiones multi-linea con MAX(...)
    o CASE ... END, columna final vs intermedia.
    """
    # Pattern: coma opcional al final de linea + [comentario slp_XXX] +
    # todo lo que viene hasta " AS slp_XXX," o " AS slp_XXX\n".
    # Usamos non-greedy pero delimitamos con " AS slp_..." explicito.
    #
    # Nota: el comentario que agregamos empieza con "  -- slp_asignado" o
    # "  -- slp_documento_sap". Puede haber otras columnas nuevas (v2).
    # Estrategia: remover cada bloque "-- slp_(asignado|documento_sap)"
    # + el codigo hasta el "AS slp_xxx" que le corresponda.

    # v1090 (2026-09-29): simplificado `[ \t]*[^\n]*` → `[^\n]*` para evitar
    # ReDoS catastrophic backtracking flagueado por CodeQL. `[^\n]*` ya matchea
    # tabs+espacios+cualquier no-newline; el `[ \t]*` upfront era redundante y
    # generaba paths exponenciales en strings adversarial.
    pattern = re.compile(
        r"(?:,\s*\n)?"                           # coma opcional pre
        r"[ \t]*--[ \t]*slp_(?:asignado|documento_sap)[^\n]*\n"  # comentario propio
        r"(?:[^\n]*\n)*?"                        # cuerpo de la expresion (lazy)
        r"[^\n]*AS[ \t]+slp_(?:asignado|documento_sap)[ \t]*,?[ \t]*\n?",
        re.IGNORECASE,
    )
    new_query = pattern.sub("\n", query)

    # Si tras el strip la ultima columna quedo con ',' de mas al final
    # (porque quitamos la ultima), limpiamos.
    # Busca patron "  X,\nFROM " y lo cambia a "  X\nFROM ".
    new_query = re.sub(r",[ \t]*\n(FROM )", r"\n\1", new_query)

    return new_query


def find_last_from_line(lines: list[str]) -> int:
    """Devuelve el indice del ultimo FROM en col 0."""
    last = -1
    for i, line in enumerate(lines):
        if line.startswith("FROM "):
            last = i
    if last == -1:
        raise RuntimeError("No se encontro FROM top-level")
    return last


def inject_columns(query: str, spec: dict) -> str:
    """
    Strippea slp_asignado/slp_documento_sap previos e inyecta las nuevas
    columnas al final del SELECT top-level.

    - slp_asignado: SIEMPRE (mapeo por texto).
    - slp_documento_sap: solo si spec['spc'] tiene el nombre de la columna
      SlpCode SAP.
    """
    if spec.get("skip_injection_use_star"):
        # v_visitas_enriquecida: usa SELECT v.* -> hereda de v_visitas.
        # No inyectamos aca; la vista v_visitas ya tiene la columna con la
        # nueva definicion y el CREATE OR REPLACE VIEW re-resuelve v.*.
        # Sigue haciendo falta el CREATE para forzar re-resolucion.
        return query

    # Strip previa version.
    query = strip_previous_slp_cols(query)

    lines = query.split("\n")
    last_from_idx = find_last_from_line(lines)

    # Retroceder al ultima linea previa no vacia -> ultima columna original.
    prev_idx = last_from_idx - 1
    while prev_idx >= 0 and lines[prev_idx].strip() == "":
        prev_idx -= 1
    if prev_idx < 0:
        raise RuntimeError("No se pudo encontrar la ultima columna antes del FROM")

    # Asegurar coma al final de la ultima columna original.
    last_col_line = lines[prev_idx].rstrip()
    if not last_col_line.endswith(","):
        lines[prev_idx] = last_col_line + ","
    else:
        lines[prev_idx] = last_col_line

    # Construir columnas nuevas.
    text_col = spec.get("text")
    if not text_col:
        raise RuntimeError("Spec incompleto: falta text")

    asig_expr = slp_asignado_expr(text_col)
    if spec.get("wrap_max"):
        asig_expr = f"MAX({asig_expr})"

    new_cols_block: list[str] = []
    new_cols_block.append(
        "  -- slp_asignado (2026-09-29 v2): mapeo canonico SOLO por texto de\n"
        "  -- assigned_vendor. Congruente con la atribucion del modelo PBI.\n"
        f"  {asig_expr} AS slp_asignado"
    )

    spc_col = spec.get("spc")
    if spc_col:
        sap_expr = spc_col
        if spec.get("wrap_max"):
            sap_expr = f"MAX({sap_expr})"
        new_cols_block[-1] = new_cols_block[-1] + ","
        new_cols_block.append(
            "  -- slp_documento_sap (2026-09-29 v2): SlpCode del documento SAP,\n"
            "  -- para analisis. NO se usa para atribucion (ver slp_asignado).\n"
            f"  {sap_expr} AS slp_documento_sap"
        )

    lines.insert(last_from_idx, "\n".join(new_cols_block))
    return "\n".join(lines)


def dedup_view_sql() -> str:
    """
    v_clientes_360_dedup: elimina duplicados de card_code_sap en
    clientes_360_view. Prioridad: updated_at DESC (NULLS LAST),
    created_at DESC (NULLS LAST), application_id DESC como tiebreaker
    deterministico.

    Nota: en el snapshot 2026-09-29 los 3 duplicados conocidos tienen
    updated_at y created_at NULL, por lo que el tiebreaker application_id
    DESC decide. Los 3 duplicados son el MISMO cliente cada uno (mismo
    comercio+division):
      - C20346628988 DARIO RUBEN PEREYRA: 2 apps, mismo vendedor IOANNIS.
      - C30710893981 FOLCA S.R.L: 2 apps, vendedores distintos (SANTIAGO
        vs PACHI) -- coverage overlap real.
      - C33718355449 LOS MARINEROS S.R.L: 2 apps, mismo vendedor MAURICIO.
    """
    return f"""CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.v_clientes_360_dedup` AS
-- v_clientes_360_dedup (2026-09-29): dedup de card_code_sap en clientes_360_view.
-- Prioridad: updated_at DESC (NULLS LAST) -> created_at DESC (NULLS LAST) ->
-- application_id DESC (tiebreaker deterministico).
-- 3 duplicados conocidos son el MISMO cliente en cada caso (mismo comercio+division).
-- clientes_360_view NO se modifica.
WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY card_code_sap
      ORDER BY
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        application_id DESC
    ) AS _rn
  FROM `{PROJECT}.{DATASET}.clientes_360_view`
)
SELECT * EXCEPT (_rn) FROM ranked WHERE _rn = 1
"""


def visitas_full_view_sql() -> str:
    """
    v_visitas_full: une v_visitas + v_visitas_enriquecida 1:1 por visita_id.
    Como v_visitas_enriquecida ya es SELECT v.* + m.card_code + match_*, lo
    unico "nuevo" respecto a v_visitas son las columnas del match. La union
    1:1 = SELECT * FROM v_visitas_enriquecida (equivalente).
    Para ser explicito y respetar la spec: LEFT JOIN por visita_id.
    """
    return f"""CREATE OR REPLACE VIEW `{PROJECT}.{DATASET}.v_visitas_full` AS
-- v_visitas_full (2026-09-29): union 1:1 de v_visitas y v_visitas_enriquecida
-- por visita_id. Una fila por visita, todas las columnas incluyendo
-- card_code (del match) y slp_asignado (heredado de v_visitas via v.*).
-- Las vistas base NO se tocan.
SELECT
  v.*,
  e.card_code,
  e.card_name_sap,
  e.match_type,
  e.match_score,
  e.match_ambiguo
FROM `{PROJECT}.{DATASET}.v_visitas` v
LEFT JOIN `{PROJECT}.{DATASET}.v_visitas_enriquecida` e
  USING (visita_id)
"""


def build_all_statements(client: bigquery.Client) -> list[tuple[str, str]]:
    """
    Returns list of (view_name, ddl) tuples in dependency order.
    """
    stmts: list[tuple[str, str]] = []

    # Orden de deploy: bases primero, luego dependientes.
    # v_ventas_lineas y v_visitas vienen antes que sus dependientes.
    deploy_order = [
        "v_ventas_lineas",
        "v_facturas_sap",
        "v_ofertas_lineas",
        "v_remitos_lineas",
        "v_backorder",
        "v_stock_asignado",
        "v_visitas",
        "v_leads_detalle",
        "v_leads_vs_clientes_por_vendedor",
        "v_conversion_leads_mensual",
        "v_leads_snapshot_fin_mes",
        # Dependientes (usan las anteriores):
        "v_visitas_enriquecida",       # SELECT v.* de v_visitas
        "v_campanias_ventas_detalle",  # JOIN v_ventas_lineas
    ]

    for view_name in deploy_order:
        spec = VIEW_SPECS[view_name]
        original = fetch_view_query(client, view_name)
        modified = inject_columns(original, spec)
        ddl = (
            f"CREATE OR REPLACE VIEW "
            f"`{PROJECT}.{DATASET}.{view_name}` AS\n{modified}"
        )
        stmts.append((view_name, ddl))

    # Nuevas vistas.
    stmts.append(("v_visitas_full", visitas_full_view_sql()))
    stmts.append(("v_clientes_360_dedup", dedup_view_sql()))

    return stmts


def get_row_count(client: bigquery.Client, view_name: str) -> int | None:
    """Return COUNT(*) of a view. None if not exists."""
    try:
        job = client.query(
            f"SELECT COUNT(*) AS n FROM `{PROJECT}.{DATASET}.{view_name}`"
        )
        return next(iter(job.result())).n
    except Exception as e:
        print(f"  (WARN) COUNT falla para {view_name}: {e}")
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo muestra los DDLs, no ejecuta.",
    )
    parser.add_argument(
        "--dump-dir",
        type=Path,
        default=None,
        help="Opcional: guardar cada DDL modificado como archivo .sql en ese dir.",
    )
    args = parser.parse_args()

    client = bigquery.Client(project=PROJECT, location=LOCATION)

    print(f"[deploy] Building statements from live DDL...")
    stmts = build_all_statements(client)
    print(f"[deploy] {len(stmts)} statements listos")

    if args.dump_dir:
        args.dump_dir.mkdir(parents=True, exist_ok=True)
        for i, (name, ddl) in enumerate(stmts, 1):
            path = args.dump_dir / f"{i:02d}_{name}.sql"
            path.write_text(ddl + "\n", encoding="utf-8")
            print(f"  dumped {path}")

    if args.dry_run:
        print("[deploy] DRY-RUN: no se ejecuta nada.")
        return 0

    # Baselines pre-deploy (solo de las 13 vistas modificadas + clientes_360_view).
    pre_counts: dict[str, int | None] = {}
    for name, _ in stmts:
        pre_counts[name] = get_row_count(client, name)
    print("\n[deploy] Baselines pre-deploy:")
    for name in [s[0] for s in stmts]:
        print(f"  {name:40s} pre={pre_counts[name]}")

    # Ejecutar.
    for i, (name, ddl) in enumerate(stmts, 1):
        print(f"\n[{i}/{len(stmts)}] {name} ...")
        try:
            job = client.query(ddl, location=LOCATION)
            job.result()
            print("    OK")
        except Exception as e:
            print(f"    FAIL: {e}", file=sys.stderr)
            return 3

    # Post-deploy counts.
    print("\n[deploy] Verificacion COUNT antes/despues:")
    print(f"  {'view':<40s} {'pre':>10s} {'post':>10s} {'delta':>10s}")
    any_diff = False
    for name, _ in stmts:
        pre = pre_counts[name]
        post = get_row_count(client, name)
        delta = "-" if (pre is None or post is None) else str(post - pre)
        marker = ""
        if pre is not None and post is not None and post != pre:
            # Para vistas nuevas (v_visitas_full, v_clientes_360_dedup),
            # 'pre' es None -> no aplica; pero por safety compa igual.
            if name not in ("v_visitas_full", "v_clientes_360_dedup"):
                marker = " <-- MISMATCH"
                any_diff = True
        print(f"  {name:<40s} {str(pre):>10s} {str(post):>10s} {delta:>10s}{marker}")

    if any_diff:
        print(
            "\n[deploy] ATENCION: hay diferencias en COUNT vs pre-deploy. Revisar.",
            file=sys.stderr,
        )
        return 4

    print("\n[deploy] Todo OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
