-- =============================================================================
-- visitas_match.sql — Vinculo tienda (v_visitas) <-> card_code (v_leads_detalle)
-- =============================================================================
-- Contexto (Mariano pedido 2026-09-01): las visitas se cargan con nombre libre
-- de tienda ("Beto Maxera"), pero en SAP el cliente es "Beto Maxera pesca".
-- El match textual actual falla por sufijos de rubro, acentos, mayúsculas,
-- orden de palabras, etc. Este archivo resuelve el bind en el backend BQ,
-- sin tocar los formularios de la app.
--
-- Approach: 4 niveles cascada, deterministic-first, mayor confianza primero.
--
-- ARQUITECTURA:
--
--   sap_bp_raw + client_apps -->  v_leads_detalle
--   visits_raw_raw_latest    -->  v_visitas
--
--   Normalizacion (CTE compartido)
--     ↓
--   3 niveles de match:
--     Level 0 — override manual (map_tienda_cliente_manual)     score=1.00
--     Level 1 — nombre normalizado exacto                        score=1.00
--     Level 2 — contencion (len>=6, un nombre dentro del otro)   score=0.85
--     Level 3 — Jaccard token-set >= 0.60                        score=jaccard
--     Desempate por provincia+localidad boost +0.10
--
--   Resultado principal: v_visitas_clientes_match (1 fila por visita)
--   Enriquecida:         v_visitas_enriquecida (v_visitas + card_code)
--   Debugging:           v_visitas_sin_match (visitas sin card_code)
--
-- REGLAS DE NEGOCIO (Mariano):
-- - Match a nivel CLIENTE (card_code), no de vendedor. Una visita VDE puede
--   vincular a cliente asignado a otro vendedor.
-- - Idempotente: mismo input -> mismo output. Nada de random.
-- - No romper v_visitas existente (creamos v_visitas_enriquecida aparte).
--
-- ORDEN DE DEPLOY (importante):
--   1. map_tienda_cliente_manual (CREATE TABLE IF NOT EXISTS)
--   2. v_visitas_clientes_match
--   3. v_visitas_enriquecida
--   4. v_visitas_sin_match
-- =============================================================================


-- =============================================================================
-- TABLA: map_tienda_cliente_manual
-- =============================================================================
-- Tabla persistente para overrides manuales. Cuando el algoritmo automatico no
-- puede resolver un tienda -> card_code, cargar aca una fila.
--
-- IMPORTANTE:
-- - `tienda_normalizada` DEBE estar pre-normalizada con la misma logica que la
--   CTE de v_visitas_clientes_match (ver README abajo). El match es por texto
--   exacto entre esta columna y la version normalizada de v_visitas.tienda.
-- - La columna `card_code` debe existir en v_leads_detalle. Si no existe (typo,
--   cliente borrado), el enrich sale sin match — pero no rompe la vista.
-- - Se recomienda incluir nota humana con motivo del override + fecha.
--
-- CREATE TABLE IF NOT EXISTS: NO destroys existing data. Safe re-deploy.
-- =============================================================================
CREATE TABLE IF NOT EXISTS `app-vendedores-shimano.shimano_app.map_tienda_cliente_manual` (
  tienda_normalizada  STRING  NOT NULL,
  card_code           STRING  NOT NULL,
  nota                STRING,
  created_at          TIMESTAMP  DEFAULT CURRENT_TIMESTAMP(),
  created_by          STRING
)
OPTIONS(description="Overrides manuales tienda->cliente para casos que el algoritmo automatico de v_visitas_clientes_match no puede resolver. Ver visitas_match.sql para reglas de carga.");


