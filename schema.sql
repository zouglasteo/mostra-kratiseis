-- ============================================================
-- Mostra Κρατήσεις – βάση δεδομένων (Supabase / PostgreSQL)
-- ΕΧΕΙ ΗΔΗ ΕΦΑΡΜΟΣΤΕΙ στο project "mostra-kratiseis" (utzcnxvqshciszjvvgaj).
-- Κρατήστε το ως αρχείο αναφοράς ή για να στήσετε ξανά τη βάση από την αρχή.
-- ============================================================

create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  date        date        not null,
  time        text        not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  name        text        not null check (char_length(name) between 1 and 120),
  phone       text        not null default '',
  phone_key   text        not null default '',          -- τα τελευταία 8 ψηφία, για το ιστορικό πελάτη
  people      integer     not null check (people between 1 and 99),
  table_no    text        not null default '',
  notes       text        not null default '',
  tags        text[]      not null default '{}',
  status      text        not null default 'confirmed'
              check (status in ('confirmed','seated','left','cancelled','noshow')),
  walkin      boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid        default auth.uid()
);
create index if not exists bookings_date_idx      on public.bookings (date);
create index if not exists bookings_phone_key_idx on public.bookings (phone_key);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- Λίστα προσωπικού: ΜΟΝΟ αυτά τα email βλέπουν και αλλάζουν κρατήσεις.
-- Για νέο μέλος προσωπικού με δικό του λογαριασμό:
--   insert into public.staff (email) values ('onoma@example.com');
create table if not exists public.staff (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;   -- χωρίς policies: δεν διαβάζεται από την εφαρμογή
revoke all on public.staff from anon, authenticated;
insert into public.staff (email) values ('kratiseis@mostrameze.com') on conflict do nothing;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated;

alter table public.bookings enable row level security;
create policy "staff read"   on public.bookings for select to authenticated using ((select private.is_staff()));
create policy "staff insert" on public.bookings for insert to authenticated with check ((select private.is_staff()));
create policy "staff update" on public.bookings for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff delete" on public.bookings for delete to authenticated using ((select private.is_staff()));
revoke all on public.bookings from anon;

-- Ζωντανή ενημέρωση ανάμεσα στα κινητά
alter publication supabase_realtime add table public.bookings;
