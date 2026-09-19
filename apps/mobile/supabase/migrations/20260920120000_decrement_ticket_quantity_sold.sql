-- ticket-refund calls this RPC to release the seat when a ticket is
-- refunded. It did not exist, so refunds never freed inventory.
-- Clamps at zero: a double refund (webhook + manual) cannot go negative.
CREATE OR REPLACE FUNCTION public.decrement_ticket_quantity_sold(
  p_ticket_type_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.ticket_types
    SET quantity_sold = greatest(coalesce(quantity_sold, 0) - 1, 0)
    WHERE id = p_ticket_type_id;
END;
$$;
REVOKE ALL ON FUNCTION public.decrement_ticket_quantity_sold(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_ticket_quantity_sold(uuid)
  TO service_role;
NOTIFY pgrst, 'reload schema';