-- =============================================================================
-- VISTA: v_visitas_clientes_match
-- =============================================================================
-- Devuelve 1 fila por visita con el mejor match a un card_code.
--
-- Columnas output:
--   visita_id, card_code, card_name, tienda, match_type
--   ('override'|'exacto'|'contenido'|'fuzzy'|'sin_match'),
--   score (0.00 a 1.00), ambiguo (BOOL — TRUE si hubo >1 candidato con score
--   >= mejor_score - 0.05)
--
-- Estrategia:
--   1. CTE `normalized_clients` — clientes + nombre normalizado + tokens
--   2. CTE `normalized_visits`  — visitas + nombre normalizado + tokens
--   3. CTE `overrides_join` — resuelve overrides por tienda_normalizada
--   4. CTE `level1_exact` — join por nombre normalizado exacto
--   5. CTE `level2_contain` — join por contenencia (con guarda len>=6)
--   6. CTE `level3_jaccard` — cross join filtrado por Jaccard >= 0.60
--   7. CTE `all_candidates` — UNION de todos los niveles con score
--   8. CTE `ranked` — ROW_NUMBER por visita ORDER BY score DESC, override first
--   9. Final: JOIN visitas <- mejor candidato + ambiguo flag
--
-- Score:
--   override       -> 1.00
--   exacto         -> 1.00
--   contenido      -> 0.85 + 0.10 boost (provincia+localidad match)
--   fuzzy jaccard  -> jaccard_score + 0.05 boost (provincia+localidad match)
--
-- Normalizacion (aplicada tanto a card_name como a tienda):
--   - LOWER + NFD (descompone acentos)
--   - REGEXP_REPLACE r'\p{M}' → quita marcas diacriticas
--   - REGEXP_REPLACE r'[^a-z0-9 ]' → quita puntuacion
--   - REGEXP_REPLACE stopwords rubro → quita PESCA, CAMPING, etc.
--   - REGEXP_REPLACE r'\s+' → colapsa espacios
--   - TRIM + UPPER (final)
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas_clientes_match` AS
WITH
-- Helper: normalizacion escrita inline en cada CTE (BQ no soporta SQL UDF
-- persistente sin CREATE FUNCTION separado). Duplicacion aceptable por
-- consistencia + performance (menos hops de subquery).

-- Stopwords de rubro que se remueven ANTES de tokenizar. La regex es case-
-- insensitive porque el pipeline ya paso por LOWER. Los espacios flanqueantes
-- (r'\bXXX\b' equivalente en BQ RE2 es palabras completas con boundaries) se
-- manejan con lookaround simulado via replace de patron ' XXX ' con ' '.
normalized_clients AS (
  SELECT
    ld.card_code,
    ld.card_name,
    UPPER(ld.provincia) AS provincia,
    UPPER(ld.localidad) AS localidad,
    -- Pipeline de normalizacion
    UPPER(
      TRIM(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(NORMALIZE(LOWER(COALESCE(ld.card_name, '')), NFD), r'\p{M}', ''),
                r'[^a-z0-9 ]', ' '
              ),
              -- stopwords rubro (con espacios flanqueantes para full-word)
              r' (pesca|camping|outdoor|fishing|shop|bait|store|tienda|articulos de pesca|srl|s r l|sa|s a|y cia|hermanos|sh) ',
              ' '
            ),
            r'\s+', ' '
          ),
          r'^ | $', ''
        )
      )
    ) AS name_norm
  FROM `app-vendedores-shimano.shimano_app.v_leads_detalle` ld
  WHERE ld.card_code IS NOT NULL
    -- v2 (2026-09-01): incluir tambien LEADs (card_code tipo 'LEAD_xxx').
    -- Motivo: muchas visitas a tiendas legitimas que aun no fueron altas
    -- oficiales en SAP existen como LEAD. Antes se excluian y quedaban en
    -- sin_match. El card_code LEAD_xxx sigue siendo un identificador estable
    -- que Power BI puede joinear (LEFT JOIN card_code) para el reporte de
    -- "sin visita ni contacto". Cuando el LEAD se convierte a cliente SAP,
    -- el score sube y el match_type mejora automaticamente.
),
normalized_clients_tokens AS (
  SELECT
    *,
    -- token set: distinct tokens ordered alfabeticamente. Sirve para Jaccard.
    ARRAY(
      SELECT DISTINCT t FROM UNNEST(SPLIT(name_norm, ' ')) t
      WHERE t IS NOT NULL AND LENGTH(t) >= 2
      ORDER BY t
    ) AS tokens,
    LENGTH(name_norm) AS name_len
  FROM normalized_clients
),
normalized_visits AS (
  SELECT
    v.visita_id,
    v.tienda,
    UPPER(v.provincia) AS provincia,
    UPPER(v.localidad) AS localidad,
    UPPER(
      TRIM(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(NORMALIZE(LOWER(COALESCE(v.tienda, '')), NFD), r'\p{M}', ''),
                r'[^a-z0-9 ]', ' '
              ),
              r' (pesca|camping|outdoor|fishing|shop|bait|store|tienda|articulos de pesca|srl|s r l|sa|s a|y cia|hermanos|sh) ',
              ' '
            ),
            r'\s+', ' '
          ),
          r'^ | $', ''
        )
      )
    ) AS name_norm
  FROM `app-vendedores-shimano.shimano_app.v_visitas` v
  WHERE v.visita_id IS NOT NULL
),
normalized_visits_tokens AS (
  SELECT
    *,
    ARRAY(
      SELECT DISTINCT t FROM UNNEST(SPLIT(name_norm, ' ')) t
      WHERE t IS NOT NULL AND LENGTH(t) >= 2
      ORDER BY t
    ) AS tokens,
    LENGTH(name_norm) AS name_len
  FROM normalized_visits
),

-- =========================================================================
-- Level 0: OVERRIDE MANUAL. Prioridad maxima (score=1.00, match_type='override')
-- =========================================================================
overrides_join AS (
  SELECT
    v.visita_id,
    v.tienda,
    m.card_code,
    c.card_name,
    'override' AS match_type,
    1.00 AS score
  FROM normalized_visits_tokens v
  JOIN `app-vendedores-shimano.shimano_app.map_tienda_cliente_manual` m
    ON v.name_norm = m.tienda_normalizada
  LEFT JOIN normalized_clients_tokens c
    ON c.card_code = m.card_code
),

-- =========================================================================
-- Level 1: EXACTO. name_norm visitas == name_norm clientes.
-- =========================================================================
level1_exact AS (
  SELECT
    v.visita_id,
    v.tienda,
    c.card_code,
    c.card_name,
    'exacto' AS match_type,
    -- v2 (2026-09-01): penalty 0.15 al score si es LEAD, para que un SAP con
    -- boost de localidad (contenido +0.10) siempre le gane a un LEAD exacto sin
    -- contexto de localidad. Ejemplo: LEAD "PIRACUA" (1.00-0.15=0.85) vs SAP
    -- "PIRACUA - BERNAL" (contenido con loc match = 0.95). SAP gana.
    CASE WHEN c.card_code LIKE 'LEAD_%' THEN 0.85 ELSE 1.00 END AS score
  FROM normalized_visits_tokens v
  JOIN normalized_clients_tokens c
    ON v.name_norm = c.name_norm
   AND LENGTH(v.name_norm) >= 3  -- Evitar match de strings vacios o triviales
  -- Exclusion: si visita YA tiene override, este level no aplica.
  WHERE NOT EXISTS (
    SELECT 1 FROM overrides_join o WHERE o.visita_id = v.visita_id
  )
),

-- =========================================================================
-- Level 2: CONTENCION. Un nombre esta contenido en el otro. Guarda len>=6.
-- Provincia+localidad match agrega boost +0.10.
-- =========================================================================
level2_contain AS (
  SELECT
    v.visita_id,
    v.tienda,
    c.card_code,
    c.card_name,
    'contenido' AS match_type,
    -- v2: mismo penalty -0.15 si LEAD (SAP-first policy).
    CASE
      WHEN v.provincia = c.provincia AND v.localidad = c.localidad THEN 0.95
      WHEN v.provincia = c.provincia THEN 0.90
      ELSE 0.85
    END - CASE WHEN c.card_code LIKE 'LEAD_%' THEN 0.15 ELSE 0.0 END AS score
  FROM normalized_visits_tokens v
  JOIN normalized_clients_tokens c
    ON (
      -- Uno contenido en el otro (usando LIKE con % en ambos lados)
      -- Requiere que el nombre "corto" tenga >= 6 chars para evitar espurios
      -- (ej. "PIRACUA" en "PIRACUA - BERNAL" OK; "OK" en "OKINAWA" NO)
      (v.name_norm LIKE CONCAT('%', c.name_norm, '%') AND c.name_len >= 6)
      OR
      (c.name_norm LIKE CONCAT('%', v.name_norm, '%') AND v.name_len >= 6)
    )
   AND v.name_norm != c.name_norm  -- Excluir exactos (ya matcheados en level 1)
  -- Excluir visitas ya matcheadas en niveles anteriores
  -- v2: NO excluir visitas ya matcheadas en niveles anteriores. Dejar que
  -- todos los candidatos compitan en all_candidates. El ROW_NUMBER en ranked
  -- decide por score final (con penalty LEAD ya aplicado). Motivo: antes un
  -- LEAD con exacto (score 0.85 post-penalty) bloqueaba al SAP con contenido
  -- (score 0.95) porque level2 se excluia. Ahora ambos van y SAP gana.
),

-- =========================================================================
-- Level 3: JACCARD TOKEN SET >= 0.60
-- Jaccard = |A ∩ B| / |A ∪ B|
-- Boost +0.05 si provincia+localidad matchea.
--
-- Optimizacion: pre-computar (visita, cliente) candidatos via UNNEST de tokens
-- (evita cartesian join full). BQ no permite EXISTS subquery en JOIN predicate,
-- por eso usamos CTE intermedio en vez de correlated subquery.
-- =========================================================================
clients_tokens_flat AS (
  -- Flatten tokens de clientes para poder joinear por token individual
  SELECT card_code, tok
  FROM normalized_clients_tokens, UNNEST(tokens) AS tok
),
visits_tokens_flat AS (
  SELECT visita_id, tok
  FROM normalized_visits_tokens, UNNEST(tokens) AS tok
),
level3_visit_client_pairs AS (
  -- Pares (visita, cliente) que comparten AL MENOS 1 token (candidatos jaccard)
  SELECT DISTINCT vf.visita_id, cf.card_code
  FROM visits_tokens_flat vf
  JOIN clients_tokens_flat cf ON cf.tok = vf.tok
),
level3_jaccard AS (
  SELECT
    v.visita_id,
    v.tienda,
    c.card_code,
    c.card_name,
    'fuzzy' AS match_type,
    -- Score = jaccard + boost si aplica, cap 0.99 (reservado 1.00 para exacto/override)
    -- v2: penalty -0.15 si LEAD para prioridad SAP.
    LEAST(
      0.99,
      jscore.jaccard_score +
      CASE
        WHEN v.provincia = c.provincia AND v.localidad = c.localidad THEN 0.10
        WHEN v.provincia = c.provincia THEN 0.05
        ELSE 0.00
      END - CASE WHEN c.card_code LIKE 'LEAD_%' THEN 0.15 ELSE 0.0 END
    ) AS score
  FROM level3_visit_client_pairs pairs
  JOIN normalized_visits_tokens v USING (visita_id)
  JOIN normalized_clients_tokens c USING (card_code)
  CROSS JOIN UNNEST([STRUCT(
    -- Jaccard = intersection_count / union_count
    SAFE_DIVIDE(
      (SELECT COUNT(*) FROM UNNEST(v.tokens) vt WHERE vt IN UNNEST(c.tokens)),
      (SELECT COUNT(DISTINCT t) FROM UNNEST(ARRAY_CONCAT(v.tokens, c.tokens)) t)
    ) AS jaccard_score
  )]) AS jscore
  WHERE jscore.jaccard_score >= 0.60
    AND ARRAY_LENGTH(v.tokens) > 0
    AND ARRAY_LENGTH(c.tokens) > 0
  -- v2: NO excluir por nivel anterior (ver comentario en level2_contain).
),

-- =========================================================================
-- ALL CANDIDATES + RANK
-- =========================================================================
all_candidates AS (
  SELECT * FROM overrides_join
  UNION ALL
  SELECT * FROM level1_exact
  UNION ALL
  SELECT * FROM level2_contain
  UNION ALL
  SELECT * FROM level3_jaccard
),
-- Pre-computar el max_score y n_candidates-en-rango-de-tolerancia por visita.
-- BigQuery no soporta correlated subqueries en views expuestas; hay que
-- decorrelar via CTE JOIN.
max_score_per_visit AS (
  SELECT visita_id, MAX(score) AS max_score
  FROM all_candidates
  GROUP BY visita_id
),
ambiguo_calc AS (
  SELECT ac.visita_id, COUNT(*) AS n_near_top
  FROM all_candidates ac
  JOIN max_score_per_visit m ON m.visita_id = ac.visita_id
  WHERE ac.score >= m.max_score - 0.05
  GROUP BY ac.visita_id
),
ranked AS (
  SELECT
    ac.*,
    ROW_NUMBER() OVER (
      PARTITION BY ac.visita_id
      ORDER BY
        -- v2 (2026-09-01): ROUND para eliminar floating point precision issues.
        -- Sin ROUND, LEAD score 0.9500000000000001 le ganaba a SAP 0.95 exacto
        -- por 1e-16 aunque el CASE SAP-first debía romper el tie.
        ROUND(ac.score, 2) DESC,
        -- En tie de score, preferir SAP (card_code LIKE 'C%') sobre LEAD.
        -- Mariano: SAP es fuente de verdad; leads son negocios en proceso de alta.
        -- Ejemplo: PIRACUA (BERNAL) → LEAD "PIRACUA" (0.95) vs SAP "PIRACUA -
        -- BERNAL" (contenido 0.95 con boost loc) → SAP gana.
        CASE WHEN ac.card_code LIKE 'LEAD_%' THEN 1 ELSE 0 END,
        ac.card_code  -- desempate final deterministic
    ) AS rn
  FROM all_candidates ac
),
best_match AS (
  SELECT
    r.visita_id,
    r.tienda,
    r.card_code,
    r.card_name,
    r.match_type,
    ROUND(r.score, 4) AS score,
    -- ambiguo: TRUE si hay >1 candidato con score >= max_score - 0.05
    COALESCE(a.n_near_top, 0) > 1 AS ambiguo
  FROM ranked r
  LEFT JOIN ambiguo_calc a ON a.visita_id = r.visita_id
  WHERE r.rn = 1
)

-- Final SELECT: LEFT JOIN visitas <- best_match (para incluir tambien las sin match)
SELECT
  v.visita_id,
  v.tienda,
  bm.card_code,
  bm.card_name,
  COALESCE(bm.match_type, 'sin_match') AS match_type,
  COALESCE(bm.score, 0.00) AS score,
  COALESCE(bm.ambiguo, FALSE) AS ambiguo
FROM `app-vendedores-shimano.shimano_app.v_visitas` v
LEFT JOIN best_match bm ON bm.visita_id = v.visita_id;


-- =============================================================================
-- VISTA: v_visitas_enriquecida
-- =============================================================================
-- v_visitas con columnas card_code, card_name_sap, match_type, match_score
-- agregadas. Reemplaza el uso directo de v_visitas en analisis que quieren
-- vincular con SAP.
--
-- NO reemplaza v_visitas (para no romper reportes existentes). Los reportes
-- nuevos que necesiten JOIN con clientes usan esta vista.
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas_enriquecida` AS
SELECT
  v.*,
  m.card_code,
  m.card_name AS card_name_sap,
  m.match_type,
  m.score AS match_score,
  m.ambiguo AS match_ambiguo
