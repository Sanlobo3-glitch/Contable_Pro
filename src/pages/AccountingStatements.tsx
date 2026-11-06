import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
  initial_balance: number;
  final_balance: number;
}

export default function AccountingStatements() {
  const [balanceData, setBalanceData] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rango de fechas por defecto: Mes actual
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);

  useEffect(() => {
    loadTrialBalance();
  }, [startDate, endDate]);

  // 1. Consumo de la función RPC de Supabase que compilamos antes
  const loadTrialBalance = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('get_trial_balance', {
        p_start_date: startDate,
        v_end_date: endDate
      });

      if (rpcError) throw rpcError;
      if (data) setBalanceData(data as TrialBalanceRow[]);
    } catch (err: any) {
      setError(err.message || 'Error calculando el balance de comprobación');
    } finally {
      setLoading(false);
    }
  };

  // 2. Lógica Financiera en Tiempo Real (Agregaciones dinámicas en Frontend)
  const totalDebits = balanceData.reduce((sum, row) => sum + Number(row.total_debit), 0);
  const totalCredits = balanceData.reduce((sum, row) => sum + Number(row.total_credit), 0);

  // Filtrado dinámico por tipo de cuenta bajo estándares NIIF
  const totalAssets = balanceData.filter(r => r.account_type === 'asset' || r.account_code.startsWith('1')).reduce((sum, r) => sum + Number(r.final_balance), 0);
  const totalLiabilities = balanceData.filter(r => r.account_type === 'liability' || r.account_code.startsWith('2')).reduce((sum, r) => sum + Number(r.final_balance), 0);
  const totalIncome = balanceData.filter(r => r.account_type === 'income' || r.account_code.startsWith('4')).reduce((sum, r) => sum + Number(r.final_balance), 0);
  const totalExpenses = balanceData.filter(r => r.account_type === 'expense' || r.account_code.startsWith('5') || r.account_code.startsWith('6')).reduce((sum, r) => sum + Number(r.final_balance), 0);

  // Ecuación matemática: Ingresos - Gastos/Costos
  const netUtility = totalIncome - totalExpenses;

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      {/* Encabezado Principal */}
      <div className="md:flex justify-between items-center bg-slate-900 text-white p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Estados Financieros</h1>
          <p className="text-slate-400 text-sm">Monitoreo y auditoría transaccional en tiempo real</p>
        </div>
        <div className="flex gap-2 mt-4 md:mt-0 bg-slate-800 p-2 rounded-xl border border-slate-700">
          <input 
            type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-emerald-500"
          />
          <span className="text-slate-500 self-center text-xs">a</span>
          <input 
            type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-emerald-500"
          />
        </div>
      </div>

      {/* 2. KPI Cards de Alto Impacto Visual */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Activos Totales</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">${totalAssets.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</h3>
          </div>
          <span className="p-3 bg-blue-50 text-blue-600 rounded-lg font-bold text-lg">🏦</span>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pasivos / Obligaciones</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">${totalLiabilities.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</h3>
          </div>
          <span className="p-3 bg-purple-50 text-purple-600 rounded-lg font-bold text-lg">📉</span>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center (${netUtility >= 0 ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-rose-500'})">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Utilidad Neta del Periodo</p>
            <h3 className={`text-2xl font-bold mt-1 ${netUtility >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              ${netUtility.toLocaleString('es-CO', { minimumFractionDigits: 2 })}
            </h3>
          </div>
          <span className={`p-3 rounded-lg font-bold text-lg ${netUtility >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {netUtility >= 0 ? '💰' : '⚠️'}
          </span>
        </div>
      </div>

      {/* 3. Tabla del Balance de Comprobación */}
      <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Balance de Comprobación por Subcuentas</h2>
          <span className="text-xs font-mono text-slate-500">Registros procesados: {balanceData.length}</span>
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-800 border-t-transparent"></div>
            <p className="text-sm text-slate-500 font-medium mt-2">Calculando saldos financieros...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-red-600 font-medium text-sm text-center">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/70 text-slate-600 font-mono text-[11px] uppercase border-b border-slate-200">
                  <th className="p-3 pl-6">Código</th>
                  <th className="p-3">Cuenta Contable</th>
                  <th className="p-3 text-right">Débitos (Mov)</th>
                  <th className="p-3 text-right">Créditos (Mov)</th>
                  <th className="p-3 text-right pr-6">Saldo Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {balanceData.map((row) => (
                  <tr key={row.account_code} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-3 pl-6 font-mono font-semibold text-slate-500">{row.account_code}</td>
                    <td className="p-3 text-slate-700 font-medium">{row.account_name}</td>
                    <td className="p-3 text-right font-mono text-slate-600">${Number(row.total_debit).toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-slate-600">${Number(row.total_credit).toFixed(2)}</td>
                    <td className={`p-3 text-right font-mono pr-6 font-bold ${Number(row.final_balance) < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      ${Number(row.final_balance).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {/* Fila de Totales de Control */}
                <tr className="bg-slate-900 text-white font-semibold font-mono text-sm">
                  <td className="p-4 pl-6" colSpan={2}>TOTALES DE CONTROL (PARTIDA DOBLE)</td>
                  <td className="p-4 text-right">${totalDebits.toFixed(2)}</td>
                  <td className="p-4 text-right">${totalCredits.toFixed(2)}</td>
                  <td className="p-4 text-right pr-6 text-emerald-400">
                    ${(totalDebits - totalCredits).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
