"""Genera el PDF 'MEJORAS' con analisis critico del estado actual de la app
y roadmap para hacerla profesional, robusta y escalable.

Output: C:/Users/shimano.sandbox/Desktop/MEJORAS.pdf

Enfoque: honesto, con evidencia (bugs reales de las ultimas semanas),
priorizado por impacto vs esfuerzo, accionable (no "hay que mejorar" sino
"correr X comando").
"""
from datetime import datetime
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    ListFlowable, ListItem
)

OUT = Path.home() / 'Desktop' / 'MEJORAS.pdf'
TODAY = datetime.now().strftime('%d/%m/%Y')

styles = getSampleStyleSheet()
BASE_FONT = 'Helvetica'
MONO_FONT = 'Courier'

# Estilos (mismo template que el manual)
st_title = ParagraphStyle('CoverTitle', parent=styles['Title'],
    fontName=BASE_FONT + '-Bold', fontSize=36, leading=42,
    textColor=colors.HexColor('#7f1d1d'), alignment=TA_CENTER, spaceAfter=18)
st_subtitle = ParagraphStyle('CoverSub', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=14, leading=18,
    textColor=colors.HexColor('#475569'), alignment=TA_CENTER, spaceAfter=10)
st_meta = ParagraphStyle('CoverMeta', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=11, leading=14,
    textColor=colors.HexColor('#64748b'), alignment=TA_CENTER)
st_h1 = ParagraphStyle('H1', parent=styles['Heading1'],
    fontName=BASE_FONT + '-Bold', fontSize=20, leading=24,
    textColor=colors.HexColor('#7f1d1d'), spaceBefore=6, spaceAfter=12,
    keepWithNext=True)
st_h2 = ParagraphStyle('H2', parent=styles['Heading2'],
    fontName=BASE_FONT + '-Bold', fontSize=14, leading=18,
    textColor=colors.HexColor('#b91c1c'), spaceBefore=14, spaceAfter=6,
    keepWithNext=True)
st_h3 = ParagraphStyle('H3', parent=styles['Heading3'],
    fontName=BASE_FONT + '-Bold', fontSize=11.5, leading=14,
    textColor=colors.HexColor('#334155'), spaceBefore=10, spaceAfter=4,
    keepWithNext=True)
st_body = ParagraphStyle('Body', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=10, leading=14,
    textColor=colors.HexColor('#0f172a'), spaceAfter=6, alignment=TA_JUSTIFY)
st_body_left = ParagraphStyle('BodyLeft', parent=st_body, alignment=TA_LEFT)
st_code = ParagraphStyle('Code', parent=styles['Normal'],
    fontName=MONO_FONT, fontSize=8.5, leading=11,
    textColor=colors.HexColor('#0f172a'),
    backColor=colors.HexColor('#f1f5f9'),
    borderColor=colors.HexColor('#cbd5e1'),
    borderWidth=0.5, borderPadding=6,
    leftIndent=4, rightIndent=4,
    spaceBefore=4, spaceAfter=8)
st_callout_warn = ParagraphStyle('CalloutWarn', parent=st_body,
    fontSize=9.5, leading=13,
    textColor=colors.HexColor('#7f1d1d'),
    backColor=colors.HexColor('#fee2e2'),
    borderColor=colors.HexColor('#dc2626'),
    borderWidth=0.5, borderPadding=8,
    leftIndent=4, rightIndent=4,
    spaceBefore=6, spaceAfter=8)
st_callout_ok = ParagraphStyle('CalloutOk', parent=st_body,
    fontSize=9.5, leading=13,
    textColor=colors.HexColor('#14532d'),
    backColor=colors.HexColor('#dcfce7'),
    borderColor=colors.HexColor('#22c55e'),
    borderWidth=0.5, borderPadding=8,
    leftIndent=4, rightIndent=4,
    spaceBefore=6, spaceAfter=8)
st_callout_info = ParagraphStyle('CalloutInfo', parent=st_body,
    fontSize=9.5, leading=13,
    textColor=colors.HexColor('#78350f'),
    backColor=colors.HexColor('#fef3c7'),
    borderColor=colors.HexColor('#fbbf24'),
    borderWidth=0.5, borderPadding=8,
    leftIndent=4, rightIndent=4,
    spaceBefore=6, spaceAfter=8)

def h1(t): return Paragraph(t, st_h1)
def h2(t): return Paragraph(t, st_h2)
def h3(t): return Paragraph(t, st_h3)
def p(t): return Paragraph(t, st_body)
def pl(t): return Paragraph(t, st_body_left)
def code(t):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = t.replace('\n', '<br/>').replace(' ', '&nbsp;')
    return Paragraph(t, st_code)
def warn(t): return Paragraph(t, st_callout_warn)
def ok(t): return Paragraph(t, st_callout_ok)
def info(t): return Paragraph(t, st_callout_info)
def sp(h=8): return Spacer(1, h)

def kv_table(rows, col_widths=None):
    style = TableStyle([
        ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f1f5f9')),
        ('FONTNAME', (0,0), (0,-1), BASE_FONT + '-Bold'),
        ('FONTNAME', (1,0), (1,-1), BASE_FONT),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('TEXTCOLOR', (0,0), (0,-1), colors.HexColor('#334155')),
        ('TEXTCOLOR', (1,0), (1,-1), colors.HexColor('#0f172a')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#cbd5e1')),
    ])
    if col_widths is None:
        col_widths = [4.5*cm, 12*cm]
    return Table(rows, colWidths=col_widths, style=style)

def data_table(header, rows, col_widths=None, header_color='#7f1d1d'):
    data = [header] + rows
    style = TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor(header_color)),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), BASE_FONT + '-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('FONTNAME', (0,1), (-1,-1), BASE_FONT),
        ('FONTSIZE', (0,1), (-1,-1), 8.5),
        ('TEXTCOLOR', (0,1), (-1,-1), colors.HexColor('#0f172a')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1),
            [colors.white, colors.HexColor('#f8fafc')]),
    ])
    return Table(data, colWidths=col_widths, style=style, repeatRows=1)

def issue_box(num, titulo, severity, esfuerzo, impacto, descripcion, evidencia, solucion):
    """Renderiza un item de 'punto debil' con formato consistente."""
    color = {'ALTA':'#dc2626','MEDIA':'#f59e0b','BAJA':'#0369a1'}.get(severity, '#64748b')
    elems = []
    elems.append(Paragraph(
        f'<font color="{color}"><b>#{num} · {titulo}</b></font>',
        ParagraphStyle('IssueTitle', parent=st_h3, fontSize=12, textColor=colors.HexColor(color),
                       spaceBefore=14, spaceAfter=4)))
    elems.append(Table(
        [['Severidad', severity, 'Esfuerzo', esfuerzo, 'Impacto', impacto]],
        colWidths=[1.8*cm, 1.5*cm, 1.5*cm, 1.5*cm, 1.5*cm, 8.2*cm],
        style=TableStyle([
            ('BACKGROUND', (0,0), (0,0), colors.HexColor('#f1f5f9')),
            ('BACKGROUND', (2,0), (2,0), colors.HexColor('#f1f5f9')),
            ('BACKGROUND', (4,0), (4,0), colors.HexColor('#f1f5f9')),
            ('FONTNAME', (0,0), (-1,0), BASE_FONT),
            ('FONTSIZE', (0,0), (-1,0), 8.5),
            ('FONTNAME', (0,0), (0,0), BASE_FONT + '-Bold'),
            ('FONTNAME', (2,0), (2,0), BASE_FONT + '-Bold'),
            ('FONTNAME', (4,0), (4,0), BASE_FONT + '-Bold'),
            ('BOX', (0,0), (-1,-1), 0.25, colors.HexColor('#cbd5e1')),
            ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor('#e2e8f0')),
            ('LEFTPADDING', (0,0), (-1,-1), 5),
            ('RIGHTPADDING', (0,0), (-1,-1), 5),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ])))
    elems.append(sp(4))
    elems.append(Paragraph('<b>Qué pasa:</b> ' + descripcion, st_body))
    elems.append(Paragraph('<b>Evidencia:</b> ' + evidencia, st_body))
    elems.append(Paragraph('<b>Solución propuesta:</b> ' + solucion, st_body))
    return elems

