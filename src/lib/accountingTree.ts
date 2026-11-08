export interface AccountNode {
  code: string
  name: string
  type: 'Activo' | 'Pasivo' | 'Patrimonio' | 'Ingreso' | 'Gasto' | 'Costo'
  nature: 'Débito' | 'Crédito'
  level: number
  children?: AccountNode[]
}

/**
 * Algoritmo oficial de conversión de lista plana a estructura jerárquica de árbol
 * según los niveles del Plan Único de Cuentas (PUC) basado en NIIF.
 */
export function buildAccountTree(flatAccounts: AccountNode[]): AccountNode[] {
  const rootNodes: AccountNode[] = []
  const lookup: { [code: string]: AccountNode } = {}

  flatAccounts.forEach((account) => {
    lookup[account.code] = { ...account, children: [] }
  })

  flatAccounts.forEach((account) => {
    const currentNode = lookup[account.code]
    const code = account.code

    if (account.level === 1) {
      rootNodes.push(currentNode)
    } else {
      let parentCode = ''
      if (account.level === 2) parentCode = code.substring(0, 1)
      else if (account.level === 3) parentCode = code.substring(0, 2)
      else if (account.level === 4) parentCode = code.substring(0, 4)

      const parentNode = lookup[parentCode]
      if (parentNode && parentNode.children) {
        parentNode.children.push(currentNode)
      } else {
        rootNodes.push(currentNode)
      }
    }
  })

  return rootNodes
}

/**
 * Catálogo Semilla de Cuentas PUC NIIF Colombiano
 */
export const SEED_PUC_ACCOUNTS: AccountNode[] = [
  { code: '1', name: 'ACTIVO', type: 'Activo', nature: 'Débito', level: 1 },
  { code: '11', name: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', type: 'Activo', nature: 'Débito', level: 2 },
  { code: '1105', name: 'Caja', type: 'Activo', nature: 'Débito', level: 3 },
  { code: '110505', name: 'Caja General', type: 'Activo', nature: 'Débito', level: 4 },
  { code: '1110', name: 'Bancos', type: 'Activo', nature: 'Débito', level: 3 },
  { code: '111005', name: 'Moneda Nacional', type: 'Activo', nature: 'Débito', level: 4 },
  { code: '13', name: 'CUENTAS POR COBRAR COMERCIALES Y OTRAS', type: 'Activo', nature: 'Débito', level: 2 },
  { code: '1305', name: 'Clientes', type: 'Activo', nature: 'Débito', level: 3 },
  { code: '130505', name: 'Clientes Nacionales', type: 'Activo', nature: 'Débito', level: 4 },
  { code: '2', name: 'PASIVO', type: 'Pasivo', nature: 'Crédito', level: 1 },
  { code: '21', name: 'OBLIGACIONES FINANCIERAS', type: 'Pasivo', nature: 'Crédito', level: 2 },
  { code: '2105', name: 'Bancos Nacionales', type: 'Pasivo', nature: 'Crédito', level: 3 },
  { code: '210505', name: 'Sobregiros', type: 'Pasivo', nature: 'Crédito', level: 4 },
  { code: '23', name: 'CUENTAS POR PAGAR', type: 'Pasivo', nature: 'Crédito', level: 2 },
  { code: '2335', name: 'Costos y Gastos por Pagar', type: 'Pasivo', nature: 'Crédito', level: 3 },
  { code: '233550', name: 'Servicios Públicos', type: 'Pasivo', nature: 'Crédito', level: 4 },
  { code: '24', name: 'IMPUESTOS, GRAVÁMENES Y TASAS', type: 'Pasivo', nature: 'Crédito', level: 2 },
  { code: '2408', name: 'Impuesto sobre las Ventas por Pagar (IVA)', type: 'Pasivo', nature: 'Crédito', level: 3 },
  { code: '240805', name: 'IVA Generado (Ventas)', type: 'Pasivo', nature: 'Crédito', level: 4 },
  { code: '240810', name: 'IVA Descontable (Compras)', type: 'Pasivo', nature: 'Crédito', level: 4 },
  { code: '3', name: 'PATRIMONIO', type: 'Patrimonio', nature: 'Crédito', level: 1 },
  { code: '31', name: 'CAPITAL SOCIAL', type: 'Patrimonio', nature: 'Crédito', level: 2 },
  { code: '3105', name: 'Capital Suscrito y Pagado', type: 'Patrimonio', nature: 'Crédito', level: 3 },
  { code: '310505', name: 'Capital Autorizado', type: 'Patrimonio', nature: 'Crédito', level: 4 },
  { code: '4', name: 'INGRESOS', type: 'Ingreso', nature: 'Crédito', level: 1 },
  { code: '41', name: 'INGRESOS OPERACIONALES', type: 'Ingreso', nature: 'Crédito', level: 2 },
  { code: '4135', name: 'Comercio al por Mayor y al por Menor', type: 'Ingreso', nature: 'Crédito', level: 3 },
  { code: '413505', name: 'Venta de Mercancías', type: 'Ingreso', nature: 'Crédito', level: 4 },
  { code: '5', name: 'GASTOS', type: 'Gasto', nature: 'Débito', level: 1 },
  { code: '51', name: 'GASTOS OPERACIONALES DE ADMINISTRACIÓN', type: 'Gasto', nature: 'Débito', level: 2 },
  { code: '5135', name: 'Servicios', type: 'Gasto', nature: 'Débito', level: 3 },
  { code: '513505', name: 'Energía Eléctrica', type: 'Gasto', nature: 'Débito', level: 4 },
  { code: '6', name: 'COSTOS DE VENTAS', type: 'Costo', nature: 'Débito', level: 1 },
  { code: '61', name: 'COSTO DE VENTAS Y PRESTACIÓN DE SERVICIOS', type: 'Costo', nature: 'Débito', level: 2 },
  { code: '6135', name: 'Comercio al por Mayor y al por Menor', type: 'Costo', nature: 'Débito', level: 3 },
  { code: '613505', name: 'Costo de Mercancías Vendidas', type: 'Costo', nature: 'Débito', level: 4 },
]
