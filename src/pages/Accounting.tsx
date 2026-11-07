import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // Asegura que la ruta a tu cliente de Supabase sea correcta

// 1. Tipado estricto de la estructura contable
// Modelo contable vigente: tabla acc_accounts (jerarquía por parent_id)
interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  nature: string;
  parent_id: string | null;
}

interface AccountNode extends AccountRow {
  level: number;
  children?: AccountNode[];
}

export default function Accounting() {
  const [accountTree, setAccountTree] = useState<AccountNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  // 2. Consulta de datos a Supabase sobre la tabla real (acc_accounts)
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const { data, error: supabaseError } = await supabase
        .from('acc_accounts')
        .select('id, code, name, type, nature, parent_id')
        .order('code', { ascending: true });

      if (supabaseError) throw supabaseError;

      if (data) {
        const tree = buildAccountTree(data as AccountRow[]);
        setAccountTree(tree);
      }
    } catch (err: any) {
      setError(err.message || 'Error cargando el catálogo de cuentas');
    } finally {
      setLoading(false);
    }
  };

  // 3. Conversión de lista plana a árbol jerárquico usando parent_id
  const buildAccountTree = (flatAccounts: AccountRow[]): AccountNode[] => {
    const lookup: { [id: string]: AccountNode } = {};
    flatAccounts.forEach((account) => {
      lookup[account.id] = { ...account, level: 1, children: [] };
    });

    const rootNodes: AccountNode[] = [];
    flatAccounts.forEach((account) => {
      const node = lookup[account.id];
      const parent = account.parent_id ? lookup[account.parent_id] : undefined;
      if (parent) parent.children!.push(node);
      else rootNodes.push(node); // raíces y huérfanos
    });

    const setLevels = (nodes: AccountNode[], level: number) => {
      nodes.forEach((n) => {
        n.level = level;
        if (n.children && n.children.length) setLevels(n.children, level + 1);
      });
    };
    setLevels(rootNodes, 1);

    return rootNodes;
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
        <span className="ml-3 text-slate-600 font-medium">Cargando catálogo de cuentas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 my-4">
        <strong>⚠️ Error en el ERP:</strong> {error}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Catálogo de Cuentas (PUC)</h1>
          <p className="text-sm text-slate-500">Plan de cuentas de tu empresa</p>
        </div>
        <button 
          onClick={fetchAccounts}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          🔄 Sincronizar
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-md border border-slate-100 p-6">
        <div className="space-y-2">
          {accountTree.map((node) => (
            <AccountRenderItem key={node.id} node={node} />
          ))}
        </div>
      </div>
    </div>
  );
}

// 4. Subcomponente Recursivo de Renderizado con Tailwind CSS
function AccountRenderItem({ node }: { node: AccountNode }) {
  const [isOpen, setIsSummaryOpen] = useState<boolean>(node.level < 3); // Dejar clases y grupos abiertos por defecto
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="my-0.5">
      <div 
        onClick={() => hasChildren && setIsSummaryOpen(!isOpen)}
        className={`flex justify-between items-center p-2 rounded-lg transition-all duration-150 ${
          hasChildren ? 'cursor-pointer hover:bg-slate-50' : 'bg-slate-50/40'
        } ${node.level === 1 ? 'border-b border-slate-100 font-bold text-slate-900 bg-slate-50/80' : ''}`}
        style={{ paddingLeft: `${node.level * 12}px` }}
      >
        <div className="flex items-center gap-2">
          {hasChildren && (
            <span className="text-slate-400 text-xs w-4">
              {isOpen ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span className="w-4"></span>}
          <span className="font-mono text-emerald-600 font-semibold">{node.code}</span>
          <span className="text-slate-700 font-medium text-sm">{node.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold font-mono ${
            node.nature === 'debito' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
          }`}>
            {node.nature === 'debito' ? 'Débito' : node.nature === 'credito' ? 'Crédito' : node.nature}
          </span>
          <span className="text-xs text-slate-400 uppercase font-mono w-16 text-right hidden sm:inline">
            {node.type}
          </span>
        </div>
      </div>

      {hasChildren && isOpen && (
        <div className="mt-0.5 transition-all">
          {node.children!.map((child) => (
            <AccountRenderItem key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
