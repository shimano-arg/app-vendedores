"""Genera exogenas.csv para el pipeline de forecasting (una fila por mes).

Uso:  python build_exogenas.py [carpeta_salida]
Deps: pandas, requests, openpyxl, pypdf (pypdf solo para meses nuevos del ICG).

Entrada: torneos.csv (junto al script; torneo_grande = 1 en los meses con incluir = 1)
Salidas: exogenas.csv, dolar_futuro_detalle.csv, resumen.json
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests

INICIO, FIN = "2022-01", "2027-12"
UA = {"User-Agent": "Mozilla/5.0"}
HOY = dt.date.today()

URL_BCRA = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/{id}"
URL_REM = ("https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/"
           "relevamiento-expectativas-mercado-historico.xlsx")
URL_CEM = "https://apicem.matbarofex.com.ar/api/v2/closing-prices"
URL_AMBITO = "https://mercados.ambito.com/dolarrava/{casa}/historico-general/{desde}/{hasta}"
URL_ARGDATOS = "https://api.argentinadatos.com/v1/cotizaciones/dolares/{casa}"
URL_YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/%5EMERV"
URL_ICG = "https://www.utdt.edu/ver_contenido.php?id_contenido=1439&id_item_menu=2970"

ID_A3500 = 5    # Tipo de cambio mayorista de referencia (Com. A3500)
ID_BADLAR = 7   # BADLAR bancos privados, TNA %

# Años con elección nacional. La regla "año electoral o 6 meses previos" se reduce
# al año calendario: todas las elecciones caen entre agosto y noviembre.
ANIOS_ELECTORALES = {2023, 2025, 2027}

# ICG UTDT ya verificado contra los informes mensuales (escala 0 a 5).
ICG_HIST: dict[str, float] = dict(zip(
    [str(p) for p in pd.period_range("2022-01", "2026-09", freq="M")],
    [1.54, 1.49, 1.51, 1.44, 1.30, 1.40, 1.12, 1.18, 1.23, 1.28, 1.19, 1.25,
     1.27, 1.17, 1.18, 1.07, 1.13, 1.12, 1.20, 1.27, 1.03, 1.22, 1.41, 2.86,
     2.61, 2.57, 2.56, 2.45, 2.51, 2.46, 2.37, 2.54, 2.16, 2.43, 2.66, 2.66,
     2.61, 2.56, 2.42, 2.33, 2.45, 2.34, 2.45, 2.12, 1.94, 2.10, 2.47, 2.46,
     2.40, 2.38, 2.30, 2.02, 1.99, 2.07, 1.94, 2.06, 1.94],
))
MESES_ES = {m: i + 1 for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"])}


def _get(url: str, reintentos: int = 3, **kw) -> requests.Response:
    """GET con reintentos; levanta error si no responde 200."""
    for i in range(reintentos):
        try:
            r = requests.get(url, headers=UA, timeout=60, **kw)
            if r.status_code == 200:
                return r
        except requests.RequestException:
            pass
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"No se pudo bajar {url}")


def serie_bcra(id_var: int) -> pd.Series:
    """Serie diaria de la API de estadísticas monetarias del BCRA (v4.0)."""
    r = _get(URL_BCRA.format(id=id_var),
             params={"desde": "2021-12-01", "hasta": HOY.isoformat(), "limit": 3000})
    det = r.json()["results"][0]["detalle"]
    return pd.Series({pd.Timestamp(d["fecha"]): d["valor"] for d in det}).sort_index()


def rem() -> pd.DataFrame:
    """REM por mes de PUBLICACIÓN: el relevamiento de fin de M-1 se publica en M."""
    raw = pd.read_excel(io.BytesIO(_get(URL_REM).content),
                        sheet_name="Base de Datos Completa", header=1)
    raw = raw.iloc[:, :5]
    raw.columns = ["fecha", "var", "ref", "per", "mediana"]
    raw["mes"] = (pd.to_datetime(raw["fecha"]).dt.to_period("M") + 1).astype(str)
    raw["per"] = raw["per"].astype(str)
    anio = raw["mes"].str[:4]

    ipc = raw[raw["var"].str.contains("IPC nivel general; INDEC", regex=False)
              & raw["ref"].str.startswith("var. % i.a.") & (raw["per"] == "Próx. 12 meses")]
    # PBI y TCN de diciembre: se toma el año calendario del mes de publicación
    pbi = raw[(raw["var"] == "PIB a precios constantes")
              & (raw["ref"] == "var. % prom. anual") & (raw["per"] == anio)]
    tcn = raw[(raw["var"] == "Tipo de cambio nominal")
              & raw["ref"].str.startswith("$/USD; dic-") & (raw["per"] == anio)]
    out = pd.DataFrame({
        "rem_ipc_12m": ipc.set_index("mes")["mediana"],
        "rem_pbi_yoy": pbi.set_index("mes")["mediana"],
        "rem_tcn_dic": tcn.set_index("mes")["mediana"],
    }).astype(float)
    return out


def futuros_12m(meses: list[str]) -> pd.DataFrame:
    """Settlement DLR del último día hábil con datos de cada mes, llevado a 12 meses.

    Si existe el contrato M+12 se usa directo; si no, se extrapola linealmente
    con los dos contratos más largos listados (pendiente del último tramo).
    """
    filas = []
    for mes in meses:
        p = pd.Period(mes, freq="M")
        r = _get(URL_CEM, params={
            "product": "DLR", "segment": "Monedas", "type": "FUT", "excludeEmptyVol": "false",
            "from": f"{mes}-{max(p.days_in_month - 9, 1):02d}", "to": f"{mes}-{p.days_in_month:02d}",
            "page": 1, "pageSize": 500})
        d = pd.DataFrame(r.json()["data"])
        if d.empty:
            continue
        d = d[d["symbol"].str.fullmatch(r"DLR\d{6}")].copy()
        d["fecha"] = pd.to_datetime(d["dateTime"].str[:10])
        d = d[d["fecha"] == d["fecha"].max()]
        d["k"] = (d["symbol"].str[5:9].astype(int) - p.year) * 12 + d["symbol"].str[3:5].astype(int) - p.month
        d = d.set_index("k").sort_index()
        kmax = int(d.index.max())
        if 12 in d.index:
            f12, metodo = float(d.loc[12, "settlement"]), "contrato M+12"
        else:
            f_a, f_b = float(d.loc[kmax - 1, "settlement"]), float(d.loc[kmax, "settlement"])
            f12 = f_b + (12 - kmax) * (f_b - f_a)
            metodo = f"extrapolado desde M+{kmax - 1} y M+{kmax}"
        ref = d.loc[min(kmax, 12)]
        filas.append({"mes": mes, "fecha_settlement": d["fecha"].iloc[0].date().isoformat(),
                      "contrato_mas_largo": d.loc[kmax, "symbol"],
                      "settlement_mas_largo": float(d.loc[kmax, "settlement"]),
                      "volumen": float(ref["volume"]), "interes_abierto": float(ref["openInterest"]),
                      "metodo": metodo, "dolar_futuro_12m": round(f12, 2)})
    return pd.DataFrame(filas).set_index("mes")


def ambito(casa: str) -> tuple[pd.Series, list[pd.Timestamp]]:
    """Serie diaria 'Referencia' de Ámbito/Rava (casa: mep o cl) y días completados con respaldo."""
    filas: list[list[str]] = []

    def tramo(a: dt.date, b: dt.date) -> None:
        try:
            d = requests.get(URL_AMBITO.format(casa=casa, desde=a, hasta=b), headers=UA, timeout=60).json()
        except (requests.RequestException, ValueError):
            d = None
        if isinstance(d, list):
            filas.extend(d[1:])
        elif a < b:  # el endpoint falla con algunos rangos: se bisecta
            medio = a + (b - a) // 2
            tramo(a, medio)
            tramo(medio + dt.timedelta(days=1), b)

    for anio in range(2021, HOY.year + 1):
        tramo(dt.date(anio, 1, 1), dt.date(anio, 12, 31))
    s = pd.Series({pd.to_datetime(f, format="%d/%m/%Y"): float(v.replace(".", "").replace(",", "."))
                   for f, v in filas}).sort_index()
    # Respaldo: los días que Ámbito no devuelve se completan con ArgentinaDatos (venta)
    alt = pd.DataFrame(_get(URL_ARGDATOS.format(casa={"mep": "bolsa", "cl": "contadoconliqui"}[casa])).json())
    alt = alt.set_index(pd.to_datetime(alt["fecha"]))["venta"].loc["2021-12-01":]
    return s.combine_first(alt).sort_index(), sorted(set(alt.index) - set(s.index))


def merval() -> pd.Series:
    """Cierre diario del índice Merval en pesos (Yahoo Finance, ^MERV)."""
    r = _get(URL_YAHOO, params={"period1": 1638316800, "period2": int(time.time()), "interval": "1d"})
    res = r.json()["chart"]["result"][0]
    idx = (pd.to_datetime(res["timestamp"], unit="s").tz_localize("UTC")
           .tz_convert("America/Argentina/Buenos_Aires").normalize().tz_localize(None))
    return pd.Series(res["indicators"]["quote"][0]["close"], index=idx).dropna()


def icg() -> pd.Series:
    """ICG UTDT: valores históricos verificados + meses nuevos leídos de los PDF."""
    vals = dict(ICG_HIST)
    try:
        html = _get(URL_ICG).content.decode("latin-1")
        ids = list(dict.fromkeys(re.findall(r"download\.php\?fname=(_\d+)\.pdf", html)))
        from pypdf import PdfReader
        for fid in ids[:6]:  # los más recientes aparecen primero
            pdf = _get(f"https://www.utdt.edu/download.php?fname={fid}.pdf").content
            txt = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
            m_val = re.search(r"ICG:\s*(\d)\s*[,.]\s*(\d+)", txt)  # pypdf a veces parte "1 ,94"
            m_mes = re.search(r"(" + "|".join(MESES_ES) + r")\s+(?:de\s+)?(20\d\d)", txt, re.I)
            if not (m_val and m_mes):
                continue
            mes = f"{m_mes.group(2)}-{MESES_ES[m_mes.group(1).lower()]:02d}"
            if mes in vals:
                break
            vals[mes] = float(f"{m_val.group(1)}.{m_val.group(2)}")
    except Exception as e:  # el ICG es opcional: no frena el pipeline
        print(f"AVISO: no se pudo actualizar ICG ({e})")
    return pd.Series(vals).sort_index()


def main(salida: Path) -> None:
    meses = [str(p) for p in pd.period_range(INICIO, FIN, freq="M")]
    mes_actual = f"{HOY:%Y-%m}"
    historicos = [m for m in meses if m <= mes_actual]
    df = pd.DataFrame(index=pd.Index(meses, name="mes"))

    # Promedios mensuales: promedio simple de los valores diarios en días hábiles
    a3500, badlar = serie_bcra(ID_A3500), serie_bcra(ID_BADLAR)
    habiles = a3500.index
    por_mes = lambda s: s.groupby(s.index.to_period("M").astype(str)).mean()  # noqa: E731
    df["dolar_oficial_prom"] = por_mes(a3500)
    df["tasa_bcra_tna"] = por_mes(badlar)
    (mep, mep_resp), (ccl, _) = ambito("mep"), ambito("cl")
    mep_h = mep[mep.index.isin(habiles)]
    df["dolar_mep_prom"] = por_mes(mep_h)

    r = rem()
    df = df.join(r)
    fut = futuros_12m(historicos)
    df["dolar_futuro_12m"] = fut["dolar_futuro_12m"]

    # Merval en USD: último cierre del mes dividido por el CCL del mismo día
    mv = merval()
    mv_usd = (mv / ccl.reindex(mv.index).ffill()).dropna()
    df["merval_arg"] = mv_usd.groupby(mv_usd.index.to_period("M").astype(str)).last()
    df["confianza_gob"] = icg()

    # Columnas conocidas a futuro: se arrastra el último dato disponible
    for col in ["rem_ipc_12m", "dolar_futuro_12m"]:
        df[col] = df[col].ffill()
    futuros_idx = df.index > mes_actual
    for col in ["rem_pbi_yoy", "rem_tcn_dic", "dolar_oficial_prom", "dolar_mep_prom",
                "tasa_bcra_tna", "confianza_gob", "merval_arg"]:
        df.loc[futuros_idx, col] = float("nan")

    df["es_electoral"] = [int(int(m[:4]) in ANIOS_ELECTORALES) for m in df.index]
    ruta_torneos = Path(__file__).with_name("torneos.csv")
    if ruta_torneos.exists():
        t = pd.read_csv(ruta_torneos, dtype={"mes": str})
        meses_torneo = set(t.loc[t["incluir"] == 1, "mes"])
    else:  # sin calendario: columna en 0, como pide la especificación
        print("AVISO: falta torneos.csv, torneo_grande queda en 0")
        meses_torneo = set()
    df["torneo_grande"] = [int(m in meses_torneo) for m in df.index]

    cols = ["rem_ipc_12m", "dolar_futuro_12m", "dolar_oficial_prom", "dolar_mep_prom",
            "tasa_bcra_tna", "es_electoral", "torneo_grande",
            "rem_pbi_yoy", "rem_tcn_dic", "confianza_gob", "merval_arg"]
    df = df[cols].round(2)
    assert len(df) == 72 and df.index.is_monotonic_increasing and df.index.is_unique

    salida.mkdir(parents=True, exist_ok=True)
    df.to_csv(salida / "exogenas.csv", encoding="utf-8", lineterminator="\n")
    fut.to_csv(salida / "dolar_futuro_detalle.csv", encoding="utf-8", lineterminator="\n")

    resumen = {
        "generado": HOY.isoformat(),
        "mes_en_curso_provisorio": mes_actual if mes_actual in df.index else None,
        "ultimo_dia_a3500": habiles.max().date().isoformat(),
        "gaps_historicos": {c: [m for m in historicos if pd.isna(df.loc[m, c])] for c in cols},
        "futuros_por_metodo": fut["metodo"].value_counts().to_dict(),
        "futuros_sin_volumen": fut.index[fut["volumen"] == 0].tolist(),
        "dias_habiles_mep_desde_respaldo": [d.date().isoformat() for d in mep_resp
                                            if d in habiles and d >= pd.Timestamp(INICIO)],
    }
    (salida / "resumen.json").write_text(json.dumps(resumen, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(resumen, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("."))
