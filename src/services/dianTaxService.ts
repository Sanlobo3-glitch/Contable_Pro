import { supabase } from '../lib/supabase'

export interface Form300Data {
  casilla_30_ingresos_gravados_19: number
  casilla_31_ingresos_gravados_5: number
  casilla_28_ingresos_excluidos: number
  casilla_41_total_ingresos_brutos: number
  casilla_43_devoluciones_ventas: number
  casilla_42_total_ingresos_netos: number
  casilla_59_iva_generado_19: number
  casilla_60_iva_generado_5: number
  casilla_65_total_iva_generado: number
  casilla_66_compras_gravadas: number
  casilla_74_iva_descontable_compras: number
  casilla_83_total_iva_descontable: number
  casilla_84_saldo_a_pagar: number
  casilla_85_saldo_a_favor: number
}

export interface Form350Data {
  casilla_27_laborales_base: number
  casilla_39_laborales_ret: number
  casilla_46_honorarios_base: number
  casilla_47_honorarios_ret: number
  casilla_50_servicios_base: number
  casilla_51_servicios_ret: number
  casilla_54_arrendamientos_base: number
  casilla_55_arrendamientos_ret: number
  casilla_56_compras_base: number
  casilla_57_compras_ret: number
  casilla_74_reteiva_base: number
  casilla_75_reteiva_ret: number
  casilla_83_autorenta_base: number
  casilla_84_autorenta_ret: number
  casilla_90_total_retenciones: number
}

export interface ExogenaRow {
  form: string
  concept: string
  docType: string
  nit: string
  dv?: string
  name: string
  city?: string
  baseAmount: number
  paymentAmount: number
  retentionPracticed: number
  retentionAssumed: number
  taxAmount: number
}

export interface DianTaxRule {
  id: string
  company_id?: string
  tax_type: 'retefuente' | 'reteiva' | 'reteica' | 'auto_renta'
  concept_name: string
  base_uvt: number
  base_cop: number
  percentage: number
  account_code: string
  municipality_code?: string
  ciuu_code?: string
  active: boolean
}

export interface DianCertificate {
  id: string
  fiscal_year: number
  cert_type: 'retefuente' | 'reteiva' | 'reteica' | '2276'
  third_party_id: string
  third_party_name: string
  total_base: number
  total_retained: number
  issued_at: string
}

// 1. Calcular Formulario 300 (IVA)
export async function getFormulario300(
  companyId: string | null,
  startDate: Date,
  endDate: Date
): Promise<Form300Data> {
  try {
    // 1. Intentar llamar a la RPC oficial si el paquete SQL ya fue ejecutado
    const { data, error } = await supabase.rpc('dian_calcular_formulario_300', {
      p_company_id: companyId || null,
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
    })

    if (!error && data) {
      return data as Form300Data
    }
  } catch {
    // Fallback directo desde tablas existentes
  }

  // Fallback: cálculo directo sobre tablas sales, devolutions y purchases
  let salesQuery = supabase
    .from('sales')
    .select('subtotal, total, tax_rate, tax_amount, status, created_at')
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString())
    .neq('status', 'anulada')

  if (companyId) {
    salesQuery = salesQuery.eq('company_id', companyId)
  }

  const { data: sales } = await salesQuery

  let ing19 = 0
  let ing5 = 0
  let ingExcl = 0
  let iva19 = 0
  let iva5 = 0

  for (const s of sales || []) {
    const rate = Number(s.tax_rate) || 0
    const tax = Number(s.tax_amount) || 0
    const sub = s.subtotal !== null && s.subtotal !== undefined ? Number(s.subtotal) : Number(s.total) - tax

    if (rate === 19) {
      ing19 += sub
      iva19 += tax
    } else if (rate === 5) {
      ing5 += sub
      iva5 += tax
    } else {
      ingExcl += sub
    }
  }

  // Devoluciones
  let devQuery = supabase
    .from('devolutions')
    .select('amount, created_at')
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString())

  if (companyId) {
    devQuery = devQuery.eq('company_id', companyId)
  }
  const { data: devs } = await devQuery
  const devTotal = (devs || []).reduce((acc: number, d: any) => acc + (Number(d.amount) || 0), 0)

  // Compras
  let purQuery = supabase
    .from('purchases')
    .select('subtotal, total, tax, status, created_at')
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString())
    .neq('status', 'anulada')

  if (companyId) {
    purQuery = purQuery.eq('company_id', companyId)
  }
  const { data: purchases } = await purQuery

  let compras19 = 0
  let ivaDesc = 0
  for (const p of purchases || []) {
    compras19 += Number(p.subtotal || p.total || 0)
    ivaDesc += Number(p.tax || 0)
  }

  const ivaGenTotal = iva19 + iva5
  const saldoPagar = ivaGenTotal >= ivaDesc ? ivaGenTotal - ivaDesc : 0
  const saldoFavor = ivaDesc > ivaGenTotal ? ivaDesc - ivaGenTotal : 0

  return {
    casilla_30_ingresos_gravados_19: Math.round(ing19),
    casilla_31_ingresos_gravados_5: Math.round(ing5),
    casilla_28_ingresos_excluidos: Math.round(ingExcl),
    casilla_41_total_ingresos_brutos: Math.round(ing19 + ing5 + ingExcl),
    casilla_43_devoluciones_ventas: Math.round(devTotal),
    casilla_42_total_ingresos_netos: Math.round(ing19 + ing5 + ingExcl - devTotal),
    casilla_59_iva_generado_19: Math.round(iva19),
    casilla_60_iva_generado_5: Math.round(iva5),
    casilla_65_total_iva_generado: Math.round(ivaGenTotal),
    casilla_66_compras_gravadas: Math.round(compras19),
    casilla_74_iva_descontable_compras: Math.round(ivaDesc),
    casilla_83_total_iva_descontable: Math.round(ivaDesc),
    casilla_84_saldo_a_pagar: Math.round(saldoPagar),
    casilla_85_saldo_a_favor: Math.round(saldoFavor),
  }
}

