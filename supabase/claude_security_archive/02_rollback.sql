-- Revierte los permisos del script 02.

grant all on table
  public.bank_reconciliations,
  public.blind_inventory_sessions,
  public.dian_exogena_concepts,
  public.layaway_contracts,
  public.manager_action_plans,
  public.manager_alert_statuses,
  public.manager_approval_requests,
  public.manager_employee_evaluations,
  public.price_shield_batches,
  public.product_exchanges
to anon;

grant execute on function public._sale_balance(uuid)
to authenticated;

alter function public._bank_is_finite(numeric)
reset search_path;
