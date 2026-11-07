import sqlUsersPayroll from '../../supabase/migrations/20261101_vendedores_nomina_invitaciones_usuarios.sql?raw'
import sqlSecurityRoles from '../../supabase/migrations/20261102_seguridad_roles_empresa.sql?raw'
import sqlBranches from '../../supabase/migrations/20261101000005_sucursales_y_bodegas.sql?raw'
import sqlMultibodega from '../../supabase/migrations/20261101000006_inventario_multibodega.sql?raw'
import sqlPhase2 from '../../supabase/migrations/20261103000013_tesoreria_centros_costo_ordenes_compra.sql?raw'
import sqlPhase3 from '../../supabase/migrations/20261103000014_presupuesto_maestro_storage_imagenes_catalogo_vendedor.sql?raw'
import sqlProductImages from '../../supabase/migrations/20261103000015_tabla_imagenes_productos_y_sincronizacion_pos.sql?raw'
import sqlSupportCpa from '../../supabase/migrations/20261103000016_rol_tecnico_soporte_sesiones_y_contador.sql?raw'
import sqlAdminEngine from '../../supabase/migrations/20261103000017_centro_administracion_sql_supabase.sql?raw'
import sqlCatalogCommerce from '../../supabase/migrations/20261103000018_ventas_catalogo_variantes_pagos_identidad.sql?raw'
import sqlWhatsappStoreLink from '../../supabase/migrations/20261103000019_enlace_tienda_og_y_estudio_whatsapp.sql?raw'
import sqlAutoBrandSync from '../../supabase/migrations/20261103000020_sincronizacion_automatica_marca_y_cache_whatsapp.sql?raw'
import sqlCommercialSuite21 from '../../supabase/migrations/20261104000021_cinco_soluciones_comerciales_avanzadas.sql?raw'

export type SqlBundleId =
  | 'contable_pro'
  | 'consolidated'
  | 'commercial_suite_21'
  | 'whatsapp_store_link'
  | 'catalog_commerce'
  | 'sql_engine'
  | 'support_cpa'
  | 'images'
  | 'phase3'
  | 'phase2'
  | 'multibodega'
  | 'security_roles'
  | 'users_payroll'

export interface SqlScriptBundle {
  id: SqlBundleId
  title: string
  filename: string
  category: 'Recomendado' | 'Nuevos módulos' | 'Infraestructura base'
  summary: string
  targetTables: string[]
  sql: string
}

