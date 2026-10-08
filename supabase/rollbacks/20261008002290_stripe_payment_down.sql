-- Undo for 20261008002290_stripe_payment.sql. Drops the three functions only; no table or data is touched.
-- Rows the function already wrote (people, entitlements, enrollments, stripe_processed_sessions, service_requests,
-- audit_events) stay, because they describe real purchases.

drop function if exists public.get_my_checkout_identity();
drop function if exists public.apply_stripe_payment(jsonb);
drop function if exists private.apply_stripe_payment(jsonb);
