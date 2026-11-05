import { fmtDate } from '../lib/currency'
/**
 * Cabecera y pie del reporte con los datos de la empresa.
 *
 * La cabecera se imprime en CADA pagina (el contenedor `.print-area` se
 * convierte en tabla durante la impresion y esta cabecera es su
 * `table-header-group`), de modo que en un reporte de varias hojas cada
 * hoja vuelve a mostrar RIF, direccion, telefono, email y el periodo.
 */

export type CompanyInfo = {
  name?: string | null
  rif?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  currency?: string | null
  invoice_prefix?: string | null
  tax_rate?: number | null
} | null

export type CompanyHeaderProps = {
  company: CompanyInfo
  periodTitle: string
  tabLabel: string
  periodLabel: string
}

export function CompanyHeader({
  company,
  periodTitle,
  tabLabel,
  periodLabel,
}: CompanyHeaderProps) {
  const datos = company ?? {}
  const nombre = datos.name || 'Mi empresa'

  return (
    <div className="print-header mb-4 pb-3 border-b border-slate-200">
      <div className="flex items-start justify-between gap-6">
        {/* Identidad de la empresa */}
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-800 break-words">{nombre}</p>
          {datos.rif ? <p className="text-xs text-slate-500">RIF: {datos.rif}</p> : null}
          {datos.address ? (
            <p className="text-xs text-slate-500 break-words">{datos.address}</p>
          ) : null}
        </div>

        {/* Contacto */}
        <div className="text-right shrink-0">
          {datos.phone ? <p className="text-xs text-slate-500">Tel: {datos.phone}</p> : null}
          {datos.email ? (
            <p className="text-xs text-slate-500 break-all">{datos.email}</p>
          ) : null}
          {datos.currency ? (
            <p className="text-xs text-slate-500">Moneda: {datos.currency}</p>
          ) : null}
        </div>
      </div>

      {/* Que reporte es y sobre que periodo */}
      <div className="mt-3 flex items-baseline justify-between gap-4">
        <p className="text-sm font-semibold text-slate-700">
          {periodTitle} · {tabLabel}
        </p>
        <p className="text-xs text-slate-500">Período: {periodLabel}</p>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        Generado: {fmtDate(new Date())}
      </p>
    </div>
  )
}

export function ReportFooter({ note }: { note?: string }) {
  return (
    <p className="print-footer mt-4 text-[10px] text-slate-400">
      {note || 'Los totales de ventas y compras no incluyen registros anulados.'}
    </p>
  )
}
