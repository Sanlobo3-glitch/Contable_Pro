-- Restricción de acceso anon a tablas internas.

revoke all on table
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
from anon;

revoke execute on function public._sale_balance(uuid)
from public, anon, authenticated;

alter function public._bank_is_finite(numeric)
set search_path = pg_catalog, public;
