import { useEffect, useState } from 'react'
import {
  Code,
  KeyRound,
  Plus,
  Copy,
  Check,
  Webhook,
  ShieldCheck,
  Terminal,
  ExternalLink,
  Layers,
  Sparkles,
} from 'lucide-react'
import { getApiKeys, saveApiKey } from '../lib/innovationsRepo'
import type { ApiKeyRecord } from '../types'

interface ApiEcosystemProps {
  onNavigate?: (page: string) => void
}

export default function ApiEcosystem({ onNavigate }: ApiEcosystemProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showNewKeyModal, setShowNewKeyModal] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')

  useEffect(() => {
    setKeys(getApiKeys())
  }, [])

  function handleCreateKey() {
    if (!newKeyLabel) return
    const randomHex = Math.random().toString(36).substring(2, 15)
    const newRecord: ApiKeyRecord = {
      id: `key-${Date.now().toString(36)}`,
      company_id: '00000000-0000-4000-8000-000000000001',
      key_label: newKeyLabel,
      api_key_masked: `ip_live_${randomHex.slice(0, 4)}********************${randomHex.slice(-4)}`,
      api_key_hash: `hash-${randomHex}`,
      permissions: ['read_stock', 'create_orders', 'read_products'],
      created_at: new Date().toISOString().split('T')[0],
      is_active: true,
    }
    const updated = saveApiKey(newRecord)
    setKeys(updated)
    setShowNewKeyModal(false)
    setNewKeyLabel('')
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2500)
  }

  const sampleCurl = `curl -X POST "https://api.inventariopro.com/v1/orders" \\
  -H "Authorization: Bearer ip_live_981a3f1a..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "customer_name": "Minimarket El Sol",
    "delivery_address": "Carrera 10 #14-20",
    "items": [
      { "sku": "CAF-500", "quantity": 10 }
    ]
  }'`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-100 text-violet-800 rounded-xl">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              API y Ecosistema de Integraciones
            </h1>
            <p className="text-xs text-slate-500">
              Conecta tu tienda Shopify, WooCommerce, CRM externo o sistemas de facturación mediante REST API y Webhooks.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowNewKeyModal(true)}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Generar API Key
        </button>
      </div>

      {/* Claves de API */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-violet-600" /> Claves de Acceso Activas (API Keys)
        </h2>

        <div className="divide-y divide-slate-100">
          {keys.map(k => (
            <div key={k.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">{k.key_label}</p>
                <p className="font-mono text-xs text-slate-500 mt-0.5">{k.api_key_masked}</p>
                <div className="flex gap-2 mt-1.5">
                  {k.permissions.map((p, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-mono text-slate-600"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400">
                  {k.last_used_at ? `Usada: ${k.last_used_at}` : 'Sin uso reciente'}
                </span>
                <button
                  onClick={() => handleCopy(k.api_key_masked, k.id)}
                  className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                >
                  {copiedId === k.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copiar
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Documentación Interactiva de la API */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-700" /> Endpoints Disponibles en /api/v1
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-md text-[10px]">
              GET
            </span>
            <p className="font-mono font-bold text-slate-800 mt-1">/api/v1/products</p>
            <p className="text-slate-500 text-[11px]">Lista catálogo con precios y stock general.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded-md text-[10px]">
              POST
            </span>
            <p className="font-mono font-bold text-slate-800 mt-1">/api/v1/orders</p>
            <p className="text-slate-500 text-[11px]">Inyecta pedidos omnicanal desde e-commerce.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-md text-[10px]">
              GET
            </span>
            <p className="font-mono font-bold text-slate-800 mt-1">/api/v1/stock/:branchId</p>
            <p className="text-slate-500 text-[11px]">Consulta disponibilidad exacta por sede física.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Ejemplo de Invocación con cURL:
          </label>
          <div className="relative">
            <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto">
              {sampleCurl}
            </pre>
            <button
              onClick={() => handleCopy(sampleCurl, 'curl')}
              className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-white p-1.5 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
            >
              {copiedId === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Modal Nueva Key */}
      {showNewKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-800 text-base">Crear Nueva Clave API</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Etiqueta / Nombre del Integrador:
              </label>
              <input
                type="text"
                placeholder="Ej: Conector Prestashop o Tienda Nube"
                value={newKeyLabel}
                onChange={e => setNewKeyLabel(e.target.value)}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:outline-hidden"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewKeyModal(false)}
                className="px-3 py-1.5 text-xs text-slate-500 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateKey}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Generar Clave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
