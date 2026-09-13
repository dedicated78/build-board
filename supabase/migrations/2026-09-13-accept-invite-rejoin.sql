-- Production migration — run once in the Supabase SQL editor.
-- Idempotent: CREATE OR REPLACE only. No table, column or policy changes.
--
-- Why this is needed: the previous accept_invite() reported one generic
-- failure for every case, so a removed member rejoining could not be told
-- apart from a wrong address or an expired link, and re-accepting an
-- invitation they had already used raised an error instead of doing nothing.
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
