/* ===========================================================================
   People & access — invite, assign roles, remove. Admins and owners only.
   Lives outside the board's own code so re-porting the board stays a one-liner.
   =========================================================================== */
(function (global) {
  "use strict";

  var ROLES = [
    ["owner",  "Owner",  "Everything, including handing over ownership."],
    ["admin",  "Admin",  "Invites people, sets roles, edits inventory and branding, deletes."],
    ["editor", "Editor", "Does the work: tasks, progress, submissions, own profile."],
    ["viewer", "Viewer", "Reads the board and the report. Nothing else."]
  ];

  var css = document.createElement("style");
  css.textContent = [
    "#acc{position:fixed;inset:0;z-index:9800;background:rgba(20,24,27,.34);display:flex;align-items:center;",
      "justify-content:center;padding:20px;font-family:'IBM Plex Sans',system-ui,sans-serif}",
    "#acc .ac-sheet{background:#fff;border:1px solid #D6DCDF;border-radius:14px;width:100%;max-width:640px;",
      "max-height:86vh;overflow:auto;box-shadow:0 18px 50px rgba(20,24,27,.18)}",
    "#acc .ac-hd{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;",
      "border-bottom:1px solid #E6EAEC;position:sticky;top:0;background:#fff;border-radius:14px 14px 0 0}",
    "#acc h2{font-family:Archivo,system-ui,sans-serif;font-size:17px;margin:0;color:#14181B}",
    "#acc .ac-x{border:0;background:#E9ECEE;color:#5A6469;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:15px}",
    "#acc .ac-sec{padding:18px 22px;border-bottom:1px solid #E6EAEC}",
    "#acc .ac-sec:last-child{border-bottom:0}",
    "#acc h3{font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:#8A9399;margin:0 0 12px;font-weight:700}",
    "#acc .ac-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #F0F3F4}",
    "#acc .ac-row:last-child{border-bottom:0}",
    "#acc .ac-who{flex:1 1 auto;min-width:0}",
    "#acc .ac-nm{font-weight:600;font-size:13.5px;color:#14181B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#acc .ac-sub{font-size:12px;color:#8A9399;font-family:'IBM Plex Mono',monospace}",
    "#acc select,#acc input{border:1px solid #D6DCDF;border-radius:8px;padding:7px 9px;font:13px 'IBM Plex Sans',system-ui,sans-serif;background:#fff;color:#14181B}",
    "#acc select:focus,#acc input:focus{outline:none;border-color:#12615E;box-shadow:0 0 0 3px #DCEBEA}",
    "#acc .ac-mini{border:0;background:transparent;color:#B5342B;font-size:12px;font-weight:600;cursor:pointer;padding:6px}",
    "#acc .ac-link{border:0;background:#E9ECEE;color:#14181B;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer}",
    "#acc form{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    "#acc form .full{grid-column:1/-1}",
    "#acc label{display:block;font-size:11.5px;font-weight:600;color:#5A6469;margin:0 0 4px}",
    "#acc form input,#acc form select{width:100%;box-sizing:border-box}",
    // a member row is name | role | remove — the select must not eat the row
    "#acc .ac-row select{flex:0 0 auto;width:auto;min-width:116px}",
    "#acc .ac-row .ac-mini{flex:0 0 auto;white-space:nowrap}",
    "#acc .ac-go{grid-column:1/-1;border:0;background:#12615E;color:#fff;border-radius:8px;padding:10px;font-weight:600;font-size:13.5px;cursor:pointer;font-family:inherit}",
    "#acc .ac-note{font-size:12px;color:#5A6469;line-height:1.5;margin:10px 0 0}",
    "#acc .ac-note.ac-bad{color:#B5342B}",
    "#acc .ac-made{background:#DCEBEA;border:1px solid #12615E33;border-radius:10px;padding:12px;margin-top:12px}",
    "#acc .ac-made code{display:block;font:12px 'IBM Plex Mono',monospace;word-break:break-all;color:#14181B;margin:6px 0 10px}",
    "#acc .ac-empty{font-size:12.5px;color:#8A9399;padding:6px 0}",
    "#acc .ac-row .ac-note{flex:1 0 100%;margin:6px 0 0}",
    // narrow: name on its own line, controls beneath, nothing clipped
    "@media (max-width:560px){",
    "  #acc form{grid-template-columns:1fr}",
    "  #acc .ac-row{display:grid;grid-template-columns:1fr auto;grid-template-areas:\'who who\' \'role rm\';row-gap:8px;column-gap:10px}",
    "  #acc .ac-row .ac-who{grid-area:who}",
    "  #acc .ac-row select{grid-area:role;width:100%;min-width:0}",
    "  #acc .ac-row .ac-mini{grid-area:rm;justify-self:end;padding:6px 0 6px 10px}",
    "  #acc .ac-row .ac-link{grid-area:role;justify-self:start}",
    "  #acc .ac-row .ac-note{grid-column:1/-1}",
    "}"
  ].join("");
  document.head.appendChild(css);

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function allowed() {   // never offer a role above your own
    var mine = PB.rank(PB.role());
    return ROLES.filter(function (r) { return PB.rank(r[0]) <= mine; });
  }

  function open() {
    var wrap = el("div"); wrap.id = "acc";
    var sheet = el("div", "ac-sheet");
    var hd = el("div", "ac-hd");
    hd.appendChild(el("h2", null, "People & access"));
    var x = el("button", "ac-x", "✕"); x.type = "button";
    x.onclick = function () { wrap.remove(); };
    hd.appendChild(x);
    sheet.appendChild(hd);

    var mSec = el("div", "ac-sec"); mSec.appendChild(el("h3", null, "On this project"));
    var mList = el("div"); mSec.appendChild(mList); sheet.appendChild(mSec);

    var iSec = el("div", "ac-sec"); iSec.appendChild(el("h3", null, "Pending invitations"));
    var iList = el("div"); iSec.appendChild(iList); sheet.appendChild(iSec);

    var fSec = el("div", "ac-sec"); fSec.appendChild(el("h3", null, "Invite someone"));
    fSec.appendChild(inviteForm(function () { refresh(); }));
    sheet.appendChild(fSec);

    wrap.appendChild(sheet);
    wrap.onclick = function (e) { if (e.target === wrap) wrap.remove(); };
    document.body.appendChild(wrap);

    function refresh() {
      PB.listMembers().then(function (list) {
        mList.innerHTML = "";
        if (!list.length) { mList.appendChild(el("div", "ac-empty", "Nobody yet.")); return; }
        list.forEach(function (m) { mList.appendChild(memberRow(m, refresh)); });
      }).catch(function (e) { mList.innerHTML = ""; mList.appendChild(el("p", "ac-note ac-bad", e.message)); });

      PB.listInvites().then(function (list) {
        iList.innerHTML = "";
        if (!list.length) { iList.appendChild(el("div", "ac-empty", "None outstanding.")); return; }
        list.forEach(function (i) { iList.appendChild(inviteRow(i, refresh)); });
      }).catch(function () { iList.innerHTML = ""; });
    }
    refresh();
  }

  function memberRow(m, done) {
    var row = el("div", "ac-row");
    var who = el("div", "ac-who");
    who.appendChild(el("div", "ac-nm", m.name || "(no name)"));
    who.appendChild(el("div", "ac-sub", m.member || "—"));
    row.appendChild(who);

    var sel = document.createElement("select");
    allowed().forEach(function (r) {
      var o = document.createElement("option");
      o.value = r[0]; o.textContent = r[1];
      if (r[0] === m.role) o.selected = true;
      sel.appendChild(o);
    });
    // a role above yours is shown but not changeable
    if (PB.rank(m.role) > PB.rank(PB.role())) {
      sel.innerHTML = ""; var o = document.createElement("option");
      o.textContent = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      sel.appendChild(o); sel.disabled = true;
    }
    var msg = el("p", "ac-note ac-bad"); msg.style.display = "none";
    sel.onchange = function () {
      PB.setRole(m.id, sel.value).then(done).catch(function (e) {
        msg.textContent = e.message; msg.style.display = "block";
      });
    };
    row.appendChild(sel);

    if (PB.rank(m.role) < PB.rank(PB.role())) {
      var rm = el("button", "ac-mini", "Remove"); rm.type = "button";
      rm.onclick = function () {
        rm.textContent = "Removing…";
        PB.removeMember(m.id).then(done).catch(function (e) {
          rm.textContent = "Remove"; msg.textContent = e.message; msg.style.display = "block";
        });
      };
      row.appendChild(rm);
    }
    row.appendChild(msg);
    return row;
  }

  function inviteRow(i, done) {
    var row = el("div", "ac-row");
    var who = el("div", "ac-who");
    who.appendChild(el("div", "ac-nm", i.email));
    who.appendChild(el("div", "ac-sub", (i.member || "—") + " · " + i.role +
      " · expires " + new Date(i.expires).toISOString().slice(0, 10)));
    row.appendChild(who);

    var copy = el("button", "ac-link", "Copy link"); copy.type = "button";
    copy.onclick = function () {
      var link = PB.inviteLink(i.token);
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 1600); })
        .catch(function () { window.prompt("Copy this invite link:", link); });
    };
    row.appendChild(copy);

    var rv = el("button", "ac-mini", "Revoke"); rv.type = "button";
    rv.onclick = function () { rv.textContent = "…"; PB.revokeInvite(i.id).then(done); };
    row.appendChild(rv);
    return row;
  }

  function inviteForm(done) {
    var f = document.createElement("form");
    function field(label, id, type, ph, full) {
      var w = el("div", full ? "full" : null);
      var l = el("label", null, label); l.htmlFor = id; w.appendChild(l);
      var i = document.createElement("input");
      i.id = id; i.type = type || "text"; if (ph) i.placeholder = ph;
      w.appendChild(i); f.appendChild(w); return i;
    }
    var email = field("Email", "acEmail", "email", "name@company.com", true);
    email.required = true;
    var name = field("Full name", "acName", "text", "SEO Worker 2");
    var member = field("Board key", "acMember", "text", "SEO-2");

    var rw = el("div", "full");
    rw.appendChild(el("label", null, "Role"));
    var sel = document.createElement("select"); sel.id = "acRole";
    allowed().forEach(function (r) {
      var o = document.createElement("option");
      o.value = r[0]; o.textContent = r[1] + " — " + r[2];
      if (r[0] === "editor") o.selected = true;
      sel.appendChild(o);
    });
    rw.appendChild(sel); f.appendChild(rw);

    var btn = el("button", "ac-go", "Create invitation"); btn.type = "submit";
    f.appendChild(btn);
    var out = el("div"); f.appendChild(out);

    f.onsubmit = function (ev) {
      ev.preventDefault();
      btn.disabled = true; btn.textContent = "Creating…"; out.innerHTML = "";
      PB.invite({ email: email.value, name: name.value, member: member.value, role: sel.value })
        .then(function (inv) {
          btn.disabled = false; btn.textContent = "Create invitation";
          email.value = name.value = member.value = "";
          var box = el("div", "ac-made");
          box.appendChild(el("div", null, "Invitation ready. Send them this link — it works once and expires in 14 days."));
          box.appendChild(el("code", null, PB.inviteLink(inv.token)));
          var c = el("button", "ac-link", "Copy link"); c.type = "button";
          c.onclick = function () {
            var link = PB.inviteLink(inv.token);
            (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
              .then(function () { c.textContent = "Copied"; })
              .catch(function () { window.prompt("Copy this invite link:", link); });
          };
          box.appendChild(c);
          out.appendChild(box);
          done();
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = "Create invitation";
          out.appendChild(el("p", "ac-note ac-bad", e.message));
        });
    };
    return f;
  }

  global.ACCESS = { open: open };
})(window);
