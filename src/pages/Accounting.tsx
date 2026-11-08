import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import JournalEntryForm from '../components/JournalEntryForm'
import {
  SEED_PUC_ACCOUNTS,
  buildAccountTree as buildCodeTree,
  type AccountNode as CodeAccountNode,
} from '../lib/accountingTree'
import { BookOpen, Plus, RefreshCw, Scale, Search } from 'lucide-react'

// 1. Tipado estricto de la estructura contable
interface AccountRow {
  id: string
  code: string
  name: string
  type: string
  nature: string
  parent_id: string | null
}

interface AccountNode extends AccountRow {
  level: number
  children?: AccountNode[]
}

interface AccountingProps {
  initialTab?: 'accounts' | 'journal'
  autoOpenNewEntry?: boolean
  onNavigate?: (page: string) => void
}

export default function Accounting({
  initialTab = 'accounts',
  autoOpenNewEntry = false,
  onNavigate,
}: AccountingProps) {
  const [tab, setTab] = useState<'accounts' | 'journal'>(
    autoOpenNewEntry ? 'journal' : initialTab
  )
  const [accountTree, setAccountTree] = useState<AccountNode[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (initialTab) {
      setTab(autoOpenNewEntry ? 'journal' : initialTab)
    }
  }, [initialTab, autoOpenNewEntry])

  useEffect(() => {
    fetchAccounts()
  }, [])

  // 2. Consulta de datos a Supabase sobre la tabla real (acc_accounts)
  const fetchAccounts = async () => {
    try {
      setLoading(true)
      setError(null)
      const { data, error: supabaseError } = await supabase
        .from('acc_accounts')
        .select('id, code, name, type, nature, parent_id')
        .order('code', { ascending: true })

      if (supabaseError) {
        // Fallback a semilla PUC NIIF si la tabla aún no existe o está vacía
        fallbackToSeedTree()
        return
      }

      if (data && data.length > 0) {
        const tree = buildAccountTree(data as AccountRow[])
        setAccountTree(tree)
      } else {
        fallbackToSeedTree()
      }
    } catch (err: any) {
      fallbackToSeedTree()
    } finally {
      setLoading(false)
    }
  }

  const fallbackToSeedTree = () => {
    const seedNodes: AccountRow[] = SEED_PUC_ACCOUNTS.map((s, idx) => ({
      id: `seed-${s.code}-${idx}`,
      code: s.code,
      name: s.name,
      type: s.type.toLowerCase(),
      nature: s.nature.toLowerCase().includes('deb') ? 'debito' : 'credito',
      parent_id: null,
    }))
    const tree = buildAccountTree(seedNodes)
    setAccountTree(tree)
  }

  // 3. Conversión de lista plana a árbol jerárquico
  const buildAccountTree = (flatAccounts: AccountRow[]): AccountNode[] => {
    const lookup: { [code: string]: AccountNode } = {}

    // Primero indexamos por código y por id
    flatAccounts.forEach((account) => {
      lookup[account.code] = {
        ...account,
        level: account.code.length <= 1 ? 1 : account.code.length <= 2 ? 2 : account.code.length <= 4 ? 3 : 4,
        children: [],
      }
    })

    const rootNodes: AccountNode[] = []
    flatAccounts.forEach((account) => {
      const node = lookup[account.code]
      const code = account.code

      if (node.level === 1) {
        rootNodes.push(node)
      } else {
        let parentCode = ''
        if (node.level === 2) parentCode = code.substring(0, 1)
        else if (node.level === 3) parentCode = code.substring(0, 2)
        else if (node.level === 4) parentCode = code.substring(0, 4)

        const parent = lookup[parentCode]
        if (parent && parent.children) {
          parent.children.push(node)
        } else {
          rootNodes.push(node)
        }
      }
    })

    return rootNodes
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-6xl space-y-6">
      {/* Pestañas superiores de Navegación Contable */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Scale className="w-7 h-7 text-emerald-600" />
            <span>Contabilidad Profesional (PUC NIIF)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Sistema contable de doble partida, inmutabilidad y estados financieros integrados.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('accounts')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'accounts'
                ? 'bg-white text-slate-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4 text-emerald-600" />
            <span>Catálogo PUC NIIF</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('journal')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'journal'
                ? 'bg-white text-slate-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Plus className="w-4 h-4 text-blue-600" />
            <span>Registrar Asiento Diario</span>
          </button>
        </div>
      </div>

      {/* Contenido según pestaña activa */}
      {tab === 'journal' ? (
        <JournalEntryForm
          onSuccess={() => {
            fetchAccounts()
          }}
          onCancel={() => setTab('accounts')}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cuenta por código o nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              onClick={fetchAccounts}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-2xs"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
              <span>Sincronizar PUC</span>
            </button>
          </div>

          {error && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <strong>Aviso de Catálogo:</strong> {error}
            </div>
          )}

          {loading ? (
            <div className="flex h-64 items-center justify-center bg-white rounded-2xl border border-slate-100 shadow-xs">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
              <span className="ml-3 text-slate-600 font-medium">Cargando catálogo PUC NIIF...</span>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 overflow-hidden">
              <div className="space-y-1 divide-y divide-slate-100">
                {accountTree.map((node) => (
                  <AccountRenderItem key={node.id || node.code} node={node} search={search} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 4. Subcomponente Recursivo de Renderizado del Árbol PUC
function AccountRenderItem({
  node,
  search = '',
}: {
  node: AccountNode
  search?: string
}) {
  const [isOpen, setIsOpen] = useState<boolean>(node.level < 3)
  const hasChildren = node.children && node.children.length > 0

  const matchesSearch =
    !search ||
    node.code.toLowerCase().includes(search.toLowerCase()) ||
    node.name.toLowerCase().includes(search.toLowerCase())

  // Si algún hijo coincide con la búsqueda, forzar apertura
  useEffect(() => {
    if (search.trim()) {
      setIsOpen(true)
    }
  }, [search])

  if (!matchesSearch && !hasChildren) {
    return null
  }

  return (
    <div className="my-0.5 pt-1">
      <div
        onClick={() => hasChildren && setIsOpen(!isOpen)}
        className={`flex justify-between items-center p-2 rounded-xl transition-all duration-150 ${
          hasChildren ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50/50'
        } ${node.level === 1 ? 'font-bold text-slate-900 bg-slate-50' : ''}`}
        style={{ paddingLeft: `${node.level * 16}px` }}
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <span className="text-slate-400 text-xs w-4">
              {isOpen ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-4"></span>
          )}
          <span className="font-mono text-emerald-600 font-semibold">{node.code}</span>
          <span className="text-slate-700 font-medium text-sm">{node.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold font-mono ${
              node.nature.toLowerCase().includes('deb')
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-purple-50 text-purple-700 border border-purple-200'
            }`}
          >
            {node.nature.toLowerCase().includes('deb') ? 'Débito' : 'Crédito'}
          </span>
          <span className="text-xs text-slate-400 uppercase font-mono w-20 text-right hidden sm:inline">
            {node.type}
          </span>
        </div>
      </div>

      {hasChildren && isOpen && (
        <div className="mt-0.5 transition-all">
          {node.children!.map((child) => (
            <AccountRenderItem key={child.id || child.code} node={child} search={search} />
          ))}
        </div>
      )}
    </div>
  )
}
