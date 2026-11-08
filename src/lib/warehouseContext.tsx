import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { Branch, Warehouse } from '../types'

interface WarehouseContextValue {
  branches: Branch[]
  warehouses: Warehouse[]
  activeWarehouses: Warehouse[]
  activeWarehouseId: string | null
  activeWarehouse: Warehouse | null
  activeBranch: Branch | null
  sqlReady: boolean
  loading: boolean
  setActiveWarehouseId: (id: string | null) => void
  refreshWarehouses: () => Promise<void>
}

const WarehouseContext = createContext<WarehouseContextValue>({
  branches: [],
  warehouses: [],
  activeWarehouses: [],
  activeWarehouseId: null,
  activeWarehouse: null,
  activeBranch: null,
  sqlReady: true,
  loading: false,
  setActiveWarehouseId: () => {},
  refreshWarehouses: async () => {},
})

const STORAGE_PREFIX = 'ip_active_warehouse_'

function isMissingSchemaError(message?: string): boolean {
  if (!message) return false
  return /relation .* does not exist|could not find the table|schema cache|42P01/i.test(message)
}

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { user, isDemo } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [activeWarehouseId, setActiveWarehouseIdState] = useState<string | null>(null)
  const [sqlReady, setSqlReady] = useState(true)
  const [loading, setLoading] = useState(false)

  const storageKey = `${STORAGE_PREFIX}${isDemo ? 'demo' : user?.company_id || user?.id || 'default'}`

  const refreshWarehouses = useCallback(async () => {
    if (!user) {
      setBranches([])
      setWarehouses([])
      setActiveWarehouseIdState(null)
      return
    }

    setLoading(true)
    try {
      const [bRes, wRes] = await Promise.all([
        supabase.from('branches').select('*').order('is_main', { ascending: false }).order('name'),
        supabase.from('warehouses').select('*').order('name'),
      ])

      if (bRes.error && isMissingSchemaError(bRes.error.message)) {
        setSqlReady(false)
        setBranches([])
        setWarehouses([])
        setActiveWarehouseIdState(null)
        setLoading(false)
        return
      }

      if (wRes.error && isMissingSchemaError(wRes.error.message)) {
        setSqlReady(false)
        setBranches([])
        setWarehouses([])
        setActiveWarehouseIdState(null)
        setLoading(false)
        return
      }

      setSqlReady(true)
      const nextBranches = ((bRes.data || []) as Branch[])
      const nextWarehouses = ((wRes.data || []) as Warehouse[])
      setBranches(nextBranches)
      setWarehouses(nextWarehouses)

      const enabled = nextWarehouses.filter(w => w.active !== false)
      if (enabled.length === 0) {
        setActiveWarehouseIdState(null)
        setLoading(false)
        return
      }

      let stored: string | null = null
      try {
        stored = sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey)
      } catch {
        stored = null
      }

      if (stored && enabled.some(w => w.id === stored)) {
        setActiveWarehouseIdState(stored)
      } else {
        const principal =
          enabled.find(w => w.warehouse_type === 'principal') ||
          enabled.find(w => {
            const b = nextBranches.find(br => br.id === w.branch_id)
            return b?.is_main
          }) ||
          enabled[0]
        setActiveWarehouseIdState(principal?.id ?? null)
      }
    } catch {
      /* offline or unavailable: preserve graceful empty state */
    } finally {
      setLoading(false)
    }
  }, [user, storageKey])

  useEffect(() => {
    void refreshWarehouses()
  }, [refreshWarehouses])

  const setActiveWarehouseId = useCallback(
    (id: string | null) => {
      setActiveWarehouseIdState(id)
      try {
        if (id) {
          sessionStorage.setItem(storageKey, id)
          if (!isDemo) localStorage.setItem(storageKey, id)
        } else {
          sessionStorage.removeItem(storageKey)
          if (!isDemo) localStorage.removeItem(storageKey)
        }
      } catch {
        /* ignore */
      }
    },
    [storageKey, isDemo]
  )

  const activeWarehouses = useMemo(
    () => warehouses.filter(w => w.active !== false),
    [warehouses]
  )

  const activeWarehouse = useMemo(
    () => activeWarehouses.find(w => w.id === activeWarehouseId) ?? null,
    [activeWarehouses, activeWarehouseId]
  )

  const activeBranch = useMemo(() => {
    if (!activeWarehouse?.branch_id) {
      return branches.find(b => b.is_main) ?? branches[0] ?? null
    }
    return branches.find(b => b.id === activeWarehouse.branch_id) ?? null
  }, [branches, activeWarehouse])

  return (
    <WarehouseContext.Provider
      value={{
        branches,
        warehouses,
        activeWarehouses,
        activeWarehouseId,
        activeWarehouse,
        activeBranch,
        sqlReady,
        loading,
        setActiveWarehouseId,
        refreshWarehouses,
      }}
    >
      {children}
    </WarehouseContext.Provider>
  )
}

export function useWarehouse() {
  return useContext(WarehouseContext)
}
