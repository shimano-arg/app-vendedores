# Reporte exogenas.csv (versión inicial, generado el 30/09/2026)

## Veredicto

El CSV está completo y listo para el pipeline: 72 filas (2022-01 a 2027-12), las 8 columnas obligatorias más las 4 opcionales, sin gaps en el histórico. Tres cosas a tener presentes antes de usarlo:

1. `dolar_futuro_12m` es casi siempre una extrapolación, no un precio observado (detalle abajo).
2. La fila 2026-09 es provisoria: tiene datos hasta el 29/09.
3. `torneo_grande` la armé yo con tres eventos porque no existe un calendario oficial. Revisala.

## Completitud

| Columna | Histórico (2022-01 a 2026-09) | Futuro (2026-10 a 2027-12) |
|:---:|:---:|:---:|
| mes | 57 de 57 | 15 de 15 |
| rem_ipc_12m | 57 de 57 | arrastre del último dato (21.0) |
| dolar_futuro_12m | 57 de 57 | arrastre del último dato (1902.0) |
| dolar_oficial_prom | 57 de 57 | vacío |
| dolar_mep_prom | 57 de 57 | vacío |
| tasa_bcra_tna | 57 de 57 | vacío |
| es_electoral | 57 de 57 | calendario |
| torneo_grande | 57 de 57 | calendario (agosto 2027 es supuesto) |
| rem_pbi_yoy (opcional) | 57 de 57 | vacío |
| rem_tcn_dic (opcional) | 57 de 57 | vacío |
| confianza_gob (opcional) | 57 de 57 | vacío |
| merval_arg (opcional) | 57 de 57 | vacío |

Gaps: ninguno en el histórico. Las cuatro opcionales quedaron incluidas.

## Definiciones aplicadas

| Columna | Definición |
|:---:|:---:|
| rem_ipc_12m | Mediana REM, IPC nivel general, próximos 12 meses. Mes M = relevamiento de fin de M-1, publicado en los primeros días de M |
| dolar_futuro_12m | Settlement DLR del último día hábil con rueda, llevado a 12 meses |
| dolar_oficial_prom | Com. A3500, promedio simple de días hábiles |
| dolar_mep_prom | MEP referencia Ámbito/Rava, promedio simple sobre los mismos días hábiles que el A3500 |
| tasa_bcra_tna | BADLAR bancos privados, TNA, promedio simple de días hábiles |
| es_electoral | 1 en 2023, 2025 y 2027 completos |
| torneo_grande | 1 en el mes del día de pesca de Surubí (Goya), Dorado (Paso de la Patria) y 24 Horas de la Corvina Negra (Claromecó) |
| rem_pbi_yoy | Mediana REM, PIB var. % promedio anual del año calendario del mes |
| rem_tcn_dic | Mediana REM, tipo de cambio nominal de diciembre del año calendario del mes |
| confianza_gob | ICG UTDT del mes (escala 0 a 5) |
| merval_arg | Último cierre del Merval del mes dividido por el CCL del mismo día |

## Fuentes (todas descargadas el 30/09/2026)

| Columna | Fuente |
|:---:|:---:|
| rem_ipc_12m, rem_pbi_yoy, rem_tcn_dic | https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-historico.xlsx (hoja Base de Datos Completa) |
| dolar_futuro_12m | https://apicem.matbarofex.com.ar/api/v2/closing-prices (CEM Matba Rofex, producto DLR) |
| dolar_oficial_prom | https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/5 |
| tasa_bcra_tna | https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/7 |
| dolar_mep_prom | https://mercados.ambito.com/dolarrava/mep/historico-general/{desde}/{hasta}, respaldo https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa |
| confianza_gob | https://www.utdt.edu/ver_contenido.php?id_contenido=1439&id_item_menu=2970 (informes mensuales en PDF) |
| merval_arg | https://query1.finance.yahoo.com/v8/finance/chart/%5EMERV y https://mercados.ambito.com/dolarrava/cl/historico-general/{desde}/{hasta} |
| es_electoral | https://www.lanacion.com.ar/politica/elecciones-en-la-argentina-2027-fechas-cargos-que-se-renuevan-y-todo-lo-que-hay-que-saber-nid23092026/ |
| torneo_grande | Una fuente por evento y año en torneos.csv |

