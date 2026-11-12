import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { api } from "./api.js";
import { migrateAuth } from "./auth.js";
import { config } from "./config.js";
import { handleGit } from "./git.js";

const app = new Hono();
app.route("/api", api);

if (fs.existsSync(path.join(config.webDist, "index.html"))) {
  // Absolute, so it works whatever folder the server is started from (and on Windows).
  const root = config.webDist;
  app.use(
    "/assets/*",
    serveStatic({
      root,
      onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  app.use("*", serveStatic({ root }));
  // Single-page app: any other path gets the shell.
  const shell = fs.readFileSync(path.join(config.webDist, "index.html"), "utf8");
  app.get("*", (c) => c.html(shell));
} else {
  app.get("/", (c) =>
    c.text("Margin server is running. Build the web app (npm run build) or use the Vite dev server on :5173."),
  );
}

export async function startServer(port = config.port): Promise<http.Server> {
  await migrateAuth();
  const listener = getRequestListener(app.fetch);
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/git/")) {
      handleGit(req, res).catch((err) => {
        console.error("git request failed", err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    void listener(req, res);
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}

if (process.env.MARGIN_NO_LISTEN !== "1") {
  startServer().then(() => {
    console.log(`Margin is running at ${config.publicUrl} (data in ${config.dataDir})`);
    if (!config.google && !config.microsoft) {
      console.log("No OAuth provider configured: sign-in is email and password only.");
    }
  });
}
