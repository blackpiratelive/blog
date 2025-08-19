import { createClient } from "@libsql/client";
import crypto from "crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

const sessions = new Set();

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");

  // Parse body for API-like POSTs
  const body = await new Promise((resolve) => {
    if (req.method !== "POST") return resolve({});
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      resolve(Object.fromEntries(new URLSearchParams(data)));
    });
  });

  // Cookie-based session
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((c) => c.trim().split("="))
  );
  const sessionToken = cookies.session || null;
  let authenticated = sessionToken && sessions.has(sessionToken);

  // --- Handle login ---
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

  // API-like routes for JS fetch
  if (authenticated && req.method === "POST" && body.api) {
    switch (body.api) {
      case "approve":
        await db.execute("UPDATE comments SET approved = 1 WHERE id = ?", [body.id]);
        return res.end("ok");
      case "delete":
        await db.execute("DELETE FROM comments WHERE id = ?", [body.id]);
        return res.end("ok");
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
        return res.end("ok");
    }
  }

  // --- Show login form if not authenticated ---
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

  // --- Authenticated: Dashboard view ---
  const rs = await db.execute(
    "SELECT id, slug, name, email, website, message, created_at, approved, parent_id FROM comments ORDER BY created_at DESC"
  );

  // Separate top-level and replies
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
            </div>
          `
        )
        .join("");

      return `
        <tr>
          <td>${c.id}</td>
          <td>${c.slug}</td>
          <td>${c.name}</td>
          <td>${c.email || ""}</td>
          <td>${c.website || ""}</td>
          <td>${c.message}</td>
          <td>${c.created_at}</td>
          <td class="${c.approved ? "approved" : "pending"}">${c.approved ? "Approved" : "Pending"}</td>
          <td>
            ${
              !c.approved
                ? `<button onclick="action('approve', ${c.id})" class="btn-approve">Approve</button>`
                : ""
            }
            <button onclick="action('delete', ${c.id})" class="btn-delete">Delete</button>
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
      body { font-family:sans-serif; padding:2rem; background:#fafafa; }
      table { width:100%; border-collapse:collapse; background:white; }
      th,td { padding:0.75rem; border-bottom:1px solid #ddd; }
      th { background:#eee; }
      .btn-approve { background:#2ecc71; color:white; }
      .btn-delete { background:#e74c3c; color:white; }
      .btn-reply { background:#f39c12; color:white; }
      .btn-toggle { background:#0070f3; color:white; margin-top:0.5rem; }
      button { padding:0.3rem 0.6rem; border:none; border-radius:4px; cursor:pointer; margin:2px; }
      .approved { color:#2ecc71; font-weight:bold; }
      .pending { color:#e67e22; font-weight:bold; }
      .reply-box { margin-top:0.5rem; }
      .reply { margin-left:1rem; padding:0.3rem; background:#f9f9f9; border-left:2px solid #ddd; }
    </style>

    <h2>Comments Dashboard</h2>
    <button onclick="action('redeploy')" class="btn-toggle">🔄 Redeploy Site</button>
    <button onclick="action('logout')" class="btn-delete">Logout</button>

    <table>
      <tr><th>ID</th><th>Slug</th><th>Name</th><th>Email</th><th>Website</th><th>Message</th><th>Created</th><th>Status</th><th>Actions</th></tr>
      ${rows}
    </table>

    <script>
      async function action(type, id) {
        const data = new URLSearchParams({ api:type, id });
        const res = await fetch('', { method:'POST', body:data });
        if (res.ok) location.reload();
      }
      async function sendReply(id) {
        const msg = document.getElementById('reply-msg-'+id).value;
        if (!msg) return;
        const data = new URLSearchParams({ api:'reply', id, message:msg });
        const res = await fetch('', { method:'POST', body:data });
        if (res.ok) location.reload();
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
    </script>
  `);
}