## Warnings

### dolar_futuro_12m

- El contrato M+12 no existe al cierre del mes M: Rofex lista 12 posiciones contando la que vence ese día, así que la más larga es M+11. Tu nota 3 no se puede aplicar literal.
- Lo que hice: extrapolación lineal con los dos contratos más largos. 54 meses desde M+10 y M+11, 2 meses desde M+9 y M+10 (2023-11 y 2024-03, curva más corta), 1 mes con contrato M+12 real (2025-01).
- En 18 de 57 meses el contrato más largo no tuvo volumen ese día, o sea que el settlement lo fijó el mercado y no una operación. Están listados en dolar_futuro_detalle.csv.
- Settlements corridos por feriado: 2022-02 (25/02, carnaval), 2024-03 (27/03, Semana Santa), 2024-12 y 2025-12 (30/12).

### Fila 2026-09 provisoria

- Promedios con 21 de 22 días hábiles. Futuro y Merval con cierre del 29/09. Se corrige sola en la corrida de octubre.
- Ojo: el arrastre a futuro de `dolar_futuro_12m` (1902.0) sale de ese dato provisorio.

### Arrastre a futuro

- `rem_ipc_12m` y `dolar_futuro_12m` quedan constantes durante 15 meses, como pediste. Una constante no le aporta información al modelo en el horizonte de pronóstico. Alternativa mejor: usar la trayectoria mensual del propio REM y la curva de futuros por posición.

### tasa_bcra_tna

- Elegí BADLAR porque es la única continua en todo el rango. La Leliq terminó en diciembre 2023, los pases pasivos en julio 2024 y la tasa de política monetaria dejó de publicarse el 10/07/2025.

### REM

- `rem_pbi_yoy` y `rem_tcn_dic` saltan cada enero por construcción, porque cambia el año objetivo.
- Validación: `rem_ipc_12m` coincide con la variable 29 de la API del BCRA en los 57 meses (diferencia máxima 0.05 por redondeo).

### dolar_oficial_prom y dolar_mep_prom

- Diciembre 2023 promedia días a 366 y días a 800 (devaluación del 13/12): 641.99.
- Ámbito no devuelve 7 días hábiles de 2025 (02/07, 25/07, 06/08, 12/08, 13/08, 14/08 y 01/10). Los completé con ArgentinaDatos. Entre ambas fuentes la diferencia mensual nunca supera 0.6%.

### es_electoral

- La cláusula de los 6 meses previos no agrega nada: todas las elecciones caen entre agosto y noviembre, así que la dummy es igual a "año impar".
- 2027: generales el 24/10. Las PASO del 08/08 siguen vigentes pero el oficialismo busca eliminarlas. No cambia la dummy.

### torneo_grande

- No hay calendario oficial consolidado (ni CAPYL ni las federaciones publican uno). Lo armé evento por evento con fuente verificada a nivel mes.
- Qué es "grande" es criterio mío: los tres de convocatoria nacional. En torneos.csv hay 26 ediciones más (Pacú, Corvina de Río, Reconquista, Cerrito, Ituzaingó, Almafuerte) con incluir = 0. Se prenden cambiando ese valor.
- Febrero y mayo 2027 están anunciados. Agosto 2027 es supuesto (el Dorado fue en agosto 5 de 5 años).
- La dummy es casi una estacionalidad fija (febrero, mayo, agosto). Solo 2023 rompe el patrón (Surubí en abril). Si el modelo ya tiene estacionalidad mensual, esta columna va a aportar poco.

### Niveles nominales

- `dolar_oficial_prom`, `dolar_mep_prom`, `dolar_futuro_12m`, `rem_tcn_dic` y `merval_arg` comparten tendencia y van a salir colineales. Sugerencia: derivar brecha (MEP / oficial - 1) y devaluación implícita (futuro / oficial - 1) en el pipeline y usar esas en lugar de los niveles.

## Actualización mensual

`python build_exogenas.py [carpeta]` regenera todo desde las fuentes (unos 5 minutos). Necesita pandas, requests, openpyxl y pypdf, y torneos.csv al lado del script.