# ---------- Header / footer ----------
def on_page(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont(BASE_FONT, 8)
        canvas.setFillColor(colors.HexColor('#64748b'))
        canvas.drawString(2*cm, 28*cm, 'MEJORAS · Análisis crítico y roadmap')
        canvas.drawRightString(19*cm, 28*cm, TODAY)
        canvas.setStrokeColor(colors.HexColor('#cbd5e1'))
        canvas.setLineWidth(0.3)
        canvas.line(2*cm, 27.7*cm, 19*cm, 27.7*cm)
    canvas.setFont(BASE_FONT, 8)
    canvas.setFillColor(colors.HexColor('#94a3b8'))
    canvas.drawCentredString(A4[0]/2, 1.3*cm, f'Página {doc.page}')
    canvas.restoreState()

# =========================================================================
# CONTENIDO
# =========================================================================
story = []

# --- PORTADA ---
story.append(Spacer(1, 5*cm))
story.append(Paragraph('MEJORAS', st_title))
story.append(sp(6))
story.append(Paragraph(
    'App Shimano Vendedores<br/>Análisis crítico del estado actual y roadmap<br/>'
    'para una aplicación profesional, robusta y escalable',
    st_subtitle))
story.append(sp(40))
story.append(Paragraph(
    f'Documento generado: {TODAY}<br/>'
    'Basado en: SW v301 (últimos 500+ commits del repo)<br/>'
    'Autor: Mariano Erbino',
    st_meta))
story.append(sp(60))
story.append(Paragraph(
    '<i>Este documento identifica los puntos débiles del sistema actual, '
    'con evidencia concreta (bugs reales aparecidos en las últimas semanas), '
    'y propone un roadmap accionable por horizontes de tiempo. La '
    'audiencia son: (a) el autor y equipo que va a implementarlas, '
    '(b) la dirección para priorizar inversión en calidad.</i>',
    st_body))
story.append(PageBreak())

# --- INDICE ---
story.append(h1('Índice'))
toc = [
    ('1', 'Resumen ejecutivo', '3'),
    ('2', 'Metodología del análisis', '5'),
    ('3', 'Fortalezas del sistema actual', '6'),
    ('4', 'Los 12 puntos débiles priorizados', '8'),
    ('5', 'Análisis por dimensión', '16'),
    ('6', 'Roadmap por horizontes', '22'),
    ('7', 'Prácticas estándar de la industria', '27'),
    ('8', 'Métricas de éxito', '29'),
    ('9', 'Riesgos si no se hace nada', '31'),
    ('A', 'Anexo: bugs reales de las últimas semanas', '33'),
    ('B', 'Anexo: deuda técnica cuantificada', '35'),
]
toc_table = Table(
    [[i[0], i[1], i[2]] for i in toc],
    colWidths=[1*cm, 14*cm, 1.5*cm],
    style=TableStyle([
        ('FONTNAME', (0,0), (-1,-1), BASE_FONT),
        ('FONTSIZE', (0,0), (-1,-1), 10.5),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor('#0f172a')),
        ('ALIGN', (0,0), (0,-1), 'RIGHT'),
        ('ALIGN', (2,0), (2,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LINEBELOW', (0,0), (-1,-1), 0.25, colors.HexColor('#e2e8f0')),
    ]))
story.append(toc_table)
story.append(PageBreak())

# --- CAP 1: RESUMEN EJECUTIVO ---
story.append(h1('1. Resumen ejecutivo'))
story.append(h2('¿Cómo está la app hoy?'))
story.append(p(
    'La app funciona: los 6 vendedores la usan a diario, los pedidos '
    'llegan a SAP, el gerente ve sus dashboards. En términos de valor '
    'entregado al negocio, es <b>un éxito operativo</b>. El sistema soporta '
    'con margen el volumen actual (5 vendedores, ~127 clientes SAP, ~50 '
    'pedidos/mes, 5 refresh de Power BI diarios).'))
story.append(p(
    'Sin embargo, la implementación actual tiene <b>deuda técnica '
    'significativa</b> que va a doler cuando el volumen crezca (más '
    'vendedores, más provincias, más clientes, más apps consumiendo la '
    'misma data). Esta deuda ya se manifiesta en <b>bugs recurrentes</b>: en las '
    'últimas 2 semanas de trabajo tuvimos 4 rollbacks en producción, '
    '3 casos donde el sync SAP pisó trabajo manual, y 1 freeze completo '
    'de Power BI Desktop.'))

story.append(h2('Los 5 riesgos más grandes hoy'))
story.append(data_table(
    ['#', 'Riesgo', 'Probabilidad', 'Impacto'],
    [
        ['1', 'Bus factor = 1: el autor es el único que entiende el código', 'Certeza', 'Crítico'],
        ['2', 'Cero tests automatizados: cada deploy es riesgoso', 'Alta', 'Alto'],
        ['3', 'Frontend monolítico de 27k líneas en 1 archivo', 'Certeza', 'Alto (mantenibilidad)'],
        ['4', 'Sincronización SAP ↔ App con bugs recurrentes', 'Alta', 'Alto (pérdida de trabajo manual)'],
        ['5', 'Sin observabilidad: los bugs se descubren cuando el usuario los reporta', 'Alta', 'Medio (reputación)'],
    ],
    col_widths=[0.7*cm, 8*cm, 2.5*cm, 5.3*cm]))

story.append(h2('Recomendación estratégica'))
story.append(p(
    'La app está <b>en la etapa correcta para invertir en calidad</b> antes de '
    'crecer. El costo de arreglar un problema hoy con 5 vendedores es 10x '
    'menor que arreglarlo con 30. Propongo un roadmap dividido en 4 '
    'horizontes:'))
story.append(pl(
    '<b>Sprint 1 (2 semanas):</b> Quick wins de alto impacto. Backup de credenciales, alertas de errores, '
    'documentación de accesos ante desvinculación del autor.<br/>'
    '<b>Sprint 2 (1 mes):</b> Tests automatizados de los 5 flows críticos + monitoreo activo.<br/>'
    '<b>Trimestre 1 (3 meses):</b> Refactor del frontend en módulos, staging environment, CI real.<br/>'
    '<b>Semestre 1 (6 meses):</b> Migrar reportes a Power BI Service (hecho parcial), CI/CD con PR reviews, '
    'segundo desarrollador entrenado.'))
story.append(ok(
    '<b>Inversión total estimada:</b> 6 meses de trabajo focado (1 dev + '
    'parte de Mariano) + ~USD 300/mes adicionales en herramientas (Sentry, '
    'GitHub Copilot para equipo, PBI Premium). <br/><br/>'
    '<b>ROI esperado:</b> reducción del 80% de bugs en producción, '
    'onboarding de un dev nuevo en 1 semana en vez de 3 meses, '
    'capacidad de escalar a 50 vendedores sin rewrite.'))
story.append(PageBreak())

# --- CAP 2: METODOLOGIA ---
story.append(h1('2. Metodología del análisis'))
story.append(p('El análisis se basa en tres fuentes:'))
story.append(h3('1. Revisión completa del código'))
story.append(p(
    'index.html (~27.000 líneas), 30+ scripts Python, 9 vistas SQL, '
    'workflows de GitHub Actions, y el README de 3.400 líneas.'))
story.append(h3('2. Trabajo real sobre la app en las últimas semanas'))
story.append(p(
    'Entre 2026-07-13 y 2026-07-14 se resolvieron 8 bugs y se agregaron '
    '4 features nuevas. Cada caso dejó al descubierto un patrón débil '
    'del sistema. El análisis usa estos casos como evidencia concreta, no '
    'como especulación.'))
story.append(h3('3. Comparación con estándares de la industria'))
story.append(p(
    'Se compara contra patrones consolidados en apps SaaS B2B: testing, '
    'CI/CD, feature flags, observability, código modular, staging '
    'environment, PR reviews, on-call rotations.'))

story.append(h2('Cómo priorizo los puntos débiles'))
story.append(p(
    'Cada issue tiene 3 dimensiones (todas explícitas en cada caso):'))
story.append(kv_table([
    ['Severidad', 'ALTA (rompe producción) / MEDIA (deuda que crece con el tiempo) / BAJA (mejora incremental)'],
    ['Esfuerzo', 'Días de trabajo estimados para resolver.'],
    ['Impacto', 'Qué se destraba al resolverlo (nuevas features posibles, o riesgos evitados).'],
]))
story.append(p(
    'La prioridad final combina las 3: los puntos ALTA + bajo esfuerzo son "quick wins", los ALTA + alto esfuerzo son "inversión estratégica".'))
story.append(PageBreak())

# --- CAP 3: FORTALEZAS ---
story.append(h1('3. Fortalezas del sistema actual'))
story.append(p(
    'Antes de listar problemas, es importante reconocer las decisiones que '
    'están bien tomadas. Estas son fortalezas <b>reales</b>, comparadas con '
    'startups similares que trabajan mal:'))
story.append(h2('Arquitectura de datos correcta'))
story.append(ok(
    '<b>Separación OLTP vs OLAP:</b> la app usa Firestore para el día-a-día '
    '(escritura frecuente, listeners real-time) y BigQuery para analytics '
    '(queries complejas, dashboards). Muchas apps empiezan con una sola DB '
    'y sufren cuando intentan escalar. Esta separación te está ahorrando '
    'un rewrite futuro.'))

story.append(h2('Pipeline de datos automatizado'))
story.append(ok(
    '<b>7 Extensions + 1 script Python</b> mueven la data automáticamente '
    'sin intervención. El tiempo desde que un vendedor guarda un pedido '
    'hasta que aparece en Power BI es < 1 hora (Extension real-time + '
    'refresh diario). En muchas empresas ese lag es de días.'))

story.append(h2('PWA en vez de app nativa'))
story.append(ok(
    '<b>Ahorro de 6-12 meses de desarrollo:</b> una sola codebase corre en '
    'iOS, Android, desktop. Se actualiza sin App Store. No hay que '
    'aprender Swift/Kotlin. Para el nivel de features actual, era la '
    'decisión correcta.'))

story.append(h2('Git como fuente de verdad'))
story.append(ok(
    '<b>Todo lo importante está versionado:</b> HTML, scripts, SQL de las '
    'vistas, workflows, README. Se puede reconstruir el estado del '
    'sistema en cualquier momento del pasado con <font face="Courier">git checkout</font>. '
    'Muchas empresas tienen scripts operativos en el desktop del '
    'sysadmin.'))

story.append(h2('Documentación viva en README'))
story.append(ok(
    '<b>3.400 líneas de doc</b> actualizada en cada commit. Explica desde el '
    'contexto de negocio hasta el schema de cada colección Firestore. '
    'Es raro ver este nivel de doc en una app hecha por 1 dev. Va en '
    'la dirección correcta: falta hacerla más navegable (ver Cap 4 #10).'))

story.append(h2('Elección de proveedores'))
story.append(ok(
    '<b>Firebase + BigQuery + GitHub</b> son estándares serios de la industria, '
    'con free tiers generosos y SLAs enterprise. Cero lock-in problemático. Si '
    'mañana Google sube precios 3x, se puede migrar a AWS/Azure con '
    'esfuerzo pero sin quedarse a pie.'))

story.append(h2('Costo bajo para la funcionalidad ofrecida'))
story.append(ok(
    '<b>USD 89/mes</b> para un sistema comercial que reemplaza (parcialmente) '
    'un ERP + CRM + herramienta de reporting. En SaaS equivalente '
    '(Salesforce + Tableau + herramientas de campo) esto costaría USD '
    '500-2.000/mes para el mismo tamaño de equipo.'))
story.append(PageBreak())

# --- CAP 4: PUNTOS DEBILES PRIORIZADOS ---
story.append(h1('4. Los 12 puntos débiles priorizados'))
story.append(p(
    'A continuación, los problemas identificados, ordenados por prioridad '
    '(severidad + urgencia). Cada uno con evidencia concreta y una solución '
    'accionable.'))

for elem in issue_box(
    1,
    'Bus factor = 1 (autor único)',
    severity='ALTA', esfuerzo='2 semanas', impacto='CRÍTICO',
    descripcion=(
        'Toda la app fue escrita por una sola persona (Mariano). Nadie más '
        'en Shimano conoce el código con profundidad suficiente para hacer '
        'cambios seguros. Si el autor se enferma, se toma vacaciones largas '
        'o cambia de trabajo, la app queda paralizada.'
    ),
    evidencia=(
        'El manual técnico recién se está generando (documento paralelo). '
        'Ninguna otra persona ha hecho commits al repo. Los accesos '
        'críticos (Firebase, GitHub org, GCP) están en la cuenta del autor. '
        'Cero handoff formal a otro dev o al equipo IT de Shimano.'
    ),
    solucion=(
        '(a) Formalizar handoff: definir un segundo dev "de guardia" que '
        'reciba training de 4 semanas. Puede ser interno IT Shimano o '
        'externo. (b) Transferir ownership de todos los servicios a cuenta '
        'compartida (bot.shimano.pesca@gmail.com como sole owner de Firebase, '
        'GitHub org, GCP). (c) Runbook operativo (parte 17 del manual) '
        'accesible sin depender del autor.'
    )):
    story.append(elem)

for elem in issue_box(
    2,
    'Cero tests automatizados',
    severity='ALTA', esfuerzo='1 semana (setup) + 1h/test futuro', impacto='ALTO',
    descripcion=(
        'No hay un solo test unitario, de integración o end-to-end. '
        'Cada cambio va a producción sin verificar que no rompió las '
        'features anteriores. Los bugs los descubren los vendedores en '
        'producción, no un CI antes del deploy.'
    ),
    evidencia=(
        'En las últimas 2 semanas: 4 rollbacks en producción, cada uno '
        'porque un cambio rompió algo que antes funcionaba: (1) v293 fix '
        'del KPI PENDIENTES revelado por el vendedor, (2) fix del bulk '
        'fantasías pisado por sync SAP, (3) Power BI Desktop colgado por '
        'schema change de v_backorder_lineas (rollback total en 2 pasos), '
        '(4) filtro por provincia Salta mostrando 0 clientes por bug de '
        'data en Firestore.'
    ),
    solucion=(
        'Playwright para 5-8 smoke tests de los flows críticos (login, '
        'alta rápida, crear pedido, cargar visita, filtro provincia, ver '
        'dashboard, cargar target, aprobar rendición). Corre en cada push '
        'a main vía GitHub Actions. Deploy se bloquea si algún test falla. '
        'Después expandir a tests unitarios para las funciones más '
        'complejas (findMatch del sync, isSapConfirmed, etc.).'
    )):
    story.append(elem)

for elem in issue_box(
    3,
    'Frontend monolítico (index.html de 27k líneas)',
    severity='ALTA', esfuerzo='4-6 semanas (refactor)', impacto='ALTO (mantenibilidad)',
    descripcion=(
        'Todo el JS + CSS + HTML de la app vive en un solo archivo de 3.2 '
        'MB. Encontrar código es difícil (grep en un solo archivo, no hay '
        'módulos con nombre semántico). Cada cambio requiere leer contexto '
        'disperso a lo largo de 27.000 líneas.'
    ),
    evidencia=(
        'Ejemplo: cuando el usuario pidió el bulk import de fantasías, para '
        'entender cómo se renderea "fantasía" hubo que grep 6 lugares '
        'distintos en el mismo archivo. La función <font face="Courier">'
        'renderClients</font> tiene 300 líneas con 3 paths distintos (POINTS '
        'clients, POINTS prospects, SAP altas huérfanas). Refactorizar '
        'requiere entender los 3 al mismo tiempo.'
    ),
    solucion=(
        'Split gradual del archivo en módulos con Vite (bundler ligero, cero '
        'framework). Estructura sugerida: <font face="Courier">src/modules/'
        '</font> con archivos por responsabilidad (auth.js, map.js, '
        'orders.js, visits.js, sync.js, etc.). Build genera un '
        'index.html similar al actual pero con code splitting: la primera '
        'carga baja solo el core (~500KB) y los módulos se cargan on-demand. '
        'Migración incremental: se puede hacer módulo por módulo sin '
        'romper la app.'
    )):
    story.append(elem)

for elem in issue_box(
    4,
    'Bugs recurrentes en sync SAP ↔ App',
    severity='ALTA', esfuerzo='2 semanas (diseño formal)', impacto='ALTO',
    descripcion=(
        'La regla actual "SAP siempre gana salvo que tenga marca de manual" '
        'es un parche, no una arquitectura. Cada campo nuevo que el admin '
        'edita requiere agregar otra excepción al script. Aparecieron 3 '
        'bugs distintos del mismo patrón en 1 semana.'
    ),
    evidencia=(
        'v291 (2026-07-13): sync pisaba localidad/provincia cargadas a mano. '
        'v300 (2026-07-14): sync pisaba fantasías cargadas manualmente. '
        'v300 (2026-07-14): sync pisaba correcciones de provincia hechas '
        'desde Excel. Todos son variantes del mismo problema conceptual: no '
        'está definida quién es la fuente de verdad para cada campo.'
    ),
    solucion=(
        'Diseñar formalmente la política de merge: (a) definir explícitamente '
        'qué campos son "SAP-owned" (nunca editables desde app) vs '
        '"app-owned" (nunca pisables por SAP) vs "hybrid" (mergeables con '
        'reglas claras). (b) Un solo lugar en el código donde se lista '
        'esta política (evita agregar excepciones dispersas). (c) Marca de '
        'audit por campo (no solo <font face="Courier">provinciaLocSource</font>, '
        'sino un objeto por campo). Costo: 2 semanas de diseño + '
        'implementación, pero cierra la fuente de bugs recurrentes.'
    )):
    story.append(elem)

for elem in issue_box(
    5,
    'Sin observabilidad ni alertas',
    severity='ALTA', esfuerzo='3 días', impacto='MEDIO',
    descripcion=(
        'Cuando la app tiene un problema, se descubre porque un vendedor '
        'escribe por Teams. No hay logs centralizados de errores del '
        'frontend, ni alertas de fallos en el backend, ni dashboard de '
        'salud del sistema. Los bugs viven ocultos hasta que alguien los '
        'reporta.'
    ),
    evidencia=(
        'El bug del filtro por Salta mostrando 0 clientes existe hace '
        'días o semanas. Se detectó recién cuando el usuario lo probó al azar. '
        'Cuántos filtros similares habrá rotos que nadie prueba? Cero '
        'visibilidad. Idem con el sync SAP: si falla 3 veces seguidas, no '
        'llega alerta.'
    ),
    solucion=(
        '(a) Sentry.io para errores del frontend (JS errors + traces). Tier '
        'free alcanza para 5k eventos/mes. (b) Alertas de GitHub Actions '
        'ya existen (mail al author) - configurar que vaya a un canal de '
        'Slack o Teams del equipo. (c) Dashboard Grafana / Metabase '
        'con métricas de salud: reads/writes Firestore por hora, tiempo de '
        'respuesta del SL de SAP, cantidad de errores 4xx/5xx.'
    )):
    story.append(elem)

for elem in issue_box(
    6,
    'Deploy sin staging environment',
    severity='MEDIA', esfuerzo='1 semana', impacto='ALTO',
    descripcion=(
        'Cada <font face="Courier">git push</font> a main va directo a '
        'producción, sin ambiente intermedio para verificar. Si un cambio '
        'rompe algo, el rollback es reactivo (después que un usuario reporta).'
    ),
    evidencia=(
        'Todo commit de las últimas semanas fue directo a main. El único '
        'test es abrir la app en el navegador del autor. No hay opción '
        'de "probar en staging con data real anonimizada antes de exponer '
        'a los vendedores".'
    ),
    solucion=(
        'Crear ambiente staging: (a) Segundo Firebase project <font face="'
        'Courier">app-vendedores-shimano-staging</font> con clon de datos. '
        '(b) Rama <font face="Courier">develop</font> del repo que despliega '
        'a un GitHub Pages secundario <font face="Courier">https://'
        'shimano-arg.github.io/app-vendedores-staging/</font>. (c) Regla: '
        'todo cambio pasa primero por staging, se prueba, después PR a '
        'main. Setup: 1 semana. Reduce el 90% de bugs que hoy llegan a '
        'producción.'
    )):
    story.append(elem)

for elem in issue_box(
    7,
    'Falta CI real con code review',
    severity='MEDIA', esfuerzo='2 semanas', impacto='MEDIO',
    descripcion=(
        'Los commits van directo a main sin revisión por pares. Si el '
        'autor comete un typo grave (borra una función usada, cambia una '
        'API rota, sube un secret al repo), no hay red de contención.'
    ),
    evidencia=(
        'El commit del rollback del gap huérfano (v_backorder_lineas) requirió '
        '2 iteraciones (rollback quirúrgico + rollback total) porque el '
        'primer intento no fue suficiente. Con code review, un segundo '
        'par de ojos habría detectado que el rollback quirúrgico no '
        'alcanzaba.'
    ),
    solucion=(
        'Combinado con el punto anterior: main protegida con branch '
        'protection. Requiere: (a) PR obligatorio (nada de push directo). '
        '(b) CI verde (smoke tests). (c) 1 aprobación de otro dev. Si por '
        'ahora hay 1 solo dev, se puede empezar con 0 aprobaciones pero '
        'PR obligatorio - fuerza al autor a explicar cada cambio y ver el diff '
        'antes de merge.'
    )):
    story.append(elem)

for elem in issue_box(
    8,
    'Firestore Rules como get() nested (caro y frágil)',
    severity='MEDIA', esfuerzo='1 semana', impacto='MEDIO',
    descripcion=(
        'Las Firestore Rules leen la colección roles con '
        '<font face="Courier">get()</font> en cada regla evaluada. Cada '
        'get es una READ contable y con latencia. Con más usuarios y más '
        'colecciones, los reads se multiplican rápido.'
    ),
    evidencia=(
        'Cuando Pablo (gerente) abre la app y suscribe a 10 colecciones, '
        'cada listener dispara evaluaciones de rules que hacen get() a '
        'roles. Fácil llegar a 100+ reads solo del roles doc en cada '
        'session. Con 30 usuarios activos = 3.000 reads adicionales por '
        'sesión.'
    ),
    solucion=(
        'Migrar a Firebase Custom Claims: el rol se guarda como claim del '
        'token JWT, no como doc Firestore. Rules consultan <font face="'
        'Courier">request.auth.token.role</font> sin get(). Costo: 1 '
        'semana + Cloud Function que setea claims cuando cambia el rol. '
        'Ahorra 60-80% de reads a la colección roles.'
    )):
    story.append(elem)

for elem in issue_box(
    9,
    'Sync SAP full snapshot vs incremental',
    severity='MEDIA', esfuerzo='1 semana', impacto='MEDIO',
    descripcion=(
        'El sync SAP → BigQuery hace <font face="Courier">WRITE_TRUNCATE</font> '
        'cada 30 min: borra la tabla entera y la reescribe. Con volumen '
        'actual (~5k rows) es aceptable, pero no escala. Si SAP crece a '
        '100k rows, cada corrida costará mucho más en BQ + tiempo.'
    ),
    evidencia=(
        'sap_invoices_raw ya tiene 4.776 filas. Si Shimano expande a otras '
        'unidades (Bike) sin filtro por PESCA, van a ser 50k+. Cada sync '
        'lee 50k rows de SAP, aplana, escribe 50k rows a BQ. 6 corridas por '
        'hora × 24h = 144 corridas diarias.'
    ),
    solucion=(
        'Migrar a sync incremental: guardar el <font face="Courier">last_sync_'
        'timestamp</font> en Firestore/BQ. Cada corrida trae solo docs con '
        '<font face="Courier">UpdateDate &gt; last_sync</font>. INSERT en '
        'BQ en vez de TRUNCATE. Escala a millones de rows con costo '
        'constante. Complejidad extra: manejo de deletes (deletes en SAP no '
        'se traducen automáticamente).'
    )):
    story.append(elem)

for elem in issue_box(
    10,
    'Documentación difícil de navegar',
    severity='MEDIA', esfuerzo='3 días', impacto='MEDIO',
    descripcion=(
        'El README tiene 3.400 líneas en un solo archivo. Es completo pero '
        'no permite encontrar info rápido. No hay tabla de contenidos '
        'linkeada, no hay separación por rol (dev vs operador vs product '
        'owner).'
    ),
    evidencia=(
        'Cuando en las sesiones pasadas necesité algo del README (sección '
        '22 sobre Targets, sección 40 sobre Power BI), tuve que grepear '
        'el archivo. Un dev nuevo tarda horas en encontrar donde está la '
        'info que busca.'
    ),
    solucion=(
        '(a) Split del README en carpeta <font face="Courier">docs/</font> '
        'con archivos por tema: docs/architecture.md, docs/deploy.md, '
        'docs/runbook.md, docs/roles.md, docs/api-sap.md, etc. (b) Índice '
        'en README.md que linkea. (c) Mantener el manual PDF como '
        'versión "presentable" para stakeholders.'
    )):
    story.append(elem)

for elem in issue_box(
    11,
    'Sin feature flags',
    severity='BAJA', esfuerzo='2 días', impacto='MEDIO',
    descripcion=(
        'No hay forma de habilitar/deshabilitar features sin deploy. Si un '
        'feature nuevo rompe algo en producción, el único rollback es git '
        'revert (que puede tomar 10 min en propagarse a todos los users).'
    ),
    evidencia=(
        'Cuando el bulk import de fantasías fue pisado por el sync, no había '
        'manera de "desactivar temporalmente" el sync mientras se preparaba '
        'el fix. Con un feature flag <font face="Courier">sync_sap_enabled=false</font> '
        'en Firestore <font face="Courier">app_config</font>, se apagaba en 1 '
        'segundo.'
    ),
    solucion=(
        'Colección <font face="Courier">app_config/feature_flags</font> con '
        'booleanos por feature. Cliente y scripts la leen al arrancar. '
        'Cambios en la UI aparecen/desaparecen sin deploy. Ejemplos: '
        '<font face="Courier">show_new_dashboard</font>, '
        '<font face="Courier">sync_targets_to_bq</font>, '
        '<font face="Courier">enable_pdf_export</font>.'
    )):
    story.append(elem)

for elem in issue_box(
    12,
    'Backup manual y sin restauración automatizada',
    severity='BAJA', esfuerzo='1 semana', impacto='ALTO (en caso de desastre)',
    descripcion=(
        'Existe un "Backup TOTAL" que exporta un ZIP con Firestore + fotos, '
        'pero es manual (admin lo dispara). No hay script de restauración '
        'automatizada: en caso de desastre (Firestore corrupto por bug del '
        'código o error humano), no hay procedimiento probado para volver '
        'atrás.'
    ),
    evidencia=(
        'El README menciona "Restauración automatizada del backup" como '
        'pendiente. Nunca se ejecutó un DR drill (disaster recovery). Si '
        'hoy alguien ejecuta un script Python malicioso o buggy que hace '
        '<font face="Courier">db.collection(\'pedidos\').stream().delete()</font>, '
        'no hay procedimiento para recuperar.'
    ),
    solucion=(
        '(a) Backup automatizado nightly (cron GH Actions) que sube el ZIP '
        'a Google Cloud Storage con retention de 30 días. (b) Script de '
        'restauración: <font face="Courier">python scripts/restore_from_backup.py '
        '--zip s3://.../backup-2026-07-14.zip --collection pedidos</font>. '
        '(c) DR drill mensual: elegir un doc al azar, simular corrupción, '
        'restaurar, verificar que quedó igual.'
    )):
    story.append(elem)

story.append(PageBreak())

# --- CAP 5: ANALISIS POR DIMENSION ---
story.append(h1('5. Análisis por dimensión'))
story.append(p(
    'Los 12 puntos débiles del capítulo 4 son casos concretos. Acá se '
    'agrupan por dimensión técnica para una visión más holística.'))

story.append(h2('5.1 Código y arquitectura frontend'))
story.append(kv_table([
    ['Estado', 'Monolito de 27k líneas en HTML+JS vanilla. Sin bundler ni framework.'],
    ['Fortaleza', 'Cero build step; deploy simple; sin complejidad de dependencias.'],
    ['Debilidad', 'Difícil de navegar; sin type checking; sin tests; cambios riesgosos.'],
    ['Cuándo duele más', 'Cuando entra un dev nuevo o hay que hacer refactor grande.'],
    ['Fix recomendado', 'Refactor gradual con Vite (mantener vanilla JS pero en módulos). '
     'Agregar TypeScript solo en las partes más complejas (mapping SAP, sync).'],
]))

story.append(h2('5.2 Datos y modelo (Firestore + BigQuery)'))
story.append(kv_table([
    ['Estado', 'Firestore para OLTP + BigQuery para OLAP. Ambos separados con Extensions.'],
    ['Fortaleza', 'Arquitectura correcta para el caso de uso; escalable a millones de docs.'],
    ['Debilidad', 'Schema de Firestore es implícito (no hay validación tipo Cloud Firestore Data Bundle). '
     'Sync bidireccional con SAP tiene bugs recurrentes.'],
    ['Cuándo duele más', 'Cuando cambia un campo (rename, cambio de tipo). Nada te avisa que rompiste el frontend.'],
    ['Fix recomendado', '(a) Definir schemas con Zod o similar en el frontend. (b) Formalizar política de '
     'merge SAP ↔ App (ver Cap 4 #4).'],
]))

story.append(h2('5.3 Sincronización SAP ↔ App'))
story.append(kv_table([
    ['Estado', 'Cron cada 30 min. Bidireccional (SAP → app + app → SAP para pedidos).'],
    ['Fortaleza', 'Automatizado, sin intervención manual necesaria.'],
    ['Debilidad', 'Full snapshot (WRITE_TRUNCATE). Reglas de merge parcheadas en el código. '
     'Bugs recurrentes de "SAP pisa manual".'],
    ['Cuándo duele más', 'Cuando el admin edita 20 tiendas a mano y a los 30 min están perdidas.'],
    ['Fix recomendado', 'Diseño formal de política de merge + sync incremental cuando el volumen crezca.'],
]))

story.append(h2('5.4 Testing y calidad'))
story.append(kv_table([
    ['Estado', 'Cero tests automatizados. QA manual improvisada.'],
    ['Fortaleza', 'Ninguna. Todo cambio es riesgoso.'],
    ['Debilidad', 'Cada bug lo descubre un vendedor en producción. Retrabajo constante.'],
    ['Cuándo duele más', 'Cada semana. En las últimas 2, 4 rollbacks + 3 hotfixes por bugs de regresión.'],
    ['Fix recomendado', 'Playwright para 5-8 smoke tests. Costo de setup: 1 semana. '
     'Costo de mantener: 1h por test cada vez que cambia la UI.'],
]))

story.append(h2('5.5 Deploy y operaciones'))
story.append(kv_table([
    ['Estado', 'Push directo a main → GH Pages en 5 min. Sin staging.'],
    ['Fortaleza', 'Feedback loop rápido. Deploy trivial.'],
    ['Debilidad', 'Cero red de contención. Un typo va a producción. Rollback solo por git revert.'],
    ['Cuándo duele más', 'Cuando el autor hace un cambio "seguro" que resulta romper algo no obvio.'],
    ['Fix recomendado', 'Staging environment + CI con smoke tests + branch protection en main.'],
]))

story.append(h2('5.6 Observabilidad'))
story.append(kv_table([
    ['Estado', 'Cero. Errores del cliente no llegan a ningún sistema centralizado.'],
    ['Fortaleza', 'Ninguna.'],
    ['Debilidad', 'Los bugs viven ocultos hasta que un usuario los reporta.'],
    ['Cuándo duele más', 'Cuando un vendedor tiene un bug intermitente que no puede reproducir.'],
    ['Fix recomendado', 'Sentry para JS errors (free tier alcanza). Alertas de GH Actions a Teams/Slack.'],
]))

story.append(h2('5.7 Seguridad'))
story.append(kv_table([
    ['Estado', 'Firestore Rules bien pensadas. Secrets en GH Actions bien manejados.'],
    ['Fortaleza', 'Reglas granulares por rol. No hay credentials en el código del cliente.'],
    ['Debilidad', 'Password de SAP en Firestore (plain text) - accesible por cualquier admin. '
     'Sin rotación de credentials.'],
    ['Cuándo duele más', 'Ante desvinculación del autor o compromiso de una cuenta admin.'],
    ['Fix recomendado', '(a) Password SAP en Google Cloud KMS o Secret Manager. '
     '(b) Rotación programada de service accounts cada 90 días. '
     '(c) Audit trail explícito de accesos privilegiados (quién editó qué).'],
]))

story.append(h2('5.8 Escalabilidad'))
story.append(kv_table([
    ['Estado', 'Escala bien a 2-3x volumen actual. Techos entre 5x y 20x.'],
    ['Fortaleza', 'Firebase + BigQuery son escalables por diseño.'],
    ['Debilidad', '(a) index.html de 3.2MB pega en tiempo de carga. '
     '(b) Reads Firestore no paginados. '
     '(c) Power BI Desktop en máquina modesta.'],
    ['Cuándo duele más', 'Cuando el equipo crezca a 15-20 vendedores.'],
    ['Fix recomendado', 'Code splitting + paginated queries + Power BI Service en vez de Desktop.'],
]))
story.append(PageBreak())

# --- CAP 6: ROADMAP ---
story.append(h1('6. Roadmap por horizontes'))
story.append(p(
    'Cuatro horizontes de tiempo. Cada uno tiene objetivos concretos, '
    'entregables medibles y dependencias.'))

story.append(h2('Sprint 1 (2 semanas) — Quick wins de blindaje'))
story.append(p('Objetivo: <b>bajar el riesgo crítico de bus factor + zero visibility</b> con mínima inversión.'))
story.append(data_table(
    ['Tarea', 'Esfuerzo', 'Fixea qué issue del Cap 4'],
    [
        ['Handoff de accesos: transferir ownership de Firebase/GitHub/GCP a cuenta compartida', '1 día', '#1'],
        ['Documentar accesos críticos + procedimientos de rotación en runbook', '1 día', '#1'],
        ['Configurar Sentry (free tier) para JS errors', '1 día', '#5'],
        ['Configurar alertas GH Actions → mail al equipo (no solo autor)', '2 horas', '#5'],
        ['Backup automatizado nightly (cron) + retention 30 días en GCS', '2 días', '#12'],
        ['Feature flags básicos en app_config', '2 días', '#11'],
    ],
    col_widths=[9*cm, 2.5*cm, 4.5*cm]))
story.append(ok(
    '<b>Al final del Sprint 1:</b> el sistema tiene visibilidad de errores, alertas '
    'automáticas, backups nightly, y accesos duplicados. Ante desvinculación '
    'del autor, otro dev puede tomar el volante.'))

story.append(h2('Sprint 2 (1 mes) — Tests + monitoring'))
story.append(p('Objetivo: <b>bajar el riesgo de regresiones</b>. Los bugs no llegan a producción.'))
story.append(data_table(
    ['Tarea', 'Esfuerzo', 'Fixea qué issue del Cap 4'],
    [
        ['Setup Playwright + primer smoke test (login)', '2 días', '#2'],
        ['5 smoke tests: login, alta rápida, crear pedido, cargar visita, filtro provincia', '4 días', '#2'],
        ['CI GitHub Actions: correr tests en cada push, bloquear si fallan', '2 días', '#2, #7'],
        ['Staging environment (segundo Firebase project + rama develop)', '3 días', '#6'],
        ['Split del README en carpeta docs/ con archivos por tema', '2 días', '#10'],
    ],
    col_widths=[9*cm, 2.5*cm, 4.5*cm]))
story.append(ok(
    '<b>Al final del Sprint 2:</b> cada cambio pasa por CI antes de producción. '
    'Los tests capturan el 60-70% de bugs que hoy llegan a vendedores. '
    'Existe un ambiente donde probar cambios sin riesgo.'))

story.append(h2('Trimestre 1 (3 meses) — Refactor gradual + segunda persona'))
story.append(p('Objetivo: <b>eliminar la deuda técnica de mediano plazo</b>. Onboarding de un segundo dev.'))
story.append(data_table(
    ['Tarea', 'Esfuerzo', 'Fixea qué issue del Cap 4'],
    [
        ['Contratar/asignar segundo dev + training de 4 semanas', '4 semanas', '#1'],
        ['Migrar Firestore Rules a Custom Claims (elimina get() nested)', '1 semana', '#8'],
        ['Diseño formal de política de merge SAP ↔ App', '2 semanas', '#4'],
        ['Setup Vite bundler + primer módulo migrado (ej. auth.js)', '1 semana', '#3'],
        ['Migrar 5-8 módulos más (sync, mapa, pedidos, visitas)', '4 semanas', '#3'],
        ['CI con code review obligatorio (branch protection + PRs)', '3 días', '#7'],
        ['Dashboard de salud del sistema (Grafana o Metabase)', '1 semana', '#5'],
    ],
    col_widths=[9*cm, 2.5*cm, 4.5*cm]))
story.append(ok(
    '<b>Al final del Trimestre 1:</b> segundo dev productivo. Frontend refactorizado '
    'a módulos. Sync SAP con arquitectura clara. Dashboard de salud '
    'monitoreado por el equipo.'))

story.append(h2('Semestre 1 (6 meses) — Escalado y consolidación'))
story.append(p('Objetivo: <b>preparar el sistema para crecer a 20-50 vendedores</b>.'))
story.append(data_table(
    ['Tarea', 'Esfuerzo', 'Fixea qué issue del Cap 4'],
    [
        ['Migrar sync SAP a incremental (por UpdateDate > last_sync)', '2 semanas', '#9'],
        ['Password SAP a Cloud KMS + rotación automatizada', '1 semana', 'Seguridad'],
        ['Paginated queries en Firestore (bajar cost de reads)', '2 semanas', 'Escalabilidad'],
        ['Migrar reportes de PBI Desktop a PBI Service definitivo', '1 semana', 'Escalabilidad'],
        ['Notificaciones push nativas via FCM', '2 semanas', 'Feature'],
        ['Modo offline real (cola de pedidos + sync al volver)', '3 semanas', 'Feature'],
        ['DR drill mensual: restore de backup + verificar', '3 días recurrente', '#12'],
    ],
    col_widths=[9*cm, 2.5*cm, 4.5*cm]))
story.append(ok(
    '<b>Al final del Semestre 1:</b> sistema listo para escalar a 3-5x usuarios sin '
    'rewrite. Bugs residuales bajos. Costo operativo controlado. Segundo '
    'dev puede sostener el sistema en vacaciones del autor.'))

story.append(h2('Año 2+ — Cuándo migrar a arquitectura media/grande'))
story.append(p('Estos hitos son señales para ir a arquitectura más ambiciosa:'))
story.append(pl(
    '• <b>Más de 30 vendedores activos:</b> load del index.html empieza a doler. '
    'Refactor completo con React/Svelte y code splitting profundo.<br/>'
    '• <b>Ventas &gt; USD 10M/año:</b> justifica invertir en infra dedicada. '
    'Cloud Functions para lógica de negocio + API Gateway.<br/>'
    '• <b>Más de 3 devs trabajando:</b> TypeScript en todo el codebase, '
    'monorepo con pnpm, storybook para componentes.<br/>'
    '• <b>Compliance requirement (auditoría SOX, ISO 27001):</b> logs '
    'centralizados, audit trail formal, políticas de retención de datos.<br/>'
    '• <b>Expansión regional (LATAM):</b> multi-tenancy, i18n, deploys por '
    'región.'))
story.append(PageBreak())

# --- CAP 7: PRACTICAS DE INDUSTRIA ---
story.append(h1('7. Prácticas estándar de la industria'))
story.append(p(
    'Qué hacen las apps B2B SaaS con equipos de 5-20 devs. Se comparan '
    'contra lo que tenemos hoy:'))
story.append(data_table(
    ['Práctica', 'Industria estándar', 'App Shimano hoy', 'Gap'],
    [
        ['Tests automatizados', 'Cobertura >70%; CI bloqueante', 'Cero tests', 'Grande'],
        ['Code review', 'PR obligatorio + 1 aprobación', 'Push directo a main', 'Grande'],
        ['Staging environment', 'Ambiente separado, data cloneada', 'No existe', 'Grande'],
        ['Feature flags', 'LaunchDarkly / Unleash / propio', 'No existe', 'Medio'],
        ['Observability', 'Sentry / Datadog / New Relic', 'Solo consola del browser', 'Grande'],
        ['Documentación', 'README + docs/ + Notion team', 'README único de 3.4k líneas', 'Medio'],
        ['On-call rotation', 'PagerDuty / Opsgenie', 'Mail al autor', 'Medio'],
        ['Backup y DR', 'Nightly + DR drill trimestral', 'Backup manual, sin drill', 'Medio'],
        ['Secret management', 'Vault / AWS Secrets / GCP KMS', 'Firestore plain text (SAP pwd)', 'Medio'],
        ['Deploy strategy', 'Blue-green / canary', 'Full deploy a todos los users', 'Bajo'],
        ['SLI / SLO / SLA', 'Definidos formalmente', 'No definidos', 'Medio'],
        ['Metrics of business', 'MAU, DAU, retention, NPS', 'Solo tracking manual', 'Bajo'],
    ],
    col_widths=[3.5*cm, 5*cm, 4*cm, 2*cm]))
story.append(info(
    '<b>No hay que copiar todo.</b> Muchas de estas prácticas están overkill '
    'para 5 vendedores. Pero al menos hay que entender qué se está renunciando '
    'y por qué. El roadmap del Cap 6 apunta a cerrar los gaps "Grandes" que '
    'sí impactan hoy.'))
story.append(PageBreak())

# --- CAP 8: METRICAS DE EXITO ---
story.append(h1('8. Métricas de éxito'))
story.append(p(
    'Cómo saber que las mejoras están funcionando. Definir estas métricas '
    'AHORA (baseline pre-mejoras) y medir cada 3 meses.'))

story.append(h2('Métricas de calidad'))
story.append(data_table(
    ['Métrica', 'Baseline (hoy)', 'Objetivo 6 meses'],
    [
        ['Bugs en producción reportados por vendedores/mes', '~5-8', '&lt;2'],
        ['Rollbacks por mes', '2', '0'],
        ['Tiempo medio de detección de un bug', 'Días (usuario reporta)', 'Minutos (Sentry alerta)'],
        ['Tiempo medio de resolución de un bug crítico', '~2 horas', '&lt;30 min'],
        ['% de deploys sin regresión', 'Desconocido', '&gt;95%'],
        ['Cobertura de tests', '0%', '&gt;40% en flows críticos'],
    ],
    col_widths=[8*cm, 4*cm, 4*cm]))

story.append(h2('Métricas de operación'))
story.append(data_table(
    ['Métrica', 'Baseline', 'Objetivo 6 meses'],
    [
        ['Uptime app', 'Desconocido (no medido)', '&gt;99.5%'],
        ['Uptime sync SAP', 'Desconocido', '&gt;99%'],
        ['Latencia P95 de un pedido guardado', 'Desconocido', '&lt;2 seg'],
        ['Costo operativo mensual', 'USD 89', '&lt;USD 150 con 2x usuarios'],
        ['Tiempo de deploy end-to-end (commit → producción)', '~5 min', 'Mantener'],
    ],
    col_widths=[8*cm, 4*cm, 4*cm]))

story.append(h2('Métricas de negocio'))
story.append(data_table(
    ['Métrica', 'Baseline', 'Objetivo 6 meses'],
    [
        ['Vendedores activos (DAU)', '5-6', '10-15'],
        ['Pedidos cargados por mes', '~50', '~200'],
        ['Tiempo promedio de armar un pedido', 'Desconocido', 'Medido + baseline'],
        ['% de visitas con GPS matched', 'Desconocido', '&gt;80%'],
        ['NPS de los vendedores sobre la app', 'No medido', 'Medido trimestral'],
    ],
    col_widths=[8*cm, 4*cm, 4*cm]))

story.append(h2('Cómo medir estas métricas'))
story.append(pl(
    '• <b>Bugs / rollbacks / MTTR:</b> issues en GitHub o Trello. Cada bug '
    'reportado = una issue. Cada rollback = un tag en el commit.<br/>'
    '• <b>Uptime + latencia:</b> Sentry Performance (viene con el plan gratis) '
    'o UptimeRobot.<br/>'
    '• <b>Costos:</b> Firebase billing + GCP billing + Power BI billing. '
    'Alerta en GCP a USD 100/mes.<br/>'
    '• <b>Business metrics:</b> query BigQuery directa, mostrar en Power BI.<br/>'
    '• <b>NPS:</b> Google Form a los vendedores 1 vez cada 3 meses.'))
story.append(PageBreak())

# --- CAP 9: RIESGOS SI NO SE HACE NADA ---
story.append(h1('9. Riesgos si NO se hace nada'))
story.append(p(
    'Escenarios probables si el sistema sigue como está, sin las mejoras '
    'propuestas:'))

story.append(h2('Escenario 1: Desvinculación del autor'))
story.append(warn(
    '<b>Probabilidad: media. Impacto: crítico.</b><br/><br/>'
    'Si Mariano se va de Shimano (vacaciones prolongadas, cambio de trabajo, '
    'enfermedad), la app queda paralizada 4-8 semanas hasta que otro dev '
    'entienda el código. Durante ese tiempo:<br/>'
    '• Bugs sin fix: los vendedores empiezan a desconfiar de la app.<br/>'
    '• Sync SAP puede fallar y nadie sabe cómo debuggear.<br/>'
    '• Accesos críticos (Firebase, GitHub) están en cuenta personal de Mariano.<br/><br/>'
    '<b>Costo estimado:</b> 4-8 semanas de productividad del equipo comercial + '
    'costo de contratar consultor externo (USD 5.000-15.000) para retomar el proyecto.'))

story.append(h2('Escenario 2: Bug crítico en producción'))
story.append(warn(
    '<b>Probabilidad: alta (ya pasó varias veces). Impacto: alto.</b><br/><br/>'
    'Un cambio "seguro" rompe una feature crítica (ej: los vendedores no pueden '
    'cargar pedidos por 2-4 horas). Sin observabilidad, no hay alerta. Sin '
    'tests, el bug pasó por CI. Los vendedores lo descubren, escriben por '
    'Teams, autor tiene que interrumpir lo que esté haciendo para '
    'debuggear.<br/><br/>'
    '<b>Costo:</b> pérdida directa de pedidos (10-30 pedidos que se caen), '
    'reputación de la app dentro del equipo comercial, retrabajo. '
    '<b>Frecuencia esperada:</b> 1-2 veces al mes.'))

story.append(h2('Escenario 3: Growth explosivo'))
story.append(warn(
    '<b>Probabilidad: media. Impacto: alto.</b><br/><br/>'
    'Shimano decide expandir la app a otras unidades (Bike) o regiones (LATAM). '
    'El equipo crece a 20-30 vendedores en 6 meses. La app actual empieza '
    'a doler:<br/>'
    '• Load del index.html tarda 8+ segundos en 4G.<br/>'
    '• Firestore reads bill llega a USD 500-800/mes.<br/>'
    '• Sync SAP full snapshot demora 20+ min cada corrida.<br/>'
    '• Un solo dev no puede sostener el crecimiento.<br/><br/>'
    '<b>Costo:</b> rewrite forzado bajo presión = 3-6 meses de un equipo de 3 devs = USD 100k-300k. '
    'Vs invertir gradualmente (roadmap propuesto) = USD 30-50k distribuidos.'))

story.append(h2('Escenario 4: Auditoría / compliance'))
story.append(warn(
    '<b>Probabilidad: baja hoy, media si Shimano corporate audita. Impacto: alto.</b><br/><br/>'
    'Una auditoría interna o externa evalúa la app y detecta:<br/>'
    '• Password SAP en Firestore plain text: falla control de seguridad.<br/>'
    '• Sin audit trail formal de accesos privilegiados.<br/>'
    '• Sin política de retención de datos de clientes.<br/>'
    '• Cero tests → dependency on "trust".<br/><br/>'
    '<b>Costo:</b> remediation obligatoria bajo timeline apretado (30-60 días), '
    'costo similar al escenario 3 pero con más presión.'))

story.append(h2('Escenario 5: Ninguna de las anteriores'))
story.append(info(
    '<b>Probabilidad: baja. Impacto: negativo por acumulación.</b><br/><br/>'
    'Si nada disruptivo pasa, la app va acumulando deuda técnica lentamente. '
    'Cada nuevo feature se vuelve más caro de agregar. Los bugs "se conviven" '
    '(no se arreglan, se documentan como "known issues"). En 12-18 meses, '
    'agregar cualquier feature simple tomará 3-4x el tiempo que tomaría hoy.<br/><br/>'
    '<b>Costo:</b> lento pero cierto. Productividad del dev bajando ~10% cada '
    'trimestre por deuda acumulada.'))
story.append(PageBreak())

# --- ANEXO A: BUGS REALES ---
story.append(h1('Anexo A: bugs reales de las últimas semanas'))
story.append(p(
    'Casos concretos que ilustran los puntos débiles. Cada uno con su '
    'commit hash para poder auditar.'))

story.append(h2('Caso 1: KPI PENDIENTES mostraba 16, tab NO CONFIRMADOS mostraba 3 (v293)'))
story.append(kv_table([
    ['Fecha', '2026-07-13'],
    ['Commit del fix', 'b155b98'],
    ['Cómo se descubrió', 'Mariano lo vio en producción'],
    ['Causa raíz', 'Dos filtros diferentes para el mismo concepto en distintas partes del código'],
    ['Se habría atrapado con', 'Smoke test que verifique "KPI del header == cantidad de items en la lista"'],
    ['Cap 4 relacionado', '#2 (cero tests)'],
]))

story.append(h2('Caso 2: Fantasías cargadas manualmente pisadas por el sync (v300)'))
story.append(kv_table([
    ['Fecha', '2026-07-14'],
    ['Commit del fix', '98a6864'],
    ['Cómo se descubrió', 'Mariano lo reportó explícitamente ("cargué a mano fantasías y desaparecieron")'],
    ['Causa raíz', 'Sync SAP hacía set(merge=True) con field.fantasia siempre presente en el payload'],
    ['Se habría atrapado con', 'Test de integración del sync: verificar que docs con marca manual no se pisan'],
    ['Cap 4 relacionado', '#4 (sync SAP con bugs recurrentes)'],
]))

story.append(h2('Caso 3: Power BI Desktop se colgó por schema change (rollback en 2 pasos)'))
story.append(kv_table([
    ['Fecha', '2026-07-13'],
    ['Commits', 'e5cef77 (intento) → 7729ced (rollback quirúrgico) → f1f441a (rollback total)'],
    ['Cómo se descubrió', 'Mariano intentando refresh en PBI, freeze de 30+ minutos'],
    ['Causa raíz', 'Cambio de schema + JSON string gigante (lines_json) hizo explotar VertiPaq'],
    ['Se habría atrapado con', 'Staging environment con PBI de prueba conectado antes de push a prod'],
    ['Cap 4 relacionado', '#6 (sin staging)'],
]))

story.append(h2('Caso 4: Filtro por provincia Salta mostraba 0 clientes'))
story.append(kv_table([
    ['Fecha', '2026-07-14'],
    ['Commit del fix', '4272418'],
    ['Cómo se descubrió', 'Mariano lo probó al azar'],
    ['Causa raíz', 'Bug de datos: sync SAP cargó provincias mal para varios BPs (YAMIN CHUBUT cuando es SALTA)'],
    ['Se habría atrapado con', 'Data quality checks periódicos: alertar cuando un BP tiene provincia distinta a la de sus BPAddresses'],
    ['Cap 4 relacionado', '#5 (observabilidad) + #4 (sync SAP)'],
]))

story.append(h2('Caso 5: Gerente no veía las visitas de los vendedores (v298)'))
story.append(kv_table([
    ['Fecha', '2026-07-14'],
    ['Commit del fix', '9afeb68'],
    ['Cómo se descubrió', 'Pablo (gerente) lo pidió explícitamente por Teams'],
    ['Causa raíz', 'Listener JS filtraba por ownerUid para roles distintos de admin/viewer, incluido gerente'],
    ['Se habría atrapado con', 'Smoke test: "gerente ve visitas de todos los vendedores"'],
    ['Cap 4 relacionado', '#2 (cero tests)'],
]))
story.append(PageBreak())

# --- ANEXO B: DEUDA TECNICA ---
story.append(h1('Anexo B: deuda técnica cuantificada'))
story.append(p(
    'Lista concreta de "TODOs" y patches que existen hoy en el código. '
    'No son bugs (funcionan) pero son parches que se acumulan.'))

story.append(h2('En el frontend'))
story.append(data_table(
    ['Deuda', 'Ubicación', 'Impacto'],
    [
        ['Funciones globales sin namespace (fs*, mc*, tgt*, sap*, etc)', 'index.html todo', 'Colisiones potenciales; difícil grep'],
        ['CSS inline mezclado con classes', 'index.html', 'Dificulta refactor visual'],
        ['Bloque hidden de vf-localidad (backwards compat) en el form Visita', 'index.html línea 2123', 'Confusión para lectores nuevos'],
        ['fantasia y source como campos separados en client_applications', 'schema Firestore', 'Podría ser un objeto {value, source, updatedBy}'],
        ['Encoding: catálogo de productos con U+FFFD por bytes latin-1', 'sap_items_raw', 'Parche con REPLACE en SQL de vistas BQ'],
        ['Overrides manuales de familia por item_code hardcodeados', 'v_sap_items_enriched', 'Debería estar en tabla config'],
    ],
    col_widths=[6*cm, 6*cm, 4.5*cm]))

story.append(h2('En el sync SAP'))
story.append(data_table(
    ['Deuda', 'Ubicación', 'Impacto'],
    [
        ['WRITE_TRUNCATE completo cada corrida', 'sync_sap_to_bigquery.py', 'Costo lineal con volumen'],
        ['Múltiples UDF_DIVISION_KEYS probados por variabilidad de SAP', 'sync_sap_to_firestore.py', 'Hack por bugs de configuración SAP'],
        ['Overrides manuales para 7 SKUs sin familia', 'views.sql', 'Deberían venir del catálogo'],
        ['provincia mal cargada en varios BPs (fix manual desde Excel)', 'client_applications', 'Bug de root cause en SAP no arreglado'],
        ['SlpCodes 50-55 hardcoded en v_targets (no existen en SAP prod aún)', 'views.sql', 'Requiere update cuando SEIDOR los cree'],
    ],
    col_widths=[6*cm, 6*cm, 4.5*cm]))

story.append(h2('En operaciones'))
story.append(data_table(
    ['Deuda', 'Ubicación', 'Impacto'],
    [
        ['Password SAP en Firestore plain text', 'app_config/sap_integration', 'Riesgo seguridad'],
        ['Service accounts sin rotación', 'GitHub secrets', 'Riesgo seguridad'],
        ['README de 3.400 líneas en 1 archivo', 'README.md', 'Difícil navegar'],
        ['Backup manual desde admin panel', 'index.html', 'Nadie lo dispara regularmente'],
        ['DR (disaster recovery) sin probar', '-', 'No sabemos si el backup sirve'],
        ['Deploy sin canary o gradual rollout', 'GH Pages', 'Todo o nada'],
    ],
    col_widths=[6*cm, 6*cm, 4.5*cm]))

story.append(sp(30))
story.append(warn(
    '<b>Regla de oro:</b> por cada parche que se agregue en el futuro, agregar '
    'una entrada acá en el Anexo B. Si la lista crece a más de 30 items, es '
    'señal de que hace falta un sprint dedicado a limpiar deuda.'))

story.append(sp(30))
story.append(Paragraph(
    'FIN DEL DOCUMENTO',
    ParagraphStyle('End', parent=st_title, fontSize=20,
                   textColor=colors.HexColor('#94a3b8'))))
story.append(sp(20))
story.append(Paragraph(
    'Este análisis se basa en el estado del código a fecha de generación. '
    'Debería revisarse cada 6 meses o cada vez que se completen los sprints '
    'propuestos.<br/><br/>'
    'Documento complementario: <b>APP SHIMANO MANUAL.pdf</b> (documentación técnica completa).<br/><br/>'
    'Para preguntas: mariano.erbino@shimano.com.ar',
    st_body))

# --- BUILD ---
doc = SimpleDocTemplate(str(OUT), pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm)
doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print(f'OK -> {OUT}')
print(f'Tamano: {OUT.stat().st_size / 1024:.1f} KB')
