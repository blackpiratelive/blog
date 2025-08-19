// api/admin-comments.js
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html");

  // Parse body (for login/delete actions)
  const body = await new Promise((resolve) => {
    if (req.method !== "POST") return resolve({});
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      resolve(Object.fromEntries(new URLSearchParams(data)));
    });
  });

  // Use a cookie for session (simple)
  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((c) => c.trim().split("="))
  );

  let authenticated = cookies.auth === process.env.ADMIN_PASSWORD;

  // --- Handle login form ---
  if (req.method === "POST" && body.action === "login") {
    if (body.password === process.env.ADMIN_PASSWORD) {
      authenticated = true;
      res.setHeader("Set-Cookie", `auth=${process.env.ADMIN_PASSWORD}; Path=/; HttpOnly`);
    } else {
      return res.end("<h2>Invalid password</h2><a href='/api/admin-comments'>Try again</a>");
    }
  }

  // --- Handle delete ---
  if (req.method === "POST" && body.action === "delete" && authenticated) {
    await db.execute({
      sql: "DELETE FROM comments WHERE id = ?",
      args: [body.id],
    });
  }

  // If not authenticated, show login form
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

  // --- Show dashboard ---
  const rs = await db.execute("SELECT id, slug, name, email, website, message, created_at FROM comments ORDER BY created_at DESC");

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
        <td>
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
    <table border="1" cellpadding="5">
      <tr>
        <th>ID</th><th>Slug</th><th>Name</th><th>Email</th><th>Website</th><th>Message</th><th>Created</th><th>Actions</th>
      </tr>
      ${rows}
    </table>
  `);
}
