-- ===========================================================================
-- Secure task claiming and releasing.
--
-- Editors need UPDATE on tasks to do their job (status, progress, notes,
-- delivery fields), and row level security cannot compare the old row with the
-- new one, so nothing in the existing policies stops an editor from writing a
-- different value into body->>'owner'. Ownership therefore moves through two
-- SECURITY DEFINER functions, and a BEFORE UPDATE trigger refuses any other
-- attempt to change it.
--
-- Idempotent: safe to run more than once.
-- Requires: public.has_role, public.is_admin, public.my_member (schema.sql).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The guard.
--
--    An owner or admin may reassign freely. For everyone else the only route
--    is claim_task/release_task, which announce themselves with a
--    transaction-local setting. PostgREST exposes only functions in the
--    `public` schema, set_config() lives in pg_catalog, and no exposed
--    function writes that setting, so a client cannot turn it on.
--
--    It is still only a flag, so it is not asked to carry the rule on its own:
--    with the flag on, a non-admin change must ALSO be one of the two
--    transitions those functions perform —
--
--        claim    unowned -> me, on a task that is not already live
--        release  me      -> unowned
--
--    Stealing, clearing somebody else's task, assigning work to a third
--    person and taking finished work are refused whatever the flag says, so
--    forcing it on would grant nothing the caller could not already do by
--    calling claim_task.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_owner text := coalesce(old.body->>'owner', '');
  new_owner text := coalesce(new.body->>'owner', '');
  status    text := coalesce(new.body->>'status', 'backlog');
  mine      text;
begin
  if old_owner is not distinct from new_owner then
    return new;                                   -- ownership did not move
  end if;
  if public.is_admin(new.site) then
    return new;                                   -- owner and admin reassign
  end if;
  if coalesce(current_setting('build_board.owner_write', true), '') <> 'on' then
    raise exception 'owner_locked'
      using errcode = '42501',
            hint = 'Ownership changes go through claim_task or release_task.';
  end if;

  -- inside claim_task / release_task: the transition still has to be sanctioned
  mine := coalesce(public.my_member(), '');
  if new_owner <> '' then                          -- a claim
    if old_owner <> '' or new_owner <> mine or mine = '' or status = 'live' then
      raise exception 'owner_locked'
        using errcode = '42501',
              hint = 'Only unowned, open work can be claimed, and only for yourself.';
    end if;
    return new;
  end if;
  if old_owner <> mine then                        -- a release
    raise exception 'owner_locked'
      using errcode = '42501',
            hint = 'Only the person holding a task may hand it back.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_owner on public.tasks;
create trigger tasks_guard_owner
  before update on public.tasks
  for each row execute function public.tasks_guard_owner();

-- ---------------------------------------------------------------------------
-- 2. Claim. One atomic conditional UPDATE: the row is only taken while it is
--    still unowned and still open, so two simultaneous claims cannot both win.
--    The new owner is always the caller's own member key — never a value the
--    caller supplied.
-- ---------------------------------------------------------------------------
create or replace function public.claim_task(p_site uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member text;
  v_body   jsonb;
  v_hit    boolean;
  v_owner  text;
  v_status text;
  v_found  boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if not public.has_role(p_site, 'editor') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  v_member := public.my_member();
  if coalesce(v_member, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;

  perform set_config('build_board.owner_write', 'on', true);

  update public.tasks t
     set body    = jsonb_set(coalesce(t.body, '{}'::jsonb), '{owner}', to_jsonb(v_member), true),
         updated = now()
   where t.site = p_site
     and t.key  = p_key
     and coalesce(t.body->>'owner', '')  = ''
     and coalesce(t.body->>'status', 'backlog') <> 'live'
  returning t.body into v_body;
  v_hit := found;

  perform set_config('build_board.owner_write', 'off', true);

  if v_hit then
    return jsonb_build_object('ok', true, 'owner', v_member, 'body', v_body);
  end if;

  select coalesce(t.body->>'owner', ''), coalesce(t.body->>'status', 'backlog')
    into v_owner, v_status
    from public.tasks t
   where t.site = p_site and t.key = p_key;
  v_found := found;

  if not v_found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_owner <> '' then
    return jsonb_build_object('ok', false, 'reason', 'taken', 'owner', v_owner);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Release. An editor may only hand back their own task; an owner or admin
--    may clear anyone's. Also atomic, so releasing a task somebody else has
--    just been given cannot happen.
-- ---------------------------------------------------------------------------
create or replace function public.release_task(p_site uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member text;
  v_admin  boolean;
  v_body   jsonb;
  v_hit    boolean;
  v_owner  text;
  v_found  boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if not public.has_role(p_site, 'editor') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  v_member := coalesce(public.my_member(), '');
  v_admin  := public.is_admin(p_site);

  perform set_config('build_board.owner_write', 'on', true);

  update public.tasks t
     set body    = jsonb_set(coalesce(t.body, '{}'::jsonb), '{owner}', to_jsonb(''::text), true),
         updated = now()
   where t.site = p_site
     and t.key  = p_key
     and coalesce(t.body->>'owner', '') <> ''
     and (v_admin or coalesce(t.body->>'owner', '') = v_member)
  returning t.body into v_body;
  v_hit := found;

  perform set_config('build_board.owner_write', 'off', true);

  if v_hit then
    return jsonb_build_object('ok', true, 'body', v_body);
  end if;

  select coalesce(t.body->>'owner', '') into v_owner
    from public.tasks t where t.site = p_site and t.key = p_key;
  v_found := found;

  if not v_found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_owner = '' then
    return jsonb_build_object('ok', false, 'reason', 'unassigned');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_yours', 'owner', v_owner);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges. CREATE FUNCTION grants EXECUTE to PUBLIC by default, which is
--    wrong for anything SECURITY DEFINER. Nothing here is reachable without a
--    session, and the two trigger bodies are not callable at all.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_task(uuid, text)   from public, anon;
revoke all on function public.release_task(uuid, text) from public, anon;
grant execute on function public.claim_task(uuid, text)   to authenticated;
grant execute on function public.release_task(uuid, text) to authenticated;

-- trigger bodies: fired by the system, never called. A trigger fires without
-- the invoking role holding EXECUTE, so revoking these breaks nothing.
revoke all on function public.tasks_guard_owner() from public, anon, authenticated;
revoke all on function public.handle_new_user()  from public, anon, authenticated;

-- membership helpers report the caller's own role and nothing else, but a
-- signed-out visitor has no use for them
do $$
declare f text;
begin
  foreach f in array array[
    'public.role_rank(text)', 'public.my_role(uuid)', 'public.is_member(uuid)',
    'public.has_role(uuid, text)', 'public.is_admin(uuid)', 'public.my_member()',
    'public.accept_invite(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon;', f);
    execute format('grant execute on function %s to authenticated;', f);
  end loop;
end $$;