export const SQL_SCRIPT_BUNDLES: SqlScriptBundle[] = [
  {
    id: 'consolidated',
    title: 'Paquete Consolidado Maestro (Todo en 1 · Recomendado)',
    filename: 'inventariopro_consolidado_maestro_completo.sql',
    category: 'Recomendado',
    summary:
      'Activa en una sola ejecución Toma Física Ciega, Plan Separe, Cambios Mano a Mano y Garantías, Conciliación Bancaria, Escudo de Precios, Enlace Propio de Tienda (/tienda/empresa), Ventas por Catálogo con Captures de Pago, Motor SQL en 1 clic, Rol Técnico y Despacho Contable (CPC).',
    targetTables: [
      'blind_inventory_sessions',
      'layaway_contracts',
      'product_exchanges',
      'bank_reconciliations',
      'catalog_orders',
      'support_tickets',
      'cpa_working_papers',
      'sql_migration_log',
      'product_images',
      'financial_budgets',
      'purchase_orders',
    ],
    sql: [
      '-- ============================================================================',
      '-- INVENTARIOPRO · PAQUETE CONSOLIDADO MAESTRO PARA SUPABASE',
      '-- Incluye Migraciones 000013 a 000021 (100% idempotente)',
      '-- Al ejecutarlo una vez, habilita también la ejecución en 1 clic desde la web.',
      '-- ============================================================================',
      '',
      sqlPhase2,
      '',
      sqlPhase3,
      '',
      sqlProductImages,
      '',
      sqlSupportCpa,
      '',
      sqlCatalogCommerce,
      '',
      sqlWhatsappStoreLink,
      '',
      sqlAutoBrandSync,
      '',
      sqlCommercialSuite21,
      '',
      sqlAdminEngine,
    ].join('\n'),
  },
  {
    id: 'commercial_suite_21',
    title: 'Suite Comercial y Financiera: Toma Ciega, Plan Separe, Cambios, Conciliación y Precios',
    filename: '20261104000021_cinco_soluciones_comerciales_avanzadas.sql',
    category: 'Recomendado',
    summary:
      'Crea las tablas multiempresa con RLS para Toma Física Ciega (blind_inventory_sessions), Plan Separe (layaway_contracts), Cambios Mano a Mano y Garantías (product_exchanges), Conciliación Bancaria (bank_reconciliations) y Escudo de Márgenes (price_shield_batches).',
    targetTables: [
      'blind_inventory_sessions',
      'layaway_contracts',
      'product_exchanges',
      'bank_reconciliations',
      'price_shield_batches',
    ],
    sql: sqlCommercialSuite21,
  },
  {
    id: 'whatsapp_store_link',
    title: 'Enlace Propio de Tienda (/tienda/empresa) + Sincronización Automática y WhatsApp',
    filename: '20261103000020_sincronizacion_automatica_marca_y_cache_whatsapp.sql',
    category: 'Recomendado',
    summary:
      'Crea catalog_slug único sincronizado automáticamente al cambiar el nombre de la empresa (conservando historial previous_catalog_slugs sin romper enlaces viejos), huella anti-caché WhatsApp, configuración multiempresa whatsapp_settings y el bucket privado payment-proofs.',
    targetTables: ['catalog_orders'],
    sql: [sqlWhatsappStoreLink, '', sqlAutoBrandSync].join('\n'),
  },
  {
    id: 'catalog_commerce',
    title: 'Ventas por Catálogo, Cualidades (Tallas/ml/kg), Capture de Pago e Identidad',
    filename: '20261103000018_ventas_catalogo_variantes_pagos_identidad.sql',
    category: 'Recomendado',
    summary:
      'Crea catalog_orders con verificación de captures (Pago Móvil, Nequi, Zelle, Bancos), variantes de producto (tallas, gramos, ml, litros, bultos), rastreo público por PIN e identidad corporativa (logo + color de marca).',
    targetTables: ['catalog_orders', 'product_images'],
    sql: sqlCatalogCommerce,
  },
  {
    id: 'sql_engine',
    title: 'Motor de Administración SQL en 1 Clic + Diagnóstico Supabase',
    filename: '20261103000017_centro_administracion_sql_supabase.sql',
    category: 'Recomendado',
    summary:
      'Crea sql_migration_log, el diagnóstico en vivo admin_diagnostico_esquema() y la función blindada admin_ejecutar_migracion_sql() exclusiva para sanlobo3@hotmail.com.',
    targetTables: ['sql_migration_log'],
    sql: sqlAdminEngine,
  },
  {
    id: 'support_cpa',
    title: 'Rol Técnico, Autorización de Sesiones y Despacho Contable (CPC)',
    filename: '20261103000016_rol_tecnico_soporte_sesiones_y_contador.sql',
    category: 'Nuevos módulos',
    summary:
      'Amplía los 11 roles en profiles y funciones de usuario, crea public.support_tickets con códigos de autorización revocables y public.cpa_working_papers para el Contador Público.',
    targetTables: ['support_tickets', 'cpa_working_papers'],
    sql: sqlSupportCpa,
  },
  {
    id: 'images',
    title: 'Tabla de Imágenes de Productos + Conexión POS y PDF',
    filename: '20261103000015_tabla_imagenes_productos_y_sincronizacion_pos.sql',
    category: 'Nuevos módulos',
    summary:
      'Crea public.product_images con RLS, sincronización automática con products.image_url y función actualizar_imagen_producto para Mostrador POS y Catálogo PDF.',
    targetTables: ['product_images'],
    sql: sqlProductImages,
  },
  {
    id: 'phase3',
    title: 'Fase 3: Presupuesto Maestro Avanzado + Catálogo Comercial',
    filename: '20261103000014_presupuesto_maestro_storage_imagenes_catalogo_vendedor.sql',
    category: 'Nuevos módulos',
    summary:
      'Clonación de presupuestos mensuales, resumen ejecutivo servidor, descripciones comerciales y productos destacados.',
    targetTables: ['financial_budgets'],
    sql: sqlPhase3,
  },
  {
    id: 'phase2',
    title: 'Fase 2: Centros de Costo + Presupuesto Base + Órdenes de Compra',
    filename: '20261103000013_tesoreria_centros_costo_ordenes_compra.sql',
    category: 'Nuevos módulos',
    summary:
      'Crea branch_id en operaciones, financial_budgets base y el ciclo completo de purchase_orders y recepción en bodega.',
    targetTables: ['purchase_orders', 'financial_budgets'],
    sql: sqlPhase2,
  },
  {
    id: 'multibodega',
    title: 'Sucursales y Bodegas Multibodega',
    filename: '20261101000005_000006_sucursales_multibodega.sql',
    category: 'Infraestructura base',
    summary:
      'Estructura base de branches, warehouses y existencias por bodega (warehouse_stock).',
    targetTables: ['branches', 'warehouses'],
    sql: [sqlBranches, '', sqlMultibodega].join('\n'),
  },
  {
    id: 'users_payroll',
    title: 'Expedientes de Personal, Nómina e Invitaciones',
    filename: '20261101_vendedores_nomina_invitaciones_usuarios.sql',
    category: 'Infraestructura base',
    summary:
      'Crea member_profiles, fotografías de perfil, invitaciones de equipo y funciones de administración de usuarios.',
    targetTables: ['member_profiles'],
    sql: sqlUsersPayroll,
  },
  {
    id: 'security_roles',
    title: 'Políticas RLS de Seguridad Empresarial',
    filename: '20261102_seguridad_roles_empresa.sql',
    category: 'Infraestructura base',
    summary:
      'Políticas base de aislamiento multiempresa por company_id en ventas, productos y dispositivos.',
    targetTables: ['profiles'],
    sql: sqlSecurityRoles,
  },
]
