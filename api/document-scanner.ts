import { GoogleGenAI, ThinkingLevel, Type, type GenerateContentResponse, type Schema } from '@google/genai'

/**
 * Pasarela multimodal en servidor para lectura inteligente de documentos comerciales:
 * - handwritten_sales: Cuadernos manuscritos de contingencia ("Sin Luz") -> Ventas
 * - purchase_invoice: Facturas y tickets de compra de mercancía -> Compras e Inventario
 * - expense_receipt: Facturas de servicios públicos (Agua, Luz, Gas, Internet) y gastos operativos -> Gastos
 *
 * Seguridad:
 * - La clave del motor permanece exclusivamente en el servidor.
 * - Verifica sesión activa de Supabase Auth (o sesión interactiva de demostración).
 */

export interface DocScannerReq {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface DocScannerRes {
  status(code: number): DocScannerRes
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

interface InputScanFile {
  mimeType: string
  data: string
  name?: string
}

interface CatalogProductHint {
  id: string
  name: string
  sku?: string | null
  price: number
  cost?: number
  price_wholesale?: number | null
  unit?: string | null
  variants?: string[]
}

interface PartyHint {
  id: string
  name: string
  document?: string | null
}

interface ExpenseCategoryHint {
  id: string
  name: string
}

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
])

const SUPPORTED_MODES = new Set([
  'handwritten_sales',
  'purchase_invoice',
  'expense_receipt',
  'payment_receipt',
  'bank_statement',
])

const MAX_FILES = 4
const MAX_BASE64_CHARS_PER_FILE = 9_500_000

