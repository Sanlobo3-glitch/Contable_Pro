-- ============================================================
-- CONTABLE PRO · MIGRACIÓN 000047
-- FASE 2: MOTOR DE REPORTES FINANCIEROS Y AGREGACIONES SQL
-- 
-- 1. fn_trial_balance: Balance de Comprobación de sumas y saldos
-- 2. fn_balance_sheet: Balance General clasificado (Activo = Pasivo + Patrimonio)
-- 3. fn_income_statement: Estado de Resultados (Ingresos, Costos, Gastos y Utilidad Neta)
-- 4. fn_post_journal_entry: Transición segura a 'posteado'
-- 5. fn_reverse_journal_entry: Contraasiento de anulación/ajuste inmutable
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. BALANCE DE COMPROBACIÓN (Sumas y Saldos)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trial_balance(
  p_company_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_total_initial_debit numeric(18, 4) := 0.0000;
  v_total_initial_credit numeric(18, 4) := 0.0000;
  v_total_period_debit numeric(18, 4) := 0.0000;
  v_total_period_credit numeric(18, 4) := 0.0000;
  v_total_final_debit numeric(18, 4) := 0.0000;
  v_total_final_credit numeric(18, 4) := 0.0000;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Parámetro inválido: Se requiere company_id' USING ERRCODE = '23502';
  END IF;

  WITH initial_moves AS (
    SELECT
      l.account_id,
      coalesce(sum(l.debit), 0.0000) AS init_debit,
      coalesce(sum(l.credit), 0.0000) AS init_credit
    FROM public.journal_lines l
    JOIN public.journal_entries e ON e.id = l.entry_id
    WHERE l.company_id = p_company_id
      AND e.status IN ('posteado', 'cerrado')
      AND e.entry_date < p_start_date
    GROUP BY l.account_id
  ),
  period_moves AS (
    SELECT
      l.account_id,
      coalesce(sum(l.debit), 0.0000) AS per_debit,
      coalesce(sum(l.credit), 0.0000) AS per_credit
    FROM public.journal_lines l
    JOIN public.journal_entries e ON e.id = l.entry_id
    WHERE l.company_id = p_company_id
      AND e.status IN ('posteado', 'cerrado')
      AND e.entry_date >= p_start_date
      AND e.entry_date <= p_end_date
    GROUP BY l.account_id
  ),
  aggregated_rows AS (
    SELECT
      a.id AS account_id,
      a.code AS account_code,
      a.name AS account_name,
      a.account_type,
      a.nature,
      a.level,
      a.is_postable,
      coalesce(im.init_debit, 0.0000) AS initial_debit,
      coalesce(im.init_credit, 0.0000) AS initial_credit,
      CASE
        WHEN a.nature = 'debito' THEN (coalesce(im.init_debit, 0.0000) - coalesce(im.init_credit, 0.0000))
        ELSE (coalesce(im.init_credit, 0.0000) - coalesce(im.init_debit, 0.0000))
      END AS initial_balance,
      coalesce(pm.per_debit, 0.0000) AS period_debit,
      coalesce(pm.per_credit, 0.0000) AS period_credit,
      (coalesce(im.init_debit, 0.0000) + coalesce(pm.per_debit, 0.0000)) AS total_cumulative_debit,
      (coalesce(im.init_credit, 0.0000) + coalesce(pm.per_credit, 0.0000)) AS total_cumulative_credit,
      CASE
        WHEN a.nature = 'debito' THEN (
          (coalesce(im.init_debit, 0.0000) + coalesce(pm.per_debit, 0.0000)) -
          (coalesce(im.init_credit, 0.0000) + coalesce(pm.per_credit, 0.0000))
        )
        ELSE (
          (coalesce(im.init_credit, 0.0000) + coalesce(pm.per_credit, 0.0000)) -
          (coalesce(im.init_debit, 0.0000) + coalesce(pm.per_debit, 0.0000))
        )
      END AS final_balance
    FROM public.accounts a
    LEFT JOIN initial_moves im ON im.account_id = a.id
    LEFT JOIN period_moves pm ON pm.account_id = a.id
    WHERE a.company_id = p_company_id
      AND a.active = true
      AND (
        coalesce(im.init_debit, 0) <> 0 OR coalesce(im.init_credit, 0) <> 0 OR
        coalesce(pm.per_debit, 0) <> 0 OR coalesce(pm.per_credit, 0) <> 0
      )
    ORDER BY a.code ASC
  )
  SELECT
    coalesce(sum(period_debit), 0.0000),
    coalesce(sum(period_credit), 0.0000),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'account_id', account_id,
          'account_code', account_code,
          'account_name', account_name,
          'account_type', account_type,
          'nature', nature,
          'level', level,
          'is_postable', is_postable,
          'initial_balance', initial_balance,
          'period_debit', period_debit,
          'period_credit', period_credit,
          'final_balance', final_balance
        )
      ),
      '[]'::jsonb
    )
  INTO
    v_total_period_debit,
    v_total_period_credit,
    v_result
  FROM aggregated_rows;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_period_debit', v_total_period_debit,
    'total_period_credit', v_total_period_credit,
    'difference', round(v_total_period_debit - v_total_period_credit, 4),
    'is_balanced', abs(v_total_period_debit - v_total_period_credit) < 0.0001,
    'accounts', v_result
  );
