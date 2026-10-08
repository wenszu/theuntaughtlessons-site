-- Undo for 20261008002350_question_bank.sql. Drops the three question bank functions and their two private helpers.
-- No table or data is touched: review rows already saved in public.assessment_item_reviews and their audit rows stay on purpose.

drop function if exists public.admin_save_item_review(jsonb, boolean);
drop function if exists public.admin_item_reviews();
drop function if exists public.admin_item_health();
drop function if exists private.qb_review_json(public.assessment_item_reviews);
drop function if exists private.qb_iso(timestamptz);
