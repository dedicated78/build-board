-- ============================================================================
-- RMM Build Board — Supabase schema (phase 1)
-- Invitation only. Four roles. Run once in the SQL editor; safe to re-run.
-- ============================================================================

-- ---------- people: one row per login, mirrors auth.users -------------------
create table if not exists public.people (
  id      uuid primary key references auth.users(id) on delete cascade,
  name    text not null default '',
  member  text not null default '',            -- board key, e.g. 'SEO-1'
  created timestamptz not null default now()
);

-- ---------- sites: one per client project (the tenant) ----------------------
create table if not exists public.sites (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  client  text not null default '',
  created timestamptz not null default now()
);

-- ---------- who is on which project, and what they may do -------------------
--   owner   everything, including handing over ownership
--   admin   invites people, sets roles, edits inventory/branding, deletes
--   editor  does the work: tasks, progress, submissions, own profile
--   viewer  reads the board and the report — nothing else
create table if not exists public.memberships (
  site     uuid not null references public.sites(id) on delete cascade,
  person   uuid not null references public.people(id) on delete cascade,
  role     text not null default 'editor'
           check (role in ('owner','admin','editor','viewer')),
  created  timestamptz not null default now(),
  primary key (site, person)
);
create index if not exists idx_memberships_person on public.memberships(person);

-- migrate an earlier install that used is_admin
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='memberships' and column_name='is_admin') then
    update public.memberships set role = case when is_admin then 'admin' else 'editor' end;
    alter table public.memberships drop column is_admin;
  end if;
end $$;

-- ---------- invitations: the only way in ------------------------------------
create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  site       uuid not null references public.sites(id) on delete cascade,
  email      text not null,
  name       text not null default '',
  member     text not null default '',
  role       text not null default 'editor'
             check (role in ('owner','admin','editor','viewer')),
  token      uuid not null default gen_random_uuid(),
  invited_by uuid references public.people(id) on delete set null,
  created    timestamptz not null default now(),
  expires    timestamptz not null default now() + interval '14 days',
  accepted   timestamptz
);
create unique index if not exists idx_invites_token on public.invites(token);
create index if not exists idx_invites_site on public.invites(site);

-- ---------- the five data tables the board speaks ---------------------------
do $$
declare t text;
begin
  foreach t in array array['tasks','team','meetings','meta','personal'] loop
    execute format($f$
      create table if not exists public.%I (
        id      uuid primary key default gen_random_uuid(),
        site    uuid not null references public.sites(id) on delete cascade,
        key     text not null,
        body    jsonb not null default '{}'::jsonb,
        updated timestamptz not null default now(),
        unique (site, key)
      );
      create index if not exists idx_%I_site on public.%I(site);
    $f$, t, t, t);
  end loop;
end $$;

-- ---------- helpers ---------------------------------------------------------
-- SECURITY DEFINER so a policy can read memberships without recursing into
-- memberships' own policies.
create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3
                when 'editor' then 2 when 'viewer' then 1 else 0 end;
$$;

