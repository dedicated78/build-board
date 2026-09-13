# Build Board

A delivery board for local SEO projects: what is planned, who owns it, what is
blocking it, and a white-label report the client can read. Multi-tenant — one
install runs every client project.

Built for [GrowwithMH](https://growwithmh.com). All rights reserved.

---

## What it does

- **Board** — tasks across six workstreams (website, on-page, off-page, GBP,
  technical, admin), with progress logged in real units: pages, citations,
  posts, reviews, fixes.
- **Approved page inventory** — the agreed scope, with live/in-build/not-started
  counts that move as work lands.
- **Plan importer** — paste an AI-generated SEO architecture, get tasks out.
- **My work** — each person's private checklists, notes and daily log.
  Private at the database, not just in the interface.
- **Review workflow** — submit, request a revision, add extra hands, reassign.
- **Notifications** — derived from the data (due, blocked, assigned, needs
  revision), no scheduler required.
- **Client report** — branded, chart-led, exportable, with per-person summaries.

## Roles

| Role | Can |
|---|---|
| `owner` | Everything, including handing over ownership |
| `admin` | Invite people, set roles, edit inventory and branding, delete tasks |
| `editor` | Tasks, progress, submissions, own profile |
| `viewer` | Read the board and the report — useful as a **client login** |

Nobody can grant a role above their own, change their own role, or remove
someone at or above their level. Access is **invitation only**: a database
trigger requires a token matching an unexpired invitation issued to that exact
email address.

## Architecture

```
src/board.html      the application, authored as one self-contained file
build.py            wraps it in a real document, swaps in Supabase, adds the gate
public/             what gets deployed (index.html is generated — do not edit)
supabase/schema.sql tables, row-level security, roles, invitations, realtime
test/               Playwright suites against a stand-in Supabase client
```

Postgres holds `{ site, key, body }` rows per table; row-level security does the
tenant isolation. The frontend is static files — no build step, no server.

## Working on it

```bash
npm install
python3 build.py     # regenerate public/index.html after editing src/board.html
npm test             # 40 checks: auth, tenancy, privacy, roles, invitations
```

`public/index.html` is generated. Edit `src/board.html` and rebuild — CI fails
if the committed page is out of date.

## Deploying

See [DEPLOY.md](DEPLOY.md). Short version: create a Supabase project, run
`supabase/schema.sql`, put your project URL and anon key in `public/config.js`,
deploy `public/` to Vercel or Cloudflare Pages.

The anon key belongs in the browser — row-level security is what protects the
data. **The service role key must never appear in this repository.**

## Roadmap

Phase 2 — the work pool: typed `pages`, `keywords`, `jobs`, `publishes` and
`checks` tables; self-claim with atomic locking; `pg_cron` driving follow-up
reminders on published URLs; server-side paging for six-figure job counts.