function getBearerToken(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers.authorization ?? headers.Authorization
  const val = Array.isArray(raw) ? raw[0] : raw
  if (!val) return ''
  const m = val.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

function normalizeSupabaseBaseUrl(raw?: string): string {
  return (raw || '')
    .trim()
    .replace(/\/+(rest|auth|storage|functions|realtime)\/v1\/?$/i, '')
    .replace(/\/+$/, '')
}

function buildHandwrittenNotebookPrompt(opts: {
  currency: string
  catalog: CatalogProductHint[]
  customers: PartyHint[]
  operatorNotes?: string
}): string {
  const catalogLines = opts.catalog.slice(0, 350).map(p => {
    const skuPart = p.sku ? ` | SKU:${p.sku}` : ''
    const varPart =
      Array.isArray(p.variants) && p.variants.length > 0
        ? ` | Variantes:[${p.variants.slice(0, 12).join(', ')}]`
        : ''
    const mayPart =
      p.price_wholesale && p.price_wholesale > 0 ? ` | Mayor:${p.price_wholesale}` : ''
    return `- ID:${p.id} | Nombre:"${p.name}"${skuPart} | Precio:${p.price}${mayPart}${varPart}`
  })

  const customerLines = opts.customers.slice(0, 200).map(c => {
    const docPart = c.document ? ` (${c.document})` : ''
    return `- ID:${c.id} | Cliente:"${c.name}"${docPart}`
  })

  return [
    'Eres un auditor contable experto en digitalizar hojas de cuadernos y libretas escritas a mano en comercios de Latinoamérica (ventas anotadas manualmente durante cortes de electricidad o contingencias).',
    `Moneda base de la empresa: ${opts.currency}.`,
    opts.operatorNotes ? `Nota contextual del encargado: ${opts.operatorNotes}` : '',
    '',
    'REGLAS ESTRICTAS DE EXTRACCIÓN:',
    '1. Lee cuidadosamente cada renglón manuscrito de todas las imágenes/páginas adjuntas.',
    '2. IGNORA renglones que estén claramente tachados/anulados (repórtalos solo en skipped_notes) y NUNCA conviertas un renglón de "TOTAL DEL DÍA / SUMA TOTAL / SUBTOTAL DE PÁGINA" en una venta adicional.',
    '3. Si varios productos aparecen agrupados bajo un mismo cliente o corchete como una sola operación, agrúpalos en un mismo objeto de `sales` con varios `items`. Si cada renglón es una venta independiente de mostrador, crea un objeto en `sales` por cada renglón.',
    '4. Normaliza el método de pago (`payment_method`) únicamente a uno de estos 4 valores:',
    '   - "efectivo": efectivo, efec, cash, contado, billete, o si no se especifica ningún método.',
    '   - "transferencia": transferencia, transf, pago movil, pago móvil, pm, nequi, daviplata, bancolombia, zelle, binance.',
    '   - "tarjeta": tarjeta, punto, punto de venta, datafono, datáfono, débito, crédito bancario.',
    '   - "fiado": fiado, crédito comercial, a crédito, debe, pendiente, cuenta por cobrar, cartera.',
    '5. Interpreta abreviaturas numéricas locales según la moneda y escala de precios del catálogo (por ejemplo en COP o VES: "30mil", "30k", "30.000" = 30000; si solo anotaron el total del renglón como "2 camisas 60.000", deduce `written_unit_price = 30000` y `written_line_total = 60000`). Si no anotaron precio en el papel, devuelve `written_unit_price: 0` y `written_line_total: 0` para usar el precio oficial del catálogo.',
    '6. Empareja cada producto contra el CATÁLOGO OFICIAL provisto abajo. Si encuentras coincidencia clara o aproximada, coloca su `id` exacto en `matched_product_id`. Si no coincide, deja `matched_product_id` como "".',
    '7. Si mencionan una talla, medida o presentación (ej. "Talla M", "L", "500ml"), colócala en `variant_hint`.',
    '8. Si mencionan el nombre de un comprador, colócalo en `raw_customer_name` y si coincide con CLIENTES REGISTRADOS coloca su `id` exacto en `matched_customer_id` (o "").',
    '9. Califica `confidence` de cada renglón como "alta", "media" o "baja".',
    '',
    'CATÁLOGO OFICIAL DE LA EMPRESA:',
    catalogLines.length > 0 ? catalogLines.join('\n') : '(Catálogo vacío)',
    '',
    'CLIENTES REGISTRADOS DE LA EMPRESA:',
    customerLines.length > 0 ? customerLines.join('\n') : '(Sin clientes registrados)',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildPurchaseInvoicePrompt(opts: {
  currency: string
  catalog: CatalogProductHint[]
  suppliers: PartyHint[]
  operatorNotes?: string
}): string {
  const catalogLines = opts.catalog.slice(0, 350).map(p => {
    const skuPart = p.sku ? ` | SKU:${p.sku}` : ''
    const costPart = p.cost && p.cost > 0 ? ` | CostoActual:${p.cost}` : ''
    return `- ID:${p.id} | Nombre:"${p.name}"${skuPart}${costPart} | Unidad:${p.unit || 'unidad'}`
  })

  const supplierLines = opts.suppliers.slice(0, 200).map(s => {
    const docPart = s.document ? ` (${s.document})` : ''
    return `- ID:${s.id} | Proveedor:"${s.name}"${docPart}`
  })

  return [
    'Eres un auditor contable experto en leer facturas de compra de mercancía, notas de entrega y tickets de proveedores mayoristas en Latinoamérica.',
    `Moneda base de la empresa: ${opts.currency}.`,
    opts.operatorNotes ? `Nota del operador: ${opts.operatorNotes}` : '',
    '',
    'REGLAS ESTRICTAS DE EXTRACCIÓN:',
    '1. Primero verifica si el documento subido es realmente una factura de COMPRA DE MERCANCÍA / INVENTARIO o si por error subieron un recibo de servicio público / gasto operativo (como agua, luz, electricidad, gas, internet, arriendo, telefonía). Si es un servicio público o gasto sin mercancía inventariable, marca `is_utility_or_expense_bill: true` y deja `items: []`.',
    '2. Extrae los datos del proveedor emisor: razón social o nombre comercial (`supplier_name`), NIT/RIF/RUT/Cédula (`supplier_document`), teléfono (`supplier_phone`), número de factura/ticket (`invoice_number`) y fecha (`invoice_date` en formato YYYY-MM-DD).',
    '3. Compara el proveedor contra PROVEEDORES REGISTRADOS (por NIT/RIF o nombre) y si coincide coloca su `id` exacto en `matched_supplier_id`, o "" si es un proveedor nuevo.',
    '4. Determina la condición de pago (`payment_method`) entre: "efectivo", "transferencia", "tarjeta" o "credito" (si dice Crédito, A plazo, 15 días, 30 días, Cuenta por pagar, o muestra fecha de vencimiento posterior). Si es a crédito, indica `credit_days` (ej. 15, 30, 60; o 30 por defecto si dice crédito sin especificar días).',
    '5. Extrae cada renglón de producto inventariable en `items` (NO incluyas filas de Subtotal, IVA total, Descuento global ni Total general como si fueran productos):',
    '   - `quantity`: número entero >= 1 (redondea si es necesario; si dice "2 cajas x 12 und" y el catálogo maneja unidad, usa las unidades reales si es evidente, o la cantidad facturada).',
    '   - `unit_cost`: costo unitario real en números puros sin símbolos de moneda (interpreta separadores de miles como 45.000 en COP = 45000). Si solo aparece el subtotal del renglón y la cantidad, divide `line_total / quantity`.',
    '   - `matched_product_id`: ID exacto del producto en el CATÁLOGO OFICIAL si coincide por código/SKU o descripción, o "" si es un artículo nuevo que aún no existe en el inventario.',
    '   - `sku_hint`: código o referencia del artículo impreso en la factura si existe, o "".',
    '   - `lot_code` y `expiry_date` (YYYY-MM-DD): si en el renglón aparece número de lote o fecha de vencimiento.',
    '',
    'CATÁLOGO OFICIAL DE PRODUCTOS:',
    catalogLines.length > 0 ? catalogLines.join('\n') : '(Sin productos aún)',
    '',
    'PROVEEDORES REGISTRADOS:',
    supplierLines.length > 0 ? supplierLines.join('\n') : '(Sin proveedores registrados)',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildExpenseReceiptPrompt(opts: {
  currency: string
  expenseCategories: ExpenseCategoryHint[]
  operatorNotes?: string
}): string {
  const categoryLines = opts.expenseCategories.slice(0, 100).map(c => `- ID:${c.id} | Categoría:"${c.name}"`)

  return [
    'Eres un contador experto en leer facturas de servicios públicos (agua, acueducto, luz, energía eléctrica, aseo, gas, internet, telefonía móvil/fija), recibos de arriendo/alquiler, fletes, transporte, papelería, mantenimiento y comprobantes de gastos operativos en Latinoamérica.',
    `Moneda base de la empresa: ${opts.currency}.`,
    opts.operatorNotes ? `Nota del usuario: ${opts.operatorNotes}` : '',
    '',
    'REGLAS ESTRICTAS DE EXTRACCIÓN:',
    '1. Si el usuario adjuntó varios recibos distintos (por ejemplo en varias fotos: uno de agua y otro de luz), crea un elemento independiente dentro del arreglo `expenses` por cada recibo distinto. Si varias páginas pertenecen a la misma factura, consolídalas en un solo elemento en `expenses`.',
    '2. Si el documento adjunto es claramente una factura mayorista de compra de mercancía para reventa/inventario y NO un servicio o gasto operativo, marca `is_merchandise_invoice: true`.',
    '3. Para cada recibo/factura de gasto extrae:',
    '   - `beneficiary`: nombre de la empresa de servicios o proveedor (ej. "Acueducto y Alcantarillado", "Enel Codensa", "EPM", "Corpoelec", "Hidrocapital", "Movistar", "Claro", etc.).',
    '   - `service_type`: etiqueta corta clara del tipo de gasto (ej. "Agua y alcantarillado", "Energía eléctrica / Luz", "Gas", "Internet y telefonía", "Arriendo / Alquiler", "Transporte / Flete", "Mantenimiento", "Papelería / Insumos", "Otro gasto").',
    '   - `matched_category_id`: ID exacto de la categoría más apropiada dentro de CATEGORÍAS DE GASTO REGISTRADAS (por ejemplo Agua, Luz, Gas e Internet van en "Servicios públicos" o equivalente). Si ninguna encaja o la lista está vacía, devuelve "".',
    '   - `suggested_category_name`: nombre limpio de categoría contable sugerida (ej. "Servicios públicos", "Arriendo", "Transporte").',
    '   - `reference`: número de factura, NIC, contrato, cuenta contrato o referencia de pago impresa.',
    '   - `expense_date`: fecha de emisión o pago en formato YYYY-MM-DD (o "" si no es visible).',
    '   - `due_date`: fecha límite de pago / vencimiento en formato YYYY-MM-DD si aparece (o "").',
    '   - `description`: concepto contable claro y listo para guardar (ej. "Factura de energía eléctrica periodo Oct 2026 - Contrato 491022").',
    '   - `amount`: monto TOTAL A PAGAR del recibo en números puros (respeta separadores de miles locales como 125.400 en COP = 125400).',
    '   - `payment_method`: uno de "efectivo", "transferencia" o "tarjeta" según indique el soporte (si es una factura pendiente por pagar o pagada por banco/PSE/Pago Móvil/Nequi usa "transferencia"; si es tirilla en efectivo usa "efectivo").',
    '   - `confidence`: "alta", "media" o "baja".',
    '',
    'CATEGORÍAS DE GASTO REGISTRADAS EN LA EMPRESA:',
    categoryLines.length > 0 ? categoryLines.join('\n') : '(Sin categorías previas)',
  ]
    .filter(Boolean)
    .join('\n')
}

const HANDWRITTEN_SALES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    page_summary: {
      type: Type.STRING,
      description: 'Resumen breve en español de lo observado en la hoja.',
    },
    detected_date_hint: {
      type: Type.STRING,
      description: 'Fecha escrita en la hoja en formato YYYY-MM-DD si aparece legible, o "".',
    },
    skipped_notes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Líneas ignoradas a propósito (tachones o sumatorias finales).',
    },
    sales: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source_line_text: { type: Type.STRING },
          payment_method: { type: Type.STRING },
          payment_detail_note: { type: Type.STRING },
          raw_customer_name: { type: Type.STRING },
          matched_customer_id: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                raw_product_text: { type: Type.STRING },
                matched_product_id: { type: Type.STRING },
                variant_hint: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                written_unit_price: { type: Type.NUMBER },
                written_line_total: { type: Type.NUMBER },
                confidence: { type: Type.STRING },
              },
              required: [
                'raw_product_text',
                'matched_product_id',
                'variant_hint',
                'quantity',
                'written_unit_price',
                'written_line_total',
                'confidence',
              ],
            },
          },
        },
        required: [
          'source_line_text',
          'payment_method',
          'payment_detail_note',
          'raw_customer_name',
          'matched_customer_id',
          'items',
        ],
      },
    },
  },
  required: ['page_summary', 'detected_date_hint', 'skipped_notes', 'sales'],
}