// 2. Calcular Formulario 350 (ReteFuente)
export async function getFormulario350(
  companyId: string | null,
  startDate: Date,
  endDate: Date
): Promise<Form350Data> {
  try {
    const { data, error } = await supabase.rpc('dian_calcular_formulario_350', {
      p_company_id: companyId || null,
      p_start_date: startDate.toISOString(),
      p_end_date: endDate.toISOString(),
    })

    if (!error && data) {
      return data as Form350Data
    }
  } catch {}

  // Fallback calculando sobre acc_lines si existen
  let entriesQuery = supabase
    .from('acc_entries')
    .select('id, date, status, company_id')
    .gte('date', startDate.toISOString().split('T')[0])
    .lt('date', endDate.toISOString().split('T')[0])
    .eq('status', 'posted')

  if (companyId) {
    entriesQuery = entriesQuery.eq('company_id', companyId)
  }

  const { data: entries } = await entriesQuery
  const entryIds = (entries || []).map(e => e.id)

  let comRet = 0
  let serRet = 0
  let honRet = 0
  let arrRet = 0
  let labRet = 0
  let rivRet = 0
  let autRet = 0

  if (entryIds.length > 0) {
    const { data: lines } = await supabase
      .from('acc_lines')
      .select('debit, credit, acc_accounts(code)')
      .in('entry_id', entryIds)

    for (const l of (lines as any[]) || []) {
      const code = l.acc_accounts?.code || ''
      const netCredit = (Number(l.credit) || 0) - (Number(l.debit) || 0)
      if (code.startsWith('236540')) comRet += netCredit
      else if (code.startsWith('236525')) serRet += netCredit
      else if (code.startsWith('236515')) honRet += netCredit
      else if (code.startsWith('236530')) arrRet += netCredit
      else if (code.startsWith('236505')) labRet += netCredit
      else if (code.startsWith('2367')) rivRet += netCredit
      else if (code.startsWith('236575')) autRet += netCredit
    }
  }

  // Estimar bases
  const comBase = comRet > 0 ? Math.round(comRet / 0.025) : 0
  const serBase = serRet > 0 ? Math.round(serRet / 0.04) : 0
  const honBase = honRet > 0 ? Math.round(honRet / 0.11) : 0
  const arrBase = arrRet > 0 ? Math.round(arrRet / 0.035) : 0
  const rivBase = rivRet > 0 ? Math.round(rivRet / 0.15) : 0
  const autBase = autRet > 0 ? Math.round(autRet / 0.004) : 0

  const totalRet = comRet + serRet + honRet + arrRet + labRet + rivRet + autRet

  return {
    casilla_27_laborales_base: 0,
    casilla_39_laborales_ret: Math.round(labRet),
    casilla_46_honorarios_base: honBase,
    casilla_47_honorarios_ret: Math.round(honRet),
    casilla_50_servicios_base: serBase,
    casilla_51_servicios_ret: Math.round(serRet),
    casilla_54_arrendamientos_base: arrBase,
    casilla_55_arrendamientos_ret: Math.round(arrRet),
    casilla_56_compras_base: comBase,
    casilla_57_compras_ret: Math.round(comRet),
    casilla_74_reteiva_base: rivBase,
    casilla_75_reteiva_ret: Math.round(rivRet),
    casilla_83_autorenta_base: autBase,
    casilla_84_autorenta_ret: Math.round(autRet),
    casilla_90_total_retenciones: Math.round(totalRet),
  }
}

