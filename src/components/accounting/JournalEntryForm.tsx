import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Account {
  id: string;
  code: string;
  name: string;
}

interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
}

export default function JournalEntryForm() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [concept, setConcept] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [lines, setLines] = useState<JournalLineInput[]>([
    { accountId: '', debit: 0, credit: 0 },
    { accountId: '', debit: 0, credit: 0 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 1. Cargar subcuentas afectables para los selectores (Nivel 4 / 6 dígitos)
  useEffect(() => {
    const loadAccounts = async () => {
      const { data } = await supabase
        .from('accounting_accounts')
        .select('id, code, name')
        .gte('level', 4)
        .order('code', { ascending: true });
      if (data) setAccounts(data);
    };
    loadAccounts();
  }, []);

  // 2. Cálculos matemáticos en tiempo real
  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const difference = Math.abs(totalDebits - totalCredits);
  const isBalanced = totalDebits === totalCredits && totalDebits > 0;

  const handleLineChange = (index: number, field: keyof JournalLineInput, value: string | number) => {
    const newLines = [...lines];
    if (field === 'accountId') {
      newLines[index].accountId = value as string;
    } else {
      // Si se ingresa débito, se limpia el crédito en esa fila (y viceversa)
      const numValue = Math.max(0, Number(value));
      newLines[index][field] = numValue;
      if (field === 'debit' && numValue > 0) newLines[index].credit = 0;
      if (field === 'credit' && numValue > 0) newLines[index].debit = 0;
    }
    setLines(newLines);
  };

  const addLine = () => setLines([...lines, { accountId: '', debit: 0, credit: 0 }]);
  const removeLine = (index: number) => {
    if (lines.length > 2) setLines(lines.filter((_, i) => i !== index));
  };

  // 3. Persistencia de datos transaccionales en Supabase (Partida Doble)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBalanced || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setMessage(null);

      // Inserción en la cabecera (accounting_journal_entries)
      const { data: entry, error: entryError } = await supabase
        .from('accounting_journal_entries')
        .insert([{ concept, entry_date: entryDate, status: 'DRAFT' }])
        .select()
        .single();

      if (entryError) throw entryError;

      // Estructuración de las líneas de detalle (accounting_journal_items)
      const linesToInsert = lines.map(line => ({
        entry_id: entry.id,
        account_id: line.accountId,
        debit: line.debit,
        credit: line.credit
      }));

      const { error: linesError } = await supabase
        .from('accounting_journal_items')
        .insert(linesToInsert);

      if (linesError) throw linesError;

      setMessage({ type: 'success', text: `Asiento Borrador creado exitosamente.` });
      setConcept('');
      setLines([
        { accountId: '', debit: 0, credit: 0 },
        { accountId: '', debit: 0, credit: 0 },
      ]);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error al guardar el asiento' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-xl shadow-md border border-slate-100">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Registrar Asiento Diario</h2>
      
      {message && (
        <div className={`p-4 rounded-lg mb-4 text-sm font-medium ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Concepto / Descripción</label>
            <input 
              type="text" required value={concept} onChange={e => setConcept(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-emerald-500"
              placeholder="Ej. Pago de servicios públicos mes actual"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">Fecha Contable</label>
            <input 
              type="date" required value={entryDate} onChange={e => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-emerald-500"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-slate-500">Apuntes Contables (Débitos y Créditos)</label>
          {lines.map((line, index) => (
            <div key={index} className="flex gap-2 items-center">
              <select
                required value={line.accountId} onChange={e => handleLineChange(index, 'accountId', e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-emerald-500"
              >
                <option value="">Seleccione una cuenta...</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                ))}
              </select>
              <input 
                type="number" step="0.01" placeholder="Débito" value={line.debit || ''}
                onChange={e => handleLineChange(index, 'debit', e.target.value)}
                className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-emerald-500"
              />
              <input 
                type="number" step="0.01" placeholder="Crédito" value={line.credit || ''}
                onChange={e => handleLineChange(index, 'credit', e.target.value)}
                className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right focus:outline-emerald-500"
              />
              <button 
                type="button" onClick={() => removeLine(index)} disabled={lines.length <= 2}
                className="text-slate-400 hover:text-red-500 p-2 disabled:opacity-30"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
          <button 
            type="button" onClick={addLine}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-white border border-emerald-200 px-3 py-1.5 rounded-lg shadow-sm"
          >
            ➕ Añadir Apunte
          </button>
          
          <div className="text-right space-y-1 text-sm font-mono">
            <div className="text-slate-600">Total Débitos: <span className="font-bold">${totalDebits.toFixed(2)}</span></div>
            <div className="text-slate-600">Total Créditos: <span className="font-bold">${totalCredits.toFixed(2)}</span></div>
            {difference > 0 ? (
              <div className="text-red-600 font-semibold text-xs">⚠️ Descuadrado por: ${difference.toFixed(2)}</div>
            ) : totalDebits > 0 ? (
              <div className="text-emerald-600 font-bold text-xs">✅ Asiento Cuadrado (Partida Doble)</div>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit" disabled={!isBalanced || isSubmitting}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-colors ${
              isBalanced && !isSubmitting ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer' : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? 'Guardando...' : 'Guardar Asiento en Borrador'}
          </button>
        </div>
      </form>
    </div>
  );
}
