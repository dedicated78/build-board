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
    "#acc{position:fixed;inset:0;z-index:9800;background:rgba(1,11,36,.38);display:flex;align-items:center;",
      "justify-content:center;padding:20px;font-family:'IBM Plex Sans',system-ui,sans-serif}",
    "#acc .ac-sheet{background:#FFFDF8;border:1px solid #E5DED2;border-radius:16px;width:100%;max-width:640px;",
      "max-height:86vh;overflow:auto;box-shadow:0 18px 48px rgba(1,11,36,.16)}",
    "#acc .ac-hd{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;",
      "border-bottom:1px solid #F0EAE0;position:sticky;top:0;background:#FFFDF8;border-radius:16px 16px 0 0}",
    "#acc h2{font-family:Archivo,system-ui,sans-serif;font-size:17px;margin:0;color:#010B24}",
    "#acc .ac-x{border:0;background:#F1EBE0;color:#56606F;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:15px}",
    "#acc .ac-sec{padding:18px 22px;border-bottom:1px solid #F0EAE0}",
    "#acc .ac-sec:last-child{border-bottom:0}",
    "#acc h3{font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:#646D7E;margin:0 0 12px;font-weight:700}",
    "#acc .ac-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F0EAE0}",
    "#acc .ac-row:last-child{border-bottom:0}",
    "#acc .ac-who{flex:1 1 auto;min-width:0}",
    "#acc .ac-nm{font-weight:600;font-size:13.5px;color:#010B24;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#acc .ac-sub{font-size:12px;color:#646D7E;font-family:'IBM Plex Mono',monospace}",
    "#acc select,#acc input{border:1px solid #E5DED2;border-radius:8px;padding:8px 10px;font:13px 'IBM Plex Sans',system-ui,sans-serif;background:#fff;color:#010B24;min-height:38px}",
    "#acc select:focus,#acc input:focus{outline:none;border-color:#0F6F69;box-shadow:0 0 0 3px #E3F3F1}",
    "#acc .ac-mini{border:1px solid #F3D9D5;background:#FBEEEC;color:#A83229;font-size:12px;font-weight:600;cursor:pointer;padding:7px 11px;border-radius:8px;min-height:36px}",
    "#acc .ac-link{border:1px solid #E5DED2;background:#FFFDF8;color:#010B24;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;min-height:36px}",
    "#acc form{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    "#acc form .full{grid-column:1/-1}",
    "#acc label{display:block;font-size:11.5px;font-weight:600;color:#56606F;margin:0 0 4px}",
    "#acc form input,#acc form select{width:100%;box-sizing:border-box}",
    // a member row is name | role | remove — the select must not eat the row
    "#acc .ac-row select{flex:0 0 auto;width:auto;min-width:116px}",
    "#acc .ac-row .ac-mini{flex:0 0 auto;white-space:nowrap}",
    "#acc .ac-go{grid-column:1/-1;border:0;background:#0F6F69;color:#fff;border-radius:10px;padding:12px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;min-height:46px}",
    "#acc .ac-note{font-size:12px;color:#56606F;line-height:1.5;margin:10px 0 0}",
    "#acc .ac-note.ac-bad{color:#A83229}",
    "#acc .ac-made{background:#E3F3F1;border:1px solid #0F6F6933;border-radius:12px;padding:13px;margin-top:12px;font-size:13px;color:#010B24}",
    "#acc .ac-made code{display:block;font:12px 'IBM Plex Mono',monospace;word-break:break-all;color:#010B24;margin:7px 0 10px}",
    "#acc .ac-empty{font-size:12.5px;color:#646D7E;padding:6px 0}",
    "#acc .ac-badge{flex:none;font-family:Archivo,system-ui,sans-serif;font-size:10px;font-weight:700;",
    "  letter-spacing:.09em;text-transform:uppercase;border-radius:99px;padding:4px 9px;",
    "  background:#F7EBD5;color:#8A5A08;border:1px solid #EEDCBB}",
    "#acc .ac-go:focus-visible,#acc .ac-link:focus-visible,#acc .ac-mini:focus-visible,",
    "#acc .ac-x:focus-visible{outline:2px solid #0F6F69;outline-offset:2px}",
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
        PB.removeMember(m.id)
          .then(function () {
            // the roster row stays so historic tasks still name them
            return PB.deactivateMember ? PB.deactivateMember(m.member) : null;
          })
          .then(done)
          .catch(function (e) {
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

    row.appendChild(el("span", "ac-badge", "Pending"));
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
    name.required = true;
    var member = field("Board key", "acMember", "text", "leave blank to generate");

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
      // the board key is a permanent internal identifier, never derived from
      // the email address and never editable afterwards
      var key = member.value.trim() || ("USR-" + Array.from({ length: 8 }, function () {
        return "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
      }).join(""));
      PB.invite({ email: email.value, name: name.value.trim(), member: key, role: sel.value })
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
