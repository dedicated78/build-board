/* ===========================================================================
   RMM Build Board — Supabase adapter
   Same surface the artifact database had, so the app above it is unchanged:
       db.collection(name).onSnapshot(cb, err)
       db.doc("table/key").onSnapshot(cb, err)
       db.doc("table/key").set(body)
       db.doc("table/key").delete()
   Every row is { site, key, body }; row-level security does the tenant
   isolation server-side, and we filter again on the way in.
   =========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.RMM_CONFIG || {};
  var sb = null, site = null, me = null, role = "", sites = [];
  var cache = {}, listeners = {}, started = {}, booted = null;

  function store(t) { return cache[t] || (cache[t] = {}); }

  function snapshot(t) {
    var m = store(t), docs = [];
    Object.keys(m).forEach(function (k) {
      var body = m[k];
      docs.push({ id: k, data: function () { return body; } });
    });
    return { docs: docs };
  }
  function docSnap(t, k) {
    var b = store(t)[k];
    return { exists: !!b, data: function () { return b || null; } };
  }
  function emit(t) {
    (listeners[t] || []).forEach(function (l) {
      try { l.cb(l.key == null ? snapshot(t) : docSnap(t, l.key)); } catch (e) {}
    });
  }
  function fail(t, e) {
    (listeners[t] || []).forEach(function (l) { if (l.err) try { l.err(e); } catch (x) {} });
  }

  function start(t) {
    if (started[t]) return started[t];
    started[t] = (async function () {
      var r = await sb.from(t).select("key,body").eq("site", site);
      if (r.error) throw r.error;
      var m = store(t);
      (r.data || []).forEach(function (row) { m[row.key] = row.body || {}; });
      emit(t);
      sb.channel("rmm-" + t + "-" + site)
        .on("postgres_changes",
            { event: "*", schema: "public", table: t, filter: "site=eq." + site },
            function (p) {
              var m2 = store(t);
              if (p.eventType === "DELETE") { if (p.old && p.old.key) delete m2[p.old.key]; }
              else if (p.new && p.new.site === site) { m2[p.new.key] = p.new.body || {}; }
              emit(t);
            })
        .subscribe();
      return true;
    })();
    started[t].catch(function (e) { fail(t, e); started[t] = null; });
    return started[t];
  }

  async function setDoc(t, k, body) {
    await start(t);
    store(t)[k] = body;      // optimistic: the UI must not wait on the network
    emit(t);
    var r = await sb.from(t).upsert({ site: site, key: k, body: body, updated: new Date().toISOString() },
                                    { onConflict: "site,key" });
    if (r.error) throw r.error;
  }

  async function delDoc(t, k) {
    await start(t);
    delete store(t)[k];
    emit(t);
    var r = await sb.from(t).delete().eq("site", site).eq("key", k);
    if (r.error) throw r.error;
  }

  function docRef(path) {
    var i = path.indexOf("/"), t = path.slice(0, i), k = path.slice(i + 1);
    return {
      set: function (body) { return setDoc(t, k, body); },
      "delete": function () { return delDoc(t, k); },
      onSnapshot: function (cb, err) {
        (listeners[t] || (listeners[t] = [])).push({ key: k, cb: cb, err: err });
        start(t).then(function () { cb(docSnap(t, k)); }).catch(function () {});
      }
    };
  }
  function collRef(t) {
    return {
      onSnapshot: function (cb, err) {
        (listeners[t] || (listeners[t] = [])).push({ key: null, cb: cb, err: err });
        start(t).then(function () { cb(snapshot(t)); }).catch(function () {});
      }
    };
  }

  /* Postgres speaks in codes; people do not. */
  function friendlyError(e) {
    var m = String((e && (e.message || e.error_description || e.details || e.code)) || "");
    if (/42501|permission denied|row-level security|violates row-level/i.test(m))
      return "You don't have permission to change that. Ask an owner or admin.";
    if (/23505|duplicate key|unique constraint/i.test(m))
      return "That already exists.";
    if (/JWT|token is expired|invalid claim/i.test(m))
      return "Your session has expired — sign in again.";
    if (/Failed to fetch|NetworkError|network/i.test(m))
      return "Can't reach the server. Check your connection and try again.";
    return "Couldn't save. Please try again.";
  }

  var API = {
    client: function () { return sb; },
    /* live = Supabase is configured at all; authed = configured AND signed in
       with a resolved board identity. The legacy identity picker may only
       appear when live() is false. */
    live: function () { return !!sb; },
    authed: function () { return !!(sb && API._session && site && me); },
    friendlyError: friendlyError,
    teamSync: function () { return API._teamSync || null; },
    me: function () { return me || ""; },
    role: function () { return role; },
    rank: function (r) { return { owner: 4, admin: 3, editor: 2, viewer: 1 }[r] || 0; },
    can: function (least) { return API.rank(role) >= API.rank(least); },
    isAdmin: function () { return API.can("admin"); },
    sites: function () { return sites; },
    siteId: function () { return site; },
    siteRecord: function () { return sites.filter(function (s) { return s.id === site; })[0] || null; },
    signedIn: function () { return !!(sb && sb.auth && API._session); },

    init: function () {
      if (sb) return sb;
      var lib = global.supabase;
      if (!lib || !CFG.supabaseUrl || !CFG.supabaseKey) return null;
      sb = lib.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      return sb;
    },

    // resolves once we know whether there is a session, and which site we're on
    ready: function () {
      if (booted) return booted;
      booted = (async function () {
        if (!API.init()) return { ok: false, reason: "config" };
        var s = await sb.auth.getSession();
        API._session = s.data && s.data.session;
        if (!API._session) return { ok: false, reason: "anon" };
        try { await API.loadProfile(); } catch (e) { return { ok: false, reason: "profile", error: e }; }
        return { ok: true };
      })();
      return booted;
    },

    loadProfile: async function () {
      var uid = API._session.user.id;
      var pr = await sb.from("people").select("name,member").eq("id", uid).maybeSingle();
      me = (pr.data && pr.data.member) || "";
      API._name = (pr.data && pr.data.name) || API._session.user.email;

      var sr = await sb.from("sites").select("id,name,client").order("name");
      if (sr.error) throw sr.error;
      sites = sr.data || [];
      if (!sites.length) throw new Error("not a member of any site");

      var want = localStorage.getItem("rmm-site");
      var pick = sites.filter(function (x) { return x.id === want; })[0] || sites[0];
      site = pick.id;
      localStorage.setItem("rmm-site", site);

      var mr = await sb.from("memberships").select("role").eq("site", site).eq("person", uid).maybeSingle();
      role = (mr.data && mr.data.role) || "viewer";
    },

    name: function () { return API._name || ""; },

    login: async function (email, password) {
      var r = await sb.auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw r.error;
      API._session = r.data.session;
      await API.loadProfile();
      return true;
    },

    logout: async function () { try { await sb.auth.signOut(); } catch (e) {} location.reload(); },
    useSite: function (id) { localStorage.setItem("rmm-site", id); location.reload(); },

    /* The invitation already decided who this person is. Make sure the board
       has a roster row for them before anything renders, so nobody is ever
       asked to pick themselves out of a list. Never overwrites an existing
       profile — it only fills a missing one, or reactivates one they left. */
    ensureOwnTeamProfile: async function () {
      if (!sb || !site || !me) return { ok: false, reason: "identity" };
      var r = await sb.from("team").select("key,body").eq("site", site).eq("key", me).maybeSingle();
      if (r.error) throw r.error;

      if (!r.data) {
        var c = await sb.from("team").insert({
          site: site, key: me,
          body: { name: API._name || "", role: "", perWeek: 0, phone: "", hours: "", active: true },
          updated: new Date().toISOString()
        });
        if (c.error) throw c.error;
        return { ok: true, created: true };
      }

      var body = r.data.body || {};
      if (body.active === false) {           // they left and have been invited back
        var back = Object.assign({}, body, { active: true });
        var u = await sb.from("team").update({ body: back }).eq("site", site).eq("key", me);
        if (u.error) throw u.error;
        return { ok: true, reactivated: true };
      }
      return { ok: true, existing: true };   // operational detail is theirs, leave it alone
    },

    /* One visible name, two places to keep it. */
    saveDisplayName: async function (name) {
      name = String(name == null ? "" : name).trim();
      if (!name) throw new Error("A display name is required.");
      var a = await sb.from("people").update({ name: name }).eq("id", API._session.user.id);
      if (a.error) throw a.error;
      API._name = name;
      var r = await sb.from("team").select("body").eq("site", site).eq("key", me).maybeSingle();
      var body = Object.assign({}, (r.data && r.data.body) || {}, { name: name });
      var u = await sb.from("team").update({ body: body }).eq("site", site).eq("key", me);
      if (u.error) throw u.error;
      return name;
    },

    /* Removal keeps history: the profile stays, marked inactive. */
    deactivateMember: async function (memberKey) {
      if (!memberKey) return false;
      var r = await sb.from("team").select("body").eq("site", site).eq("key", memberKey).maybeSingle();
      if (r.error || !r.data) return false;
      var body = Object.assign({}, r.data.body || {}, { active: false });
      var u = await sb.from("team").update({ body: body }).eq("site", site).eq("key", memberKey);
      return !u.error;
    },

    connect: async function () {
      var r = await API.ready();
      if (!r.ok) return null;
      try { API._teamSync = await API.ensureOwnTeamProfile(); }
      catch (e) { API._teamSync = { ok: false, error: e, message: friendlyError(e) }; }
      return { doc: docRef, collection: collRef };
    },


    /* ---- people and access (admins) ---- */
    listMembers: async function () {
      var r = await sb.from("memberships")
        .select("role, person, people(name, member)")
        .eq("site", site);
      if (r.error) throw r.error;
      return (r.data || []).map(function (m) {
        return { id: m.person, role: m.role,
                 name: (m.people && m.people.name) || "",
                 member: (m.people && m.people.member) || "" };
      }).sort(function (a, b) { return API.rank(b.role) - API.rank(a.role) || a.name.localeCompare(b.name); });
    },

    setRole: async function (personId, newRole) {
      var r = await sb.from("memberships").update({ role: newRole })
        .eq("site", site).eq("person", personId).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error("That change isn't allowed at your role.");
    },

    removeMember: async function (personId) {
      var r = await sb.from("memberships").delete()
        .eq("site", site).eq("person", personId).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error("That change isn't allowed at your role.");
    },

    listInvites: async function () {
      var r = await sb.from("invites")
        .select("id,email,name,member,role,token,expires,accepted")
        .eq("site", site).is("accepted", null);
      if (r.error) throw r.error;
      return (r.data || []).filter(function (i) { return new Date(i.expires) > new Date(); });
    },

    invite: async function (o) {
      var r = await sb.from("invites").insert({
        site: site, email: String(o.email || "").trim().toLowerCase(),
        name: o.name || "", member: o.member || "", role: o.role || "editor",
        invited_by: API._session.user.id
      }).select().single();
      if (r.error) throw new Error(/row-level security/.test(r.error.message || "")
        ? "You can't invite someone at a role above your own." : r.error.message);
      return r.data;
    },

    revokeInvite: async function (id) {
      var r = await sb.from("invites").delete().eq("id", id);
      if (r.error) throw r.error;
    },

    inviteLink: function (token) {
      return location.origin + location.pathname + "#invite=" + token;
    },

    /* ---- accepting one ---- */
    signUpWithInvite: async function (email, password, token) {
      var r = await sb.auth.signUp({
        email: String(email || "").trim(),
        password: password,
        options: { data: { token: token } }
      });
      if (r.error) throw r.error;
      if (!r.data.session) throw new Error("NEEDS_CONFIRM");
      API._session = r.data.session;
      booted = null;
      return true;
    },

    // already signed in, opening a link for another project
    acceptInvite: async function (token) {
      var r = await sb.rpc("accept_invite", { t: token });
      if (r.error) throw r.error;
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (row && row.site) localStorage.setItem("rmm-site", row.site);
      return row;
    },

    downloads: {
      save: function (o) {
        return new Promise(function (res) {
          var blob = new Blob([o.data], { type: o.type || "text/html;charset=utf-8" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = o.filename || "download.html";
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); res(); }, 400);
        });
      }
    },

    sampler: CFG.ai ? function (prompt) {
      return fetch(CFG.ai, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt, site: site })
      }).then(function (r) { return r.json(); })
        .then(function (j) { return { text: j.text || j.output || "" }; });
    } : null
  };

  global.PB = API;
  try { API.init(); } catch (e) {}
})(window);
