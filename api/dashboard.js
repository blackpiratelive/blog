import { createClient } from "@libsql/client";
import crypto from "crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

const sessions = new Set();
const rateLimits = new Map(); // IP-based rate limiting

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");

  // Rate limit check
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const now = Date.now();
  if (rateLimits.has(ip) && now - rateLimits.get(ip) < 2000) {
    res.statusCode = 429;
    return res.end("Too many requests. Slow down!");
  }
  rateLimits.set(ip, now);

  // Parse body
  const body = await new Promise((resolve) => {
    if (req.method !== "POST") return resolve({});
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(data))));
  });

  // Cookie sessions
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((c) => c.trim().split("="))
  );
  const sessionToken = cookies.session || null;
  let authenticated = sessionToken && sessions.has(sessionToken);

  // --- Login ---
  if (req.method === "POST" && body.action === "login") {
    if (body.password === process.env.ADMIN_PASSWORD) {
      const token = crypto.randomBytes(32).toString("hex");
      sessions.add(token);
      authenticated = true;
      res.setHeader(
        "Set-Cookie",
        `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`
      );
    } else {
      return res.end("<h2>Invalid password</h2><a href='/api/dashboard'>Try again</a>");
    }
  }

  // API endpoints
  if (authenticated && req.method === "POST" && body.api) {
    switch (body.api) {
      case "approve":
        await db.execute("UPDATE comments SET approved = 1 WHERE id = ?", [body.id]);
        return res.end("ok");

      case "delete":
        await db.execute("UPDATE comments SET deleted = 1 WHERE id = ?", [body.id]);
        return res.end("deleted-soft");

      case "undo":
        await db.execute("UPDATE comments SET deleted = 0 WHERE id = ?", [body.id]);
        return res.end("undo-ok");

      case "reply":
        const parent = await db.execute("SELECT slug FROM comments WHERE id = ?", [body.id]);
        if (parent.rows.length > 0) {
          const slug = parent.rows[0].slug;
          await db.execute({
            sql: `INSERT INTO comments (slug, name, message, website, approved, parent_id)
                  VALUES (?, 'Sudip', ?, 'blackpiratex.com', 1, ?)`,
            args: [slug, body.message, body.id],
          });
        }
        return res.end("ok");

      case "redeploy":
        await fetch(process.env.VERCEL_DEPLOY_HOOK_URL, { method: "POST" });
        return res.end("redeploy-ok");

      case "logout":
        sessions.delete(sessionToken);
        res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
        return res.end("logout-ok");

      case "export":
        const all = await db.execute("SELECT * FROM comments ORDER BY created_at ASC");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", "attachment; filename=comments-export.json");
        return res.end(JSON.stringify(all.rows, null, 2));
    }
  }

  // --- Login screen ---
  if (!authenticated) {
    return res.end(`
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background:#f5f5f5; }
        .login-box { background:white; padding:2rem; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.2); }
      </style>
      <div class="login-box">
        <h2>Admin Login</h2>
        <form method="POST">
          <input type="hidden" name="action" value="login">
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    `);
  }

  // --- Dashboard data ---
  const page = parseInt(body.page || req.query.page || 1);
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const search = body.search || req.query.search || "";
  const statusFilter = body.status || req.query.status || "all";

  let where = "WHERE deleted=0";
  const args = [];

  if (search) {
    where += " AND (slug LIKE ? OR name LIKE ? OR message LIKE ?)";
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (statusFilter === "approved") where += " AND approved=1";
  if (statusFilter === "pending") where += " AND approved=0";

  const rs = await db.execute({
    sql: `SELECT * FROM comments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset],
  });

  const totalRs = await db.execute({
    sql: `SELECT COUNT(*) as total FROM comments ${where}`,
    args,
  });
  const total = totalRs.rows[0].total;
  const pages = Math.ceil(total / perPage);

  const comments = rs.rows.filter((c) => !c.parent_id);
  const replies = rs.rows.filter((c) => c.parent_id);

  const rows = comments
    .map((c) => {
      const childReplies = replies.filter((r) => r.parent_id === c.id);
      const replyRows = childReplies
        .map(
          (r) => `
            <div class="reply">
              <strong>${r.name}</strong>: ${r.message} <small>(${r.created_at})</small>
              <button onclick="doAction('delete', ${r.id})" class="btn-delete">Delete</button>
            </div>
          `
        )
        .join("");

      return `
        <tr>
          <td>${c.id}</td>
          <td>${c.slug}</td>
          <td>${c.name}</td>
          <td>${c.message}</td>
          <td>${c.created_at}</td>
          <td class="${c.approved ? "approved" : "pending"}">${c.approved ? "Approved" : "Pending"}</td>
          <td>
            ${!c.approved ? `<button onclick="doAction('approve', ${c.id})" class="btn-approve">Approve</button>` : ""}
            <button onclick="doAction('delete', ${c.id})" class="btn-delete">Delete</button>
            <button onclick="toggleReplyBox(${c.id})" class="btn-reply">Reply</button>
            <div id="reply-box-${c.id}" class="reply-box" style="display:none;">
              <input type="text" id="reply-msg-${c.id}" placeholder="Type reply...">
              <button onclick="sendReply(${c.id})">Send</button>
            </div>
            ${
              replyRows
                ? `<button onclick="toggleReplies(${c.id})" class="btn-toggle">Show Replies (${childReplies.length})</button>
                   <div id="replies-${c.id}" class="replies" style="display:none;">${replyRows}</div>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");

  return res.end(`
    <style>
      body { font-family:sans-serif; padding:2rem; background:#fafafa; transition:background 0.3s,color 0.3s; }
      body.dark { background:#121212; color:#eee; }
      table { width:100%; border-collapse:collapse; background:white; }
      body.dark table { background:#1e1e1e; color:#eee; }
      th,td { padding:0.75rem; border-bottom:1px solid #ddd; }
      .btn-approve { background:#2ecc71; color:white; }
      .btn-delete { background:#e74c3c; color:white; }
      .btn-reply { background:#f39c12; color:white; }
      .btn-toggle { background:#0070f3; color:white; margin:2px; }
      button { padding:0.3rem 0.6rem; border:none; border-radius:4px; cursor:pointer; }
      .approved { color:#2ecc71; font-weight:bold; }
      .pending { color:#e67e22; font-weight:bold; }
      .reply-box { margin-top:0.5rem; }
      .reply { margin-left:1rem; padding:0.3rem; background:#f9f9f9; border-left:2px solid #ddd; }
      #toast { position:fixed; bottom:20px; right:20px; background:#333; color:white; padding:10px 20px; border-radius:4px; opacity:0; transition:opacity 0.3s; }
      #toast.show { opacity:1; }
    </style>

    <h2>Comments Dashboard</h2>
    <button onclick="doAction('redeploy')" class="btn-toggle">Redeploy Site</button>
    <button onclick="doExport()" class="btn-toggle">Export Comments</button>
    <button onclick="toggleDark()" class="btn-toggle">Toggle Dark Mode</button>
    <button onclick="doAction('logout')" class="btn-delete">Logout</button>

    <form method="GET" style="margin-top:1rem;">
      <input type="text" name="search" placeholder="Search..." value="${search}">
      <select name="status">
        <option value="all" ${statusFilter === "all" ? "selected" : ""}>All</option>
        <option value="approved" ${statusFilter === "approved" ? "selected" : ""}>Approved</option>
        <option value="pending" ${statusFilter === "pending" ? "selected" : ""}>Pending</option>
      </select>
      <button type="submit">Filter</button>
    </form>

    <table>
      <tr><th>ID</th><th>Slug</th><th>Name</th><th>Message</th><th>Created</th><th>Status</th><th>Actions</th></tr>
      ${rows}
    </table>

    <div>
      ${Array.from({ length: pages }, (_, i) => {
        const pageNum = i + 1;
        return `<a href="?page=${pageNum}&search=${search}&status=${statusFilter}" style="margin:5px;${pageNum===page?"font-weight:bold;":""}">${pageNum}</a>`;
      }).join(" ")}
    </div>

    <div id="toast"></div>

    <script>
      function showToast(msg, thenReload=false, thenRedirect=null) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        setTimeout(() => {
          t.classList.remove('show');
          if (thenReload) location.reload();
          if (thenRedirect) location.href = thenRedirect;
        }, 2000);
      }

      async function doAction(type, id) {
        const data = new URLSearchParams({ api:type, id });
        const res = await fetch('', { method:'POST', body:data });
        if (res.ok) {
          const result = await res.text();
          if (type==='logout') return showToast('Logged out', false, '/api/dashboard');
          if (result==='redeploy-ok') return showToast('Redeploy triggered');
          if (result==='deleted-soft') return showToast('Deleted (can undo)', true);
          if (result==='undo-ok') return showToast('Undo successful', true);
          if (type==='approve') return showToast('Approved', true);
        }
      }
      async function sendReply(id) {
        const msg = document.getElementById('reply-msg-'+id).value;
        if (!msg) return;
        const data = new URLSearchParams({ api:'reply', id, message:msg });
        const res = await fetch('', { method:'POST', body:data });
        if (res.ok) showToast('Reply sent', true);
      }
      function toggleReplyBox(id) {
        const el = document.getElementById('reply-box-'+id);
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      }
      function toggleReplies(id) {
        const el = document.getElementById('replies-'+id);
        const btn = event.target;
        if (el.style.display === 'none') {
          el.style.display = 'block';
          btn.textContent = 'Hide Replies';
        } else {
          el.style.display = 'none';
          btn.textContent = 'Show Replies';
        }
      }
      function toggleDark() {
        document.body.classList.toggle('dark');
        localStorage.setItem('dark', document.body.classList.contains('dark'));
      }
      window.onload = () => {
        if(localStorage.getItem('dark') === 'true') document.body.classList.add('dark');
      }
      async function doExport() {
        const res = await fetch('', { method:'POST', body:new URLSearchParams({ api:'export' }) });
        if (res.ok) {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'comments-export.json';
          a.click();
          window.URL.revokeObjectURL(url);
          showToast('Exported');
        }
      }
    </script>
  `);
}