END;
$$;

-- ------------------------------------------------------------
-- 2. BALANCE GENERAL (Estado de Situación Financiera)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_balance_sheet(
  p_company_id uuid,
  p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assets jsonb;
  v_liabilities jsonb;
  v_equity jsonb;
  v_total_assets numeric(18, 4) := 0.0000;
  v_total_liabilities numeric(18, 4) := 0.0000;
  v_total_equity numeric(18, 4) := 0.0000;
  v_net_income numeric(18, 4) := 0.0000;
  v_total_equity_with_income numeric(18, 4) := 0.0000;
  v_diff numeric(18, 4);
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Parámetro inválido: Se requiere company_id' USING ERRCODE = '23502';
  END IF;

  -- 1. Utilidad/Pérdida neta acumulada hasta la fecha (Ingresos - Costos - Gastos)
  SELECT coalesce(
    sum(
      CASE
        WHEN a.account_type = 'ingreso' THEN (l.credit - l.debit)
        WHEN a.account_type IN ('costo', 'gasto') THEN -(l.debit - l.credit)
        ELSE 0.0000
      END
    ),
    0.0000
  )
  INTO v_net_income
  FROM public.journal_lines l
  JOIN public.journal_entries e ON e.id = l.entry_id
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.company_id = p_company_id
    AND e.status IN ('posteado', 'cerrado')
    AND e.entry_date <= p_as_of_date
    AND a.account_type IN ('ingreso', 'costo', 'gasto');

  -- 2. Activos (Clase 1 / tipo 'activo')
  WITH asset_balances AS (
    SELECT
      a.id, a.code, a.name, a.level, a.is_postable,
      round(coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0), 4) AS balance
    FROM public.accounts a
    LEFT JOIN (
      public.journal_lines l
      JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado') AND e.entry_date <= p_as_of_date
    ) ON l.account_id = a.id AND l.company_id = p_company_id
    WHERE a.company_id = p_company_id
      AND a.account_type = 'activo'
      AND a.active = true
    GROUP BY a.id, a.code, a.name, a.level, a.is_postable
    HAVING (coalesce(sum(l.debit), 0) <> 0 OR coalesce(sum(l.credit), 0) <> 0)
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(balance), 0.0000),
    coalesce(jsonb_agg(to_jsonb(asset_balances)), '[]'::jsonb)
  INTO v_total_assets, v_assets
  FROM asset_balances;

  -- 3. Pasivos (Clase 2 / tipo 'pasivo')
  WITH liability_balances AS (
    SELECT
      a.id, a.code, a.name, a.level, a.is_postable,
      round(coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0), 4) AS balance
    FROM public.accounts a
    LEFT JOIN (
      public.journal_lines l
      JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado') AND e.entry_date <= p_as_of_date
    ) ON l.account_id = a.id AND l.company_id = p_company_id
    WHERE a.company_id = p_company_id
      AND a.account_type = 'pasivo'
      AND a.active = true
    GROUP BY a.id, a.code, a.name, a.level, a.is_postable
    HAVING (coalesce(sum(l.debit), 0) <> 0 OR coalesce(sum(l.credit), 0) <> 0)
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(balance), 0.0000),
    coalesce(jsonb_agg(to_jsonb(liability_balances)), '[]'::jsonb)
  INTO v_total_liabilities, v_liabilities
  FROM liability_balances;

  -- 4. Patrimonio (Clase 3 / tipo 'patrimonio')
  WITH equity_balances AS (
    SELECT
      a.id, a.code, a.name, a.level, a.is_postable,
      round(coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0), 4) AS balance
    FROM public.accounts a
    LEFT JOIN (
      public.journal_lines l
      JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado') AND e.entry_date <= p_as_of_date
    ) ON l.account_id = a.id AND l.company_id = p_company_id
    WHERE a.company_id = p_company_id
      AND a.account_type = 'patrimonio'
      AND a.active = true
    GROUP BY a.id, a.code, a.name, a.level, a.is_postable
    HAVING (coalesce(sum(l.debit), 0) <> 0 OR coalesce(sum(l.credit), 0) <> 0)
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(balance), 0.0000),
    coalesce(jsonb_agg(to_jsonb(equity_balances)), '[]'::jsonb)
  INTO v_total_equity, v_equity
  FROM equity_balances;

  v_total_equity_with_income := v_total_equity + v_net_income;
  v_diff := round(v_total_assets - (v_total_liabilities + v_total_equity_with_income), 4);

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'as_of_date', p_as_of_date,
    'assets', jsonb_build_object('accounts', v_assets, 'total', v_total_assets),
    'liabilities', jsonb_build_object('accounts', v_liabilities, 'total', v_total_liabilities),
    'equity', jsonb_build_object(
      'accounts', v_equity,
      'base_total', v_total_equity,
      'net_income_current_period', v_net_income,
      'total_equity_with_income', v_total_equity_with_income
    ),
    'liabilities_and_equity_total', (v_total_liabilities + v_total_equity_with_income),
    'difference', v_diff,
    'is_balanced', abs(v_diff) < 0.0001
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. ESTADO DE RESULTADOS (Pérdidas y Ganancias)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_income_statement(
  p_company_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revenues jsonb;
  v_costs jsonb;
  v_expenses jsonb;
  v_total_revenues numeric(18, 4) := 0.0000;
  v_total_costs numeric(18, 4) := 0.0000;
  v_total_expenses numeric(18, 4) := 0.0000;
  v_gross_profit numeric(18, 4);
  v_operating_profit numeric(18, 4);
  v_net_income numeric(18, 4);
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Parámetro inválido: Se requiere company_id' USING ERRCODE = '23502';
  END IF;

  -- Ingresos (Clase 4)
  WITH rev_balances AS (
    SELECT
      a.id, a.code, a.name, a.level,
      round(coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0), 4) AS amount
    FROM public.accounts a
    JOIN public.journal_lines l ON l.account_id = a.id AND l.company_id = p_company_id
    JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado')
    WHERE a.company_id = p_company_id
      AND a.account_type = 'ingreso'
      AND e.entry_date >= p_start_date
      AND e.entry_date <= p_end_date
    GROUP BY a.id, a.code, a.name, a.level
    HAVING (coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)) <> 0
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(amount), 0.0000),
    coalesce(jsonb_agg(to_jsonb(rev_balances)), '[]'::jsonb)
  INTO v_total_revenues, v_revenues
  FROM rev_balances;

  -- Costos (Clase 5)
  WITH cost_balances AS (
    SELECT
      a.id, a.code, a.name, a.level,
      round(coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0), 4) AS amount
    FROM public.accounts a
    JOIN public.journal_lines l ON l.account_id = a.id AND l.company_id = p_company_id
    JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado')
    WHERE a.company_id = p_company_id
      AND a.account_type = 'costo'
      AND e.entry_date >= p_start_date
      AND e.entry_date <= p_end_date
    GROUP BY a.id, a.code, a.name, a.level
    HAVING (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)) <> 0
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(amount), 0.0000),
    coalesce(jsonb_agg(to_jsonb(cost_balances)), '[]'::jsonb)
  INTO v_total_costs, v_costs
  FROM cost_balances;

  -- Gastos (Clase 6)
  WITH exp_balances AS (
    SELECT
      a.id, a.code, a.name, a.level,
      round(coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0), 4) AS amount
    FROM public.accounts a
    JOIN public.journal_lines l ON l.account_id = a.id AND l.company_id = p_company_id
    JOIN public.journal_entries e ON e.id = l.entry_id AND e.status IN ('posteado', 'cerrado')
    WHERE a.company_id = p_company_id
      AND a.account_type = 'gasto'
      AND e.entry_date >= p_start_date
      AND e.entry_date <= p_end_date
    GROUP BY a.id, a.code, a.name, a.level
    HAVING (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)) <> 0
    ORDER BY a.code
  )
  SELECT
    coalesce(sum(amount), 0.0000),
    coalesce(jsonb_agg(to_jsonb(exp_balances)), '[]'::jsonb)
  INTO v_total_expenses, v_expenses
  FROM exp_balances;

  v_gross_profit := v_total_revenues - v_total_costs;
  v_operating_profit := v_gross_profit - v_total_expenses;
  v_net_income := v_operating_profit;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'revenues', jsonb_build_object('items', v_revenues, 'total', v_total_revenues),
    'costs', jsonb_build_object('items', v_costs, 'total', v_total_costs),
    'gross_profit', v_gross_profit,
    'expenses', jsonb_build_object('items', v_expenses, 'total', v_total_expenses),
    'operating_profit', v_operating_profit,
    'net_income', v_net_income
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. POSTEO FORMAL DE ASIENTO (fn_post_journal_entry)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_post_journal_entry(
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.journal_entries%rowtype;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El asiento contable no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF v_entry.status = 'posteado' THEN
    RETURN jsonb_build_object('ok', true, 'message', 'El asiento ya se encuentra posteado.', 'entry_id', p_entry_id);
  END IF;

  IF v_entry.status = 'cerrado' THEN
    RAISE EXCEPTION 'No se puede modificar un asiento en período contable cerrado.' USING ERRCODE = '23505';
  END IF;

  -- La función fn_assert_journal_entry_balanced se dispara automáticamente mediante el trigger
  -- pero también la evaluamos explícitamente antes del UPDATE para capturar errores de forma controlada.
  PERFORM public.fn_assert_journal_entry_balanced(p_entry_id);

  UPDATE public.journal_entries
  SET
    status = 'posteado',
    posted_by = auth.uid(),
    posted_at = now(),
    updated_at = now()
  WHERE id = p_entry_id;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', p_entry_id,
    'entry_number', v_entry.entry_number,
    'status', 'posteado',
    'posted_at', now()
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. CONTRAASIENTO DE ANULACIÓN / AJUSTE (fn_reverse_journal_entry)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reverse_journal_entry(
  p_entry_id uuid,
  p_reverse_concept text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.journal_entries%rowtype;
  v_reverse_id uuid := gen_random_uuid();
  v_next_num integer;
  v_reverse_number text;
  v_line record;
BEGIN
  SELECT * INTO v_original FROM public.journal_entries WHERE id = p_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El asiento contable a anular no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF v_original.status NOT IN ('posteado', 'cerrado') THEN
    RAISE EXCEPTION 'Solo pueden anularse asientos que hayan sido previamente posteados o cerrados.' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(max(nullif(regexp_replace(entry_number, '\D', '', 'g'), '')::integer), 0) + 1
  INTO v_next_num
  FROM public.journal_entries
  WHERE company_id = v_original.company_id;

  v_reverse_number := 'ASI-' || lpad(v_next_num::text, 5, '0');

  -- 1. Insertar cabecera del contraasiento
  INSERT INTO public.journal_entries (
    id,
    company_id,
    entry_number,
    entry_date,
    concept,
    status,
    source_module,
    source_id,
    created_by,
    posted_by,
    posted_at
  ) VALUES (
    v_reverse_id,
    v_original.company_id,
    v_reverse_number,
    CURRENT_DATE,
    coalesce(p_reverse_concept, 'Reversión / Contraasiento de ' || v_original.entry_number || ': ' || v_original.concept),
    'posteado',
    'ajuste',
    v_original.id,
    auth.uid(),
    auth.uid(),
    now()
  );

  -- 2. Invertir débitos y créditos con exactitud matemática
  FOR v_line IN
    SELECT account_id, line_number, description, debit, credit
    FROM public.journal_lines
    WHERE entry_id = p_entry_id
    ORDER BY line_number
  LOOP
    INSERT INTO public.journal_lines (
      company_id,
      entry_id,
      account_id,
      line_number,
      description,
      debit,
      credit
    ) VALUES (
      v_original.company_id,
      v_reverse_id,
      v_line.account_id,
      v_line.line_number,
      'Reversión: ' || coalesce(v_line.description, v_original.concept),
      v_line.credit, -- El crédito pasa a débito
      v_line.debit   -- El débito pasa a crédito
    );
  END LOOP;

  -- 3. Marcar el asiento original como anulado
  UPDATE public.journal_entries
  SET status = 'anulado', updated_at = now()
  WHERE id = p_entry_id;

  RETURN jsonb_build_object(
    'ok', true,
    'original_entry_id', p_entry_id,
    'original_entry_number', v_original.entry_number,
    'reversal_entry_id', v_reverse_id,
    'reversal_entry_number', v_reverse_number,
    'status', 'anulado'
  );
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.fn_trial_balance TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balance_sheet TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_income_statement TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_journal_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reverse_journal_entry TO authenticated;

COMMIT;
