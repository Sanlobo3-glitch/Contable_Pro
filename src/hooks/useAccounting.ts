import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountingService } from '../services/accountingService'
import type { CreateJournalEntryPayload } from '../types'

export const ACCOUNTING_KEYS = {
  all: ['accounting'] as const,
  accounts: (companyId: string) => [...ACCOUNTING_KEYS.all, 'accounts', companyId] as const,
  entries: (companyId: string) => [...ACCOUNTING_KEYS.all, 'entries', companyId] as const,
  trialBalance: (companyId: string, start: string, end: string) =>
    [...ACCOUNTING_KEYS.all, 'trial-balance', companyId, start, end] as const,
  balanceSheet: (companyId: string, asOf: string) =>
    [...ACCOUNTING_KEYS.all, 'balance-sheet', companyId, asOf] as const,
  incomeStatement: (companyId: string, start: string, end: string) =>
    [...ACCOUNTING_KEYS.all, 'income-statement', companyId, start, end] as const,
}

export function useAccounts(companyId: string) {
  return useQuery({
    queryKey: ACCOUNTING_KEYS.accounts(companyId),
    queryFn: () => accountingService.getAccounts(companyId),
    enabled: Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useJournalEntries(companyId: string) {
  return useQuery({
    queryKey: ACCOUNTING_KEYS.entries(companyId),
    queryFn: () => accountingService.getJournalEntries(companyId),
    enabled: Boolean(companyId),
    staleTime: 30 * 1000,
  })
}

export function useCreateJournalEntry(companyId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateJournalEntryPayload) => accountingService.createJournalEntry(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.entries(companyId) })
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.all })
    },
  })
}

export function usePostJournalEntry(companyId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entryId: string) => accountingService.postJournalEntry(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.entries(companyId) })
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.all })
    },
  })
}

export function useReverseJournalEntry(companyId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ entryId, concept }: { entryId: string; concept?: string }) =>
      accountingService.reverseJournalEntry(entryId, concept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.entries(companyId) })
      queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEYS.all })
    },
  })
}

export function useTrialBalance(companyId: string, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ACCOUNTING_KEYS.trialBalance(companyId, startDate, endDate),
    queryFn: () => accountingService.getTrialBalance(companyId, startDate, endDate),
    enabled: Boolean(companyId && startDate && endDate),
    staleTime: 60 * 1000,
  })
}

export function useBalanceSheet(companyId: string, asOfDate: string) {
  return useQuery({
    queryKey: ACCOUNTING_KEYS.balanceSheet(companyId, asOfDate),
    queryFn: () => accountingService.getBalanceSheet(companyId, asOfDate),
    enabled: Boolean(companyId && asOfDate),
    staleTime: 60 * 1000,
  })
}

export function useIncomeStatement(companyId: string, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ACCOUNTING_KEYS.incomeStatement(companyId, startDate, endDate),
    queryFn: () => accountingService.getIncomeStatement(companyId, startDate, endDate),
    enabled: Boolean(companyId && startDate && endDate),
    staleTime: 60 * 1000,
  })
}