const PURCHASE_INVOICE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    document_summary: {
      type: Type.STRING,
      description: 'Resumen breve de la factura de compra leída.',
    },
    is_utility_or_expense_bill: {
      type: Type.BOOLEAN,
      description: 'True solo si es un recibo de agua, luz, internet o gasto operativo sin mercancía.',
    },
    invoice_number: { type: Type.STRING },
    invoice_date: { type: Type.STRING },
    supplier_name: { type: Type.STRING },
    supplier_document: { type: Type.STRING },
    supplier_phone: { type: Type.STRING },
    matched_supplier_id: { type: Type.STRING },
    payment_method: {
      type: Type.STRING,
      description: 'Uno de: efectivo, transferencia, tarjeta, credito.',
    },
    credit_days: { type: Type.NUMBER },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          raw_product_text: { type: Type.STRING },
          sku_hint: { type: Type.STRING },
          matched_product_id: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          unit_cost: { type: Type.NUMBER },
          line_total: { type: Type.NUMBER },
          lot_code: { type: Type.STRING },
          expiry_date: { type: Type.STRING },
          confidence: { type: Type.STRING },
        },
        required: [
          'raw_product_text',
          'sku_hint',
          'matched_product_id',
          'quantity',
          'unit_cost',
          'line_total',
          'lot_code',
          'expiry_date',
          'confidence',
        ],
      },
    },
  },
  required: [
    'document_summary',
    'is_utility_or_expense_bill',
    'invoice_number',
    'invoice_date',
    'supplier_name',
    'supplier_document',
    'supplier_phone',
    'matched_supplier_id',
    'payment_method',
    'credit_days',
    'items',
  ],
}

