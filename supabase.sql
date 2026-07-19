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
-- Debe coincidir con ADMIN_EMAILS de assets/config.js.
-- Para varios admins: ('admin1@correo.com','admin2@correo.com')
drop policy if exists "admin_select_all" on public.crm_states;
create policy "admin_select_all" on public.crm_states
  for select using ( (auth.jwt() ->> 'email') in ('valeria3320@gmail.com') );

-- ===========================================================================
-- LISTO. Ya NO hace falta crear usuarios a mano: la app trae "Crear cuenta"
-- en la pantalla de entrada.
--
-- Para que crear cuenta funcione sin fricciones, en el panel de Supabase:
--   Authentication → Sign In / Providers → Email
--     · "Confirm email"  ->  APAGADO   (asi entran al instante, sin correo)
--   Authentication → URL Configuration
--     · Site URL -> la direccion real del sitio (no localhost:3000)
-- ===========================================================================
