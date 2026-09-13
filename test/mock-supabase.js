/* Stand-in for @supabase/supabase-js. Emulates the parts of PostgREST, auth and
   realtime the app uses — and, importantly, the policies, so a change that
   breaks isolation or role limits fails here rather than at a client. */
(function (g) {
  "use strict";
  function load() { try { return JSON.parse(localStorage.getItem("mocksb")) || {}; } catch (e) { return {}; } }
  function save(d) { localStorage.setItem("mocksb", JSON.stringify(d)); }
  function uid() { return "r" + Math.random().toString(36).slice(2, 12); }
  function uuid() {   // tokens are uuids in Postgres, so they must be here too
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function cp(v) { return JSON.parse(JSON.stringify(v)); }
  var DATA = ["tasks", "team", "meetings", "meta", "personal"];
  var RANK = { owner: 4, admin: 3, editor: 2, viewer: 1 };

  function Client() {
    var self = this;
    this._subs = {};
    var raw = null; try { raw = JSON.parse(localStorage.getItem("mocksb-session")); } catch (e) {}
    this._session = raw;
    this.auth = {
      getSession: function () { return Promise.resolve({ data: { session: self._session }, error: null }); },
      signInWithPassword: function (c) {
        var d = load(), u = (d.people || []).filter(function (p) { return p.email === c.email; })[0];
        if (!u || u.password !== c.password) return Promise.resolve({ data: {}, error: { message: "Invalid login credentials" } });
        self._setSession({ user: { id: u.id, email: u.email } });
        return Promise.resolve({ data: { session: self._session }, error: null });
      },
      // the invitation-only signup trigger, in miniature
      signUp: function (c) {
        var d = load(), tok = c.options && c.options.data && c.options.data.token;
        if ((d.people || []).some(function (p) { return p.email === c.email; }))
          return Promise.resolve({ data: {}, error: { message: "User already registered" } });
        var inv = (d.invites || []).filter(function (i) {
          return i.token === tok && String(i.email).toLowerCase() === String(c.email).toLowerCase() &&
                 !i.accepted && new Date(i.expires) > new Date();
        })[0];
        if (!inv) return Promise.resolve({ data: {}, error: { message: "This board is invitation only. Ask an admin for an invite link." } });
        var u = { id: uid(), email: c.email, password: c.password, name: inv.name, member: inv.member };
        d.people = d.people || []; d.people.push(u);
        d.memberships = d.memberships || [];
        d.memberships.push({ site: inv.site, person: u.id, role: inv.role });
        inv.accepted = new Date().toISOString();
        save(d);
        self._setSession({ user: { id: u.id, email: u.email } });
        return Promise.resolve({ data: { session: self._session }, error: null });
      },
      signOut: function () { self._session = null; localStorage.removeItem("mocksb-session"); return Promise.resolve({ error: null }); }
    };
  }
  Client.prototype._setSession = function (s) {
    this._session = s; localStorage.setItem("mocksb-session", JSON.stringify(s));
  };
  Client.prototype._uid = function () { return this._session && this._session.user.id; };
  Client.prototype._me = function () {
    var d = load(), u = this._uid();
    return (d.people || []).filter(function (p) { return p.id === u; })[0] || null;
  };
  Client.prototype._member = function () { var m = this._me(); return m ? m.member : null; };
  Client.prototype._role = function (site) {
    var d = load(), u = this._uid();
    var m = (d.memberships || []).filter(function (x) { return x.person === u && x.site === site; })[0];
    return m ? m.role : null;
  };
  Client.prototype._rank = function (site) { return RANK[this._role(site)] || 0; };

  Client.prototype._visible = function (t, row) {
    if (!this._uid()) return false;
    if (t === "people") return true;
    if (t === "sites") return !!this._role(row.id);
    if (t === "memberships") return !!this._role(row.site);
    if (t === "invites") return this._rank(row.site) >= RANK.admin;
    if (DATA.indexOf(t) > -1) {
      if (!this._role(row.site)) return false;
      if (t === "personal" && row.key !== this._member()) return false;
      return true;
    }
    return false;
  };
  // returns null when allowed, or a message when the policy refuses
  Client.prototype._refuse = function (t, row, op) {
    // people: you may only edit your own row (mirrors the people_self policy)
    if (t === "people") return row.id === this._uid() ? null : "blocked";
    var r = this._rank(row.site !== undefined ? row.site : row.id);
    if (t === "invites") {
      if (r < RANK.admin) return "new row violates row-level security policy for table \"invites\"";
      if (op !== "delete" && RANK[row.role] > r) return "new row violates row-level security policy for table \"invites\"";
      return null;
    }
    if (t === "memberships") {
      if (r < RANK.admin) return "blocked";
      if (op === "update" && row.person === this._uid()) return "blocked";
      if (op === "update" && RANK[row.role] > r) return "new row violates row-level security policy for table \"memberships\"";
      if (op === "delete" && RANK[row.role] >= r) return "blocked";
      return null;
    }
    if (!r) return "blocked";
    if (t === "personal") return row.key === this._member() ? null : "new row violates row-level security policy for table \"personal\"";
    if (t === "team") return (r >= RANK.admin || row.key === this._member()) ? null
      : "new row violates row-level security policy for table \"team\"";
    if (t === "meta") {
      var need = row.key === "reads" ? RANK.viewer : (row.key === "activity" ? RANK.editor : RANK.admin);
      if (op === "delete") need = RANK.admin;
      return r >= need ? null : "new row violates row-level security policy for table \"meta\"";
    }
    if (t === "tasks" || t === "meetings") {
      var min = op === "delete" ? RANK.admin : RANK.editor;
      return r >= min ? null : "new row violates row-level security policy for table \"" + t + "\"";
    }
    return null;
  };

  function Q(c, t) { this.c = c; this.t = t; this.op = "select"; this.f = []; this.nulls = []; }
  Q.prototype.select = function (cols) { this.cols = cols; if (this.op === "select") this.op = "select"; return this; };
  Q.prototype.order = function () { return this; };
  Q.prototype.eq = function (col, v) { this.f.push([col, v]); return this; };
  Q.prototype.is = function (col) { this.nulls.push(col); return this; };
  Q.prototype.maybeSingle = function () { this.one = true; return this; };
  Q.prototype.single = function () { this.one = true; return this; };
  Q.prototype.upsert = function (row) { this.op = "upsert"; this.row = row; return this; };
  Q.prototype.insert = function (row) { this.op = "insert"; this.row = row; return this; };
  Q.prototype.update = function (patch) { this.op = "update"; this.patch = patch; return this; };
  Q.prototype["delete"] = function () { this.op = "delete"; return this; };
  Q.prototype._match = function (r) {
    return this.f.every(function (p) { return r[p[0]] === p[1]; }) &&
           this.nulls.every(function (c) { return r[c] == null; });
  };
  Q.prototype._embed = function (d, row) {
    if (!this.cols || this.cols.indexOf("people(") < 0) return row;
    var out = cp(row);
    out.people = (d.people || []).filter(function (p) { return p.id === row.person; })
      .map(function (p) { return { name: p.name, member: p.member }; })[0] || null;
    return out;
  };
  Q.prototype.then = function (res, rej) {
    var d = load(), out = { data: null, error: null }, self = this;
    try {
      var rows = (d[this.t] || []).filter(function (r) { return self._match(r) && self.c._visible(self.t, r); });
      if (this.op === "select") {
        var mapped = rows.map(function (r) { return self._embed(d, r); });
        out.data = this.one ? (mapped[0] || null) : mapped;
      } else if (this.op === "upsert" || this.op === "insert") {
        var why = this.c._refuse(this.t, this.row, "insert");
        if (why) throw new Error(why);
        d[this.t] = d[this.t] || [];
        var i = this.op === "upsert"
          ? d[this.t].findIndex(function (r) { return r.site === self.row.site && r.key === self.row.key; })
          : -1;
        var rec = cp(this.row);
        if (i < 0) { rec.id = rec.id || uid(); if (self.t === "invites") { rec.token = rec.token || uuid(); rec.expires = rec.expires || new Date(Date.now() + 12096e5).toISOString(); rec.accepted = null; } d[this.t].push(rec); }
        else { rec.id = d[this.t][i].id; d[this.t][i] = rec; }
        save(d); this.c._fire(this.t, i < 0 ? "INSERT" : "UPDATE", rec);
        out.data = this.one ? rec : [rec];
      } else if (this.op === "update") {
        var done = [];
        rows.forEach(function (r) {
          var merged = Object.assign({}, r, self.patch);
          if (self.c._refuse(self.t, self.t === "memberships" ? merged : r, "update")) {
            if (self.t === "memberships" && RANK[merged.role] > self.c._rank(r.site))
              throw new Error("new row violates row-level security policy for table \"memberships\"");
            return;   // silently affects zero rows, exactly like a USING clause
          }
          Object.assign(r, self.patch); done.push(cp(r));
          self.c._fire(self.t, "UPDATE", r);
        });
        save(d); out.data = done;
      } else if (this.op === "delete") {
        var gone = rows.filter(function (r) { return !self.c._refuse(self.t, r, "delete"); });
        d[this.t] = (d[this.t] || []).filter(function (r) { return gone.indexOf(r) < 0; });
        save(d);
        gone.forEach(function (r) { self.c._fire(self.t, "DELETE", r); });
        out.data = gone.map(cp);
      }
    } catch (e) { out.error = { message: e.message }; out.data = null; }
    return Promise.resolve(out).then(res, rej);
  };

  Client.prototype.from = function (t) { return new Q(this, t); };
  Client.prototype.rpc = function (fn, args) {
    var d = load(), self = this;
    // mirrors public.accept_invite(): distinct reasons, and idempotent when
    // the account is already on the project
    if (fn === "accept_invite") {
      var me = this._me();
      var inv = (d.invites || []).filter(function (i) { return i.token === args.t; })[0];
      var fail = function (m) { return Promise.resolve({ data: null, error: { message: m } }); };
      if (!inv) return fail("invite_not_found");
      if (String(inv.email).toLowerCase() !== String(me.email).toLowerCase()) return fail("invite_email_mismatch");
      d.memberships = d.memberships || [];
      var had = d.memberships.filter(function (m) { return m.site === inv.site && m.person === me.id; })[0];
      if (had) {
        inv.accepted = inv.accepted || new Date().toISOString(); save(d);
        return Promise.resolve({ data: [{ site: inv.site, role: had.role }], error: null });
      }
      if (inv.accepted) return fail("invite_used");
      if (new Date(inv.expires) <= new Date()) return fail("invite_expired");
      d.memberships.push({ site: inv.site, person: me.id, role: inv.role });
      inv.accepted = new Date().toISOString(); save(d);
      return Promise.resolve({ data: [{ site: inv.site, role: inv.role }], error: null });
    }
    return Promise.resolve({ data: null, error: { message: "unknown function" } });
  };
  Client.prototype.channel = function () {
    var c = this;
    return { on: function (ev, o, cb) { (c._subs[o.table] = c._subs[o.table] || []).push(cb); return this; },
             subscribe: function () { return this; } };
  };
  Client.prototype._fire = function (t, type, row) {
    (this._subs[t] || []).forEach(function (cb) {
      cb({ eventType: type, "new": type === "DELETE" ? null : cp(row), old: type === "DELETE" ? cp(row) : null });
    });
  };

  g.supabase = { createClient: function () { return new Client(); } };
})(window);