const EXPENSE_RECEIPT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    page_summary: {
      type: Type.STRING,
      description: 'Resumen breve de los recibos o facturas de servicios/gastos detectados.',
    },
    is_merchandise_invoice: {
      type: Type.BOOLEAN,
      description: 'True si el documento es una factura de compra de inventario para reventa.',
    },
    expenses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          beneficiary: { type: Type.STRING },
          service_type: { type: Type.STRING },
          matched_category_id: { type: Type.STRING },
          suggested_category_name: { type: Type.STRING },
          reference: { type: Type.STRING },
          expense_date: { type: Type.STRING },
          due_date: { type: Type.STRING },
          description: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          payment_method: {
            type: Type.STRING,
            description: 'Uno de: efectivo, transferencia, tarjeta.',
          },
          confidence: { type: Type.STRING },
        },
        required: [
          'beneficiary',
          'service_type',
          'matched_category_id',
          'suggested_category_name',
          'reference',
          'expense_date',
          'due_date',
          'description',
          'amount',
          'payment_method',
          'confidence',
        ],
      },
    },
  },
  required: ['page_summary', 'is_merchandise_invoice', 'expenses'],
}

function buildPaymentReceiptPrompt(opts: {
  currency: string
  expectedAmount?: number
  operatorNotes?: string
}): string {
  return [
    'Eres un auditor bancario experto en validar comprobantes digitales de transferencia y capturas de pantalla de pagos móviles en Latinoamérica (Nequi, Bancolombia, Daviplata, PSE, Pago Móvil interbancario, Zelle, Binance Pay, transferencias bancarias y depósitos).',
    `Moneda esperada de la orden: ${opts.currency}.`,
    opts.expectedAmount && opts.expectedAmount > 0
      ? `Monto esperado del pedido: ${opts.expectedAmount}.`
      : '',
    opts.operatorNotes ? `Contexto del pedido: ${opts.operatorNotes}` : '',
    '',
    'REGLAS ESTRICTAS DE AUDITORÍA:',
    '1. Identifica el banco o billetera (`bank_or_platform`, ej. "Nequi", "Bancolombia", "Daviplata", "Pago Móvil Mercantil", "Zelle", "Binance").',
    '2. Extrae el número único de comprobante, referencia, CUS o aprobación (`reference_number`) limpio sin etiquetas como "Ref:" o "#". Si no hay número de referencia visible en absoluto, devuelve "".',
    '3. Extrae el monto exacto transferido (`amount`) en números puros respetando el formato local (ej. "$ 30.000,00" o "$30.000" en COP = 30000; "Bs. 1.250,50" = 1250.5).',
    '4. Indica la moneda detectada en la imagen (`currency_hint`, ej. "COP", "VES", "USD") y la fecha/hora visible (`transaction_date`).',
    '5. Verifica el estado real de la operación en la captura (`transaction_status`):',
    '   - "aprobada": si dice Exitosa, Envío exitoso, Transferencia realizada, Aprobada, Completada, Comprobante de pago.',
    '   - "pendiente": si es una pantalla PREVIA antes de confirmar el envío ("¿Estás seguro de enviar?", "Confirmar datos", "En proceso", "Pendiente").',
    '   - "rechazada": si dice Fallida, Rechazada, Fondos insuficientes.',
    '   - "dudosa": si está recortada, borrosa, parece editada o no es un comprobante bancario.',
    '6. En `recipient_hint` coloca el destinatario, teléfono o cuenta destino si es visible.',
    '7. En `alert_notes` escribe una advertencia clara en español si detectas riesgo (por ejemplo: captura previa sin ejecutar el pago, sin número de referencia, monto ilegible o recorte sospechoso), o "" si el comprobante luce íntegro.',
  ]
    .filter(Boolean)
    .join('\n')
}