create or replace function public.my_role(s uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from memberships m where m.site = s and m.person = auth.uid();
$$;

create or replace function public.is_member(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.site = s and m.person = auth.uid());
$$;

-- "at least this role"
create or replace function public.has_role(s uuid, least_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.role_rank(public.my_role(s)) >= public.role_rank(least_role);
$$;

create or replace function public.is_admin(s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(s, 'admin');
$$;

create or replace function public.my_member()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select p.member from people p where p.id = auth.uid()), '');
$$;

-- ---------- row level security ---------------------------------------------
alter table public.people      enable row level security;
alter table public.sites       enable row level security;
alter table public.memberships enable row level security;
alter table public.invites     enable row level security;
alter table public.tasks       enable row level security;
alter table public.team        enable row level security;
alter table public.meetings    enable row level security;
alter table public.meta        enable row level security;
alter table public.personal    enable row level security;

drop policy if exists people_read on public.people;
drop policy if exists people_self on public.people;
create policy people_read on public.people for select to authenticated using (true);
create policy people_self on public.people for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists sites_read on public.sites;
drop policy if exists sites_edit on public.sites;
create policy sites_read on public.sites for select to authenticated using (public.is_member(id));
create policy sites_edit on public.sites for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

-- everyone sees who is on the project; only admins change roles, and nobody
-- may hand out a role above their own or edit an owner
drop policy if exists memberships_read on public.memberships;
drop policy if exists memberships_add  on public.memberships;
drop policy if exists memberships_set  on public.memberships;
drop policy if exists memberships_del  on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
  using (public.is_member(site));
create policy memberships_add on public.memberships for insert to authenticated
  with check (public.is_admin(site) and public.role_rank(role) <= public.role_rank(public.my_role(site)));
create policy memberships_set on public.memberships for update to authenticated
  using (public.is_admin(site)
         and public.role_rank(role) <= public.role_rank(public.my_role(site))
         and person <> auth.uid())
  with check (public.is_admin(site)
         and public.role_rank(role) <= public.role_rank(public.my_role(site)));
create policy memberships_del on public.memberships for delete to authenticated
  using (public.is_admin(site)
         and public.role_rank(role) < public.role_rank(public.my_role(site)));

-- invitations are an admin tool; the invitee never reads this table (the
-- signup trigger runs as definer and does the lookup for them)
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin(site))
  with check (public.is_admin(site) and public.role_rank(role) <= public.role_rank(public.my_role(site)));

-- tasks: everyone reads; only an owner or admin may CREATE a task, while an
-- editor may still work on the tasks they have been given. Creating and
-- editing are deliberately separate permissions.
drop policy if exists tasks_read on public.tasks;
drop policy if exists tasks_add  on public.tasks;
drop policy if exists tasks_edit on public.tasks;
drop policy if exists tasks_del  on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.is_member(site));
create policy tasks_add  on public.tasks for insert to authenticated
  with check (public.is_admin(site));
create policy tasks_edit on public.tasks for update to authenticated
  using (public.has_role(site,'editor')) with check (public.has_role(site,'editor'));
create policy tasks_del  on public.tasks for delete to authenticated
  using (public.is_admin(site));

-- meetings: everyone reads, editors and up write, admins delete
do $$
declare t text;
begin
  foreach t in array array['meetings'] loop
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_add  on public.%I;', t, t);
    execute format('drop policy if exists %I_edit on public.%I;', t, t);
    execute format('drop policy if exists %I_del  on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (public.is_member(site));', t, t);
    execute format('create policy %I_add  on public.%I for insert to authenticated with check (public.has_role(site,''editor''));', t, t);
    execute format('create policy %I_edit on public.%I for update to authenticated using (public.has_role(site,''editor'')) with check (public.has_role(site,''editor''));', t, t);
    execute format('create policy %I_del  on public.%I for delete to authenticated using (public.is_admin(site));', t, t);
  end loop;
end $$;

-- team: admins manage the roster; anyone may edit their OWN profile row
drop policy if exists team_read on public.team;
drop policy if exists team_add  on public.team;
drop policy if exists team_edit on public.team;
drop policy if exists team_del  on public.team;
create policy team_read on public.team for select to authenticated using (public.is_member(site));
create policy team_add  on public.team for insert to authenticated
  with check (public.is_admin(site) or key = public.my_member());
create policy team_edit on public.team for update to authenticated
  using (public.is_admin(site) or key = public.my_member())
  with check (public.is_admin(site) or key = public.my_member());
create policy team_del  on public.team for delete to authenticated using (public.is_admin(site));

-- meta holds four different things with four different audiences:
--   reads     per-person notification receipts — everyone, viewers included
--   activity  the feed — anyone who can do work
--   brand     report branding      \ admins
--   inventory approved page counts /
drop policy if exists meta_read on public.meta;
drop policy if exists meta_add  on public.meta;
drop policy if exists meta_edit on public.meta;
drop policy if exists meta_del  on public.meta;
create policy meta_read on public.meta for select to authenticated using (public.is_member(site));
create policy meta_add on public.meta for insert to authenticated with check (
  case key
    when 'reads'    then public.is_member(site)
    when 'activity' then public.has_role(site,'editor')
    else public.is_admin(site)
  end);
