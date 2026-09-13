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
  body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F2F4F5;color:#14181B}
  img{max-width:100%}
  [hidden]{display:none!important}
  *,*::before,*::after{box-sizing:border-box}
</style>
<script src="supabase.js"></script>
<script src="config.js"></script>
<script src="sb-adapter.js"></script>
<script src="access.js"></script>
<style>
  #gate{position:fixed;inset:0;z-index:9999;background:#F2F4F5;display:flex;align-items:center;justify-content:center;padding:24px}
  #gate .gcard{background:#fff;border:1px solid #D6DCDF;border-radius:12px;padding:28px;width:100%;max-width:360px;
    box-shadow:0 1px 2px rgba(20,24,27,.06),0 6px 18px rgba(20,24,27,.05);font-family:"IBM Plex Sans",system-ui,sans-serif}
  #gate h1{font-family:"Archivo",system-ui,sans-serif;font-size:19px;margin:0 0 4px;color:#14181B}
  #gate p{margin:0 0 20px;font-size:13px;color:#5A6469;line-height:1.5}
  #gate label{display:block;font-size:12px;font-weight:600;color:#5A6469;margin:0 0 5px}
  #gate input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #D6DCDF;border-radius:8px;
    font:14px/1.4 "IBM Plex Sans",system-ui,sans-serif;margin:0 0 14px;background:#fff;color:#14181B}
  #gate input:focus{outline:none;border-color:#12615E;box-shadow:0 0 0 3px #DCEBEA}
  #gate button{width:100%;padding:11px;border:0;border-radius:8px;background:#12615E;color:#fff;font-weight:600;
    font-size:14px;cursor:pointer;font-family:"IBM Plex Sans",system-ui,sans-serif}
  #gate button:disabled{opacity:.6;cursor:default}
  #gate .err{font-size:12.5px;color:#B5342B;margin:12px 0 0;line-height:1.5;display:none}
  #gate .err.on{display:block}
  #whoami{position:fixed;left:12px;bottom:12px;z-index:600;display:none;align-items:center;gap:8px;background:#fff;
    border:1px solid #D6DCDF;border-radius:999px;padding:5px 6px 5px 12px;font:12px "IBM Plex Sans",system-ui,sans-serif;
    color:#5A6469;box-shadow:0 1px 2px rgba(20,24,27,.06),0 6px 18px rgba(20,24,27,.05)}
  #whoami select{border:0;background:transparent;font:600 12px "IBM Plex Sans",system-ui,sans-serif;color:#14181B;
    max-width:150px;cursor:pointer}
  #whoami select:focus{outline:none}
  #whoami button{border:0;background:#E9ECEE;color:#5A6469;border-radius:999px;padding:5px 11px;font-size:12px;
    font-weight:600;cursor:pointer;font-family:inherit}
  body.authed{padding-bottom:56px}
  #whoami .people{background:#DCEBEA;color:#0F4F4C}
  #whoami .role{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8A9399;font-weight:700}
  /* A viewer can read the board and the report, nothing else. The database
     refuses their writes regardless — this just stops them being offered. */
  body.role-viewer #addBtn, body.role-viewer #fabAdd, body.role-viewer [data-add="1"],
  body.role-viewer #dSave, body.role-viewer #dDelete, body.role-viewer #dApprove,
  body.role-viewer #importPlan, body.role-viewer #editInv, body.role-viewer #addPerson,
  body.role-viewer #addMeeting, body.role-viewer #xAdd{display:none!important}
  @media (max-width:760px){ #whoami{left:10px;bottom:10px;padding:4px 5px 4px 10px} #whoami select{max-width:96px} }
</style>
<div id="gate" hidden><div class="gcard">
  <h1>RMM Build Board</h1>
  <p>Sign in with the account your admin created for you.</p>
  <form id="gateForm">
    <label for="gEmail">Email</label>
    <input id="gEmail" type="email" autocomplete="username" required>
    <label for="gPass">Password</label>
    <input id="gPass" type="password" autocomplete="current-password" required>
    <button type="submit" id="gBtn">Sign in</button>
    <p class="err" id="gErr"></p>
  </form>
</div></div>
<div id="whoami"></div>
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
  var bar  = document.getElementById("whoami");
  if (!PB.client()) { gate.parentNode.removeChild(gate); return; }  // unconfigured: local mode

  function chrome() {
    var cur = PB.siteId(), list = PB.sites();
    var opts = list.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === cur ? " selected" : "") + ">" +
             String(s.name || s.id).replace(/[<>&]/g, "") + "</option>";
    }).join("");
    bar.innerHTML = (list.length > 1 ? '<select id="siteSel">' + opts + "</select>"
                                     : "<span>" + String((PB.siteRecord() || {}).name || "") + "</span>") +
                    '<span class="role">' + String(PB.role() || "") + "</span>" +
                    (PB.isAdmin() ? '<button type="button" class="people" id="people">People</button>' : "") +
                    '<button type="button" id="signOut" title="' + String(PB.name() || "") + '">Sign out</button>';
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
