import { createClient } from "@libsql/client";
import crypto from "crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

// In-memory session tokens (reset on cold start)
const sessions = new Set();

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");

  // Parse POST body
  const body = await new Promise((resolve) => {
    if (req.method !== "POST") return resolve({});
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      resolve(Object.fromEntries(new URLSearchParams(data)));
    });
  });

  // Parse cookies
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

  // --- Logout ---
  if (req.method === "POST" && body.action === "logout" && authenticated) {
    sessions.delete(sessionToken);
    res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
    return res.end("<h2>Logged out</h2><a href='/api/dashboard'>Login again</a>");
  }

  // --- Delete ---
  if (req.method === "POST" && body.action === "delete" && authenticated) {
    await db.execute({ sql: "DELETE FROM comments WHERE id = ?", args: [body.id] });
  }

  // --- Approve ---
  if (req.method === "POST" && body.action === "approve" && authenticated) {
    await db.execute({ sql: "UPDATE comments SET approved = 1 WHERE id = ?", args: [body.id] });
  }

  // --- Reply ---
  if (req.method === "POST" && body.action === "reply" && authenticated) {
    const parentId = body.id;
    const message = body.message;
    if (message && parentId) {
      const parent = await db.execute({
        sql: "SELECT slug FROM comments WHERE id = ?",
        args: [parentId],
      });
      if (parent.rows.length > 0) {
        const slug = parent.rows[0].slug;
        await db.execute({
          sql: `INSERT INTO comments (slug, name, message, website, approved, parent_id)
                VALUES (?, 'Sudip', ?, 'blackpiratex.com', 1, ?)`,
          args: [slug, message, parentId],
        });
      }
    }
  }

  // --- Redeploy ---
  if (req.method === "POST" && body.action === "redeploy" && authenticated) {
    try {
      await fetch(process.env.VERCEL_DEPLOY_HOOK_URL, { method: "POST" });
      return res.end("<h2>Redeploy triggered ✅</h2><a href='/api/dashboard'>Back</a>");
    } catch (err) {
      console.error("Failed to redeploy:", err);
      return res.end("<h2>Failed to trigger redeploy ❌</h2>");
    }
  }

  // --- Not authenticated: show login ---
  if (!authenticated) {
    return res.end(`
      <style>
        body { font-family: sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .login-box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
        input { padding: 0.5rem; margin-top: 0.5rem; width: 100%; }
        button { margin-top: 1rem; padding: 0.5rem 1rem; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #555; }
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

  // --- Authenticated: dashboard ---
  const rs = await db.execute(
    "SELECT id, slug, name, email, website, message, created_at, approved FROM comments ORDER BY created_at DESC"
  );

  const rows = rs.rows
    .map(
      (c) => `
      <tr>
        <td>${c.id}</td>
        <td>${c.slug}</td>
        <td>${c.name}</td>
        <td>${c.email || ""}</td>
        <td>${c.website || ""}</td>
        <td>${c.message}</td>
        <td>${c.created_at}</td>
        <td class="${c.approved ? "approved" : "pending"}">
          ${c.approved ? "Approved" : "Pending"}
        </td>
        <td>
          ${
            !c.approved
              ? `<form method="POST" style="display:inline">
                   <input type="hidden" name="action" value="approve">
                   <input type="hidden" name="id" value="${c.id}">
                   <button class="btn-approve" type="submit">Approve</button>
                 </form>`
              : ""
          }
          <form method="POST" style="display:inline">
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="id" value="${c.id}">
            <button class="btn-delete" type="submit">Delete</button>
          </form>
          <form method="POST" style="display:inline">
            <input type="hidden" name="action" value="reply">
            <input type="hidden" name="id" value="${c.id}">
            <input type="text" name="message" placeholder="Reply..." required>
            <button class="btn-reply" type="submit">Reply</button>
          </form>
        </td>
      </tr>
    `
    )
    .join("");

  return res.end(`
    <style>
      body { font-family: sans-serif; background: #fafafa; padding: 2rem; }
      h2 { margin-bottom: 1rem; }
      .top-actions { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
      .top-actions form { display: inline; }
      button { padding: 0.4rem 0.8rem; border: none; border-radius: 4px; cursor: pointer; }
      .btn-logout { background: #666; color: white; }
      .btn-redeploy { background: #0070f3; color: white; }
      .btn-approve { background: #2ecc71; color: white; }
      .btn-delete { background: #e74c3c; color: white; }
      .btn-reply { background: #f39c12; color: white; }
      table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
      th, td { padding: 0.75rem; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
      th { background: #f0f0f0; }
      tr:hover { background: #f9f9f9; }
      .approved { color: #2ecc71; font-weight: bold; }
      .pending { color: #e67e22; font-weight: bold; }
      input[type=text] { padding: 0.3rem; margin-right: 0.3rem; }
    </style>

    <h2>Comments Dashboard</h2>
    <div class="top-actions">
      <form method="POST">
        <input type="hidden" name="action" value="logout">
        <button class="btn-logout" type="submit">Logout</button>
      </form>
      <form method="POST">
        <input type="hidden" name="action" value="redeploy">
        <button class="btn-redeploy" type="submit">🔄 Redeploy Site</button>
      </form>
    </div>

    <table>
      <tr>
        <th>ID</th><th>Slug</th><th>Name</th><th>Email</th>
        <th>Website</th><th>Message</th><th>Created</th><th>Status</th><th>Actions</th>
      </tr>
      ${rows}
    </table>
  `);
}
