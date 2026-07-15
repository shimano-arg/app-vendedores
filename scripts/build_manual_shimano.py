"""Genera el PDF 'APP SHIMANO MANUAL' con toda la doc tecnica de la app
para que un sucesor entienda el proyecto sin apoyo del autor.

Output: C:/Users/shimano.sandbox/Desktop/APP SHIMANO MANUAL.pdf
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
    KeepTogether, ListFlowable, ListItem
)

OUT = Path.home() / 'Desktop' / 'APP SHIMANO MANUAL.pdf'
TODAY = datetime.now().strftime('%d/%m/%Y')

# ---------- Estilos ----------
styles = getSampleStyleSheet()
BASE_FONT = 'Helvetica'
MONO_FONT = 'Courier'

st_title = ParagraphStyle('CoverTitle', parent=styles['Title'],
    fontName=BASE_FONT + '-Bold', fontSize=32, leading=38,
    textColor=colors.HexColor('#0c4a6e'), alignment=TA_CENTER, spaceAfter=18)
st_subtitle = ParagraphStyle('CoverSub', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=14, leading=18,
    textColor=colors.HexColor('#475569'), alignment=TA_CENTER, spaceAfter=10)
st_meta = ParagraphStyle('CoverMeta', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=11, leading=14,
    textColor=colors.HexColor('#64748b'), alignment=TA_CENTER)

st_h1 = ParagraphStyle('H1', parent=styles['Heading1'],
    fontName=BASE_FONT + '-Bold', fontSize=20, leading=24,
    textColor=colors.HexColor('#0c4a6e'), spaceBefore=6, spaceAfter=12,
    keepWithNext=True)
st_h2 = ParagraphStyle('H2', parent=styles['Heading2'],
    fontName=BASE_FONT + '-Bold', fontSize=14, leading=18,
    textColor=colors.HexColor('#0369a1'), spaceBefore=14, spaceAfter=6,
    keepWithNext=True)
st_h3 = ParagraphStyle('H3', parent=styles['Heading3'],
    fontName=BASE_FONT + '-Bold', fontSize=11.5, leading=14,
    textColor=colors.HexColor('#334155'), spaceBefore=10, spaceAfter=4,
    keepWithNext=True)

st_body = ParagraphStyle('Body', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=10, leading=14,
    textColor=colors.HexColor('#0f172a'), spaceAfter=6, alignment=TA_JUSTIFY)
st_body_left = ParagraphStyle('BodyLeft', parent=st_body, alignment=TA_LEFT)
st_body_small = ParagraphStyle('BodySmall', parent=st_body,
    fontSize=9, leading=12)

st_code = ParagraphStyle('Code', parent=styles['Normal'],
    fontName=MONO_FONT, fontSize=8.5, leading=11,
    textColor=colors.HexColor('#0f172a'),
    backColor=colors.HexColor('#f1f5f9'),
    borderColor=colors.HexColor('#cbd5e1'),
    borderWidth=0.5, borderPadding=6,
    leftIndent=4, rightIndent=4,
    spaceBefore=4, spaceAfter=8)

st_callout = ParagraphStyle('Callout', parent=st_body,
    fontSize=9.5, leading=13,
    textColor=colors.HexColor('#78350f'),
    backColor=colors.HexColor('#fef3c7'),
    borderColor=colors.HexColor('#fbbf24'),
    borderWidth=0.5, borderPadding=8,
    leftIndent=4, rightIndent=4,
    spaceBefore=6, spaceAfter=8)

st_toc_entry = ParagraphStyle('TOC', parent=styles['Normal'],
    fontName=BASE_FONT, fontSize=10.5, leading=16,
    textColor=colors.HexColor('#0f172a'))

# ---------- Helpers ----------
def h1(text): return Paragraph(text, st_h1)
def h2(text): return Paragraph(text, st_h2)
def h3(text): return Paragraph(text, st_h3)
def p(text): return Paragraph(text, st_body)
def pl(text): return Paragraph(text, st_body_left)
def code(text):
    # Escapar tags HTML del texto de codigo
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    text = text.replace('\n', '<br/>').replace(' ', '&nbsp;')
    return Paragraph(text, st_code)
def callout(text): return Paragraph(text, st_callout)
def sp(h=8): return Spacer(1, h)

def kv_table(rows, col_widths=None):
    """Tabla de 2 columnas key/value."""
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

def data_table(header, rows, col_widths=None):
    """Tabla con header estilo grid."""
    data = [header] + rows
    style = TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0369a1')),
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

# ---------- Header y Footer ----------
def on_page(canvas, doc):
    canvas.saveState()
    # Header
    if doc.page > 1:
        canvas.setFont(BASE_FONT, 8)
        canvas.setFillColor(colors.HexColor('#64748b'))
        canvas.drawString(2*cm, 28*cm,
            'APP SHIMANO MANUAL  ·  Manual técnico completo')
        canvas.drawRightString(19*cm, 28*cm, f'{TODAY}')
        canvas.setStrokeColor(colors.HexColor('#cbd5e1'))
        canvas.setLineWidth(0.3)
        canvas.line(2*cm, 27.7*cm, 19*cm, 27.7*cm)
    # Footer
    canvas.setFont(BASE_FONT, 8)
    canvas.setFillColor(colors.HexColor('#94a3b8'))
    canvas.drawCentredString(A4[0]/2, 1.3*cm, f'Página {doc.page}')
    canvas.restoreState()

# ---------- Contenido ----------
story = []

# === PORTADA ===
story.append(Spacer(1, 6*cm))
story.append(Paragraph('APP SHIMANO', st_title))
story.append(Paragraph('MANUAL TÉCNICO COMPLETO', st_title))
story.append(sp(20))
story.append(Paragraph(
    'Sistema comercial de Shimano Argentina<br/>'
    'para gestión de vendedores, pedidos y visitas',
    st_subtitle))
story.append(sp(50))
story.append(Paragraph(
    f'Versión de la app: SW v301<br/>'
    f'Documento generado: {TODAY}<br/>'
    'Autor: Mariano Erbino (Data Scientist, Shimano Argentina)',
    st_meta))
story.append(sp(80))
story.append(Paragraph(
    '<i>Este documento describe la arquitectura, componentes, operación y '
    'costos de la app de vendedores de Shimano Argentina. Está pensado '
    'para que cualquier persona pueda entender cómo funciona el sistema '
    'end-to-end sin apoyo del autor original.</i>',
    st_body))
story.append(PageBreak())

# === INDICE ===
story.append(h1('Índice'))
toc_items = [
    ('1', 'Resumen ejecutivo', '3'),
    ('2', 'Contexto de negocio', '4'),
    ('3', 'Arquitectura general', '6'),
    ('4', 'Frontend: PWA en GitHub Pages', '9'),
    ('5', 'Firebase (backend)', '13'),
    ('6', 'GitHub: repo, Pages y Actions', '18'),
    ('7', 'Integración con SAP Business One', '22'),
    ('8', 'BigQuery: pipeline de datos', '26'),
    ('9', 'Power BI: dashboards y suscripciones', '30'),
    ('10', 'Cron jobs y automatización', '33'),
    ('11', 'Deploy, versionado y regla del README', '35'),
    ('12', 'Modelo de datos Firestore', '37'),
    ('13', 'Roles y permisos', '40'),
    ('14', 'Scripts operativos', '42'),
    ('15', 'Costos operativos', '44'),
    ('16', 'Contactos y accesos críticos', '45'),
    ('17', 'Runbook: problemas comunes', '46'),
    ('18', 'Decisiones tomadas y roadmap', '49'),
    ('19', 'Glosario', '51'),
]
toc_table = Table(
    [[i[0], i[1], i[2]] for i in toc_items],
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

# === CAPITULO 1: RESUMEN EJECUTIVO ===
story.append(h1('1. Resumen ejecutivo'))
story.append(p(
    'La <b>App Shimano</b> es una aplicación web (PWA) desarrollada '
    'internamente para el equipo comercial de Shimano Argentina. Cubre el '
    'ciclo completo de venta: gestión territorial por zona, alta de '
    'clientes nuevos, visitas con GPS a tiendas, armado de pedidos con '
    'sugerencias inteligentes, rendiciones de gastos con OCR de tickets, '
    'rutas mensuales optimizadas, y sincronización bidireccional con '
    'SAP Business One.'))
story.append(p(
    'La app nació como respuesta a la transición del modelo '
    'comercial de Shimano Argentina: hasta 2024, la distribución se '
    'hacía a través de Baraldo (distribuidor único); a partir '
    'de 2025, Shimano vende directamente a las tiendas de pesca. Este '
    'cambio requiere que el equipo interno de vendedores tenga las '
    'herramientas para gestionar cientos de tiendas en todo el país, '
    'sin infraestructura previa.'))
story.append(h2('Datos clave del sistema (a julio 2026)'))
story.append(kv_table([
    ['URL pública', 'https://shimano-arg.github.io/app-vendedores/'],
    ['Repositorio', 'https://github.com/shimano-arg/app-vendedores'],
    ['Firebase project', 'app-vendedores-shimano'],
    ['SAP Company DB (PROD)', 'SHIMANO_SAU'],
    ['SAP Company DB (TEST)', 'SHIMANO_TST_06'],
    ['SAP Service Layer', 'https://shimano-sap.seidor.com.ar:50000'],
    ['Vendedores externos (VDE)', '4 (Gonzalo, Federico, Martin, Mauricio)'],
    ['Vendedores internos (VDI)', '2 (Ioannis, Santiago)'],
    ['Clientes SAP-confirmados', '~127 en client_applications'],
    ['SKUs pesca sincronizados', '~755 en sap_items_raw'],
    ['Facturas históricas (24 meses)', '~4.700 en sap_invoices_raw'],
    ['Versión actual del frontend', 'SW v301 / APP_VERSION v301'],
    ['Stack principal', 'HTML5 + Vanilla JS + Firebase Firestore + Gemini API'],
    ['Costo operativo mensual', '~USD 89'],
]))
story.append(PageBreak())

# === CAPITULO 2: CONTEXTO DE NEGOCIO ===
story.append(h1('2. Contexto de negocio'))
story.append(h2('El cambio de modelo comercial'))
story.append(p(
    'Hasta el 2024, Shimano Argentina distribuía todos sus productos '
    '(cañas, reeles, líneas, indumentaria) a través de <b>Baraldo</b>, '
    'un distribuidor único que revendía al retail de pesca. '
    'A partir del 2025, Shimano opera con <b>venta directa</b>: el equipo '
    'comercial interno atiende directamente a las tiendas de pesca en todo '
    'el país. Este cambio requiere:'))
story.append(pl(
    '• Un padrón propio de clientes (antes lo tenía Baraldo).<br/>'
    '• Un equipo comercial que visite tiendas, arme pedidos y los cargue en SAP.<br/>'
    '• Herramientas de gestión territorial: quién atiende qué zona.<br/>'
    '• Tablero para el gerente comercial (Pablo Gonzalez) y dirección (Diego).<br/>'
    '• Integración con SAP Business One (ERP financiero-logístico).'))

story.append(h2('Roles funcionales del sistema'))
story.append(data_table(
    ['Rol', 'Persona(s)', 'Alcance'],
    [
        ['Administrador', 'Mariano Erbino (autor)', 'Acceso total. Config sistema, resolución de bugs, gestión de datos maestros.'],
        ['Gerente comercial', 'Pablo Gonzalez', 'Ve todo el mapa/pedidos/visitas. Carga targets mensuales. Aprueba altas de clientes. NO edita config sistema.'],
        ['Dirección', 'Diego', 'Solo lectura. Ve dashboards y reportes por email.'],
        ['Vendedor externo (VDE)', '4 personas', 'Solo su zona. Crea pedidos y visitas propios. Alta rápida de clientes.'],
        ['Vendedor interno (VDI)', '2 personas', 'Zona de sus VDEs pareja. Puede crear en nombre del VDE (para soporte cuando el externo no puede).'],
        ['Viewer', 'Solo cuentas de auditoría', 'Solo lectura.'],
    ],
    col_widths=[3*cm, 4*cm, 10*cm]))

story.append(h2('Mapeo territorial'))
story.append(p(
    'Argentina está dividida en <b>6 zonas comerciales</b>. Los vendedores '
    'externos (VDEs) atienden principalmente las zonas centrales; los internos '
    '(VDIs) cubren zonas grandes/dispersas donde no hay VDE (Patagonia, NOA, NEA):'))
story.append(data_table(
    ['Zona', 'Vendedor', 'Tipo', 'Cobertura'],
    [
        ['Z1', 'Gonzalo de la Rosa', 'VDE', 'Chubut, Santa Cruz, Tierra del Fuego'],
        ['Z2', 'Federico Castelanelli', 'VDE', 'Buenos Aires (norte), CABA'],
        ['Z4', 'Martin Boiero', 'VDE', 'Córdoba, Santa Fe, San Luis'],
        ['Z5', 'Mauricio Gil', 'VDE', 'Entre Ríos, Corrientes'],
        ['Z6', 'Ioannis Palkoudakis', 'VDI', 'Neuquén, Río Negro, La Pampa, Mendoza (parte Patagonia)'],
        ['Z7', 'Santiago Esteban', 'VDI', 'Salta, Jujuy, Tucumán, Formosa, Chaco, Misiones (NOA + NEA)'],
    ],
    col_widths=[1.5*cm, 4.5*cm, 1.5*cm, 9.5*cm]))
story.append(callout(
    '<b>Provincias hardcoded a VDIs:</b> Patagonia + Mendoza → Ioannis. '
    'NOA + NEA → Santiago Esteban. Estas asignaciones están en el '
    'código del build script <font face="Courier">_build_argentina_zonas_v2.py</font> '
    'y no se pueden cambiar desde la app.'))
story.append(PageBreak())

# === CAPITULO 3: ARQUITECTURA GENERAL ===
story.append(h1('3. Arquitectura general'))
story.append(p(
    'La app es una <b>PWA (Progressive Web App)</b> servida como archivo '
    'estático desde GitHub Pages. No hay servidor de aplicaciones propio: '
    'toda la lógica corre en el navegador del vendedor. El backend es '
    'Firebase Firestore (base de datos + autenticación). El pipeline de '
    'datos analíticos usa BigQuery. La integración con SAP se hace '
    'via Service Layer (REST) desde scripts Python que corren en GitHub Actions.'))

story.append(h2('Diagrama de alto nivel'))
story.append(code(
    '                        USUARIOS (5-10 vendedores + gerente + admin)\n'
    '                                         |\n'
    '                                         v\n'
    '     +--------------------------------------------------------------+\n'
    '     |  PWA en el navegador del vendedor (celular o desktop)         |\n'
    '     |  Servida desde GitHub Pages (index.html ~3.2 MB)              |\n'
    '     |  Vanilla JS + Leaflet (mapa) + SheetJS (Excel) + Firebase SDK |\n'
    '     +--------------------------------------------------------------+\n'
    '           |                    |                          |\n'
    '           v                    v                          v\n'
    '     Firebase Auth       Firebase Firestore         Firebase Storage\n'
    '     (Google/MSFT       (todas las colecciones      (fotos de tickets\n'
    '      login + email)     de la app - vive real-time  y visitas)\n'
    '                        con onSnapshot listeners)\n'
    '                                |\n'
    '                                | Firebase Extensions\n'
    '                                | firestore-bigquery-export (real-time)\n'
    '                                v\n'
    '     +--------------------------------------------------------------+\n'
    '     |  BigQuery dataset shimano_app (southamerica-east1)           |\n'
    '     |  - 7 tablas *_raw_latest (Firestore streams)                 |\n'
    '     |  - 7 tablas sap_*_raw (SAP pull cada 30 min)                 |\n'
    '     |  - 9 vistas curadas v_* (para Power BI)                      |\n'
    '     +--------------------------------------------------------------+\n'
    '                                |\n'
    '                                v\n'
    '                        Power BI Service\n'
    '                        (Modelo TABLERO SAR + suscripción email diaria)\n'
    '\n'
    '     Sistemas laterales:\n'
    '     - SAP Business One (Service Layer + DTW manual como backup)\n'
    '     - Google Gemini API (OCR de tickets de rendición)\n'
    '     - Power Automate (SharePoint sync de rendiciones aprobadas)\n'
    '     - GitHub Actions (crons + sync SAP -> Firestore/BigQuery)'
))

story.append(h2('Flujo de un pedido, de punta a punta'))
story.append(p('Ejemplo de un vendedor cargando un pedido en la app:'))
items = [
    'El vendedor abre la app en su celular (PWA instalada). Firebase Auth valida su sesión. Se cargan las colecciones que necesita (roles, client_applications, product_catalog) via <font face="Courier">onSnapshot</font>.',
    'Filtra por zona/provincia/localidad en la barra superior. Elige un cliente confirmado en SAP (por CardCode).',
    'Doble-click en el cliente → se abre el modal de pedido. La izquierda muestra el picker de 755 productos pesca; la derecha muestra las líneas del pedido y los sugeridos basados en el historial de compras de esa tienda.',
    'Agrega productos, ajusta cantidad y forma de pago. El pedido se guarda en tiempo real en Firestore como "En curso".',
    '"Pasar a pendientes" → el pedido pasa a la pestaña PENDIENTES para que admin lo revise.',
    'Admin (o el mismo vendedor) le da "Confirmar definitivo" → el pedido pasa a CONFIRMADOS y se dispara el envío a SAP (via Service Layer directo, o descarga como ZIP DTW).',
    'Santiago Beron (SAP admin) recibe la Sales Quotation en SAP y la aprueba manualmente.',
    'En paralelo, el pedido queda en Firestore. La Firebase Extension lo copia a BigQuery en segundos. La próxima corrida del refresh de Power BI (15:00 hs) lo trae al dashboard.',
    'Mariano y Diego reciben por email el snapshot del dashboard con los nuevos KPIs.',
]
story.append(ListFlowable(
    [ListItem(p(t), leftIndent=15) for t in items],
    bulletType='1', bulletFontSize=10))

story.append(PageBreak())

# === CAPITULO 4: FRONTEND ===
story.append(h1('4. Frontend: PWA en GitHub Pages'))
story.append(h2('Filosofía de diseño'))
story.append(p(
    'La app es un <b>archivo HTML único de ~3.2 MB</b> (index.html) con '
    'todo embebido: CSS, JavaScript, datos maestros (padrón de tiendas, '
    'catálogo de productos, geografía de Argentina como polígonos). '
    'No hay bundler ni framework. Esta decisión fue deliberada para '
    'minimizar fricciones de mantenimiento: cualquier persona con conocimientos '
    'básicos de JS/HTML puede editar el código sin instalar toolchain.'))
story.append(h3('Trade-offs conscientes'))
story.append(pl(
    '<b>Ventajas:</b><br/>'
    '• Cero build step: <font face="Courier">git push</font> → en 5 minutos está en producción.<br/>'
    '• Deployment simple: GitHub Pages con CDN global gratis.<br/>'
    '• Sin dependencias de npm; sin lock files rotos.<br/>'
    '• Funciona offline (Service Worker cachea el HTML).<br/>'
    '• Instalable como PWA en celulares (iOS y Android).<br/>'
    '<br/>'
    '<b>Contras:</b><br/>'
    '• 27.000+ líneas en un solo archivo: difícil de navegar.<br/>'
    '• Cada usuario descarga 3.2 MB en la primera carga.<br/>'
    '• Sin type checking (JavaScript, no TypeScript).<br/>'
    '• Sin tests automatizados (hoy). Cada cambio es riesgoso.'))

story.append(h2('Stack técnico'))
story.append(data_table(
    ['Capa', 'Tecnología', 'Detalles'],
    [
        ['HTML + CSS', 'Vanilla', 'Sin framework CSS. Estilos inline y en <font face="Courier">&lt;style&gt;</font> global.'],
        ['JavaScript', 'Vanilla ES6+', 'Sin framework. Funciones globales con prefijos por módulo (fs*, mc*, tgt*, sap*, etc).'],
        ['Mapa', 'Leaflet 1.9.4', 'CDN unpkg. Tiles CartoDB Positron (OSM).'],
        ['Excel', 'SheetJS 0.18.5 + ExcelJS 4.4.0', 'SheetJS para lectura/escritura simple. ExcelJS para exports con foto embebida.'],
        ['ZIP', 'JSZip 3.10.1', 'Backup TOTAL de la app + ZIP DTW para SAP.'],
        ['Auth + DB', 'Firebase Compat SDK 10.7.1', 'Auth + Firestore + Storage.'],
        ['QR', 'qrcode.js 1.0.0', 'Setup 2FA con Google Authenticator.'],
        ['OCR', 'Google Gemini API (gemini-2.5-flash)', 'REST. OCR de tickets de rendición.'],
        ['Geocoding', 'OpenStreetMap Nominatim', 'Gratis, country=AR.'],
        ['Hosting', 'GitHub Pages', 'Deploy automático desde rama main.'],
        ['Build offline', 'Python 3 + openpyxl', 'Genera el HTML desde Excels master (script _build_argentina_zonas_v2.py).'],
        ['Storage local', 'localStorage + IndexedDB', 'Persistencia offline. Firestore usa IndexedDB para cache real-time.'],
    ],
    col_widths=[3*cm, 5*cm, 9.5*cm]))

story.append(h2('Estructura del código'))
story.append(code(
    'shimano-arg/app-vendedores/\n'
    '├── index.html                  # App completa (~3.2 MB, ~27k líneas)\n'
    '├── alta-cliente.html           # Formulario público standalone\n'
    '├── manifest.json               # PWA manifest\n'
    '├── sw.js                       # Service Worker (~100 líneas)\n'
    '├── stock.json                  # Snapshot stock SAP (auto-generado)\n'
    '├── login-bg.jpg                # Foto de fondo del login\n'
    '├── Shimano-Logo.png            # Logo\n'
    '├── icon-*.png                  # PWA icons (180, 192, 512)\n'
    '├── .nojekyll                   # Deshabilita Jekyll en Pages\n'
    '├── .github/workflows/          # GitHub Actions crons\n'
    '│   ├── sync-sap-catalog-stock.yml       # cron 13,43 * * * *\n'
    '│   ├── sync-sap-to-bigquery.yml         # cron 13,43 * * * *\n'
    '│   └── send-rendiciones-email.yml       # cron Lun/Mie 9am AR\n'
    '├── scripts/                    # Python: sync SAP, exports, mails\n'
    '│   ├── sync_sap_to_firestore.py         # SAP -> Firestore\n'
    '│   ├── sync_sap_to_bigquery.py          # SAP -> BigQuery\n'
    '│   ├── send_rendiciones_email.py        # cron mail\n'
    '│   └── [scripts operativos]              # bulk imports, verify, etc\n'
    '├── bigquery/\n'
    '│   └── views.sql                        # 9 vistas curadas\n'
    '└── README.md                   # doc viva del proyecto\n'
))

story.append(h2('Service Worker (PWA + cache)'))
story.append(p(
    'El SW hace <b>network-first para el HTML</b> (siempre trae la última '
    'versión si hay red, cae al cache si no hay) y <b>cache-first para '
    'assets locales</b> (iconos, manifest, logo). Los assets de CDN (Firebase, '
    'Leaflet, tiles OSM) no se interceptan, van directo a red.'))
story.append(p(
    'Cada deploy que cambia el HTML requiere bump manual de '
    '<font face="Courier">CACHE_VERSION</font> en <font face="Courier">sw.js</font> '
    'y de <font face="Courier">APP_VERSION</font> en <font face="Courier">index.html</font>. '
    'Ambos deben quedar sincronizados. La app muestra un banner en consola al '
    'arrancar comparando ambos: si difieren, algo está mal.'))
story.append(callout(
    '<b>Convención:</b> después de cualquier cambio en el frontend, '
    'ejecutar <font face="Courier">git commit</font> con:<br/>'
    '1. Editar el código.<br/>'
    '2. Incrementar <font face="Courier">CACHE_VERSION = \'v302\'</font> en sw.js.<br/>'
    '3. Incrementar <font face="Courier">APP_VERSION = \'v302\'</font> en index.html.<br/>'
    '4. Actualizar la fila "Versión actual" en el header del README.<br/>'
    '5. Agregar entrada al Changelog (sección 41 del README).<br/>'
    '6. <font face="Courier">git push</font>. GitHub Pages propaga en 1-5 min.'))
story.append(PageBreak())

# === CAPITULO 5: FIREBASE ===
story.append(h1('5. Firebase (backend)'))
story.append(h2('Proyecto y plan'))
story.append(kv_table([
    ['Nombre del proyecto', 'app-vendedores-shimano'],
    ['Región', 'southamerica-east1 (São Paulo)'],
    ['Plan', 'Blaze (pay-as-you-go)'],
    ['Console URL', 'https://console.firebase.google.com/project/app-vendedores-shimano'],
    ['Budget alert', 'USD 25/mes con avisos al 50/90/100% a mariano.erbino@shimano.com.ar'],
    ['Owners', 'bot.shimano.pesca@gmail.com, erbinomariano@gmail.com'],
]))
story.append(callout(
    '<b>Por qué Blaze:</b> el plan gratuito (Spark) no permite instalar '
    'Extensions (necesarias para el sync a BigQuery) ni usar Firebase Storage. '
    'Con Blaze pagamos solo por el uso que excede el free tier. Hoy pagamos '
    '~USD 5/mes de Firebase real.'))

story.append(h2('Firestore: colecciones principales'))
story.append(data_table(
    ['Colección', 'Propósito', 'Volumen aprox.'],
    [
        ['roles', 'Rol y config por usuario', '~15 docs'],
        ['userData', 'Preferencias UI + PIN por user', '~15 docs'],
        ['pedidos', 'Pedidos armados por vendedores', '~50 docs'],
        ['visits', 'Registro de visitas a tiendas', '~50 docs'],
        ['client_applications', 'Solicitudes de alta + BPs SAP sincronizados', '127 docs'],
        ['client_master', 'Direcciones exactas de POINTS legacy', '~100 docs'],
        ['client_locations', 'GPS preciso (cargado en visitas)', '~40 docs'],
        ['sap_vendors', 'Mapeo vendorKey → SlpCode SAP', '6 docs'],
        ['sap_clients', 'Import masivo desde SAP B1 (histrico)', '~50 docs'],
        ['product_catalog', 'Catálogo de productos (chunks)', '~50 docs (chunks)'],
        ['stock_snapshot', 'Snapshot de stock por warehouse', '1 doc grande'],
        ['app_config', 'Config global: sap_integration, precios, etc', '~10 docs'],
        ['campaigns', 'Campañas comerciales vigentes', '~5 docs'],
        ['targets', 'Metas mensuales por vendedor', '~50 docs'],
        ['rendiciones', 'Gastos rendidos + fotos', '~100 docs'],
        ['notifications', 'Notificaciones entre usuarios', '~200 docs'],
        ['custom_routes', 'Rutas armadas por vendedor', '~30 docs'],
        ['vendor_overrides', 'Reasignación de tiendas por Modal Zonas', '~20 docs'],
        ['route_overrides', 'Overrides de rutas del mes', '~10 docs'],
        ['operations_log', 'Log de operaciones críticas', '~500 docs'],
        ['allowed_emails', 'Pre-autorización de emails', '~20 docs'],
    ],
    col_widths=[4.5*cm, 8.5*cm, 4*cm]))

story.append(h2('Firebase Security Rules'))
story.append(p(
    'Las reglas de seguridad viven en la Firebase Console (NO en el repo git, '
    'para que un push accidental no las sobrescriba). El archivo está '
    'documentado en detalle en la <b>sección 9 del README.md</b> del repo.'))
story.append(p('Resumen de la lógica:'))
story.append(pl(
    '• <b>Lectura:</b> mayoría de colecciones = todos los autenticados. Excepciones: <font face="Courier">roles</font> = solo el propio + admin.<br/>'
    '• <b>Escritura pedidos/visits:</b> admin/gerente todo; vendedor solo su propio (<font face="Courier">ownerUid == request.auth.uid</font>); VDI en nombre del VDE pareja.<br/>'
    '• <b>Delete client_applications con cardCodeSap:</b> solo admin.<br/>'
    '• <b>Escritura config/targets/campaigns:</b> admin/gerente.<br/>'
    '• <b>Reglas de último recurso:</b> deny por default para colecciones no explicitadas.'))
story.append(callout(
    '<b>Custom claims:</b> el rol del usuario NO va como custom claim de Firebase '
    'Auth. Vive en <font face="Courier">roles/{uid}.role</font> como STRING. Las '
    'rules leen esa colección con <font face="Courier">get()</font> para '
    'decidir permisos. Trade-off: los <font face="Courier">get()</font> cuestan '
    '1 read por regla evaluada, pero permite cambiar rol sin re-login.'))

story.append(h2('Firebase Storage'))
story.append(p(
    'Bucket: <font face="Courier">app-vendedores-shimano.firebasestorage.app</font> '
    '(bucket nuevo formato post-2024, no .appspot.com).'))
story.append(kv_table([
    ['photos/rendiciones/<id>__ticket.jpg', 'Fotos de tickets subidas por vendedor. Leídas por el cron de mail rendiciones (Power Automate flow).'],
    ['photos/visits/<id>__frente.jpg', 'Foto del frente del local en cada visita.'],
    ['photos/visits/<id>__espacio_N.jpg', 'Fotos del interior del local (hasta 8).'],
    ['photos/client_applications/<id>__arca.jpg', 'Constancia ARCA en altas de cliente.'],
    ['photos/client_applications/<id>__iibb.jpg', 'Constancia IIBB.'],
    ['photos/client_applications/<id>__local_N.jpg', 'Fotos del local en el alta.'],
]))
story.append(callout(
    '<b>ATENCIÓN:</b> el bucket usa URLs de token largo para acceso público '
    'a las fotos (necesario para que el cron de mail las embeba). NO cambiar '
    'las reglas del bucket a strict private o el mail rendiciones deja de funcionar.'))

story.append(h2('Firebase Extensions instaladas'))
story.append(p(
    '7 instancias de la extension <font face="Courier">firestore-bigquery-export</font> '
    '(v0.3.2 al momento de instalar), una por colección. Todas apuntan al '
    'dataset <font face="Courier">shimano_app</font> en '
    '<font face="Courier">southamerica-east1</font>.'))
story.append(data_table(
    ['Colección Firestore', 'Tabla en BQ'],
    [
        ['pedidos', 'pedidos_raw_raw_changelog + pedidos_raw_raw_latest'],
        ['visits', 'visits_raw_raw_changelog + visits_raw_raw_latest'],
        ['client_master', 'client_master_raw_raw_changelog + _latest'],
        ['sap_clients', 'sap_clients_raw_raw_changelog + _latest'],
        ['client_applications', 'client_applications_raw_raw_changelog + _latest'],
        ['rendiciones', 'rendiciones_raw_raw_changelog + _latest'],
        ['campaigns', 'campaigns_raw_raw_changelog + _latest'],
    ],
    col_widths=[6*cm, 10.5*cm]))
story.append(p(
    'Cada write en Firestore dispara automáticamente un Cloud Function que '
    'copia el evento a BigQuery. Latencia típica: 5-30 segundos. La tabla '
    '<font face="Courier">*_raw_changelog</font> guarda TODOS los eventos (CREATE, '
    'UPDATE, DELETE, IMPORT) como audit trail. La view '
    '<font face="Courier">*_raw_latest</font> muestra solo el estado actual.'))
story.append(callout(
    '<b>Colecciones NO sincronizadas a BQ via Extension:</b> notifications, '
    'custom_routes, route_overrides, vendor_overrides, roles, userData, '
    'product_catalog, sap_products, sap_vendors, client_locations, '
    'operations_log, targets (esta última se sync manualmente vía '
    'sync_sap_to_bigquery.py desde 2026-07-14), allowed_emails, app_config. '
    'Si Power BI las necesita, se puede sumar más instancias.'))
story.append(PageBreak())

# === CAPITULO 6: GITHUB ===
story.append(h1('6. GitHub: repo, Pages y Actions'))
story.append(h2('Organización y repositorio'))
story.append(kv_table([
    ['Organization', 'shimano-arg'],
    ['Repo', 'app-vendedores'],
    ['URL', 'https://github.com/shimano-arg/app-vendedores'],
    ['Visibilidad', 'Privada (requiere ser member de la org)'],
    ['Owners', 'bot.shimano.pesca@gmail.com, erbinomariano@gmail.com'],
    ['Branch de trabajo', 'main (protegida - sin PRs, push directo)'],
    ['Historial', 'Desde 2025 (~500+ commits)'],
]))

story.append(h2('GitHub Pages para hosting'))
story.append(p(
    'GitHub Pages sirve automáticamente cada archivo pusheado a la rama '
    '<font face="Courier">main</font>. La URL '
    '<font face="Courier">https://shimano-arg.github.io/app-vendedores/</font> '
    'sirve el <font face="Courier">index.html</font> del root.'))
story.append(pl(
    '<b>Ventajas:</b><br/>'
    '• Gratis (dentro del free tier de GitHub).<br/>'
    '• CDN global con HTTPS automático.<br/>'
    '• Cache de edge que hace la carga rápida.<br/>'
    '• Cero infra que administrar.<br/>'
    '<br/>'
    '<b>Limitaciones:</b><br/>'
    '• Sitios estáticos solamente (no server-side rendering).<br/>'
    '• Soft limit: 100 GB de bandwidth mensual (bien por debajo hoy).<br/>'
    '• Deploy toma 1-5 minutos post-push (a veces más).<br/>'
    '• Sin logs de acceso ni analytics nativas.'))
story.append(callout(
    '<b>El archivo <font face="Courier">.nojekyll</font></b> en el root del '
    'repo es crítico: le dice a GitHub Pages que NO procese los archivos '
    'con Jekyll. Sin él, algunos paths podrían romperse.'))

story.append(h2('GitHub Actions: workflows activos'))
story.append(data_table(
    ['Workflow', 'Cron', 'Propósito'],
    [
        ['sync-sap-catalog-stock.yml', '13,43 * * * *', 'SAP → Firestore + stock.json (cada 30 min)'],
        ['sync-sap-to-bigquery.yml', '13,43 * * * *', 'SAP + targets → BigQuery (cada 30 min)'],
        ['send-rendiciones-email.yml', '0 12 * * 1,3', 'Mail rendiciones aprobadas (Lun/Mie 9am AR)'],
    ],
    col_widths=[6*cm, 3.5*cm, 7*cm]))

story.append(h3('Secrets configurados en GitHub Actions'))
story.append(p(
    'Los workflows necesitan credenciales que viven como '
    '<b>GitHub Actions Secrets</b> del repo. Están en '
    '<font face="Courier">Settings → Secrets and variables → Actions</font>:'))
story.append(kv_table([
    ['FIREBASE_SERVICE_ACCOUNT', 'JSON del service account de Firebase (con permisos de Firestore + Storage + BigQuery)'],
    ['GH_TOKEN', 'Token con permiso repo:write para commitear stock.json'],
    ['GMAIL_APP_PASSWORD', 'App password de bot.shimano.pesca@gmail.com para SMTP'],
]))
story.append(callout(
    '<b>ROTACIÓN:</b> el service account de Firebase (JSON) hay que rotarlo '
    'cada 90 días por buenas prácticas de seguridad. Se genera desde '
    'Firebase Console → Configuración del proyecto → Cuentas de '
    'servicio → Generar nueva clave privada.'))

story.append(h3('Flujo de un workflow típico'))
story.append(code(
    '# .github/workflows/sync-sap-catalog-stock.yml (resumen)\n'
    'on:\n'
    '  schedule:\n'
    '    - cron: \'13,43 * * * *\'\n'
    '  workflow_dispatch:  # trigger manual\n'
    '\n'
    'jobs:\n'
    '  sync:\n'
    '    runs-on: ubuntu-latest\n'
    '    steps:\n'
    '      - uses: actions/checkout@v4\n'
    '      - uses: actions/setup-python@v5\n'
    '        with: {python-version: \'3.11\'}\n'
    '      - run: pip install firebase-admin requests\n'
    '      - run: python scripts/sync_sap_to_firestore.py\n'
    '        env:\n'
    '          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}\n'
    '      - name: commit stock.json si cambio\n'
    '        run: |\n'
    '          git config user.name "shimano-bot"\n'
    '          git config user.email "bot@shimano"\n'
    '          git add stock.json && git commit -m "stock update" || echo "no changes"\n'
    '          git push'
))

story.append(h3('Monitoreo de los workflows'))
story.append(p(
    'Los workflows se pueden ver en <font face="Courier">github.com/shimano-arg/app-vendedores/actions</font>. '
    'Cada corrida deja logs detallados por 90 días. Si un workflow falla, '
    'GitHub manda mail al author del último commit.'))
story.append(callout(
    '<b>Chequeo típico:</b> si algo en la app "dejó de actualizarse" '
    '(stock, sync BPs, targets), primero revisar Actions y ver si el cron '
    'está verde. Muchas veces es que SAP Service Layer devolvió 500/timeout '
    'y el workflow abortó. Se puede re-triggerar manualmente con '
    '<font face="Courier">workflow_dispatch</font>.'))
story.append(PageBreak())

# === CAPITULO 7: SAP ===
story.append(h1('7. Integración con SAP Business One'))
story.append(h2('Config y credenciales'))
story.append(kv_table([
    ['ERP', 'SAP Business One v10.x (Seidor hosting)'],
    ['URL Service Layer', 'https://shimano-sap.seidor.com.ar:50000'],
    ['CompanyDB PROD', 'SHIMANO_SAU'],
    ['CompanyDB TEST', 'SHIMANO_TST_06'],
    ['Usuario integración', 'APP_VENDEDORES (creado por IT Shimano)'],
    ['Provider hosting', 'SEIDOR Argentina'],
    ['Contactos SEIDOR', 'Alejandro Caracchi (infra), Ezequiel Mendoza (funcional)'],
    ['Contacto IT Shimano', 'Juan (usuarios SAP)'],
    ['SAP admin en Shimano', 'Santiago Beron (aprueba Quotations manualmente)'],
]))
story.append(p(
    'La config viva en Firestore: <font face="Courier">app_config/sap_integration</font> '
    'con campos <font face="Courier">serviceLayer.url</font>, '
    '<font face="Courier">.companyDB</font>, <font face="Courier">.username</font>, '
    '<font face="Courier">.password</font>, <font face="Courier">.enabled</font>. '
    'Los scripts Python la leen al arrancar.'))

story.append(h2('Endpoints del Service Layer que consumimos'))
story.append(data_table(
    ['Endpoint', 'Uso'],
    [
        ['POST /b1s/v1/Login', 'Autenticación. Devuelve cookie B1SESSION.'],
        ['GET /b1s/v1/Items', 'Catálogo de productos filtrado por ItemsGroupCode=PESCA.'],
        ['GET /b1s/v1/BusinessPartners', 'BPs con filtro CardType + U_DIVISION.'],
        ['GET /b1s/v1/Invoices', 'Facturas emitidas (últimos 24 meses).'],
        ['GET /b1s/v1/Quotations', 'Cotizaciones (Sales Quotations).'],
        ['GET /b1s/v1/Orders', 'Sales Orders abiertas (backorder).'],
        ['GET /b1s/v1/PurchaseOrders', 'Purchase Orders abiertas (mercadería incoming).'],
        ['GET /b1s/v1/SalesPersons', 'Vendedores con SlpCode + SlpName.'],
        ['GET /b1s/v1/States?$filter=Country eq \'AR\'', 'Provincias AR para mapeo de códigos internos.'],
        ['GET /b1s/v1/ItemGroups', 'Grupos de items para resolver el número del grupo PESCA.'],
        ['POST /b1s/v1/Quotations', 'Envío de pedidos desde la app (Sales Quotation nueva).'],
        ['POST /b1s/v1/Logout', 'Cierre de sesión.'],
    ],
    col_widths=[8*cm, 8.5*cm]))

story.append(h2('Dos vías para transferir pedidos a SAP'))
story.append(h3('Vía 1: Service Layer directo (automático)'))
story.append(p(
    'Cuando el vendedor confirma un pedido, la app dispara un POST a '
    '<font face="Courier">/Quotations</font> con las líneas + UDFs '
    '(<font face="Courier">U_AppOrigen</font>, '
    '<font face="Courier">U_AppOrderId</font>, etc.) para audit trail. SAP '
    'crea la Sales Quotation con estado Open. Santiago Beron la aprueba manualmente '
    'y la copia a Sales Order.'))
story.append(callout(
    '<b>Bloqueantes históricos:</b> el flujo Service Layer requiere (a) '
    'CORS habilitado en Apache delante del SL para que el browser lo llame, '
    '(b) usuario integración con licencia Limited CRM o Logistics, '
    '(c) UDFs + Serie APP 103 creados en PROD. Los 3 puntos ya están '
    'resueltos al momento de este documento.'))
story.append(h3('Vía 2: DTW manual (backup)'))
story.append(p(
    'Admin descarga los pedidos confirmados como ZIP con formato DTW (Data '
    'Transfer Workbench de SAP): dos CSVs por Quotation, uno con el header '
    '(OQUT) y otro con las líneas (QUT1). SAP admin importa el ZIP en DTW. '
    'Este flujo se mantiene como fallback permanente, incluso con Service Layer '
    'funcionando, en caso de outage.'))

story.append(h2('Bug histórico: provincias mal cargadas'))
story.append(p(
    'El sync <font face="Courier">sync_sap_to_firestore.py</font> lee el '
    'UDF <font face="Courier">U_SH_PCIA</font> de cada BusinessPartner para '
    'determinar su provincia. SAP guarda ese UDF como <b>código interno '
    'numérico</b> (\'1\', \'2\', \'3\'...) que se traduce a nombre vía '
    'lookup a <font face="Courier">/States?filter=Country eq \'AR\'</font>. '
    'En algunos BPs el código está mal cargado en SAP y se traduce '
    'incorrectamente (ej: YAMIN aparece como CHUBUT cuando es SALTA).'))
story.append(p(
    '<b>Paliativo</b> (2026-07-14): script '
    '<font face="Courier">bulk_fix_provincia_localidad_from_excel.py</font> '
    'corrige la provincia cruzando por CUIT contra un Excel de respuestas '
    'del formulario de alta. El sync respeta la corrección manual '
    'chequeando el flag <font face="Courier">provinciaLocSource</font>. '
    'El fix definitivo es corregir los UDFs en SAP prod.'))

story.append(PageBreak())

# === CAPITULO 8: BIGQUERY ===
story.append(h1('8. BigQuery: pipeline de datos'))
story.append(h2('Dataset y config'))
story.append(kv_table([
    ['GCP project', 'app-vendedores-shimano (mismo que Firebase)'],
    ['Dataset', 'shimano_app'],
    ['Región', 'southamerica-east1'],
    ['Console URL', 'https://console.cloud.google.com/bigquery?project=app-vendedores-shimano'],
    ['Free tier mensual', '1 TB de queries + 10 GB de storage (uso actual bien por debajo)'],
]))

story.append(h2('Fuentes de datos'))
story.append(p(
    'BigQuery recibe datos de <b>dos fuentes</b>:'))
story.append(h3('1. Firestore → BigQuery (real-time, via Extensions)'))
story.append(p(
    'Las 7 instancias de <font face="Courier">firestore-bigquery-export</font> '
    'copian eventos de Firestore a BQ en 5-30 segundos. Cada write dispara un '
    'Cloud Function que escribe a la tabla changelog + view latest. Ver '
    'capítulo 5 para el detalle.'))
story.append(h3('2. SAP → BigQuery (cada 30 min, via Python)'))
story.append(p(
    'El script <font face="Courier">scripts/sync_sap_to_bigquery.py</font> '
    'corre en GH Actions cada 30 min. Consulta el SAP Service Layer, aplana '
    'los datos y hace <font face="Courier">WRITE_TRUNCATE</font> (borra y '
    'reescribe cada tabla). Tablas resultantes:'))
story.append(data_table(
    ['Tabla', 'Contenido', 'Volumen'],
    [
        ['sap_bp_raw', 'Business Partners Customers', '~20 rows'],
        ['sap_items_raw', 'Items PESCA con stock + precio', '755 rows'],
        ['sap_invoices_raw', 'Facturas últimos 24 meses', '~4.700 rows'],
        ['sap_quotations_raw', 'Cotizaciones últimos 24 meses', '~1.500 rows'],
        ['sap_orders_raw', 'Sales Orders últimos 24 meses', '~500 rows'],
        ['sap_purchase_orders_raw', 'POs abiertas (mercadería incoming)', '~200 rows'],
        ['targets_raw', 'Metas mensuales desde Firestore', '4 rows'],
    ],
    col_widths=[5*cm, 8*cm, 3.5*cm]))

story.append(h2('9 vistas curadas para Power BI'))
story.append(p(
    'El archivo <font face="Courier">bigquery/views.sql</font> del repo define '
    '9 vistas SQL que aplanan el JSON de las tablas raw y las presentan como '
    'tablas listas para Power BI (nombres en snake_case latino, sin '
    '<font face="Courier">JSON_VALUE()</font> en cada medida):'))
story.append(data_table(
    ['Vista', 'Granularidad', 'Consumido por'],
    [
        ['v_pedidos_header', '1 fila por pedido', 'Dashboard: cantidad de pedidos, montos'],
        ['v_pedidos_lines', '1 fila por línea (UNNEST)', 'Mix de venta por producto'],
        ['v_visitas', '1 fila por visita', 'Dashboard visitas, cobertura'],
        ['v_facturas_sap', '1 fila por factura + JOIN BP', 'Facturación real'],
        ['v_ventas_lineas', '1 fila por línea de factura (UNNEST)', 'Análisis producto x cliente'],
        ['v_backorder_lineas', '1 fila por línea de SQ abierta', 'Backorder por cliente'],
        ['v_inventario', '1 fila por SKU con stock', 'Card "Stock total"'],
        ['v_inventario_por_warehouse', '1 fila por SKU x warehouse', 'Detalle por depósito'],
        ['v_targets', '1 fila por vendedor+mes', 'Target Mensual + % cumplimiento'],
    ],
    col_widths=[4.5*cm, 6*cm, 6*cm]))

story.append(h2('v_sap_items_enriched (vista helper)'))
story.append(p(
    'Vista intermedia que enriquece <font face="Courier">sap_items_raw</font> '
    'con <font face="Courier">familia_norm</font> (usa la <font face="Courier">'
    'cat</font> del catálogo + overrides manuales + regex heurística '
    'por nombre). Consumida por v_inventario, v_backorder_lineas y '
    'v_ventas_lineas.'))

story.append(h2('Cómo actualizar las vistas'))
story.append(p(
    'Cambiar el SQL en <font face="Courier">bigquery/views.sql</font> y correr:'))
story.append(code(
    'python scripts/redeploy_views.py'))
story.append(p(
    'El script lee el archivo, extrae cada bloque <font face="Courier">CREATE '
    'OR REPLACE VIEW</font> y los ejecuta contra BigQuery en orden. Corre smoke '
    'tests al final. Idempotente: se puede correr varias veces sin problemas.'))
story.append(callout(
    '<b>Cuidado con schema changes:</b> si agregás una columna a una vista '
    'que consume Power BI, PBI Desktop puede colgarse en el próximo refresh '
    '(caso real 2026-07-13 con el intento de fix del gap de v_backorder_lineas). '
    'Antes de deployar, chequear con Power BI y estar preparado para rollback.'))
story.append(PageBreak())

# === CAPITULO 9: POWER BI ===
story.append(h1('9. Power BI: dashboards y suscripciones'))
story.append(h2('Config general'))
story.append(kv_table([
    ['Producto', 'Power BI Service (workspace en la nube)'],
    ['Workspace', 'Mi área de trabajo de Mariano'],
    ['Licencia', 'Power BI Pro (~USD 10/mes/user)'],
    ['Reporte principal', 'TABLERO SAR'],
    ['Origen de datos', 'BigQuery dataset shimano_app'],
    ['Modo', 'Import (no DirectQuery) con refresh programado'],
    ['Refresh programado', 'Diario 14:30 AR (30 min antes del mail)'],
]))

story.append(h2('Suscripción diaria por email'))
story.append(kv_table([
    ['Nombre', 'Desempeño diario de ventas SAR - PESCA'],
    ['Destinatario', 'mariano.erbino@shimano.com.ar'],
    ['Frecuencia', 'Diaria a 15:00 AR'],
    ['Contenido', 'Miniatura de la página TABLERO SAR + PDF adjunto con todas las páginas'],
    ['Config', 'Power BI Service → informe → "Suscribirse a informe" → tipo Estándar'],
]))
story.append(p(
    'Para agregar destinatarios (Diego, Pablo, etc.): editar la suscripción '
    'existente y sumar emails separados por punto y coma. Los destinatarios '
    'externos al tenant <font face="Courier">shimano.com.ar</font> requieren '
    'que IT habilite "External sharing" en Azure AD / Power BI Admin Portal.'))

story.append(h2('Medidas DAX principales'))
story.append(code(
    'Target Mensual = SUM(v_targets[target_ars])\n'
    '\n'
    'Facturación Total = SUM(v_facturas_sap[doc_total])\n'
    '\n'
    'Pct Cumplimiento = DIVIDE([Facturación Total], [Target Mensual], 0)\n'
    '\n'
    'Color Cumplimiento =\n'
    '  VAR Ratio = DIVIDE([Facturación Total], [Target Mensual], 0)\n'
    '  RETURN SWITCH(TRUE(),\n'
    '    Ratio >= 1,     "#22C55E",  // verde: cumplió\n'
    '    Ratio >= 0.9,   "#F59E0B",  // amarillo: 90-99%\n'
    '    "#EF4444"                    // rojo: < 90%\n'
    '  )'
))

story.append(h2('Mapeo vendorKey → SlpCode (hardcoded en v_targets)'))
story.append(p(
    'El mapeo canonico de vendedor de la app a SalesPersonCode de SAP está '
    'hardcoded en el CASE del SQL de <font face="Courier">v_targets</font>. '
    'Si SAP asigna otros SlpCodes al crear los usuarios en PROD, actualizar '
    'ahí:'))
story.append(data_table(
    ['vendorKey app', 'SlpCode SAP', 'Zona'],
    [
        ['GONZALO DE LA ROSA', '50', 'Z1'],
        ['MAURICIO GIL', '51', 'Z5'],
        ['IOANNIS PALKOUDAKIS', '52', 'Z6'],
        ['SANTIAGO ESTEBAN', '53', 'Z7'],
        ['FEDERICO CASTELANELLI', '54', 'Z2'],
        ['MARTIN BOIERO', '55', 'Z4'],
    ],
    col_widths=[6*cm, 4*cm, 5*cm]))
story.append(callout(
    '<b>Advertencia:</b> al momento de este documento, los SlpCodes 50-55 '
    'NO existen en SAP prod (SHIMANO_SAU) todavía. SEIDOR debe crearlos '
    'como parte del lanzamiento. Verificar con <font face="Courier">python '
    'scripts/query_sap_sales_persons.py</font>.'))

story.append(h2('Troubleshooting Power BI'))
story.append(pl(
    '<b>Refresh cuelga (modal Actualizar pegado):</b> es cliente Power BI '
    'Desktop en máquinas con poca RAM. Task Manager → finalizar '
    'tarea → borrar cache <font face="Courier">%LOCALAPPDATA%\\Microsoft'
    '\\Power BI Desktop\\AnalysisServicesWorkspaces</font> → reabrir.<br/>'
    '<b>Falta columna nueva:</b> agregar manualmente desde Power Query Editor '
    '(las columnas nuevas de vistas BQ no se sincronizan automáticamente).<br/>'
    '<b>Mail no llega:</b> verificar (a) refresh del dataset OK, (b) suscripción '
    'no expirada, (c) IT permite external sharing.'))
story.append(PageBreak())

# === CAPITULO 10: CRON JOBS ===
story.append(h1('10. Cron jobs y automatización'))
story.append(h2('Resumen de todos los crons'))
story.append(data_table(
    ['Cron', 'Frecuencia', 'Qué hace'],
    [
        ['sync-sap-catalog-stock', 'Cada 30 min (:13 y :43)', 'SAP → Firestore: catálogo, stock, BPs pesca, precios PESCA. Commit stock.json al repo.'],
        ['sync-sap-to-bigquery', 'Cada 30 min (:13 y :43)', 'SAP → BigQuery: 6 tablas raw + targets desde Firestore.'],
        ['send-rendiciones-email', 'Lun y Mie 12:00 UTC (9am AR)', 'Excel + mail de rendiciones aprobadas del período.'],
        ['Power BI refresh', 'Diario 14:30 AR', 'Refresh del dataset TABLERO SAR desde BigQuery.'],
        ['Power BI subscription', 'Diario 15:00 AR', 'Envío del snapshot del dashboard por email.'],
        ['Power Automate rendiciones', 'Cuando el gerente aprueba una rendición', 'Copia la rendición a la lista SharePoint del team SAR.'],
    ],
    col_widths=[5.5*cm, 3.5*cm, 8*cm]))

story.append(h2('sync_sap_to_firestore.py (detalle)'))
story.append(p(
    'Script Python de ~1180 líneas. Login en SAP Service Layer, itera '
    'endpoints (Items, BusinessPartners, PriceLists) y escribe a Firestore. '
    'Idempotente: usa <font face="Courier">set(merge=True)</font> para no '
    'destruir campos manuales. Duración típica: 2-4 min.'))
story.append(h3('Reglas de merge (importantes)'))
story.append(pl(
    '• <b>Fantasía:</b> si el doc tiene fantasía distinta del comercio y del cardname, se preserva. Ver commit 98a6864.<br/>'
    '• <b>Provincia + localidad:</b> si el doc tiene <font face="Courier">provinciaLocSource != \'sap_sync\'</font>, se preserva. Ver commit 34bc962.<br/>'
    '• <b>Localidad/provincia si SAP viene vacía:</b> no se pisa (v291 fix).<br/>'
    '• <b>assignedVendor / ownerUid:</b> solo se inicializan en CREATE, en UPDATE se preservan.'))

story.append(h2('sync_sap_to_bigquery.py (detalle)'))
story.append(p(
    'Script Python de ~700 líneas. Trae datos de SAP + Firestore.targets '
    'y escribe a BigQuery con <font face="Courier">WRITE_TRUNCATE</font>. '
    'Duración típica: 3-5 min.'))
story.append(callout(
    '<b>WRITE_TRUNCATE vs INCREMENTAL:</b> el sync borra y reescribe cada '
    'tabla enterrra en cada corrida. Es la elección pragmática para '
    'los volúmenes actuales (~5k rows máx). Si crece a millones '
    'de rows, migrar a incremental por doc_date > last_sync.'))
story.append(PageBreak())

# === CAPITULO 11: DEPLOY ===
story.append(h1('11. Deploy, versionado y regla del README'))
story.append(h2('Proceso de deploy manual'))
story.append(p(
    'Todo el deploy pasa por Git. No hay staging environment. La app en '
    'producción = lo que está en la rama <font face="Courier">main</font> '
    'del repo.'))
story.append(code(
    '# 1. Editar el codigo (index.html, scripts/*, bigquery/views.sql, etc)\n'
    '# 2. Bumpear versiones:\n'
    '#    - sw.js: CACHE_VERSION = \'v302\'\n'
    '#    - index.html: const APP_VERSION = \'v302\'\n'
    '#    - README.md: fila "Version actual" y title del Changelog\n'
    '# 3. Actualizar README.md con changelog + secciones afectadas\n'
    '# 4. Commit y push:\n'
    'git add index.html sw.js README.md\n'
    'git commit -m "Descripcion clara del cambio"\n'
    'git push origin main\n'
    '# 5. GitHub Pages propaga en 1-5 minutos.\n'
    '# 6. Usuarios reciben la version nueva al cerrar y abrir la PWA\n'
    '#    (o forzar refresh con Ctrl+Shift+R).'
))

story.append(h2('Regla dura del README'))
story.append(callout(
    '<b>Después de CUALQUIER cambio en index.html, sw.js u otro archivo '
    'del repo, ACTUALIZAR el README.md en el mismo commit.</b> El README es '
    'la fuente de verdad viva del proyecto: si un cambio no queda reflejado '
    'ahí (nueva sección, campo Firestore, botón, función, '
    'versión, etc.), se considera trabajo incompleto.'))

story.append(h2('Convención de commits'))
story.append(pl(
    '• Sin prefijos tipo "feat:" o "fix:" - se usan tags naturales.<br/>'
    '• Primera línea &lt;72 caracteres, descriptiva.<br/>'
    '• Body opcional con detalles técnicos + WHY del cambio.<br/>'
    '• Firma <font face="Courier">Co-Authored-By: Claude Opus 4.7 (1M context)</font> cuando el commit lo hizo la IA.'))

story.append(h2('Rollback'))
story.append(p(
    'Si algo se rompe en producción, hay 3 opciones:'))
story.append(pl(
    '<b>1. Git revert</b> del commit malo + push. El más rápido pero '
    'requiere que el bug esté en 1 commit específico.<br/>'
    '<b>2. Rollback quirúrgico</b> en Firestore/BigQuery con scripts Python.<br/>'
    '<b>3. Hard reset</b> del main a un commit anterior + force push. Último '
    'recurso: pierde historia posterior. Solo con OK explícito del owner.'))
story.append(callout(
    '<b>NUNCA</b> hacer force push a main sin coordinar. Los deploys de GH '
    'Pages se disparan automáticamente, y perder commits del historial '
    'afecta la trazabilidad para siempre.'))
story.append(PageBreak())

# === CAPITULO 12: MODELO DE DATOS ===
story.append(h1('12. Modelo de datos Firestore'))
story.append(p(
    'Detalles completos en la sección 8 del README.md del repo. '
    'Acá resumo los 3 documentos más importantes.'))

story.append(h2('client_applications/{appId}'))
story.append(p('Solicitudes de alta + BPs SAP sincronizados. Colección central del sistema.'))
story.append(code(
    '{\n'
    '  ownerUid: "uid_vendedor",\n'
    '  ownerEmail: "...", ownerName: "...",\n'
    '  comercio: "GABRIEL ALEJANDRO YAMIN",     // razon social SAP\n'
    '  fantasia: "ARMERIA EL COLORADO",         // nombre comercial (Excel formulario)\n'
    '  cuit: "20227774151",                     // normalizado, solo digitos\n'
    '  cardCodeSap: "C20227774151",             // CardCode SAP\n'
    '  calle: "URQUIZA 491",\n'
    '  localidad: "SALTA CAPITAL",\n'
    '  provincia: "SALTA",\n'
    '  telefonoContacto: "...",\n'
    '  email: "...",\n'
    '  status: "approved",                      // "pending_approval" | "approved" | "rejected"\n'
    '  source: "sap_sync",                      // "manual" | "alta_rapida" | "sap_sync" | "sap_sync_manual_link"\n'
    '  manualSapPending: false,                 // true si es provisorio de Alta Rapida\n'
    '  assignedVendor: "GONZALO DE LA ROSA",    // vendorKey de la app\n'
    '  sapCardType: "cCustomer",                // Customer | Lid (Lead)\n'
    '  fantasiaSource: "bulk_excel_2026-07-14", // audit: quien seteo la fantasia\n'
    '  provinciaLocSource: "bulk_excel_2026-07-14",\n'
    '  approvedAt: <Timestamp>,\n'
    '  createdAt: <Timestamp>, updatedAt: <Timestamp>\n'
    '}'
))

story.append(h2('pedidos/{pedidoId}'))
story.append(p('Pedidos armados por vendedores. Ciclo: en_curso → pending → confirmed.'))
story.append(code(
    '{\n'
    '  pedidoKey: "GONZALO DE LA ROSA|BUENOS AIRES|LARROQUE|AGUSTIN BEBER|julio|2026",\n'
    '  ownerUid: "...", ownerEmail: "...",\n'
    '  createdByUid: "...", createdByEmail: "...",\n'
    '  onBehalfOf: false,                       // true si VDI creo por VDE\n'
    '  tipoCliente: "cliente",                  // cliente | prospecto | sap_alta\n'
    '  clienteNombre: "AGUSTIN BEBER",\n'
    '  cardCodeSap: "C20307454905",             // si es SAP-confirmed\n'
    '  provincia: "ENTRE RIOS", localidad: "LARROQUE",\n'
    '  mesLabel: "julio", mesIdx: 6, anio: 2026,\n'
    '  stage: "confirmed",                      // en_curso | pending | confirmed\n'
    '  confirmedAt: <Timestamp>,\n'
    '  condicionPago: "CONTADO",\n'
    '  formaEntregaTipo: "TRANSPORTISTA",\n'
    '  transpNombre: "...", transpDireccion: "...",\n'
    '  lines: [\n'
    '    {code: "FX4000FC", desc: "...", qty: 20, precio: 5200},\n'
    '    ...\n'
    '  ],\n'
    '  subtotalArs: 104000, netAmountArs: 98800, discountPct: 5,\n'
    '  sapDocNum: 2000000,                      // Si se envio a SAP\n'
    '  createdAt: <Timestamp>, updatedAt: <Timestamp>\n'
    '}'
))

story.append(h2('visits/{visitId}'))
story.append(p('Registro de visita a una tienda con formulario completo + foto + GPS.'))
story.append(code(
    '{\n'
    '  ownerUid: "...", ownerEmail: "...",\n'
    '  createdByUid: "...", onBehalfOf: false,\n'
    '  vendor: "GONZALO DE LA ROSA",\n'
    '  provincia: "SALTA", localidad: "SALTA CAPITAL",\n'
    '  tienda: "GABRIEL ALEJANDRO YAMIN",       // titular (para agrupar historial)\n'
    '  tipo: "PESCA",                           // PESCA | OUTDOOR | HIBRIDO | GENERAL\n'
    '  local: "FISICO",                         // FISICO | ECOMMERCE\n'
    '  tamano: "GRANDE",                        // GRANDE | MEDIANA | CHICA\n'
    '  fidelidad: "ALTA",                       // ALTA | MEDIA | BAJA\n'
    '  relevancia: 4,                           // 1-5\n'
    '  pop: "SI",                               // SI | NO\n'
    '  necesidadPuntual: "CARTEL",              // CANERO | CARTEL | MOSTRADO | OTROS\n'
    '  tipoVenta: "MOSTRADO",                   // MOSTRADO (display) MOSTRADOR | ECOMMERCE | AMBOS\n'
    '  ponderacionMostrado: 60, ponderacionEcommerce: 40,\n'
    '  competencia: "DAIWA",\n'
    '  oportunidad: "...", masVendido: "...", masPreguntan: "...", ayudaTienda: "...",\n'
    '  frenteLocal: "https://firebasestorage.../frente.jpg",\n'
    '  espacio: ["url1", "url2", ...],\n'
    '  gpsStatus: "MATCHED",                    // MATCHED | FAR | DENIED\n'
    '  gpsDistanceM: 25,\n'
    '  mes: "JULIO", anio: 2026, fecha: "2026-07-14",\n'
    '  comentario: "...",\n'
    '  createdAt: <Timestamp>\n'
    '}'
))
story.append(PageBreak())

# === CAPITULO 13: ROLES ===
story.append(h1('13. Roles y permisos'))
story.append(data_table(
    ['Rol', 'Puede leer', 'Puede escribir'],
    [
        ['admin', 'Todo', 'Todo. Config sistema, delete de cualquier cosa.'],
        ['gerente', 'Todo (incluye visits desde v298)', 'Casi todo excepto USUARIOS, STOCK, PRECIOS, AUDITORIA.'],
        ['vendedor', 'Su zona', 'Sus propios pedidos/visitas + alta rápida.'],
        ['interno', 'Sus zonas pareja', 'En nombre de sus VDEs pareja + Seguimiento.'],
        ['viewer', 'Todo', 'Nada (read-only).'],
        ['unassigned', 'Nada', 'Nada (pantalla "Pedí al admin que te habilite").'],
    ],
    col_widths=[3*cm, 4.5*cm, 9*cm]))

story.append(h2('Configuración de un vendedor nuevo'))
story.append(p('Cuando entra un vendedor nuevo:'))
items = [
    'El vendedor entra a la URL y se loguea con Google/Microsoft.',
    'Su usuario queda como <font face="Courier">unassigned</font>.',
    'Admin abre el modal USUARIOS → busca el email → le asigna rol <font face="Courier">vendedor</font> + <font face="Courier">vendorKey</font> (ej "MARTIN BOIERO") + <font face="Courier">internalPartnerUid</font> (uid del VDI pareja).',
    'Vendedor cierra y vuelve a abrir la app. Ya ve su zona.',
]
story.append(ListFlowable(
    [ListItem(p(t), leftIndent=15) for t in items],
    bulletType='1', bulletFontSize=10))

story.append(h2('2FA opcional'))
story.append(p(
    'Todos los roles pueden activar 2FA (Google Authenticator). Desde v178 '
    'ya no es obligatorio ni siquiera para admin. Admin configura desde '
    'el panel USUARIOS → botón "\U0001f510 2FA" → genera QR → '
    'el user escanea con Google Authenticator.'))
story.append(PageBreak())

# === CAPITULO 14: SCRIPTS ===
story.append(h1('14. Scripts operativos'))
story.append(p(
    'La carpeta <font face="Courier">scripts/</font> tiene ~30 scripts Python. '
    'Los principales:'))

story.append(h2('Sync (corren en cron GH Actions)'))
story.append(data_table(
    ['Script', 'Propósito'],
    [
        ['sync_sap_to_firestore.py', 'Sync SAP → Firestore (catálogo, stock, BPs, precios). ~1180 líneas.'],
        ['sync_sap_to_bigquery.py', 'Sync SAP + Firestore.targets → BigQuery. ~700 líneas.'],
        ['send_rendiciones_email.py', 'Excel de rendiciones aprobadas + mail cada Lun/Mie 9am.'],
    ],
    col_widths=[7*cm, 9.5*cm]))

story.append(h2('Bulk imports (correr manualmente)'))
story.append(data_table(
    ['Script', 'Propósito'],
    [
        ['bulk_import_fantasias_from_excel.py', 'Carga masiva de nombres de fantasía desde Excel formulario, match por CUIT. --apply para escribir.'],
        ['bulk_fix_provincia_localidad_from_excel.py', 'Corrige provincia mal cargada desde Excel formulario. Valida contra lista canónica AR.'],
        ['bootstrap_targets_to_bigquery.py', 'Carga inicial de targets → BQ (cuando se crea la tabla).'],
    ],
    col_widths=[7*cm, 9.5*cm]))

story.append(h2('Diagnóstico (read-only)'))
story.append(data_table(
    ['Script', 'Propósito'],
    [
        ['audit_targets.py', 'Dump de la colección targets con normalización.'],
        ['verify_fantasias_in_firestore.py', 'Chequea que las fantasías estén cargadas OK.'],
        ['check_provincias_salta.py', 'Diagnóstico genérico de valores de provincia.'],
        ['query_sap_sales_persons.py', 'Consulta /SalesPersons de SAP (para verificar SlpCodes reales).'],
        ['diagnose_inventario_gap.py', 'Diagnóstico del gap entre v_backorder y v_inventario.'],
        ['smoke_pedidos_lines.py', 'Smoke test rápido de las vistas BQ.'],
    ],
    col_widths=[7*cm, 9.5*cm]))

story.append(h2('BigQuery admin'))
story.append(data_table(
    ['Script', 'Propósito'],
    [
        ['redeploy_views.py', 'Aplica todos los CREATE OR REPLACE VIEW del views.sql.'],
        ['apply_v_targets.py', 'Aplica solo v_targets + corre verificaciones.'],
        ['apply_facturas_sap_slim.py', 'Aplica solo v_facturas_sap (sin lines_json).'],
        ['rollback_v_inventario.py', 'Rollback quirúrgico de v_inventario al pre-fix.'],
    ],
    col_widths=[7*cm, 9.5*cm]))

story.append(h2('Requisitos para correr los scripts'))
story.append(code(
    '# Instalar dependencias\n'
    'pip install firebase-admin google-cloud-bigquery openpyxl requests\n'
    '\n'
    '# Credenciales necesarias:\n'
    '# 1. Service Account de Firebase (JSON con permisos Firestore + BQ)\n'
    '#    guardar en: ~/Desktop/sa-key.json\n'
    '# 2. Para sync SAP: config vive en Firestore app_config/sap_integration'
))
story.append(PageBreak())

# === CAPITULO 15: COSTOS ===
story.append(h1('15. Costos operativos'))
story.append(data_table(
    ['Servicio', 'Plan', 'Costo estimado', 'Estado'],
    [
        ['Firebase (Auth + Firestore + Storage + Extensions)', 'Blaze (pay-as-you-go)', '~USD 5/mes (free tier cubre la mayor parte)', 'Activo'],
        ['BigQuery', 'Free tier', '~USD 0/mes (queries < 1TB/mes, storage < 10GB)', 'Activo'],
        ['Power Automate Premium', 'Trial 90 días → licencia', '~USD 15/mes/user post-trial', 'Trial activo'],
        ['Power BI Pro', 'Por user', '~USD 10/mes x 5 viewers = 50', 'Workspace activo'],
        ['GCP (BQ export storage)', 'Pago por uso', '~USD 5/mes', 'Activo'],
        ['Gmail App Password (bot.shimano.pesca)', 'Free', 'USD 0', 'Activo'],
        ['GitHub (repo + Actions + Pages)', 'Free', 'USD 0', 'Activo'],
        ['Google Gemini API (OCR)', 'Pay-per-use', '~USD 2/mes (bajo volumen)', 'Activo'],
        ['SAP Business One (hosting SEIDOR)', 'Contrato Shimano-SEIDOR', 'No aplica a este proyecto', 'Fuera de alcance'],
    ],
    col_widths=[4.5*cm, 3*cm, 5*cm, 3*cm]))
story.append(callout(
    '<b>Total mensual estimado: USD 89.</b> Budget alert en GCP a USD 25/mes '
    'con avisos al 50/90/100% a Mariano. Cargo a tarjeta corporativa de '
    'Shimano (confirmado por Diego).'))

story.append(h2('Cómo escala el costo'))
story.append(data_table(
    ['Escenario', 'Firestore', 'BigQuery', 'Power BI', 'Total'],
    [
        ['Hoy (5 users)', '~USD 5', '~USD 0', '~USD 50', '~USD 89'],
        ['3x (15 users)', '~USD 30', '~USD 5', '~USD 50', '~USD 130'],
        ['10x (50 users)', '~USD 200', '~USD 20', '~USD 120', '~USD 400'],
        ['30x (150 users)', '~USD 800', '~USD 80', '~USD 300', '~USD 1.400'],
    ],
    col_widths=[3*cm, 3*cm, 3*cm, 3*cm, 3*cm]))
story.append(PageBreak())

# === CAPITULO 16: CONTACTOS Y ACCESOS ===
story.append(h1('16. Contactos y accesos críticos'))

story.append(h2('Equipo Shimano'))
story.append(data_table(
    ['Persona', 'Rol', 'Contacto'],
    [
        ['Mariano Erbino', 'Autor de la app / Data Scientist', 'mariano.erbino@shimano.com.ar / erbinomariano@gmail.com'],
        ['Pablo Gonzalez', 'Gerente comercial / dueño funcional', 'pablo.gonzalez@shimano.com.ar'],
        ['Diego', 'Dirección / stakeholder', 'diego@shimano.com.ar'],
        ['Santiago Beron', 'SAP admin (aprueba Quotations)', 'srb90284@gmail.com'],
        ['Juan (IT Shimano)', 'Usuarios SAP', 'IT interno Shimano'],
    ],
    col_widths=[3.5*cm, 5*cm, 8*cm]))

story.append(h2('Vendedores'))
story.append(p('Ver sección 2 (Contexto de negocio) para lista completa.'))

story.append(h2('SEIDOR (hosting SAP)'))
story.append(data_table(
    ['Persona', 'Rol'],
    [
        ['Alejandro Caracchi', 'Infraestructura SAP (Apache, CORS, hosting).'],
        ['Ezequiel Mendoza', 'Funcional SAP (UDFs, series, config).'],
    ],
    col_widths=[5*cm, 11.5*cm]))

story.append(h2('Accesos críticos'))
story.append(data_table(
    ['Sistema', 'Dónde entrar', 'Cuentas con acceso'],
    [
        ['Firebase Console', 'console.firebase.google.com', 'bot.shimano.pesca@gmail.com (owner), erbinomariano@gmail.com'],
        ['GitHub org shimano-arg', 'github.com/shimano-arg', 'Mismos owners'],
        ['GCP Console', 'console.cloud.google.com/bigquery?project=app-vendedores-shimano', 'Mismos owners'],
        ['SAP Service Layer', 'shimano-sap.seidor.com.ar:50000', 'Usuario APP_VENDEDORES (password en Firestore app_config)'],
        ['Power BI Service', 'app.powerbi.com', 'mariano.erbino@shimano.com.ar'],
        ['Power Automate', 'make.powerautomate.com', 'mariano.erbino@shimano.com.ar'],
        ['Gmail bot.shimano.pesca', 'gmail.com', 'Password compartida por Mariano'],
    ],
    col_widths=[4*cm, 6*cm, 6.5*cm]))
story.append(callout(
    '<b>CRÍTICO ante desvinculación del autor:</b> transferir '
    'ownership de:<br/>'
    '• GitHub org shimano-arg a otro miembro.<br/>'
    '• Firebase project a bot.shimano.pesca@gmail.com como sole owner.<br/>'
    '• GCP project idem.<br/>'
    '• Power BI workspace TABLERO SAR.<br/>'
    '• Rotar service accounts y secrets de GitHub Actions.'))
story.append(PageBreak())

# === CAPITULO 17: RUNBOOK ===
story.append(h1('17. Runbook: problemas comunes'))

story.append(h2('Síntoma: los vendedores no ven la app actualizada'))
story.append(p(
    'Causa: cache del Service Worker viejo. La app usa network-first para el '
    'HTML pero el navegador puede cachear el SW anterior por 24hs.'))
story.append(p('<b>Fix:</b>'))
story.append(pl(
    '• Vendedor: cerrar y reabrir la PWA (o Ctrl+Shift+R en desktop).<br/>'
    '• Si no funciona: botón "REFRESCAR APP" del menú (móvil).<br/>'
    '• Verificar en consola del navegador: <font face="Courier">console.log(APP_VERSION)</font> vs <font face="Courier">console.log(caches)</font>.'))

story.append(h2('Síntoma: sync SAP no está corriendo'))
story.append(p(
    'Chequear el workflow en <font face="Courier">github.com/shimano-arg/app-vendedores/actions</font>. '
    'Buscar el último run de <font face="Courier">sync-sap-catalog-stock</font>.'))
story.append(p('<b>Causas comunes:</b>'))
story.append(pl(
    '• SAP Service Layer devolvió 500 o timeout → re-triggerar workflow manual.<br/>'
    '• Password SAP expirada → actualizar en Firestore <font face="Courier">app_config/sap_integration.serviceLayer.password</font>.<br/>'
    '• Service account Firebase expirado → generar nueva key en Firebase Console + actualizar GitHub secret <font face="Courier">FIREBASE_SERVICE_ACCOUNT</font>.<br/>'
    '• GitHub Actions quota exhausted → raro, el free tier alcanza para 2 crons cada 30 min.'))

story.append(h2('Síntoma: Power BI cuelga en el refresh'))
story.append(p(
    'Bug conocido en Power BI Desktop en máquinas con poca RAM cuando '
    'cambia el schema de una vista o cuando hay strings JSON gigantes en la data.'))
story.append(p('<b>Fix inmediato:</b>'))
story.append(pl(
    '1. Task Manager → finalizar Microsoft Power BI Desktop.<br/>'
    '2. Borrar <font face="Courier">%LOCALAPPDATA%\\Microsoft\\Power BI Desktop\\AnalysisServicesWorkspaces</font>.<br/>'
    '3. Reabrir el .pbix.<br/>'
    '4. Refresh selectivo tabla por tabla (no Home→Refresh general).<br/>'
    '<br/>'
    '<b>Fix a largo plazo:</b> migrar a Power BI Service (corre en servidor '
    'Microsoft con recursos garantizados). Ya publicado como TABLERO SAR.'))

story.append(h2('Síntoma: el gerente carga targets pero no se ven en la app'))
story.append(p('Ver runbook detallado en Changelog del README v292+.'))
story.append(pl(
    '1. Verificar que estén en Firestore: <font face="Courier">python scripts/audit_targets.py</font>.<br/>'
    '2. Si están → usuario debe refrescar la app (Ctrl+Shift+R).<br/>'
    '3. Si no están → problema de permisos Firestore. Chequear rol del user que cargó.'))

story.append(h2('Síntoma: bulk import de fantasías fue pisado por el sync'))
story.append(p(
    'Bug histórico (arreglado en commit 98a6864, 2026-07-14). Si vuelve '
    'a pasar, chequear que el commit del fix siga en el repo. Fix inmediato: '
    'volver a correr el bulk con <font face="Courier">--apply</font>.'))
story.append(p(
    'La regla protectora vive en <font face="Courier">sync_sap_to_firestore.py:</font> '
    'si el doc tiene fantasía distinta del comercio y del cardname, se '
    'preserva. Si el bug vuelve, chequear que ese check no se haya eliminado.'))

story.append(h2('Síntoma: mail rendiciones no llega los Lun/Mie'))
story.append(p('Chequear:'))
story.append(pl(
    '1. Workflow <font face="Courier">send-rendiciones-email</font> en GH Actions.<br/>'
    '2. Gmail app password sigue válido (Google los rota cada tanto).<br/>'
    '3. Bucket Firebase Storage sigue con URLs de token largo (no cambiar a strict private).'))

story.append(h2('Síntoma: SAP Service Layer devuelve 401'))
story.append(p('Password de SAP expiró o cambio de licencia.'))
story.append(pl(
    '1. Contactar a Ezequiel Mendoza (SEIDOR) para reset o extensión.<br/>'
    '2. Nueva password → actualizar en Firestore <font face="Courier">app_config/sap_integration</font>.<br/>'
    '3. Re-triggerar workflows manualmente.'))
story.append(PageBreak())

# === CAPITULO 18: ROADMAP ===
story.append(h1('18. Decisiones tomadas y roadmap'))

story.append(h2('Cosas que NO se van a hacer (decisión explícita)'))
story.append(pl(
    '• <b>Middleware intermedio</b> entre app y SAP: descartado 2026-06-19. Service Layer directo alcanza.<br/>'
    '• <b>Approval Procedure sobre OQUT</b> en SAP: descartado 2026-06-19. Santiago aprueba manual.<br/>'
    '• <b>Migrar a React/Vue/Angular:</b> no aporta valor proporcional al esfuerzo. La app es manejable como vanilla mientras tenga &lt; 50 usuarios.<br/>'
    '• <b>Backend Node/Python propio:</b> Firestore Rules + Cloud Functions cuando necesitemos, sólo lo justo.<br/>'
    '• <b>App nativa iOS/Android:</b> la PWA cubre casi todo, cero mantenimiento extra.'))

story.append(h2('Mejoras pendientes / roadmap'))
story.append(pl(
    '• <b>Documentación operativa para vendedores</b> (manual de uso, este documento es técnico).<br/>'
    '• <b>Capacitación de los 6 vendedores</b> en la app (fase de onboarding).<br/>'
    '• <b>Smoke tests con Playwright</b> para los 5 flows críticos (login, alta rápida, crear pedido, cargar visita, dashboard).<br/>'
    '• <b>Definir ritmo de revisión de Quotations</b> con Santiago (1x día recomendado).<br/>'
    '• <b>Migrar API keys a Cloud KMS</b> para credenciales SAP.<br/>'
    '• <b>Restauración automatizada del backup</b> (hoy solo hay export ZIP, sin script de restore).<br/>'
    '• <b>Telemetría de uso</b> (qué pestañas se abren más, latencias).<br/>'
    '• <b>Modo offline real</b> (cola de pedidos cuando no hay red, sync al volver).<br/>'
    '• <b>Notificaciones push nativas via FCM.</b><br/>'
    '• <b>Webhooks SAP → app:</b> cuando Santiago copia Quotation a SO, la app se entera.<br/>'
    '• <b>Heatmap de visitas en el mapa.</b><br/>'
    '• <b>Filtro por fecha en el dashboard.</b>'))

story.append(h2('Cuándo migrar a arquitectura más grande'))
story.append(p('Señales que indican que hay que refactorizar:'))
story.append(pl(
    '• Ya se necesitan mover a Power BI Service (hecho) → próximo: revisar si sigue funcionando con 50+ users concurrentes.<br/>'
    '• Costo Firestore supera USD 100/mes → paginar queries, dejar de subscribir a colecciones enteras.<br/>'
    '• Load time del index.html supera 5 segundos en 4G → code splitting con Vite.<br/>'
    '• Más de 3 devs trabajando en el código → refactorizar en módulos, agregar TypeScript.<br/>'
    '• Ventas superan USD 10M anuales de facturación → Cloud Functions + API Gateway.'))
story.append(PageBreak())

# === CAPITULO 19: GLOSARIO ===
story.append(h1('19. Glosario'))
story.append(data_table(
    ['Término', 'Significado'],
    [
        ['PWA', 'Progressive Web App. Aplicación web instalable como app nativa.'],
        ['SW', 'Service Worker. Script del navegador que intercepta requests para cache offline.'],
        ['VDE', 'Vendedor externo. Sale a visitar tiendas.'],
        ['VDI', 'Vendedor interno. Soporte y gestión de zona amplia.'],
        ['BP', 'Business Partner. Cliente en SAP.'],
        ['CardCode', 'Código único de un BP en SAP. Formato "C{CUIT}" para clientes.'],
        ['SlpCode', 'SalesPersonCode. Código del vendedor en SAP.'],
        ['SL', 'Service Layer. API REST de SAP Business One.'],
        ['DTW', 'Data Transfer Workbench. Herramienta de SAP para importar CSVs.'],
        ['SQ', 'Sales Quotation. Cotización de venta en SAP.'],
        ['SO', 'Sales Order. Pedido en firme en SAP.'],
        ['PO', 'Purchase Order. Pedido a proveedor en SAP.'],
        ['POINTS', 'Padrón legacy de tiendas embebido en index.html. Fuente para el mapa.'],
        ['UDF', 'User Defined Field. Campo custom en SAP (ej. U_DIVISION, U_SH_PCIA).'],
        ['Firestore', 'Base de datos NoSQL de Firebase. Real-time con listeners.'],
        ['Firebase Extension', 'Cloud Function pre-empaquetada que se instala en Firebase Console.'],
        ['BigQuery', 'Data warehouse serverless de Google.'],
        ['VertiPaq', 'Motor de compresión columnar de Power BI (in-memory).'],
        ['Power Automate', 'Herramienta low-code de Microsoft para automatizar flujos.'],
        ['DAX', 'Data Analysis Expressions. Lenguaje de fórmulas de Power BI.'],
        ['GH Actions', 'GitHub Actions. Sistema de CI/CD nativo de GitHub.'],
        ['Blaze', 'Plan pay-as-you-go de Firebase.'],
        ['Fantasia', 'Nombre comercial de la tienda (ej. "ARMERIA EL COLORADO"). Distinto del titular (razón social SAP).'],
    ],
    col_widths=[3.5*cm, 13*cm]))

story.append(PageBreak())

# === FIN ===
story.append(sp(6*cm))
story.append(Paragraph(
    'FIN DEL MANUAL',
    ParagraphStyle('End', parent=st_title, fontSize=20, textColor=colors.HexColor('#94a3b8'))))
story.append(sp(30))
story.append(Paragraph(
    'Este documento se actualiza junto con el proyecto.<br/>'
    'La fuente más actualizada siempre es el <b>README.md</b> del repo.<br/><br/>'
    'Para preguntas técnicas puntuales, revisar:<br/>'
    '• <b>README.md</b> completo en el repo (sección 41 = Changelog detallado).<br/>'
    '• <b>git log</b> del repo para trazabilidad de cada cambio.<br/>'
    '• <b>Firebase Console</b> para el estado de datos y logs de Cloud Functions.<br/>'
    '• <b>GitHub Actions</b> para el estado de los crons.',
    st_body))

# ---------- Build ----------
doc = SimpleDocTemplate(str(OUT), pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm)
doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print(f'OK -> {OUT}')
print(f'Tamano: {OUT.stat().st_size / 1024:.1f} KB')
