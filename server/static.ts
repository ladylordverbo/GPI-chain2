import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In production (bundled to CommonJS), the bundled file is at dist/index.cjs
  // and static files are at dist/public/. 
  // Since we know the structure, we can resolve from process.cwd() which should
  // be the project root when the bundled file runs.
  // This works regardless of whether __dirname is available or not.
  const distPath = path.resolve(process.cwd(), "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
