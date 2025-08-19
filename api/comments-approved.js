// api/comments-approved.js
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "Slug is required" });

  try {
    const rs = await db.execute({
      sql: "SELECT name, message, created_at FROM comments WHERE slug = ? AND approved = 1 ORDER BY created_at DESC",
      args: [slug],
    });
    return res.status(200).json(rs.rows);
  } catch (err) {
    console.error("Failed to fetch approved comments:", err);
    return res.status(500).json({ error: "Failed to fetch approved comments" });
  }
}