FROM `app-vendedores-shimano.shimano_app.v_visitas` v
LEFT JOIN `app-vendedores-shimano.shimano_app.v_visitas_clientes_match` m
  ON m.visita_id = v.visita_id;


-- =============================================================================
-- VISTA: v_visitas_sin_match
-- =============================================================================
-- Debugging: visitas que no lograron matchear con ningun cliente SAP.
-- Alimenta la investigacion de por que: nombre demasiado libre, cliente no
-- existe en SAP todavia (lead), typo del vendedor, etc.
-- =============================================================================
CREATE OR REPLACE VIEW `app-vendedores-shimano.shimano_app.v_visitas_sin_match` AS
SELECT
  v.visita_id,
  v.vendedor,
  v.tienda,
  v.provincia,
  v.localidad,
  v.fecha_visita,
  v.interaction_type,
  v.es_contacto
FROM `app-vendedores-shimano.shimano_app.v_visitas` v
LEFT JOIN `app-vendedores-shimano.shimano_app.v_visitas_clientes_match` m
  ON m.visita_id = v.visita_id
WHERE m.card_code IS NULL
   OR m.match_type = 'sin_match';


-- =============================================================================
-- QUERIES DE VALIDACION (correr manualmente post-deploy)
-- =============================================================================

-- V1: % de visitas jul-ago con card_code asignado (objetivo: maximizar)
-- SELECT
--   COUNT(*) AS total,
--   COUNTIF(card_code IS NOT NULL) AS con_match,
--   ROUND(COUNTIF(card_code IS NOT NULL) * 100.0 / COUNT(*), 1) AS pct_matched
-- FROM `app-vendedores-shimano.shimano_app.v_visitas_enriquecida`
-- WHERE fecha_visita BETWEEN '2026-07-01' AND '2026-08-31';

