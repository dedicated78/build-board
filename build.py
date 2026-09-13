#!/usr/bin/env python3
"""Build public/index.html from src/board.html.

The board is authored as one self-contained file; this wraps it in a real HTML
document, swaps the artifact runtime for Supabase, and adds the sign-in gate.
Re-runnable: edit src/board.html, run `python3 build.py`, redeploy."""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src" / "board.html"
OUT = ROOT / "public" / "index.html"
d = SRC.read_text(encoding="utf-8")

head = """<style>
  /* base reset the artifact runtime used to inject — the app depends on it */
  html{color-scheme:light}
  body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F7F3EA;color:#010B24}
  img{max-width:100%}
  [hidden]{display:none!important}
  *,*::before,*::after{box-sizing:border-box}
</style>
<script src="supabase.js"></script>
<script src="config.js"></script>
<script src="sb-adapter.js"></script>
<script src="access.js"></script>
<style>
  /* the app's tokens, repeated here because this shell renders before it */
  #gate, #whoami, .acct { --cream:#F7F3EA; --paper:#FFFDF8; --navy:#010B24; --navy-2:#56606F;
    --muted:#646D7E; --line:#E5DED2; --teal:#0F6F69; --teal-hover:#218F88; --teal-soft:#E3F3F1; --red:#A83229; }

  /* ---- authentication ---- */
  #gate{position:fixed;inset:0;z-index:9999;background:var(--cream);display:flex;align-items:center;
    justify-content:center;padding:24px 20px;overflow-y:auto}
  #gate .gwrap{width:100%;max-width:392px;margin:auto}
  #gate .glock{text-align:center;margin:0 0 22px}
  #gate .glock .eb{font-family:"Archivo",system-ui,sans-serif;font-size:10.5px;font-weight:700;
    letter-spacing:.15em;text-transform:uppercase;color:var(--navy-2)}
  #gate .glock .nm{font-family:"Archivo",system-ui,sans-serif;font-size:27px;font-weight:700;
    letter-spacing:-.02em;color:var(--navy);line-height:1.15;margin-top:3px}
  #gate .glock .sb{font-size:13px;color:var(--muted);margin-top:5px}
  #gate .gcard{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:26px 24px;
    box-shadow:0 1px 2px rgba(1,11,36,.05),0 18px 48px rgba(1,11,36,.10);
    font-family:"IBM Plex Sans",system-ui,sans-serif}
  #gate h1{font-family:"Archivo",system-ui,sans-serif;font-size:18px;margin:0 0 4px;color:var(--navy)}
  #gate p{margin:0 0 20px;font-size:13px;color:var(--navy-2);line-height:1.55}
  #gate label{display:block;font-family:"Archivo",system-ui,sans-serif;font-size:10.5px;font-weight:600;
    letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
  #gate input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:10px;
    font:16px/1.4 "IBM Plex Sans",system-ui,sans-serif;margin:0 0 15px;background:#fff;color:var(--navy);min-height:46px}
  #gate input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
  #gate button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--teal);color:#fff;font-weight:600;
    font-size:15px;cursor:pointer;font-family:"Archivo",system-ui,sans-serif;min-height:48px}
  #gate button:hover{background:var(--teal-hover)}
  #gate button:disabled{opacity:.6;cursor:default}
  #gate button:focus-visible,#gate input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
  #gate .err{font-size:12.5px;color:var(--red);margin:12px 0 0;line-height:1.5;display:none}
  #gate .err.on{display:block}
  #gate .gfoot{text-align:center;font-size:11.5px;color:var(--muted);margin:16px 0 0}

  /* ---- account: inline in the header on desktop, inside .acct on mobile ---- */
  #whoami{display:none;align-items:center;gap:8px;font:12px "IBM Plex Sans",system-ui,sans-serif;color:var(--navy-2)}
  #whoami .site{display:inline-flex;align-items:center;background:var(--paper);border:1px solid var(--line);
    border-radius:8px;padding:0 4px 0 10px;min-height:34px;max-width:200px}
  #whoami select{border:0;background:transparent;font:600 12.5px "IBM Plex Sans",system-ui,sans-serif;
    color:var(--navy);max-width:170px;cursor:pointer;min-height:32px}
  #whoami select:focus{outline:none}
  #whoami button{border:1px solid var(--line);background:var(--paper);color:var(--navy-2);border-radius:8px;
    padding:0 12px;min-height:34px;font-size:12.5px;font-weight:600;cursor:pointer;
    font-family:"Archivo",system-ui,sans-serif}
  #whoami button:hover{color:var(--teal);border-color:var(--teal);background:var(--teal-soft)}
  #whoami .people{background:var(--teal-soft);border-color:transparent;color:#0B4F4A}
  #whoami .role{font-family:"Archivo",system-ui,sans-serif;font-size:10px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--muted);font-weight:700;background:var(--cream);
    border:1px solid var(--line);border-radius:99px;padding:3px 9px}
  /* A viewer can read the board and the report, nothing else. The database
     refuses their writes regardless — this just stops them being offered. */
  body.role-viewer #addBtn, body.role-viewer #fabAdd, body.role-viewer [data-add="1"],
  body.role-viewer #dSave, body.role-viewer #dDelete, body.role-viewer #dApprove,
  body.role-viewer #importPlan, body.role-viewer #editInv, body.role-viewer #addPerson,
  body.role-viewer #addMeeting, body.role-viewer #xAdd{display:none!important}

  @media (max-width:1180px) and (min-width:701px){ #whoami .role{display:none} }
  @media (max-width:700px){
    /* inside the avatar sheet: full-width rows, nothing floating over content */
    #whoami{flex-direction:column;align-items:stretch;gap:6px;width:100%}
    #whoami .site,#whoami select{max-width:none;width:100%}
    #whoami .site{min-height:42px}
    #whoami button{min-height:42px;text-align:left}
    #whoami .role{display:none}   /* the sheet header already states the role */
  }
</style>
<div id="gate" hidden><div class="gwrap">
  <div class="glock">
    <div class="eb">RMM Builders Ltd</div>
    <div class="nm">Build Board</div>
    <div class="sb">Secure project workspace</div>
  </div>
  <div class="gcard">
  <h1>Sign in</h1>
  <p>Use the account your admin created for you.</p>
  <form id="gateForm">
    <label for="gEmail">Email</label>
    <input id="gEmail" type="email" autocomplete="username" required>
    <label for="gPass">Password</label>
    <input id="gPass" type="password" autocomplete="current-password" required>
    <button type="submit" id="gBtn">Sign in</button>
    <p class="err" id="gErr"></p>
  </form>
  </div>
  <p class="gfoot">Access is by invitation only.</p>
</div></div>
"""
app = d.index("<script>\n")
d = d[:app] + head + d[app:]

