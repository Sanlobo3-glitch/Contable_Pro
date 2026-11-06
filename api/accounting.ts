import type { Request, Response } from 'express'
import { SEED_PUC_ACCOUNTS, buildAccountTree, type AccountNode } from '../src/lib/accountingTree'

export interface CreateJournalEntryPayload {
  entry_number?: string
  entry_date?: string
  concept: string
  status?: 'borrador' | 'posteado' | 'cerrado'
  source_module?: string
  created_by?: string
  created_by_name?: string
  lines: Array<{
    account_code: string
    account_name?: string
    debit: number
    credit: number
    memo?: string
  }>
}

interface InFlightEntry {
  id: string
  entry_number: string
  entry_date: string
  concept: string
  status: 'borrador' | 'posteado' | 'cerrado' | 'anulado'
  source_module: string
  created_by_name?: string
  created_at: string
  lines: Array<{
    id: string
    account_code: string
    account_name: string
    debit: number
    credit: number
    memo?: string
  }>
}

// Memoria de respaldo en servidor
const serverEntries: InFlightEntry[] = [
  {
    id: 'entry-seed-01',
    entry_number: 'AS-2026-001',
    entry_date: new Date().toISOString().split('T')[0],
    concept: 'Apertura contable y constitución de capital inicial',
    status: 'posteado',
    source_module: 'apertura',
    created_by_name: 'Contador General',
    created_at: new Date().toISOString(),
    lines: [
      { id: 'line-1', account_code: '110505', account_name: 'Caja General', debit: 5000000, credit: 0, memo: 'Aporte en efectivo' },
      { id: 'line-2', account_code: '111005', account_name: 'Moneda Nacional', debit: 15000000, credit: 0, memo: 'Depósito inicial bancos' },
      { id: 'line-3', account_code: '310505', account_name: 'Capital Autorizado', debit: 0, credit: 20000000, memo: 'Capital suscrito de socios' },
    ],
  },
  {
    id: 'entry-seed-02',
    entry_number: 'AS-2026-002',
    entry_date: new Date().toISOString().split('T')[0],
    concept: 'Venta de mercancía a crédito con IVA generado',
    status: 'posteado',
    source_module: 'ventas',
    created_by_name: 'Valentina Morales',
    created_at: new Date().toISOString(),
    lines: [
      { id: 'line-4', account_code: '130505', account_name: 'Clientes Nacionales', debit: 2380000, credit: 0, memo: 'Factura cliente mayorista' },
      { id: 'line-5', account_code: '413505', account_name: 'Venta de Mercancías', debit: 0, credit: 2000000, memo: 'Ingreso operacional' },
      { id: 'line-6', account_code: '240805', account_name: 'IVA Generado (Ventas)', debit: 0, credit: 380000, memo: 'IVA 19% generado' },
    ],
  },
]