create policy meta_edit on public.meta for update to authenticated using (
  case key
    when 'reads'    then public.is_member(site)
    when 'activity' then public.has_role(site,'editor')
    else public.is_admin(site)
  end) with check (
  case key
    when 'reads'    then public.is_member(site)
    when 'activity' then public.has_role(site,'editor')
    else public.is_admin(site)
  end);
create policy meta_del on public.meta for delete to authenticated using (public.is_admin(site));

-- personal: your own row only. This is what makes "My work" actually private —
-- the database refuses to hand anyone else's notes over, admins included.
drop policy if exists personal_own on public.personal;
create policy personal_own on public.personal for all to authenticated
  using (public.is_member(site) and key = public.my_member())
  with check (public.is_member(site) and key = public.my_member());

-- ---------- grants ----------------------------------------------------------
grant usage on schema public to authenticated;
do $$
declare t text;
begin
  foreach t in array array['people','sites','memberships','invites',
                           'tasks','team','meetings','meta','personal'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end $$;

-- ---------- realtime --------------------------------------------------------
-- REPLICA IDENTITY FULL: without it a delete event carries only the primary
-- key, and the board would never learn which row vanished.
do $$
declare t text;
begin
  foreach t in array array['tasks','team','meetings','meta','personal'] loop
    execute format('alter table public.%I replica identity full;', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- signup is invitation only ---------------------------------------
-- Sign-ups stay ENABLED in the dashboard; this trigger is what makes them
-- invitation only, and it is stricter than the toggle: it requires a token that
-- matches an unexpired invitation issued to that exact address.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  raw_token text := new.raw_user_meta_data->>'token';
  inv public.invites%rowtype;
begin
  if raw_token is null or raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'This board is invitation only. Ask an admin for an invite link.'
      using errcode = '42501';
  end if;

  select * into inv from public.invites i
   where i.token = raw_token::uuid
     and lower(i.email) = lower(new.email)
     and i.accepted is null
     and i.expires > now()
   limit 1;

  if inv.id is null then
    raise exception 'That invitation is not valid any more. Ask an admin for a new link.'
      using errcode = '42501';
  end if;

  insert into public.people (id, name, member)
  values (new.id, inv.name, inv.member)
  on conflict (id) do update set name = excluded.name, member = excluded.member;

  insert into public.memberships (site, person, role)
  values (inv.site, new.id, inv.role)
  on conflict (site, person) do update set role = excluded.role;

  update public.invites set accepted = now() where id = inv.id;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- an existing member joining, or rejoining, a project -------------
-- An account with zero memberships is valid: they may have been removed from
-- every project, or invited before ever joining one. Accepting an invitation
-- only adds a membership back — the auth user, the people row and the
-- permanent board key are never touched, so historic tasks still resolve.
-- Distinct error tokens let the interface say what actually went wrong.
create or replace function public.accept_invite(t uuid)
returns table (site uuid, role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  inv public.invites%rowtype;
  my_email text;
begin
  select u.email into my_email from auth.users u where u.id = auth.uid();

  select * into inv from public.invites i where i.token = t limit 1;
  if inv.id is null then
    raise exception 'invite_not_found' using errcode = '42501';
  end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  -- already on the project: accepting again is a no-op, never an error
  if exists (select 1 from memberships m where m.site = inv.site and m.person = auth.uid()) then
    update public.invites set accepted = coalesce(invites.accepted, now()) where invites.id = inv.id;
    return query select inv.site, m.role from memberships m
      where m.site = inv.site and m.person = auth.uid();
    return;
  end if;

  if inv.accepted is not null then
    raise exception 'invite_used' using errcode = '42501';
  end if;
  if inv.expires <= now() then
    raise exception 'invite_expired' using errcode = '42501';
  end if;

  insert into public.memberships (site, person, role)
  values (inv.site, auth.uid(), inv.role)
  on conflict (site, person) do update set role = excluded.role;

  update public.invites set accepted = now() where invites.id = inv.id;
  return query select inv.site, inv.role;
end $$;
grant execute on function public.accept_invite(uuid) to authenticated;
