-- ============================================================================
-- 20261108000051 · CENTRO DE DIRECCIÓN GERENCIAL: TABLAS Y AUTORIZACIONES
-- Tablas multiempresa para Solicitudes de Autorización Gerencial, Planes de Acción,
-- Evaluaciones de Desempeño y Estado de Alertas Gerenciales.
-- 100% Idempotente con RLS y aislamiento estricto por company_id.
-- ============================================================================

-- 1. Tabla de Solicitudes de Autorización Gerencial
CREATE TABLE IF NOT EXISTS public.manager_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    branch_id UUID,
    request_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requester_id UUID,
    requester_name TEXT NOT NULL,
    requester_role TEXT NOT NULL DEFAULT 'empleado',
    amount NUMERIC(15,2) DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'COP',
    quantity NUMERIC(12,2) DEFAULT 0,
    document_reference TEXT,
    justification TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente',
    manager_decision_by UUID,
    manager_decision_name TEXT,
    manager_decision_notes TEXT,
    decided_at TIMESTAMPTZ,
    audit_trail JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_mgr_approval_type CHECK (
        request_type IN (
            'compra',
            'gasto',
            'descuento_comercial',
            'ajuste_inventario',
            'traslado',
            'devolucion',
            'credito',
            'excepcion'
        )
    ),
    CONSTRAINT chk_mgr_approval_status CHECK (
        status IN (
            'pendiente',
            'aprobada',
            'rechazada',
            'en_correccion',
            'en_revision'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_mgr_approvals_company_status 
ON public.manager_approval_requests(company_id, status);

CREATE INDEX IF NOT EXISTS idx_mgr_approvals_created_at 
ON public.manager_approval_requests(company_id, created_at DESC);

-- 2. Tabla de Planes de Acción Gerencial
CREATE TABLE IF NOT EXISTS public.manager_action_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT 'operaciones',
    assigned_to_id UUID,
    assigned_to_name TEXT NOT NULL,
    assigned_to_role TEXT,
    priority TEXT NOT NULL DEFAULT 'media',
    kpi_target TEXT,
    due_date DATE NOT NULL,
    progress_percent INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pendiente',
    evidence_notes TEXT,
    created_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_mgr_action_area CHECK (
        area IN (
            'comercial',
            'operaciones',
            'financiera',
            'inventario',
            'talento_humano',
            'calidad',
            'estrategica'
        )
    ),
    CONSTRAINT chk_mgr_action_priority CHECK (
        priority IN ('baja', 'media', 'alta', 'critica')
    ),
    CONSTRAINT chk_mgr_action_status CHECK (
        status IN (
            'pendiente',
            'en_ejecucion',
            'en_revision',
            'atrasado',
            'completado',
            'cancelado'
        )
    ),
    CONSTRAINT chk_mgr_action_progress CHECK (
        progress_percent >= 0 AND progress_percent <= 100
    )
);

CREATE INDEX IF NOT EXISTS idx_mgr_action_plans_company_status 
ON public.manager_action_plans(company_id, status);

CREATE INDEX IF NOT EXISTS idx_mgr_action_plans_due_date 
ON public.manager_action_plans(company_id, due_date ASC);

-- 3. Tabla de Evaluaciones de Desempeño y Novedades de Talento Humano
CREATE TABLE IF NOT EXISTS public.manager_employee_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    evaluator_name TEXT NOT NULL,
    evaluation_period TEXT NOT NULL,
    score NUMERIC(3,1) DEFAULT 5.0,
    strengths TEXT,
    areas_for_improvement TEXT,
    commitments TEXT,
    incident_type TEXT NOT NULL DEFAULT 'evaluacion_periodica',
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_mgr_evaluation_type CHECK (
        incident_type IN (
            'evaluacion_periodica',
            'felicitacion',
            'compromiso_mejora',
            'llamado_atencion'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_mgr_evaluations_company_emp 
ON public.manager_employee_evaluations(company_id, employee_id);

-- 4. Tabla de Estado de Alertas Gerenciales
CREATE TABLE IF NOT EXISTS public.manager_alert_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    alert_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'activa',
    updated_by_name TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_mgr_alert_status CHECK (
        status IN ('activa', 'leida', 'en_gestion', 'resuelta')
    ),
    CONSTRAINT uq_mgr_alert_company_key UNIQUE (company_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_mgr_alert_statuses_company 
ON public.manager_alert_statuses(company_id, status);

-- 5. Habilitar RLS en todas las nuevas tablas
ALTER TABLE public.manager_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_employee_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_alert_statuses ENABLE ROW LEVEL SECURITY;

-- 6. Políticas de aislamiento por tenant
DROP POLICY IF EXISTS p_mgr_approvals_tenant ON public.manager_approval_requests;
CREATE POLICY p_mgr_approvals_tenant ON public.manager_approval_requests
FOR ALL
USING (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
)
WITH CHECK (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
);

DROP POLICY IF EXISTS p_mgr_action_plans_tenant ON public.manager_action_plans;
CREATE POLICY p_mgr_action_plans_tenant ON public.manager_action_plans
FOR ALL
USING (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
)
WITH CHECK (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
);

DROP POLICY IF EXISTS p_mgr_evaluations_tenant ON public.manager_employee_evaluations;
CREATE POLICY p_mgr_evaluations_tenant ON public.manager_employee_evaluations
FOR ALL
USING (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
)
WITH CHECK (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
);

DROP POLICY IF EXISTS p_mgr_alert_statuses_tenant ON public.manager_alert_statuses;
CREATE POLICY p_mgr_alert_statuses_tenant ON public.manager_alert_statuses
FOR ALL
USING (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
)
WITH CHECK (
    company_id = public.current_company_id()
    OR (SELECT public.is_platform_admin())
);

-- 7. Registro idempotente en la bitácora unificada de migraciones
DO $reg$
BEGIN
  IF to_regprocedure('public.sql_registrar_migracion(text,text,text,text,text)') IS NOT NULL THEN
    PERFORM public.sql_registrar_migracion(
        '20261108000051_centro_direccion_gerencial_tablas_y_autorizaciones',
        'Centro de Dirección Gerencial: Aprobaciones, Planes de Acción y Desempeño',
        '20261108000051_centro_direccion_gerencial_tablas_y_autorizaciones.sql'
    );
  END IF;
END
$reg$;
