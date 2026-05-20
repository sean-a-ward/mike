create extension if not exists "pgcrypto";

create table if not exists public.llm_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider_type text not null check (provider_type in ('openai-compatible', 'anthropic-compatible', 'google-compatible')),
  base_url text not null,
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  enabled boolean not null default true,
  http_referer text,
  app_title text,
  model_allowlist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists llm_connections_user_idx
  on public.llm_connections(user_id, created_at desc);

create table if not exists public.user_model_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  main_connection_id uuid references public.llm_connections(id) on delete set null,
  main_model_id text,
  tabular_connection_id uuid references public.llm_connections(id) on delete set null,
  tabular_model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on public.llm_connections from anon, authenticated;
revoke all on public.user_model_preferences from anon, authenticated;