const PAYMENT_RECEIPT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    bank_or_platform: { type: Type.STRING },
    reference_number: { type: Type.STRING },
    amount: { type: Type.NUMBER },
    currency_hint: { type: Type.STRING },
    transaction_date: { type: Type.STRING },
    transaction_status: {
      type: Type.STRING,
      description: 'Uno de: aprobada, pendiente, rechazada, dudosa.',
    },
    recipient_hint: { type: Type.STRING },
    alert_notes: { type: Type.STRING },
    confidence: {
      type: Type.STRING,
      description: 'Uno de: alta, media, baja.',
    },
  },
  required: [
    'bank_or_platform',
    'reference_number',
    'amount',
    'currency_hint',
    'transaction_date',
    'transaction_status',
    'recipient_hint',
    'alert_notes',
    'confidence',
  ],
}

function buildBankStatementPrompt(opts: {
  currency: string
  operatorNotes?: string
}): string {
  return [
    'Eres un auditor bancario y contable experto en extraer movimientos desde extractos bancarios o capturas de movimientos (Bancolombia, Nequi, Daviplata, Davivienda, BBVA, Banesco, Mercantil, Provincial, Zelle, Binance, etc.).',
    `Moneda base de la empresa: ${opts.currency}.`,
    opts.operatorNotes ? `Nota contextual: ${opts.operatorNotes}` : '',
    '',
    'REGLAS ESTRICTAS DE EXTRACCIÓN:',
    '1. Identifica el banco o plataforma (`bank_name`) y el período visible (`period_hint`).',
    '2. Extrae cada renglón de movimiento en `movements` en orden cronológico (ignora encabezados o subtotales de página).',
    '3. Normaliza `date` al formato YYYY-MM-DD cuando sea posible.',
    '4. Clasifica `direction` como:',
    '   - "credit": entradas de dinero (abonos, transferencias recibidas, consignaciones, pagos QR/datáfono).',
    '   - "debit": salidas de dinero (pagos a proveedores, transferencias enviadas, comisiones, impuestos bancarios, retiros).',
    '5. Convierte `amount` siempre en número positivo puro (ej. "$ 45.000,00" o "-45.000" -> 45000).',
    '6. Extrae el código o número de referencia/aprobación en `reference` si aparece, o "" si no aparece.',
    '7. Clasifica `fee_kind` así:',
    '   - "gmf_4x1000": Gravamen a los Movimientos Financieros, 4x1000, Impuesto 4x1000.',
    '   - "comision_bancaria": Cuota de manejo, comisión transferencia, comisión datáfono/redeban/credibanco, timbre.',
    '   - "iva_comision": IVA sobre comisión o cobro bancario.',
    '   - "igtf": IGTF / Impuesto Grandes Transacciones Financieras.',
    '   - "none": Cualquier movimiento comercial normal (ventas, cobros, compras, gastos generales).',
  ]
    .filter(Boolean)
    .join('\n')
}

