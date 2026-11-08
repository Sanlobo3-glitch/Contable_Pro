BEGIN;

-- 1. Crear sucursal principal para cada empresa
-- que todavía no tenga una.

INSERT INTO public.branches (
    company_id,
    name,
    code,
    is_main,
    active
)
SELECT
    c.id,
    'Sucursal principal',
    'SUC-001',
    true,
    true
FROM public.companies c
WHERE NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.company_id = c.id
      AND b.is_main = true
);

-- 2. Crear bodega principal asociada
-- a la sucursal principal de cada empresa.

INSERT INTO public.warehouses (
    company_id,
    branch_id,
    name,
    code,
    warehouse_type,
    active
)
SELECT
    b.company_id,
    b.id,
    'Bodega principal',
    'BOD-001',
    'principal',
    true
FROM public.branches b
WHERE b.is_main = true
  AND b.active = true
  AND NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.company_id = b.company_id
        AND w.branch_id = b.id
        AND w.warehouse_type = 'principal'
  );

-- 3. Inicializar las existencias por bodega
-- usando el stock actual de cada producto.
-- No modificar products.stock.
-- No duplicar registros existentes.

INSERT INTO public.warehouse_stock (
    company_id,
    warehouse_id,
    product_id,
    quantity,
    reserved_quantity
)
SELECT
    p.company_id,
    w.id,
    p.id,
    p.stock,
    0
FROM public.products p
JOIN public.branches b
    ON b.company_id = p.company_id
   AND b.is_main = true
JOIN public.warehouses w
    ON w.company_id = p.company_id
   AND w.branch_id = b.id
   AND w.warehouse_type = 'principal'
   AND w.active = true
ON CONFLICT (warehouse_id, product_id)
DO NOTHING;

COMMIT;