// 3. Obtener Datos de Información Exógena por Formato
export async function getExogenaRows(
  companyId: string | null,
  year: number,
  formatCode: string
): Promise<ExogenaRow[]> {
  const rows: ExogenaRow[] = []

  if (formatCode === '1001') {
    // Compras y gastos a proveedores
    let q = supabase
      .from('purchases')
      .select('id, supplier_id, subtotal, total, tax, suppliers(name, document, phone, address)')
      .gte('created_at', `${year}-01-01T00:00:00`)
      .lt('created_at', `${year + 1}-01-01T00:00:00`)
      .neq('status', 'anulada')

    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q

    const bySupplier = new Map<string, any>()
    for (const p of data || []) {
      const s = (p as any).suppliers
      const doc = s?.document || '222222222222'
      const prev = bySupplier.get(doc) || {
        docType: '31',
        nit: doc,
        name: s?.name || 'Proveedor General',
        base: 0,
        tax: 0,
      }
      prev.base += Number(p.subtotal || p.total || 0)
      prev.tax += Number(p.tax || 0)
      bySupplier.set(doc, prev)
    }

    for (const item of bySupplier.values()) {
      rows.push({
        form: '1001',
        concept: '5007',
        docType: item.docType,
        nit: item.nit,
        name: item.name,
        baseAmount: Math.round(item.base),
        paymentAmount: Math.round(item.base),
        retentionPracticed: Math.round(item.base * 0.025),
        retentionAssumed: 0,
        taxAmount: Math.round(item.tax),
      })
    }
  } else if (formatCode === '1007') {
    // Ingresos operacionales por ventas
    let q = supabase
      .from('sales')
      .select('customer_id, customer_name, subtotal, total, tax_amount, customers(name, document)')
      .gte('created_at', `${year}-01-01T00:00:00`)
      .lt('created_at', `${year + 1}-01-01T00:00:00`)
      .neq('status', 'anulada')

    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q

    const byCustomer = new Map<string, any>()
    for (const s of data || []) {
      const c = (s as any).customers
      const doc = c?.document || '222222222222'
      const name = c?.name || s.customer_name || 'Consumidor Final'
      const sub = Number(s.subtotal || s.total || 0)

      const prev = byCustomer.get(doc) || { docType: '13', nit: doc, name, base: 0 }
      prev.base += sub
      byCustomer.set(doc, prev)
    }

    for (const item of byCustomer.values()) {
      rows.push({
        form: '1007',
        concept: '4001',
        docType: item.docType,
        nit: item.nit,
        name: item.name,
        baseAmount: Math.round(item.base),
        paymentAmount: Math.round(item.base),
        retentionPracticed: 0,
        retentionAssumed: 0,
        taxAmount: 0,
      })
    }
  } else if (formatCode === '1006') {
    // IVA generado en ventas
    let q = supabase
      .from('sales')
      .select('customer_id, customer_name, subtotal, total, tax_amount, tax_rate, customers(name, document)')
      .gte('created_at', `${year}-01-01T00:00:00`)
      .lt('created_at', `${year + 1}-01-01T00:00:00`)
      .gt('tax_amount', 0)
      .neq('status', 'anulada')

    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q

    for (const s of data || []) {
      const c = (s as any).customers
      rows.push({
        form: '1006',
        concept: '8001',
        docType: '13',
        nit: c?.document || '222222222222',
        name: c?.name || s.customer_name || 'Cliente',
        baseAmount: Math.round(Number(s.subtotal || s.total || 0)),
        paymentAmount: Math.round(Number(s.total || 0)),
        retentionPracticed: 0,
        retentionAssumed: 0,
        taxAmount: Math.round(Number(s.tax_amount || 0)),
      })
    }
  }

  return rows
}

// 4. Exportar a CSV compatible con Prevalidador DIAN
export function exportExogenaToCsv(formatCode: string, year: number, rows: ExogenaRow[]): void {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const headers = ['Formato', 'Concepto', 'Tipo Doc', 'Identificacion', 'Razon Social / Nombre', 'Pago / Base', 'Retencion Practicada', 'Impuesto']
  const lines = [headers.map(esc).join(',')]

  for (const r of rows) {
    lines.push([
      r.form,
      r.concept,
      r.docType,
      r.nit,
      r.name,
      r.paymentAmount,
      r.retentionPracticed,
      r.taxAmount,
    ].map(esc).join(','))
  }

  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `DIAN_Formato_${formatCode}_${year}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