const BANK_STATEMENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    bank_name: { type: Type.STRING },
    period_hint: { type: Type.STRING },
    movements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          description: { type: Type.STRING },
          reference: { type: Type.STRING },
          direction: {
            type: Type.STRING,
            description: 'Uno de: credit, debit.',
          },
          amount: { type: Type.NUMBER },
          fee_kind: {
            type: Type.STRING,
            description: 'Uno de: none, gmf_4x1000, comision_bancaria, iva_comision, igtf.',
          },
        },
        required: ['date', 'description', 'reference', 'direction', 'amount', 'fee_kind'],
      },
    },
  },
  required: ['bank_name', 'period_hint', 'movements'],
}

export function createDocumentScannerHandler(deps?: {
  fetchFn?: typeof fetch
  env?: Record<string, string | undefined>
}) {
  const fetchFn = deps?.fetchFn || globalThis.fetch.bind(globalThis)
  const getEnv = () => deps?.env || process.env

  return async function handleDocumentScanner(
    req: DocScannerReq,
    res: DocScannerRes
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')

    const env = getEnv()
    const geminiApiKey = (env.GEMINI_API_KEY || '').trim()
    const supabaseUrl = normalizeSupabaseBaseUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL)
    const supabaseAnonKey = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim()

    if (req.method === 'GET') {
      res.status(200).json({
        ok: true,
        ready: Boolean(geminiApiKey),
        supportedModes: Array.from(SUPPORTED_MODES),
      })
      return
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Método no permitido.' })
      return
    }

    if (!geminiApiKey) {
      res.status(503).json({
        ok: false,
        error:
          'El servicio de reconocimiento óptico de documentos no está disponible temporalmente en el servidor.',
      })
      return
    }

    const token = getBearerToken(req.headers)
    if (!token) {
      res.status(401).json({ ok: false, error: 'Sesión requerida para escanear documentos.' })
      return
    }

    if (supabaseUrl && supabaseAnonKey && token !== 'mock-jwt-token') {
      try {
        const authResp = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
          },
        })
        if (!authResp.ok) {
          res.status(401).json({
            ok: false,
            error: 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.',
          })
          return
        }
      } catch {
        res.status(502).json({
          ok: false,
          error: 'No se pudo verificar tu sesión con el servidor de autenticación.',
        })
        return
      }
    }

    let bodyObj: Record<string, unknown> = {}
    if (typeof req.body === 'string') {
      try {
        bodyObj = JSON.parse(req.body) as Record<string, unknown>
      } catch {
        bodyObj = {}
      }
    } else if (req.body && typeof req.body === 'object') {
      bodyObj = req.body as Record<string, unknown>
    }

    const mode = String(bodyObj.mode || 'handwritten_sales').trim()
    if (!SUPPORTED_MODES.has(mode)) {
      res.status(400).json({ ok: false, error: `Modo de escaneo no soportado: ${mode}` })
      return
    }

    const rawFiles = Array.isArray(bodyObj.files) ? bodyObj.files : []
    if (rawFiles.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Adjunta al menos una fotografía o PDF del documento.',
      })
      return
    }
    if (rawFiles.length > MAX_FILES) {
      res.status(400).json({
        ok: false,
        error: `Puedes analizar hasta ${MAX_FILES} páginas o archivos por lote.`,
      })
      return
    }

    const cleanFiles: InputScanFile[] = []
    for (const f of rawFiles) {
      if (!f || typeof f !== 'object') continue
      const rec = f as Record<string, unknown>
      const mimeType = String(rec.mimeType || '')
        .trim()
        .toLowerCase()
      const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
      const rawData = String(rec.data || '')
        .replace(/^data:[^;]+;base64,/i, '')
        .replace(/\s+/g, '')

      if (!ALLOWED_MIMES.has(normalizedMime)) {
        res.status(400).json({
          ok: false,
          error: `Formato no compatible (${mimeType || 'desconocido'}). Usa fotos JPG, PNG, WebP o PDF.`,
        })
        return
      }
      if (!rawData || rawData.length > MAX_BASE64_CHARS_PER_FILE) {
        res.status(400).json({
          ok: false,
          error: 'Una de las imágenes supera el tamaño máximo permitido. Intenta con una foto más ligera.',
        })
        return
      }
      cleanFiles.push({
        mimeType: normalizedMime,
        data: rawData,
        name: rec.name ? String(rec.name) : undefined,
      })
    }

    const currency = String(bodyObj.currency || 'USD')
      .trim()
      .toUpperCase()
      .slice(0, 6)
    const operatorNotes = String(bodyObj.operatorNotes || '')
      .trim()
      .slice(0, 300)

    const catalog: CatalogProductHint[] = (Array.isArray(bodyObj.catalog) ? bodyObj.catalog : [])
      .slice(0, 400)
      .map(item => {
        const r = (item || {}) as Record<string, unknown>
        return {
          id: String(r.id || '').slice(0, 64),
          name: String(r.name || '').slice(0, 120),
          sku: r.sku ? String(r.sku).slice(0, 50) : null,
          price: Number(r.price) || 0,
          cost: Number(r.cost) || 0,
          price_wholesale: r.price_wholesale ? Number(r.price_wholesale) : null,
          unit: r.unit ? String(r.unit).slice(0, 20) : null,
          variants: Array.isArray(r.variants)
            ? r.variants.map(v => String(v).slice(0, 50)).slice(0, 15)
            : [],
        }
      })
      .filter(p => p.id && p.name)

    const parseParties = (raw: unknown): PartyHint[] =>
      (Array.isArray(raw) ? raw : [])
        .slice(0, 250)
        .map(item => {
          const r = (item || {}) as Record<string, unknown>
          return {
            id: String(r.id || '').slice(0, 64),
            name: String(r.name || '').slice(0, 120),
            document: r.document ? String(r.document).slice(0, 40) : null,
          }
        })
        .filter(c => c.id && c.name)

    const customers = parseParties(bodyObj.customers)
    const suppliers = parseParties(bodyObj.suppliers)

    const expenseCategories: ExpenseCategoryHint[] = (
      Array.isArray(bodyObj.expenseCategories) ? bodyObj.expenseCategories : []
    )
      .slice(0, 100)
      .map(item => {
        const r = (item || {}) as Record<string, unknown>
        return {
          id: String(r.id || '').slice(0, 64),
          name: String(r.name || '').slice(0, 80),
        }
      })
      .filter(c => c.id && c.name)

    let promptText = ''
    let systemInstruction = ''
    let responseSchema: Schema = HANDWRITTEN_SALES_SCHEMA

    if (mode === 'purchase_invoice') {
      promptText = buildPurchaseInvoicePrompt({
        currency,
        catalog,
        suppliers,
        operatorNotes,
      })
      systemInstruction =
        'Extrae con precisión contable facturas o tickets de compra de mercancía de proveedores y devuélvelos exclusivamente en el esquema JSON solicitado.'
      responseSchema = PURCHASE_INVOICE_SCHEMA
    } else if (mode === 'expense_receipt') {
      promptText = buildExpenseReceiptPrompt({
        currency,
        expenseCategories,
        operatorNotes,
      })
      systemInstruction =
        'Extrae con precisión contable facturas de servicios públicos (agua, luz, gas, internet) y recibos de gastos operativos, devolviéndolos exclusivamente en el esquema JSON solicitado.'
      responseSchema = EXPENSE_RECEIPT_SCHEMA
    } else if (mode === 'payment_receipt') {
      promptText = buildPaymentReceiptPrompt({
        currency,
        expectedAmount: Number(bodyObj.expectedAmount) || 0,
        operatorNotes,
      })
      systemInstruction =
        'Audita con rigor bancario capturas de comprobantes de pago (Nequi, Bancolombia, Pago Móvil, Zelle, transferencias) y devuelve exclusivamente el esquema JSON solicitado.'
      responseSchema = PAYMENT_RECEIPT_SCHEMA
    } else if (mode === 'bank_statement') {
      promptText = buildBankStatementPrompt({
        currency,
        operatorNotes,
      })
      systemInstruction =
        'Extrae con precisión contable todos los movimientos de entrada y salida de un extracto bancario o captura de movimientos y devuélvelos exclusivamente en el esquema JSON solicitado.'
      responseSchema = BANK_STATEMENT_SCHEMA
    } else {
      promptText = buildHandwrittenNotebookPrompt({
        currency,
        catalog,
        customers,
        operatorNotes,
      })
      systemInstruction =
        'Extrae con precisión contable ventas manuscritas desde fotos de cuadernos físicos y devuélvelas exclusivamente en el esquema JSON solicitado.'
      responseSchema = HANDWRITTEN_SALES_SCHEMA
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })

      const parts: Array<
        { inlineData: { mimeType: string; data: string } } | { text: string }
      > = cleanFiles.map(file => ({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data,
        },
      }))

      parts.push({ text: promptText })

      const candidateModels: Array<{ id: string; useLowThinking: boolean }> = [
        { id: 'gemini-3.8-flash', useLowThinking: true },
        { id: 'gemini-flash-latest', useLowThinking: false },
        { id: 'gemini-3.1-flash-lite', useLowThinking: true },
      ]

      let response: GenerateContentResponse | null = null
      let lastErr: unknown = null

      for (const candidate of candidateModels) {
        try {
          response = await ai.models.generateContent({
            model: candidate.id,
            contents: { parts },
            config: {
              abortSignal: AbortSignal.timeout(15000),
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema,
              ...(candidate.useLowThinking
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          })
          break
        } catch (modelErr) {
          lastErr = modelErr
          const emsg = modelErr instanceof Error ? modelErr.message : String(modelErr)
          const ename = modelErr instanceof Error ? modelErr.name : ''
          if (
            ename === 'TimeoutError' ||
            ename === 'AbortError' ||
            /503|UNAVAILABLE|high demand|overloaded|429|RESOURCE_EXHAUSTED|404|NOT_FOUND|DEADLINE_EXCEEDED|aborted|timeout/i.test(
              emsg
            )
          ) {
            continue
          }
          throw modelErr
        }
      }

      if (!response) {
        throw lastErr ?? new Error('UNAVAILABLE')
      }

      const rawJson = (response.text ?? '').trim()
      if (!rawJson) {
        res.status(502).json({
          ok: false,
          error:
            'No se pudo extraer texto legible del documento. Intenta tomar la foto con buena iluminación y enfocando de frente.',
        })
        return
      }

      let parsed: unknown = null
      try {
        parsed = JSON.parse(rawJson)
      } catch {
        res.status(502).json({
          ok: false,
          error: 'La lectura devolvió un formato incompleto. Intenta nuevamente con una toma más nítida.',
        })
        return
      }

      res.status(200).json({
        ok: true,
        data: parsed,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
        res.status(503).json({
          ok: false,
          error:
            'El motor de reconocimiento óptico presenta alta demanda temporal en este instante. Espera unos segundos y pulsa Analizar nuevamente.',
        })
        return
      }
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        res.status(429).json({
          ok: false,
          error:
            'Se alcanzó temporalmente el límite de consultas por minuto del lector óptico. Espera unos segundos y vuelve a intentar.',
        })
        return
      }
      if (/403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) {
        res.status(502).json({
          ok: false,
          error:
            'El servicio de lectura óptica en el servidor rechazó la autorización. Contacta al administrador del sistema.',
        })
        return
      }
      console.error('Error en document-scanner:', msg)
      res.status(500).json({
        ok: false,
        error: 'Ocurrió un inconveniente al analizar el documento. Intenta nuevamente.',
      })
    }
  }
}

const defaultScannerHandler = createDocumentScannerHandler()

export default async function handler(req: DocScannerReq, res: DocScannerRes): Promise<void> {
  await defaultScannerHandler(req, res)
}
