import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Modelo contable vigente: acc_* (acc_trial_balance / acc_balance_sheet / acc_income_statement)
interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  type: string;
  nature: string;
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
}

interface StatementRow {
  account_id: string;
  code: string;
  name: string;
  type: string;
  amount: number;
}

const finalBalance = (r: TrialBalanceRow) => Number(r.closing_debit) - Number(r.closing_credit);

export default function AccountingStatements() {
  const [balanceData, setBalanceData] = useState<TrialBalanceRow[]>([]);
  const [sheetRows, setSheetRows] = useState<StatementRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);

  useEffect(() => {
    loadTrialBalance();
  }, [startDate, endDate]);

  const loadTrialBalance = async () => {
    try {
      setLoading(true);
      setError(null);
      const [tb, bs, is] = await Promise.all([
        supabase.rpc('acc_trial_balance', { p_from: startDate, p_to: endDate }),
        supabase.rpc('acc_balance_sheet', { p_to: endDate }),
        supabase.rpc('acc_income_statement', { p_from: startDate, p_to: endDate })
      ]);
      if (tb.error) throw tb.error;
      if (bs.error) throw bs.error;
      if (is.error) throw is.error;
      setBalanceData((tb.data || []) as TrialBalanceRow[]);
      setSheetRows((bs.data || []) as StatementRow[]);
      setIncomeRows((is.data || []) as StatementRow[]);
    } catch (err: any) {
      setError(err.message || 'Error calculando el balance de comprobación');
    } finally {
      setLoading(false);
    }
  };

  const totalDebits = balanceData.reduce((sum, row) => sum + Number(row.period_debit), 0);
  const totalCredits = balanceData.reduce((sum, row) => sum + Number(row.period_credit), 0);

  const sumBy = (rows: StatementRow[], types: string[]) =>
    rows.filter(r => types.includes(r.type)).reduce((sum, r) => sum + Number(r.amount), 0);

  const totalAssets = sumBy(sheetRows, ['activo']);
  const totalLiabilities = sumBy(sheetRows, ['pasivo']);
  const totalIncome = sumBy(incomeRows, ['ingreso']);
  const totalExpenses = sumBy(incomeRows, ['costo', 'gasto']);

  const netUtility = totalIncome - totalExpenses;

  const exportToExcel = () => {
    if (!balanceData || balanceData.length === 0) return;
    const worksheetData = balanceData.map(row => ({
      "Código Cuenta": row.code,
      "Nombre de Cuenta": row.name,
      "Tipo": String(row.type || '').toUpperCase(),
      "Débitos": Number(row.period_debit),
      "Créditos": Number(row.period_credit),
      "Saldo Final": finalBalance(row)
    }));
    worksheetData.push({
      "Código Cuenta": "TOTALES",
      "Nombre de Cuenta": "CONTROL PARTIDA DOBLE",
      "Tipo": "",
      "Débitos": totalDebits,
      "Créditos": totalCredits,
      "Saldo Final": totalDebits - totalCredits
    });
    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Comprobación");
    XLSX.writeFile(wb, `Balance_Comprobacion_${startDate}_a_${endDate}.xlsx`);
  };

  const exportToPDF = () => {
    if (!balanceData || balanceData.length === 0) return;
    const doc = new jsPDF();
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Contable_Pro - ERP Financiero", 14, 20);
    doc.setFontSize(11);
    doc.setFont("Helvetica", "normal");
    doc.text("Balance de Comprobación Oficial", 14, 27);
    doc.text(`Periodo: ${startDate} al ${endDate}`, 14, 33);

    const tableRows = balanceData.map(row => [
      row.code,
      row.name,
      `$${Number(row.period_debit).toFixed(2)}`,
      `$${Number(row.period_credit).toFixed(2)}`,
      `$${finalBalance(row).toFixed(2)}`
    ]);
    tableRows.push([
      "TOTALES",
      "CONTROL DE PARTIDA DOBLE",
      `$${totalDebits.toFixed(2)}`,
      `$${totalCredits.toFixed(2)}`,
      `$${(totalDebits - totalCredits).toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: 40,
      head: [['Código', 'Cuenta Contable', 'Débitos', 'Créditos', 'Saldo Final']],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42] }
    });
    doc.save(`Balance_Comprobacion_${startDate}_a_${endDate}.pdf`);
  };
  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="md:flex justify-between items-center bg-slate-900 text-white p-6 rounded-2xl shadow-lg">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Estados Financieros</h1>
          <p className="text-slate-400 text-sm">Monitoreo y auditoría transaccional en tiempo real</p>
        </div>
        
        <div className="flex flex-wrap md:flex-nowrap gap-3 mt-4 md:mt-0 bg-slate-800 p-2 rounded-xl border border-slate-700 items-center">
          <div className="flex gap-1 items-center">
            <input 
              type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-emerald-500"
            />
            <span className="text-slate-500 text-xs">a</span>
            <input 
              type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white focus:outline-emerald-500"
            />
          </div>

          <div className="hidden md:block h-6 w-px bg-slate-700"></div>

          <div className="flex gap-2 w-full md:w-auto justify-end">
            <button 
              onClick={exportToExcel}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
            >
              📊 Excel
            </button>
            <button 
              onClick={exportToPDF}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
            >
              📄 PDF
            </button>
          </div>
        </div>
      </div>

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

        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center border-l-4 border-l-emerald-500">
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

      <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Balance de Comprobación por Subcuentas</h2>
          <span className="text-xs font-mono text-slate-500">Registros procesados: {balanceData ? balanceData.length : 0}</span>
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
                {balanceData && balanceData.map((row) => (
                  <tr key={row.account_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-3 pl-6 font-mono font-semibold text-slate-500">{row.code}</td>
                    <td className="p-3 text-slate-700 font-medium">{row.name}</td>
                    <td className="p-3 text-right font-mono text-slate-600">${Number(row.period_debit).toFixed(2)}</td>
                    <td className="p-3 text-right font-mono text-slate-600">${Number(row.period_credit).toFixed(2)}</td>
                    <td className={`p-3 text-right font-mono pr-6 font-bold ${finalBalance(row) < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                      ${finalBalance(row).toFixed(2)}
                    </td>
                  </tr>
                ))}
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
