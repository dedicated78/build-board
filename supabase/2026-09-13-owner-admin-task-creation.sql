-- Production migration — run once in the Supabase SQL editor.
-- Idempotent. Touches ONE policy: the INSERT rule on public.tasks.
--
-- Why: task creation was open to editors. Creating a task is project planning
-- and belongs to an owner or admin; editing an existing task is the editor's
-- job and is deliberately left alone. Nothing here loosens any policy.

drop policy if exists tasks_add on public.tasks;
create policy tasks_add on public.tasks for insert to authenticated
  with check (public.is_admin(site));

-- unchanged, restated so a fresh run of this file leaves a consistent set
drop policy if exists tasks_edit on public.tasks;
create policy tasks_edit on public.tasks for update to authenticated
  using (public.has_role(site,'editor')) with check (public.has_role(site,'editor'));
