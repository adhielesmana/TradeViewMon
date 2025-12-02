import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets with long-term caching for hashed files
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      maxAge: "1y", // 1 year cache for hashed assets
      immutable: true,
      etag: true,
    })
  );

  // Serve other static files with shorter cache
  app.use(
    express.static(distPath, {
      maxAge: "1h", // 1 hour cache for non-hashed files
      etag: true,
    })
  );

  // fall through to index.html if the file doesn't exist (no cache for HTML)
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
