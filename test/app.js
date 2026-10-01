/*
 * Fake CMS — test subject for Testeria E2E.
 * Features chosen to exercise every recorder/replayer path:
 *   - plain login form (username/password → exercises masked password prompt)
 *   - delayed-render SPA view (2.5s skeleton → exercises element wait/polling)
 *   - select, checkbox, buttons, client-side redirect (/redirect→/inbox)
 *   - multi-page form flow (/login → GET /inbox)
 */
(function () {
  "use strict";
  const http = require("http");

  function page(title, bodyHtml) {
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      title +
      "</title><style>" +
      "body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#222}" +
      "header{background:#1f2937;color:#fff;padding:14px 22px;display:flex;justify-content:space-between;align-items:center}" +
      "main{max-width:640px;margin:40px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}" +
      "label{display:block;margin:12px 0 4px;font-weight:600;font-size:13px}" +
      "input,select{width:100%;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;box-sizing:border-box}" +
      "button{margin-top:16px;background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer}" +
      "button.secondary{background:#64748b}" +
      ".err{color:#dc2626;font-size:13px;min-height:18px;margin-top:10px}" +
      ".row{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:14px}" +
      ".skel{height:14px;border-radius:6px;background:#e2e8f0;margin:10px 0;animation:pulse 1.1s ease-in-out infinite}" +
      "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}" +
      ".task{padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0;display:flex;justify-content:space-between}" +
      ".badge{background:#eef2ff;color:#4338ca;border-radius:999px;padding:2px 10px;font-size:12px}" +
      "a{color:#4f46e5}" +
      "</style></head><body>" +
      bodyHtml +
      "</body></html>"
    );
  }

  function header() {
    return "<header><strong>🗒 TaskDesk CMS</strong><span id='who'></span></header>";
  }

  // ---- SPA shell (login + dashboard live under one document) ----
  const SPA = page(
    "TaskDesk",
    header() +
      "<main id='app'>" +
      "<h1>Sign in</h1>" +
      "<label for='username'>Username</label><input id='username' autocomplete='off'>" +
      "<label for='password'>Password</label><input id='password' type='password'>" +
      "<label for='project'>Project</label><select id='project'>" +
      "<option value='alpha'>Alpha</option><option value='beta'>Beta</option><option value='gamma'>Gamma</option>" +
      "</select>" +
      "<div class='row'><input type='checkbox' id='remember' style='width:auto'><label for='remember' style='margin:0'>Remember me</label></div>" +
      "<button id='login-btn'>Sign in</button><div class='err' id='err'></div>" +
      "</main>" +
      "<script>" +
      "(function(){" +
      "function h(s){return String(s).replace(/[&<>\\\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;'}[c];});}" +
      "function route(render,href){if(location.pathname!==href){try{history.pushState({},'',href);}catch(e){}}render();}" +
      "function showLogin(){document.getElementById('who').textContent='';" +
      "document.getElementById('app').innerHTML=\"<h1>Sign in</h1>\"+" +
      "\"<label for='username'>Username</label><input id='username' autocomplete='off'>\"+" +
      "\"<label for='password'>Password</label><input id='password' type='password'>\"+" +
      "\"<label for='project'>Project</label><select id='project'><option value='alpha'>Alpha</option><option value='beta'>Beta</option><option value='gamma'>Gamma</option></select>\"+" +
      "\"<div class='row'><input type='checkbox' id='remember' style='width:auto'><label for='remember' style='margin:0'>Remember me</label></div>\"+" +
      "\"<button id='login-btn'>Sign in</button><div class='err' id='err'></div>\";" +
      "bindLogin();}" +
      "function bindLogin(){var b=document.getElementById('login-btn');if(!b)return;" +
      "b.addEventListener('click',function(){" +
      "var u=document.getElementById('username').value;var p=document.getElementById('password').value;" +
      "if(p==='secret123'){sessionStorage.setItem('td-user',u||'admin');" +
      "sessionStorage.setItem('td-project',document.getElementById('project').value);" +
      "if(document.getElementById('remember').checked)sessionStorage.setItem('td-remember','1');" +
      "setTimeout(function(){route(showDashboard,'/dashboard');},350);}" +
      "else{document.getElementById('err').textContent='Wrong password (hint: secret123)';}});}" +
      "function showDashboard(){document.getElementById('who').textContent='admin';" +
      "var app=document.getElementById('app');" +
      "app.innerHTML='<h1>Dashboard</h1><div class=skel></div><div class=skel></div><div class=skel></div>';" +
      "setTimeout(function(){" + // delayed render → replayer must poll & wait
      "app.innerHTML='<h1>Dashboard</h1><p id=welcome>Welcome back, admin. Project: '+h(sessionStorage.getItem('td-project')||'—')+'</p>'+" +
      "\"<div class='task'><span>Fix login regression</span><span class='badge'>open</span></div>\"+" +
      "\"<div class='task'><span>Write release notes</span><span class='badge'>open</span></div>\"+" +
      "\"<label for='filter'>Filter</label><select id='filter'><option value='all'>All</option><option value='open'>Open</option><option value='done'>Done</option></select>\"+" +
      "\"<div class='row'><input type='checkbox' id='notify' style='width:auto'><label for='notify' style='margin:0'>Email me updates</label></div>\"+" +
      "\"<button id='refresh-btn'>Refresh</button> <button id='new-btn' class='secondary'>New task</button>\"+" +
      "\"<button id='logout-btn' class='secondary' style='margin-left:8px'>Log out</button>\";" +
      "document.getElementById('refresh-btn').addEventListener('click',function(){var t=document.querySelector('.task');if(t)t.style.outline='2px solid #4f46e5';});" +
      "document.getElementById('new-btn').addEventListener('click',function(){route(showNew,'/tasks/new');});" +
      "document.getElementById('logout-btn').addEventListener('click',function(){sessionStorage.clear();route(showLogin,'/');});},2500);}" +
      "function showNew(){document.getElementById('who').textContent='admin';" +
      "document.getElementById('app').innerHTML='<h1>New task</h1>'+" +
      "\"<label for='title'>Title</label><input id='title' placeholder='Task title'>\"+" +
      "\"<button id='create-btn'>Create</button> <button id='back-btn' class='secondary'>Back</button>\";" +
      "document.getElementById('create-btn').addEventListener('click',function(){" +
      "var t=document.getElementById('title').value;" +
      "setTimeout(function(){route(function(){showDashboard2('Task created: '+t);},'/dashboard');},300);});" +
      "document.getElementById('back-btn').addEventListener('click',function(){route(showDashboard,'/dashboard');});}" +
      "function showDashboard2(msg){document.getElementById('who').textContent='admin';" +
      "var app=document.getElementById('app');" +
      "app.innerHTML='<h1>Dashboard</h1><div class=skel></div><div class=skel></div>';" +
      "setTimeout(function(){app.innerHTML='<p id=created>'+h(msg)+'</p>'+" +
      "'<button id=logout-btn class=secondary>Log out</button>';" +
      "document.getElementById('logout-btn').addEventListener('click',function(){sessionStorage.clear();route(showLogin,'/');});},1200);}" +
      "window.addEventListener('popstate',function(){if(location.pathname==='/')showLogin();else if(location.pathname==='/tasks/new')showNew();else showDashboard();});" +
      "if(location.pathname==='/dashboard')showDashboard();else if(location.pathname==='/tasks/new')showNew();else bindLogin();})();" +
      "</script>"
  );

  // ---- Multi-page login (form GET → /inbox) with delayed-render inbox ----
  const LOGIN_MP = page(
    "Sign in — Acme Mail",
    header() +
      "<main><h1>Acme Mail</h1>" +
      "<form action='/inbox' method='GET'>" +
      "<label for='user'>Email</label><input id='user' name='user' autocomplete='off'>" +
      "<label for='pass'>Password</label><input id='pass' name='pass' type='password'>" +
      "<button type='submit' id='go'>Continue</button>" +
      "</form></main>"
  );

  const INBOX = page(
    "Inbox — Acme Mail",
    header() +
      "<main><h1>Inbox</h1><div id='wait' class='skel'></div><div class='skel'></div>" +
      "<div id='ready' style='display:none'>" +
      "<p>3 messages awaiting triage.</p>" +
      "<div class='task'><span>Invoice #4821 overdue</span><span class='badge'>finance</span></div>" +
      "<div class='task'><span>Interview slot confirmed</span><span class='badge'>hr</span></div>" +
      "<div class='task'><span>Server certificate expiring</span><span class='badge'>ops</span></div>" +
      "<label for='folder'>Folder</label><select id='folder'><option>inbox</option><option>archive</option><option>spam</option></select>" +
      "<button id='triage'>Mark all triaged</button>" +
      "<button id='back' class='secondary'>Back to login</button>" +
      "</div></main>" +
      "<script>setTimeout(function(){document.getElementById('wait').style.display='none';" +
      "document.querySelectorAll('.skel').forEach(function(s){s.style.display='none';});" +
      "document.getElementById('ready').style.display='block';},2000);" +
      "document.getElementById('triage').addEventListener('click',function(){this.textContent='All triaged ✓';});" +
      "document.getElementById('back').addEventListener('click',function(){location.href='/login';});</script>"
  );

  // ---- Client redirect page (replay-start race target) ----
  const REDIRECT = page(
    "Signing in…",
    header() +
      "<main><h1>Signing in…</h1><p id='count'>You will be redirected shortly.</p></main>" +
      "<script>setTimeout(function(){location.replace('/inbox');},900);</script>"
  );

  // ---- Slow-render page (element appears at 2.5s incl. a button) ----
  const SLOW = page(
    "Slow page",
    header() +
      "<main><h1>Slow loading page</h1><p id='later'>loading…</p></main>" +
      "<script>setTimeout(function(){document.getElementById('later').textContent='Finally loaded';" +
      "var b=document.createElement('button');b.id='slow-btn';b.textContent='Do thing';" +
      "b.addEventListener('click',function(){b.textContent='Thing done';});" +
      "document.querySelector('main').appendChild(b);},2500);</script>"
  );

  // ---- Halaman yang me-RELOAD dirinya sendiri 1,2 dtk setelah aksi ----
  // Target uji guard reload di tengah replay: step dikirim → dokumen mati →
  // dokumen baru PAGE_READY → replay TIDAK boleh melanjutkan buta (mengulang
  // aksi di halaman yang sudah di-reset). View kedua muncul setelah reload;
  // tombol pemicu reload jadi no-op di view kedua (idempoten, seperti
  // guard double-submit form sungguhan).

  const RELOAD_NUDGE = page(
    "Reload probe",
    header() +
      "<main><h1>Reload probe</h1>" +
      "<p id='st0'>first view</p>" +
      "<p id='st2' style='display:none'>second view</p>" +
      "<button id='reload-me'>Lanjut (reload dulu)</button> " +
      "<button id='after-reload' style='display:none'>Aksi setelah reload</button>" +
      "</main>" +
      "<script>(function(){" +
      "var visited=sessionStorage.getItem('rn-visited');" +
      "var rb=document.getElementById('reload-me');" +
      "if(visited){" +
      "document.getElementById('st0').style.display='none';" +
      "document.getElementById('st2').style.display='';" +
      "document.getElementById('after-reload').style.display='';" +
      "rb.textContent='Sudah (no-op)';" +
      "rb.addEventListener('click',function(){});" +
      "}else{" +
      "rb.addEventListener('click',function(){" +
      "sessionStorage.setItem('rn-visited','1');" +
      "setTimeout(function(){location.reload();},1200);" +
      "});" +
      "}" +
      "document.getElementById('after-reload').addEventListener('click',function(){this.textContent='OK';});" +
      "})()</script>"
  );

  function handlerFor(url) {
    // SPA shell untuk semua route client-side (real SPAs serve the shell on
    // deep links — tanpa ini replay yang navigate langsung ke /dashboard 404).
    if (url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/tasks/new") return SPA;
    if (url.pathname === "/login") return LOGIN_MP;
    if (url.pathname === "/inbox") return INBOX;
    if (url.pathname === "/redirect") return REDIRECT;
    if (url.pathname === "/slow") return SLOW;
    if (url.pathname === "/reload-probe") return RELOAD_NUDGE;
    return page("404", "<main><h1>404</h1><a href='/'>home</a></main>");
  }

  const handler = function (req, res) {
    var url = new URL(req.url, "http://localhost");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(handlerFor(url));
  };

  module.exports = { handler: handler };

  if (require.main === module) {
    const port = Number(process.env.PORT) || 8899;
    http.createServer(handler).listen(port, "127.0.0.1", function () {
      console.log("fake CMS listening on http://localhost:" + port);
    });
  }
})();