old = """    try { db = await window.claude.use("db"); } catch (e) { db = null; }
    try { downloads = await window.claude.use("downloads"); } catch (e) { downloads = null; }
    try { sampler = await window.claude.use("sample"); } catch (e) { sampler = null; }"""
new = """    try { db = await PB.connect(); } catch (e) { db = null; }
    downloads = PB.downloads;
    sampler = PB.sampler;
    // the signed-in account IS the identity: no more picking your own name
    if (db) {
      var mine = PB.me();
      if (mine) { state.me = mine; try { localStorage.setItem("rmm-board-me", mine); } catch (err) {} }
      document.body.classList.add("authed");
      if (!PB.isAdmin()) document.body.classList.add("member-only");
    }"""
assert d.count(old) == 1, "capability block not found"
d = d.replace(old, new)

boot = """
/* ================= sign-in gate ================= */
(function () {
  var gate = document.getElementById("gate");
  // the account controls live in the header cluster: inline on desktop, and
  // inside the avatar sheet on mobile. Never floating over the content.
  var slot = document.getElementById("acctSlot");
  var bar  = document.createElement("div");
  bar.id = "whoami";
  if (slot) slot.appendChild(bar); else document.body.appendChild(bar);
  if (!PB.client()) { gate.parentNode.removeChild(gate); return; }  // unconfigured: local mode

  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, ""); }

  function chrome() {
    var cur = PB.siteId(), list = PB.sites();
    var siteName = esc((PB.siteRecord() || {}).name || "");
    var opts = list.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === cur ? " selected" : "") + ">" +
             esc(s.name || s.id) + "</option>";
    }).join("");

    // who you are, stated once, at the top of the mobile sheet
    var idBlock = document.getElementById("acctWho");
    if (!idBlock) {
      idBlock = document.createElement("div");
      idBlock.id = "acctWho"; idBlock.className = "acct-id";
      var host = document.getElementById("acct");
      if (host) host.insertBefore(idBlock, host.firstChild);
    }
    var role = esc(PB.role() || "");
    idBlock.innerHTML = '<span class="nm">' + esc(PB.name() || "Signed in") + "</span>" +
                        '<span class="mt">' + (role ? role.charAt(0).toUpperCase() + role.slice(1) : "") +
                        (siteName ? " &middot; " + siteName : "") + "</span>";

    bar.innerHTML = (list.length > 1
                      ? '<span class="site"><select id="siteSel" aria-label="Project">' + opts + "</select></span>"
                      : '<span class="site"><span>' + siteName + "</span></span>") +
                    '<span class="role">' + esc(PB.role() || "") + "</span>" +
                    (PB.isAdmin() ? '<button type="button" class="people" id="people">Manage people</button>' : "") +
                    '<button type="button" id="signOut" title="' + esc(PB.name() || "") + '">Sign out</button>';
    bar.style.display = "flex";
    var sel = document.getElementById("siteSel");
    if (sel) sel.onchange = function () { PB.useSite(this.value); };
    document.getElementById("signOut").onclick = function () { PB.logout(); };
    var pb2 = document.getElementById("people");
    if (pb2) pb2.onclick = function () { ACCESS.open(); };
    document.body.classList.add("role-" + PB.role());
  }

  // the invited person has no account yet: let them make one with the token
  function openSignup() {
    gate.hidden = false;
    var card = gate.querySelector(".gcard");
    card.innerHTML =
      '<h1>Create your account</h1>' +
      '<p>You have been invited to the board. Use the email address the invitation was sent to.</p>' +
      '<form id="suForm">' +
        '<label for="suEmail">Email</label>' +
        '<input id="suEmail" type="email" autocomplete="username" required>' +
        '<label for="suPass">Choose a password</label>' +
        '<input id="suPass" type="password" autocomplete="new-password" minlength="8" required>' +
        '<button type="submit" id="suBtn">Create account</button>' +
        '<p class="err" id="suErr"></p>' +
      '</form>';
    var f = document.getElementById("suForm"),
        e2 = document.getElementById("suErr"),
        b2 = document.getElementById("suBtn");
    f.onsubmit = function (ev) {
      ev.preventDefault();
      b2.disabled = true; b2.textContent = "Creating…"; e2.classList.remove("on");
      PB.signUpWithInvite(document.getElementById("suEmail").value,
                          document.getElementById("suPass").value, token)
        .then(function () { location.hash = ""; location.reload(); })
        .catch(function (err) {
          b2.disabled = false; b2.textContent = "Create account";
          var m = (err && err.message) || "";
          e2.textContent =
            m === "NEEDS_CONFIRM" ? "Account created. Check your email to confirm it, then sign in." :
            /invitation only|not valid/i.test(m) ? m :
            /already registered/i.test(m) ? "That email already has an account — sign in instead, then open this link again." :
            /password/i.test(m) ? "Pick a password of at least 8 characters." :
            "Couldn't create the account. Ask your admin for a fresh invite link.";
          e2.classList.add("on");
        });
    };
  }

  function openGate(msg) {
    gate.hidden = false;
    var err = document.getElementById("gErr");
    if (msg) { err.textContent = msg; err.classList.add("on"); }
  }

  var token = (location.hash.match(/invite=([0-9a-f-]{36})/i) || [])[1] || "";

  // pasting an invite link into a tab that is already open only changes the
  // hash, so nothing would happen without this
  window.addEventListener("hashchange", function () {
    if (/invite=[0-9a-f-]{36}/i.test(location.hash)) location.reload();
  });

  PB.ready().then(function (r) {
    if (r.ok && token) {
      // already signed in, opening a link for another project
      return PB.acceptInvite(token)
        .then(function () { location.hash = ""; location.reload(); })
        .catch(function (e) { chrome(); alert(e.message || "That invitation is not valid any more."); });
    }
    if (token && !r.ok) return openSignup();
    if (r.ok) return chrome();
    if (r.reason === "profile")
      return openGate("Signed in, but this account isn't on a project yet — ask your admin to add you.");
    openGate("");
  });

  var form = document.getElementById("gateForm"),
      err  = document.getElementById("gErr"),
      btn  = document.getElementById("gBtn");
  form.onsubmit = function (ev) {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = "Signing in…"; err.classList.remove("on");
    PB.login(document.getElementById("gEmail").value.trim(),
             document.getElementById("gPass").value)
      .then(function () { location.reload(); })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = "Sign in";
        var m = (e && (e.message || e.error_description)) || "";
        err.textContent = /member of any site/.test(m)
          ? "That account isn't on a project yet — ask your admin to add you."
          : (/fetch|network|Failed/i.test(m) ? "Can't reach the server. Check your connection and try again."
                                             : "Wrong email or password.");
        err.classList.add("on");
      });
  };
})();
"""
tail = d.rindex("</script>")
d = d[:tail] + boot + d[tail:]

# never render-block on a third party
d = re.sub(
    r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com[^"]+)">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="\\1" media="print" onload="this.media=\'all\'">\n'
    '<noscript><link rel="stylesheet" href="\\1"></noscript>',
    d, count=1)

d = ('<!doctype html>\n<html lang="en">\n<head>\n'
     '<meta charset="utf-8">\n'
     '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
     '<meta name="robots" content="noindex,nofollow">\n'
     '<meta name="color-scheme" content="light">\n'
     '<link rel="icon" href="data:image/svg+xml,'
     "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
     "%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%B1%3C/text%3E%3C/svg%3E\">\n"
     '</head>\n<body>\n') + d + "\n</body>\n</html>\n"

OUT.write_text(d, encoding="utf-8")
print("built", OUT, len(d), "bytes")
