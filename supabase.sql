-- ===========================================================================
-- Insitum Capital CRM — Esquema para Supabase (NUBE)
-- Pega TODO esto en Supabase → SQL Editor → New query → Run.
-- ===========================================================================

-- Una fila por usuario; guarda toda su cartera como JSON.
create table if not exists public.crm_states (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table public.crm_states enable row level security;

-- Cada socio ve y edita SOLO su propia fila --------------------------------
drop policy if exists "own_select" on public.crm_states;
create policy "own_select" on public.crm_states
  for select using (auth.uid() = user_id);

drop policy if exists "own_insert" on public.crm_states;
create policy "own_insert" on public.crm_states
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_update" on public.crm_states;
create policy "own_update" on public.crm_states
  for update using (auth.uid() = user_id);

-- El ADMIN (por correo) puede VER la cartera de todos -----------------------
-- ⚠️ Cambia el correo por el del socio administrador real.
drop policy if exists "admin_select_all" on public.crm_states;
create policy "admin_select_all" on public.crm_states
  for select using ( (auth.jwt() ->> 'email') in ('socio2@insitum.mx') );

-- Listo. Ahora crea los usuarios en Authentication → Users → Add user.
