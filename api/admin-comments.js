// api/admin-comments.js
import { createClient } from "@libsql/client";
import crypto from "crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

// In-memory session storage (resets on cold start)
const sessions = new Set();

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");

  // Parse body (for login/delete/approve/logout actions)
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
      return res.end(
        "<h2>Invalid password</h2><a href='/api/admin-comments'>Try again</a>"
      );
    }
  }

  // --- Handle logout ---
  if (req.method === "POST" && body.action === "logout" && authenticated) {
    sessions.delete(sessionToken);
    res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
    return res.end("<h2>Logged out</h2><a href='/api/admin-comments'>Login again</a>");
  }

  // --- Handle delete ---
  if (req.method === "POST" && body.action === "delete" && authenticated) {
    await db.execute({
      sql: "DELETE FROM comments WHERE id = ?",
      args: [body.id],
    });
  }

  // --- Handle approve ---
  if (req.method === "POST" && body.action === "approve" && authenticated) {
    await db.execute({
      sql: "UPDATE comments SET approved = 1 WHERE id = ?",
      args: [body.id],
    });
  }

  // --- Not logged in: show login form ---
  if (!authenticated) {
    return res.end(`
      <h2>Admin Login</h2>
      <form method="POST">
        <input type="hidden" name="action" value="login">
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
      </form>
    `);
  }

  // --- Logged in: show dashboard ---
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
        <td>${c.approved ? "✅ Approved" : "❌ Pending"}</td>
        <td>
          ${
            !c.approved
              ? `<form method="POST" style="display:inline">
                   <input type="hidden" name="action" value="approve">
                   <input type="hidden" name="id" value="${c.id}">
                   <button type="submit">Approve</button>
                 </form>`
              : ""
          }
          <form method="POST" style="display:inline">
            <input type="hidden" name="action" value="delete">
            <input type="hidden" name="id" value="${c.id}">
            <button type="submit">Delete</button>
          </form>
        </td>
      </tr>
    `
    )
    .join("");

  return res.end(`
    <h2>Comments Dashboard</h2>
    <form method="POST" style="margin-bottom:20px;">
      <input type="hidden" name="action" value="logout">
      <button type="submit">Logout</button>
    </form>
    <table border="1" cellpadding="5">
      <tr>
        <th>ID</th><th>Slug</th><th>Name</th><th>Email</th>
        <th>Website</th><th>Message</th><th>Created</th><th>Status</th><th>Actions</th>
      </tr>
      ${rows}
    </table>
  `);
}
