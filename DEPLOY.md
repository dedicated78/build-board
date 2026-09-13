# RMM Build Board — Supabase + Vercel (phase 1)

Static frontend, Postgres behind it, no server to maintain.

**Verified here:** the schema, every row-level security policy and the
invitation trigger were executed against a real PostgreSQL 16 instance — 23
checks covering cross-tenant reads and writes, private notes, role limits
(an admin cannot grant ownership, change their own role, or remove the owner),
and invitations that are refused without a token, with the wrong email, when
expired, and when already used. The app passed 40 end-to-end checks against a
stand-in Supabase client. What I could not test from here is Supabase's own
hosted behaviour: realtime delivery and the dashboard settings in §4.

---

## 0. Two things to decide before you rely on it

- **Vercel Hobby is non-commercial.** A client-facing tracker under GrowwithMH
  is commercial use. Either go Pro ($20/mo) or deploy the same folder to
  **Cloudflare Pages**, which is free and allows commercial use. Instructions for
  both are in §4 — the app is static files, so it makes no difference to the code.
- **Supabase free projects pause after about a week of inactivity.** Fine while
  building. Not fine when a client's team signs in on a Monday and gets an
  error. Budget $25/mo for Pro when it goes live, or accept the pause risk while
  it's still internal.

## 1. Create the project

supabase.com → New project. Pick the region closest to the people using it —
**London (eu-west-2)** for a Birmingham client and a UK-hours team.

Save the database password somewhere safe; you won't be shown it again.

## 2. Run the schema

SQL Editor → New query → paste all of `supabase/schema.sql` → Run.

It is idempotent, so re-running after an edit is safe. It creates:

| Table | What it holds |
|---|---|
| `people` | one row per login, with the board key (`SEO-1`) that ties an account to its tasks |
| `sites` | one per client project — this is the tenant |
| `memberships` | who is on which project, and who is an admin there |
| `tasks` `team` `meetings` `meta` | the board's data, scoped by site |
| `personal` | My work — readable only by the person it belongs to |

Phase 2 adds typed tables (`pages`, `keywords`, `jobs`, `publishes`, `checks`)
beside these, where row counts and indexes start to matter.

## 3. Roles

| Role | Can |
|---|---|
| **owner** | Everything, including handing over ownership. You. |
| **admin** | Invite people, set roles, edit the page inventory and report branding, delete tasks. A project lead. |
| **editor** | Do the work: create and edit tasks, log progress, submit, edit their own profile. Cannot delete or invite. |
| **viewer** | Read the board and the report. Nothing else. |

Nobody can hand out a role above their own, change their own role, or remove
someone at or above their level — the database enforces that, not the interface.

**Viewer is worth a thought as a client login.** Instead of emailing a PDF every
Friday, give the client a viewer account and let them watch the board and the
report live. It is also the cheapest retention mechanism you have: a client who
can see the work happening asks "what am I paying for" far less often.

## 4. Invitations, and your own account

Sign-ups stay **enabled** in the dashboard — the database trigger is what makes
the board invitation-only, and it's stricter than the toggle: it demands a token
matching an unexpired invitation issued to that exact email address. Someone
without a link gets *"This board is invitation only."*

Two settings to check under **Authentication → Sign In / Providers → Email**:

- **Confirm email: OFF.** You have no SMTP configured, and Supabase's built-in
  sender is rate-limited to a handful an hour — with it on, invited people get
  stuck waiting for a confirmation mail that may never arrive. The invitation
  token already proves who they are. The trade-off is that an address is never
  verified by the system; you are vouching for it when you send the link.
- **Minimum password length: 8** or more.

Now bootstrap yourself. In the SQL editor:

```sql
-- your first client project
insert into public.sites (name, client)
values ('RMM Builders Ltd', 'RMM Builders Ltd');

-- and your own invitation, as owner
insert into public.invites (site, email, name, member, role)
select id, 'you@growwithmh.com', 'Mehedi', 'MH-1', 'owner'
from public.sites where name = 'RMM Builders Ltd'
returning token;
```

Copy the `token` it returns and open:

```
https://board.growwithmh.com/#invite=<token>
```

Set a password, and you're the owner. **From that point you never touch SQL
again** — the *People* button in the corner does the rest:

- invite someone (email, name, board key, role) and copy the one-time link
- change anyone's role from a dropdown
- revoke a pending invitation, or remove a member
- links expire after 14 days and work exactly once

The **board key** is the important field. It's what ties an account to their
tasks on the board — `SEO-1`, `DEV-2`. Get it wrong and they sign in to an empty
"My work".

Send the link however you already talk to people — WhatsApp, email, Slack. The
app deliberately doesn't send mail: no SMTP to configure, nothing to land in
spam, and one less thing to pay for.

## 5. Deploy the frontend

Edit `public/rmm-config.js` with your project URL and anon key
(Settings → API). **The anon key belongs in the browser** — it only allows API
calls, and the policies you just installed are what protect the data. The
*service role* key must never appear in any file you deploy.

**Vercel**

```bash
npm i -g vercel
cd public
vercel --prod
```

Or push the folder to GitHub and import it as a project; framework preset
**Other**, output directory `public`. `vercel.json` at the repo root sets the
security headers and `noindex`.

**Cloudflare Pages** (free, commercial use allowed)

```bash
npm i -g wrangler
wrangler pages deploy public --project-name rmm-board
```

Either way, put it on a subdomain you control — `board.growwithmh.com`.

## 6. Check these six things once it's live

1. Sign in as yourself. Board loads, and the dot says *Saving live*.
2. Open a task in one browser, watch it change in another. That's realtime
   working; if it doesn't, re-run the realtime block at the bottom of the schema.
3. Invite someone as **editor**, accept the link in a private window, confirm
   they land on the board with their own name and no *People* button.
4. Confirm their **My work** shows their notes and not yours — this is the thing
   that was impossible in the artifact version.
5. Invite yourself a second address as **viewer** and confirm there is no *New
   task* button and no way to edit anything.
6. Try the URL in a private window with no invite link. You get the sign-in card
   and nothing else; signing up without a token is refused.

## 7. Backups

The free tier has no automatic backups worth relying on. Until you're on Pro,
take one yourself — weekly is enough at this stage:

```bash
npm i -g supabase
supabase login
supabase db dump --db-url "postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres" -f rmm-$(date +%F).sql
```

Keep the last few. A backup you have never restored is not a backup — restore
one into a throwaway Supabase project once, early, so you know the command works.

## 8. Updating the app

The board is still authored as one file. When it changes:

```bash
python3 port.py        # rebuilds public/index.html from ../rmm-board.html
cd public && vercel --prod
```

## 9. Re-running the tests

```bash
node sbtest.js         # 19 checks: auth, tenancy, writes, privacy
node sbtest_roles.js   # 21 checks: roles, invitations, viewer lockdown
```

`mocksb.js` emulates the policies too — role ranks included — so a change that
breaks isolation or lets someone grant themselves a role fails the suite rather
than reaching a client.

## 10. What phase 2 adds on this foundation

Supabase makes the follow-up engine straightforward, which the VPS plan would
have needed a cron daemon for:

- `pg_cron` marks checks due each morning; an Edge Function sends the
  notification. No server, no scheduler to babysit.
- `publishes` and `checks` tables per §4 of the earlier plan.
- The work pool is a filtered query with `range()` paging — Postgres does not
  care about 100k job rows, and the browser only ever holds a page of them.
- Claiming a job is one `update ... where owner is null` — atomic, so two people
  clicking at once can't both win.
