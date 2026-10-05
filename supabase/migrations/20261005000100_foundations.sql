-- UTL core schema 0100: extensions, private helper schema, shared triggers, migration lineage.
-- Every table in later files is written to by trusted server code only (service role).
-- Browsers read through row level security and never write directly.

create schema if not exists extensions;
create schema if not exists private;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

-- Keep updated_at honest on every table that has one.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Used by append-only tables (consent, audit).
create or replace function private.reject_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is not allowed on % because the table is append-only', tg_op, tg_table_name
    using errcode = '42501';
end
$$;

-- Organization sponsors only see aggregates when at least this many people are in the group.
create or replace function private.min_group_size()
returns integer
language sql
immutable
as $$ select 5 $$;

-- Migration lineage. Every imported row can point back to the run that created it.
create table public.migration_runs (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  mode text not null check (mode in ('dry-run', 'apply', 'restore')),
  status text not null default 'planned'
    check (status in ('planned', 'running', 'completed', 'failed', 'rolled_back')),
  source_snapshot_id text,
  source_checksum text,
  plan_checksum text,
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  reconciliation jsonb check (reconciliation is null or jsonb_typeof(reconciliation) = 'object'),
  created_by text not null default 'system',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.migration_records (
  run_id uuid not null references public.migration_runs (id) on delete cascade,
  record_id text not null,
  source_type text not null,
  source_ref_hash text not null,
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  source_checksum text,
  target_checksum text,
  status text not null default 'planned'
    check (status in ('planned', 'applied', 'skipped_existing', 'exception', 'quarantined')),
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (run_id, record_id)
);
