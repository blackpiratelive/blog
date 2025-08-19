// api/comment.js
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  schemaSync: false,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Parse form body (x-www-form-urlencoded)
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      resolve(Object.fromEntries(new URLSearchParams(data)));
    });
  });

  const { slug, name, message, email, website, honeypot } = body;

  // 🪤 Honeypot: if bots fill out this hidden field, reject
  if (honeypot) {
    return res.status(400).send("Spam detected");
  }

  if (!slug || !name || !message) {
    return res.status(400).send("Missing required fields");
  }

  try {
    await db.execute({
      sql: "INSERT INTO comments (slug, name, message, email, website) VALUES (?, ?, ?, ?, ?)",
      args: [slug, name, message, email || null, website || null],
    });

    // Redirect back with success flag
    return res.redirect(302, `${req.headers.referer || "/"}?comment=success`);
  } catch (err) {
    console.error("Failed to insert comment:", err);
    return res.status(500).send("Failed to insert comment");
  }
}
