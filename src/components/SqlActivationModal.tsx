import { useEffect, useState } from 'react'
import { Check, Copy, Database, Download, X } from 'lucide-react'
import { copyToClipboard } from '../lib/copilotShare'
import { SQL_SCRIPT_BUNDLES, type SqlScriptBundle } from '../lib/sqlScripts'

export default function SqlActivationModal({
  open,
  onClose,
  initialBundle = 'consolidated',
}: {
  open: boolean
  onClose: () => void
  initialBundle?: SqlScriptBundle['id']
}) {
  const [selectedId, setSelectedId] = useState<SqlScriptBundle['id']>(initialBundle)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedId(initialBundle)
      setCopied(false)
    }
  }, [open, initialBundle])

  if (!open) return null

  const active = SQL_SCRIPT_BUNDLES.find(b => b.id === selectedId) || SQL_SCRIPT_BUNDLES[0]

  async function handleCopy() {
    const ok = await copyToClipboard(active.sql)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2600)
    }
  }

  function handleDownload() {
    const blob = new Blob([active.sql], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = active.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                Scripts SQL listos para Supabase SQL Editor
              </h2>
              <p className="text-xs text-slate-500">
                Copia y pega en Supabase → SQL Editor → Run (100% idempotente, no borra datos existentes).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SQL_SCRIPT_BUNDLES.map(b => {
              const isSel = b.id === active.id
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(b.id)
                    setCopied(false)
                  }}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    isSel
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-semibold leading-snug">{b.title}</p>
                  <p className={`text-[11px] mt-1 font-mono truncate ${isSel ? 'text-slate-300' : 'text-slate-400'}`}>
                    {b.filename}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-slate-600 leading-relaxed">{active.summary}</p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar .sql
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'SQL copiado' : 'Copiar SQL completo'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>{active.filename}</span>
              <span className="tabular-nums">{active.sql.split('\n').length} líneas SQL</span>
            </div>
            <pre className="p-3.5 text-[11px] leading-relaxed text-slate-200 font-mono overflow-x-auto max-h-72 overflow-y-auto">
              {active.sql}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