export function createAccountingHandler() {
  return async function handleAccounting(req: Request, res: Response) {
    const { path, method } = req

    try {
      // 1. GET /api/accounting/accounts -> Catálogo plano y árbol jerárquico
      if (method === 'GET' && (path === '/accounts' || path === '/api/accounting/accounts')) {
        const tree = buildAccountTree(SEED_PUC_ACCOUNTS)
        return res.json({
          ok: true,
          total: SEED_PUC_ACCOUNTS.length,
          flat: SEED_PUC_ACCOUNTS,
          tree,
        })
      }

      // 2. GET /api/accounting/entries -> Listado de Asientos Contables
      if (method === 'GET' && (path === '/entries' || path === '/api/accounting/entries')) {
        return res.json({
          ok: true,
          count: serverEntries.length,
          entries: serverEntries,
        })
      }

      // 3. POST /api/accounting/entries -> Crear y registrar Asiento Contable (Valida Partida Doble)
      if (method === 'POST' && (path === '/entries' || path === '/api/accounting/entries')) {
        const payload: CreateJournalEntryPayload = req.body

        if (!payload || !payload.concept || !Array.isArray(payload.lines) || payload.lines.length < 2) {
          return res.status(400).json({
            ok: false,
            error: 'Un asiento contable requiere concepto válido y al menos 2 líneas contables.',
          })
        }

        let totalDebit = 0
        let totalCredit = 0

        const processedLines = payload.lines.map((line, idx) => {
          const debit = Number(line.debit) || 0
          const credit = Number(line.credit) || 0
          totalDebit += debit
          totalCredit += credit

          const matchedAccount = SEED_PUC_ACCOUNTS.find((a) => a.code === line.account_code)
          return {
            id: `line-${Date.now()}-${idx}`,
            account_code: line.account_code,
            account_name: line.account_name || matchedAccount?.name || 'Cuenta Contable',
            debit,
            credit,
            memo: line.memo || payload.concept,
          }
        })

        const diff = Math.round((totalDebit - totalCredit) * 100) / 100

        // Si se va a postear directamente, exigir partida doble absoluta
        const status = payload.status || 'borrador'
        if (status === 'posteado' && diff !== 0) {
          return res.status(422).json({
            ok: false,
            error: `Error de Partida Doble: El asiento contable está descuadrado por ${diff}. Total Débitos: ${totalDebit}, Total Créditos: ${totalCredit}. No se puede postear sin balancear.`,
            totalDebit,
            totalCredit,
            diff,
          })
        }

        const newEntryNumber =
          payload.entry_number ||
          `AS-${new Date().getFullYear()}-${String(serverEntries.length + 1).padStart(3, '0')}`

        const newEntry: InFlightEntry = {
          id: `entry-${Date.now()}`,
          entry_number: newEntryNumber,
          entry_date: payload.entry_date || new Date().toISOString().split('T')[0],
          concept: payload.concept,
          status,
          source_module: payload.source_module || 'manual',
          created_by_name: payload.created_by_name || 'Usuario Contable',
          created_at: new Date().toISOString(),
          lines: processedLines,
        }

        serverEntries.unshift(newEntry)

        return res.status(201).json({
          ok: true,
          message:
            status === 'posteado'
              ? 'Asiento contable posteado con éxito bajo estricta partida doble (Inmutable).'
              : 'Asiento contable guardado en borrador.',
          entry: newEntry,
          totalDebit,
          totalCredit,
          balanced: diff === 0,
        })
      }

      // 4. GET /api/accounting/reports/trial-balance -> Balance de Comprobación
      if (
        method === 'GET' &&
        (path === '/reports/trial-balance' || path === '/api/accounting/reports/trial-balance')
      ) {
        const accountTotals = new Map<string, { debit: number; credit: number }>()

        // Acumular de asientos posteados
        for (const entry of serverEntries) {
          if (entry.status === 'posteado' || entry.status === 'cerrado') {
            for (const l of entry.lines) {
              const current = accountTotals.get(l.account_code) || { debit: 0, credit: 0 }
              current.debit += l.debit
              current.credit += l.credit
              accountTotals.set(l.account_code, current)
            }
          }
        }

        let totalDebitSum = 0
        let totalCreditSum = 0

        const rows = SEED_PUC_ACCOUNTS.filter((acc) => accountTotals.has(acc.code)).map((acc) => {
          const totals = accountTotals.get(acc.code) || { debit: 0, credit: 0 }
          totalDebitSum += totals.debit
          totalCreditSum += totals.credit

          const balance =
            acc.nature === 'Débito'
              ? totals.debit - totals.credit
              : totals.credit - totals.debit

          return {
            code: acc.code,
            name: acc.name,
            type: acc.type,
            nature: acc.nature,
            level: acc.level,
            debit: totals.debit,
            credit: totals.credit,
            balance,
          }
        })

        return res.json({
          ok: true,
          report: 'Balance de Comprobación de Sumas y Saldos (NIIF)',
          asOf: new Date().toISOString(),
          totalDebitSum,
          totalCreditSum,
          balanced: Math.round(totalDebitSum * 100) === Math.round(totalCreditSum * 100),
          rows,
        })
      }

      // 5. GET /api/accounting/reports/balance-sheet -> Balance General
      if (
        method === 'GET' &&
        (path === '/reports/balance-sheet' || path === '/api/accounting/reports/balance-sheet')
      ) {
        let totalActivo = 0
        let totalPasivo = 0
        let totalPatrimonio = 0

        const activosRows: any[] = []
        const pasivosRows: any[] = []
        const patrimonioRows: any[] = []

        for (const entry of serverEntries) {
          if (entry.status === 'posteado' || entry.status === 'cerrado') {
            for (const l of entry.lines) {
              const acc = SEED_PUC_ACCOUNTS.find((a) => a.code === l.account_code)
              if (!acc) continue

              const net = acc.nature === 'Débito' ? l.debit - l.credit : l.credit - l.debit

              if (acc.type === 'Activo') {
                totalActivo += net
                activosRows.push({ code: acc.code, name: acc.name, amount: net })
              } else if (acc.type === 'Pasivo') {
                totalPasivo += net
                pasivosRows.push({ code: acc.code, name: acc.name, amount: net })
              } else if (acc.type === 'Patrimonio') {
                totalPatrimonio += net
                patrimonioRows.push({ code: acc.code, name: acc.name, amount: net })
              }
            }
          }
        }

        const pasivoMasPatrimonio = totalPasivo + totalPatrimonio
        const ecuacionContableCuadrada =
          Math.abs(Math.round((totalActivo - pasivoMasPatrimonio) * 100)) === 0

        return res.json({
          ok: true,
          report: 'Balance General Clasificado (NIIF)',
          asOf: new Date().toISOString(),
          totalActivo,
          totalPasivo,
          totalPatrimonio,
          pasivoMasPatrimonio,
          ecuacionContableCuadrada,
          details: {
            activos: activosRows,
            pasivos: pasivosRows,
            patrimonio: patrimonioRows,
          },
        })
      }

      // 6. GET /api/accounting/reports/income-statement -> Estado de Resultados
      if (
        method === 'GET' &&
        (path === '/reports/income-statement' || path === '/api/accounting/reports/income-statement')
      ) {
        let totalIngresos = 0
        let totalCostos = 0
        let totalGastos = 0

        for (const entry of serverEntries) {
          if (entry.status === 'posteado' || entry.status === 'cerrado') {
            for (const l of entry.lines) {
              const acc = SEED_PUC_ACCOUNTS.find((a) => a.code === l.account_code)
              if (!acc) continue

              if (acc.type === 'Ingreso') {
                totalIngresos += l.credit - l.debit
              } else if (acc.type === 'Costo') {
                totalCostos += l.debit - l.credit
              } else if (acc.type === 'Gasto') {
                totalGastos += l.debit - l.credit
              }
            }
          }
        }

        const utilidadBruta = totalIngresos - totalCostos
        const utilidadNeta = utilidadBruta - totalGastos

        return res.json({
          ok: true,
          report: 'Estado de Resultados Integral (P&G NIIF)',
          asOf: new Date().toISOString(),
          totalIngresos,
          totalCostos,
          utilidadBruta,
          totalGastos,
          utilidadNeta,
        })
      }

      return res.status(404).json({ ok: false, error: `Ruta contable ${path} no encontrada` })
    } catch (err: any) {
      console.error('Error en controlador contable:', err)
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno del servidor contable' })
    }
  }
}