-- V2: Casos control (Mariano)
-- SELECT tienda, card_name, match_type, score, ambiguo
-- FROM `app-vendedores-shimano.shimano_app.v_visitas_enriquecida`
-- WHERE UPPER(tienda) LIKE '%MAXERA%' OR UPPER(tienda) LIKE '%PIRACUA%' OR UPPER(tienda) LIKE '%TUCUMAN FISHING%';

-- V3: Matches ambiguos para revision manual
-- SELECT visita_id, tienda, card_name, match_type, score, ambiguo
-- FROM `app-vendedores-shimano.shimano_app.v_visitas_clientes_match`
-- WHERE ambiguo = TRUE
-- ORDER BY score DESC, tienda
-- LIMIT 50;

-- V4: Visitas sin match agrupadas por vendedor
-- SELECT vendedor, COUNT(*) AS n_sin_match
-- FROM `app-vendedores-shimano.shimano_app.v_visitas_sin_match`
-- GROUP BY vendedor
-- ORDER BY n_sin_match DESC;

-- =============================================================================
-- README: como cargar overrides manuales
-- =============================================================================
-- Cuando el algoritmo automatico no resuelve un caso (visita queda en
-- v_visitas_sin_match o el match_type='fuzzy' con score bajo o ambiguo=TRUE),
-- el humano puede cargar un override manual en `map_tienda_cliente_manual`.
--
-- IMPORTANTE: la columna `tienda_normalizada` debe estar PRE-NORMALIZADA con
-- la misma logica que aplica la vista (lowercase → sin acentos → sin puntuacion
-- → sin stopwords → UPPER). Usar este helper query para calcular la version
-- normalizada de un nombre libre:
--
-- WITH raw AS (SELECT 'MI TIENDA S.R.L.' AS tienda)
-- SELECT
--   tienda,
--   UPPER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
--     NORMALIZE(LOWER(tienda), NFD), r'\p{M}', ''),
--     r'[^a-z0-9 ]', ' '),
--     r' (pesca|camping|outdoor|fishing|shop|bait|store|tienda|articulos de pesca|srl|s r l|sa|s a|y cia|hermanos|sh) ', ' '),
--     r'\s+', ' '),
--     r'^ | $', ''))) AS tienda_normalizada
-- FROM raw;
--
-- Insertar override:
-- INSERT INTO `app-vendedores-shimano.shimano_app.map_tienda_cliente_manual`
--   (tienda_normalizada, card_code, nota, created_by)
-- VALUES ('MI TIENDA', 'C20123456789', 'Cliente que aparece como MITIENDA en visitas', 'mariano.erbino@shimano.com.ar');
--
-- Post-insert las vistas v_visitas_clientes_match / v_visitas_enriquecida ya
-- lo aplican en la proxima query (son views, no snapshots).
-- =============================================================================
