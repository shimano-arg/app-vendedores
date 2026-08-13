"""
Construye 2 tablas BQ para pintar mapa por DEPARTAMENTO en Power BI:
  - geo_departamentos_ref             (525 rows, vocabulario destino)
  - geo_localidad_departamento        (~4000 rows, join localidad->depto)

Fuentes:
  - TopoJSON local `Argentina Departamentos (sin Antartida).json` (Desktop):
    los 525 poligonos que pinta PBI. De aca sacamos el vocabulario
    autoritativo (departamento, cabecera, provincia, prov_depto) que
    prov_depto de v_leads_detalle DEBE matchear.
  - API Georef del Estado Argentino (datos.gob.ar):
    https://apis.datos.gob.ar/georef/api/localidades?campos=nombre,departamento,provincia&max=5000
    Gazetteer de localidades con su departamento oficial.

Que hace:
  1. Baja Georef -> 4037 localidades con {provincia, departamento, localidad}.
  2. Lee TopoJSON local -> 525 (provincia, departamento) validos.
  3. Normaliza strings (UPPER + strip accents) en ambos lados.
  4. Cross-check: cuantas localidades matchean un departamento valido del
     TopoJSON (misma provincia). Reporta.
  5. Sube geo_departamentos_ref (525) + geo_localidad_departamento (4037)
     a BQ como tablas.

Uso:
  python scripts/build_geo_localidad_departamento.py

Requiere: google-cloud-bigquery, pandas, requests. Usa ADC.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd
import requests
from google.cloud import bigquery

PROJECT = "app-vendedores-shimano"
DATASET = "shimano_app"
TABLE_DEPTOS = "geo_departamentos_ref"
TABLE_LOC = "geo_localidad_departamento"

TOPO_PATH = Path(r"C:\Users\shimano.sandbox\Desktop\Argentina Departamentos (sin Antartida).json")
GEOREF_URL = (
    "https://apis.datos.gob.ar/georef/api/localidades"
    "?campos=nombre,departamento,provincia&max=5000"
)


def strip_accents(s: str) -> str:
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def norm_str(s: str) -> str:
    """UPPER + sin acentos + colapsa espacios."""
    if not s:
        return ""
    return re.sub(r"\s+", " ", strip_accents(str(s)).upper().strip())


# Alias manuales departamento_norm -> departamento canonico del TopoJSON.
# Necesarios cuando Georef y TopoJSON usan nombres distintos para el mismo
# departamento. Se aplica DESPUES de la normalizacion + reemplazos.
DEPTO_ALIASES = {
    # (provincia_norm, depto_norm_georef) -> depto_norm_topo
    ("LA RIOJA", "GENERAL FELIPE VARELA"): "CORONEL FELIPE VARELA",
    ("LA RIOJA", "GENERAL ORTIZ DE OCAMPO"): "GENERAL OCAMPO",
    ("SANTIAGO DEL ESTERO", "JUAN FELIPE IBARRA"): "JUAN F IBARRA",
    # Rio Negro: Georef usa "AVELLANEDA" -> TopoJSON idem (no hace falta)
}


def norm_depto(prov_norm: str, depto_raw: str) -> str:
    """Normaliza depto: strip accents + upper + expand DR/GRAL + drop dots.
    Luego aplica alias manual (provincia, depto) si esta en DEPTO_ALIASES.
    """
    n = norm_str(depto_raw)
    # Puntos de abreviaturas: "LEANDRO N. ALEM" / "JOSE C. PAZ" -> sin puntos.
    n = n.replace(".", " ")
    n = re.sub(r"\s+", " ", n).strip()
    # Expansion de abreviaturas comunes.
    n = re.sub(r"\bDR\b", "DOCTOR", n)
    n = re.sub(r"\bGRAL\b", "GENERAL", n)
    n = re.sub(r"\bCNEL\b", "CORONEL", n)
    return DEPTO_ALIASES.get((prov_norm, n), n)


# Mapeo de provincias:
#   - v_leads_detalle canoniza CIUDAD AUTONOMA ... -> CABA.
#   - Georef trae "Tierra del Fuego, Antartida e Islas del Atlantico Sur";
#     TopoJSON usa solo "TIERRA DEL FUEGO". Alineamos ambos a TIERRA DEL FUEGO
#     y luego v_leads_detalle canoniza si hace falta.
PROV_CANONIZE = {
    "CIUDAD AUTONOMA DE BUENOS AIRES": "CABA",
    "TIERRA DEL FUEGO, ANTARTIDA E ISLAS DEL ATLANTICO SUR": "TIERRA DEL FUEGO",
}


def norm_prov_leads(prov_raw: str) -> str:
    """Aplica la misma canonizacion que v_leads_detalle -> matchea con la vista."""
    n = norm_str(prov_raw)
    return PROV_CANONIZE.get(n, n)


def norm_prov_topo(prov_raw: str) -> str:
    """Igual que norm_prov_leads pero el TopoJSON usa CIUDAD AUTONOMA...
    Alineamos al mismo mapping (CABA) para que joinee con v_leads_detalle."""
    return norm_prov_leads(prov_raw)


# ============================================================
# Extension del mapping localidad->depto: expandir aliases + generar filas
# extra para variantes que la app usa (typos frecuentes, sufijos barrio).
# Se agregan a geo_localidad_departamento como filas extra que apuntan a la
# localidad canonica.
# ============================================================
# (provincia_norm, localidad_variante_norm) -> localidad_canonica_georef_norm
LOCALIDAD_ALIASES = {
    ("SANTA FE", "SANTA FE DE LA VERA CRUZ"): "SANTA FE",
    ("SANTA FE", "ROSARIO SUD"): "ROSARIO",
    ("SANTA FE", "ROSARIO NORTE"): "ROSARIO",
    ("BUENOS AIRES", "MAR DEL PLATA NORTE"): "MAR DEL PLATA",
    ("BUENOS AIRES", "MAR DEL PLATA SUR"): "MAR DEL PLATA",
    ("BUENOS AIRES", "GRAL RODRIGUEZ"): "GENERAL RODRIGUEZ",
    ("BUENOS AIRES", "GRAL SAN MARTIN"): "GENERAL SAN MARTIN",
    ("BUENOS AIRES", "GRAL PACHECO"): "GENERAL PACHECO",
    ("RIO NEGRO", "GRAL ROCA"): "GENERAL ROCA",
    ("CHACO", "SAENZ PENA"): "PRESIDENCIA ROQUE SAENZ PENA",
    ("JUJUY", "JUJUY"): "SAN SALVADOR DE JUJUY",
    ("CORDOBA", "BARRIO CENTRO NORTE"): "CORDOBA",
    # HAEDO esta en Buenos Aires (partido MORON), no CABA - fix provincia mal cargada.
    # Este caso NO lo cubrimos con alias (requiere cambiar la provincia); lo dejamos NULL.
}


def norm_localidad(prov_norm: str, loc_raw: str) -> str:
    """Normaliza localidad: upper + sin acentos + expandir GRAL/GRAL. + drop puntos.
    Luego aplica alias manual si esta en LOCALIDAD_ALIASES."""
    n = norm_str(loc_raw)
    n = n.replace(".", " ")
    n = re.sub(r"\s+", " ", n).strip()
    n = re.sub(r"\bGRAL\b", "GENERAL", n)
    n = re.sub(r"\bCNEL\b", "CORONEL", n)
    return LOCALIDAD_ALIASES.get((prov_norm, n), n)


def load_topo_departamentos() -> pd.DataFrame:
    print(f"[topo] cargando {TOPO_PATH.name}...")
    topo = json.loads(TOPO_PATH.read_text(encoding="utf-8"))
    geoms = topo["objects"]["departamentos"]["geometries"]
    rows = []
    for g in geoms:
        p = g.get("properties") or {}
        prov_n = norm_prov_topo(p["provincia"])
        depto_n = norm_depto(prov_n, p["departamento"])
        rows.append(
            {
                "provincia": p["provincia"],
                "departamento": p["departamento"],
                "cabecera": p.get("cabecera", ""),
                "prov_depto": p["prov_depto"],
                "topo_id": p.get("id"),
                # Provincia + depto normalizados para el JOIN.
                "provincia_norm": prov_n,
                "departamento_norm": depto_n,
            }
        )
    df = pd.DataFrame(rows)
    print(f"[topo] {len(df)} departamentos, {df['provincia'].nunique()} provincias")
    return df


def load_georef_localidades() -> pd.DataFrame:
    print(f"[georef] bajando {GEOREF_URL}...")
    r = requests.get(GEOREF_URL, timeout=60)
    r.raise_for_status()
    data = r.json()
    locs = data.get("localidades", [])
    print(f"[georef] {len(locs)} localidades traidas")
    rows = []
    for loc in locs:
        prov = (loc.get("provincia") or {}).get("nombre", "")
        depto = (loc.get("departamento") or {}).get("nombre", "")
        nom = loc.get("nombre", "")
        prov_n = norm_prov_leads(prov)
        depto_n = norm_depto(prov_n, depto)
        rows.append(
            {
                "provincia_original": prov,
                "departamento_original": depto,
                "localidad_original": nom,
                "provincia_norm": prov_n,
                "departamento_norm": depto_n,
                "localidad_norm": norm_localidad(prov_n, nom),
            }
        )
    df = pd.DataFrame(rows)
    print(f"[georef] normalizado. Provincias: {df['provincia_norm'].nunique()}")
    return df


def build_localidad_dept_table(
    georef: pd.DataFrame, deptos_topo: pd.DataFrame
) -> pd.DataFrame:
    """Cruza georef con topo para obtener el prov_depto oficial por localidad."""
    print("[merge] cruzando georef con vocabulario TopoJSON...")
    merged = georef.merge(
        deptos_topo[["provincia_norm", "departamento_norm", "provincia", "departamento", "prov_depto"]],
        how="left",
        on=["provincia_norm", "departamento_norm"],
        suffixes=("_georef", "_topo"),
    )
    total = len(merged)
    matched = merged["prov_depto"].notna().sum()
    print(f"[merge] localidades con depto matcheado en TopoJSON: {matched}/{total} ({100*matched/total:.1f}%)")
    unmatched = merged[merged["prov_depto"].isna()]
    if len(unmatched):
        print(f"[merge] top 10 (provincia_norm, departamento_norm) sin match:")
        for (p, d), n in unmatched.groupby(
            ["provincia_norm", "departamento_norm"]
        ).size().sort_values(ascending=False).head(10).items():
            print(f"    {p:<30} | {d:<30} -> {n} loc")

    # Deduplicar por (provincia_norm, localidad_norm) - a veces Georef trae
    # la misma localidad en 2 departamentos (barrios o proximas al limite).
    # Nos quedamos con la primera aparicion (ordenar por prov + loc + depto).
    merged = merged.sort_values(
        ["provincia_norm", "localidad_norm", "departamento_norm"]
    ).drop_duplicates(subset=["provincia_norm", "localidad_norm"], keep="first")
    print(f"[merge] dedup por (prov,loc): {len(merged)} rows base")

    # Insertar filas EXTRA por cada alias: la variante norm que la app usa
    # apunta al mismo prov_depto que la localidad canonica de Georef.
    extra_rows = []
    for (prov_n, variant_norm), canonical_norm in LOCALIDAD_ALIASES.items():
        # Buscar el prov_depto de la canonica en la tabla base.
        canonical_row = merged[
            (merged["provincia_norm"] == prov_n)
            & (merged["localidad_norm"] == norm_str(canonical_norm))
        ]
        if canonical_row.empty:
            # La canonica misma no matchea? Skip con warning.
            print(f"[alias WARN] canonica no encontrada para {prov_n}|{variant_norm}->{canonical_norm}")
            continue
        base = canonical_row.iloc[0]
        extra_rows.append(
            {
                "provincia_norm": prov_n,
                "localidad_norm": variant_norm,  # ya viene norm por LOCALIDAD_ALIASES key
                "provincia_original": base["provincia_original"],
                "localidad_original": f"(alias) {variant_norm}",
                "departamento_original": base["departamento_original"],
                "provincia": base["provincia"],
                "departamento": base["departamento"],
                "prov_depto": base["prov_depto"],
            }
        )
    if extra_rows:
        extra = pd.DataFrame(extra_rows)
        merged = pd.concat([merged, extra], ignore_index=True).drop_duplicates(
            subset=["provincia_norm", "localidad_norm"], keep="first"
        )
        print(f"[alias] agregadas {len(extra_rows)} filas alias -> total {len(merged)}")

    out = merged[
        [
            "provincia_norm",
            "localidad_norm",
            "provincia_original",
            "localidad_original",
            "departamento_original",
            # Del TopoJSON (validado):
            "provincia",
            "departamento",
            "prov_depto",
        ]
    ].rename(
        columns={
            "provincia": "provincia_topo",
            "departamento": "departamento_topo",
        }
    )
    return out


def upload_df(client: bigquery.Client, df: pd.DataFrame, table: str) -> None:
    table_id = f"{PROJECT}.{DATASET}.{table}"
    print(f"[bq] subiendo {len(df)} rows a {table_id}...")
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_TRUNCATE",
        autodetect=True,
    )
    job = client.load_table_from_dataframe(df, table_id, job_config=job_config)
    job.result()
    print(f"[bq] OK {table_id}")


def main() -> None:
    if not TOPO_PATH.exists():
        print(f"::error::no encuentro {TOPO_PATH}", file=sys.stderr)
        sys.exit(1)
    client = bigquery.Client(project=PROJECT)
    deptos = load_topo_departamentos()
    georef = load_georef_localidades()
    loc_dept = build_localidad_dept_table(georef, deptos)

    # Tabla 1: geo_departamentos_ref (525 rows).
    upload_df(client, deptos, TABLE_DEPTOS)
    # Tabla 2: geo_localidad_departamento (~4000 rows).
    upload_df(client, loc_dept, TABLE_LOC)

    print("\n[done] tablas listas. Siguiente paso: correr")
    print("       python scripts/deploy_leads_detalle_view.py")
    print("para redeployar v_leads_detalle con las columnas departamento + prov_depto.")


if __name__ == "__main__":
    main()
