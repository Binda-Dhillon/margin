import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

const port = Number(env("PORT") ?? 8787);
const dataDir = path.resolve(env("DATA_DIR") ?? path.join(here, "..", "data"));
fs.mkdirSync(path.join(dataDir, "repos", "users"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "repos", "groups"), { recursive: true });

/**
 * The auth secret signs session cookies. If the operator has not set one we
 * create it once and keep it next to the database, so a plain
 * `docker compose up` works and sessions survive restarts.
 */
function loadSecret(): string {
  const fromEnv = env("AUTH_SECRET");
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, ".auth-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const publicUrl = (env("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, "");

export const config = {
  port,
  dataDir,
  publicUrl,
  secret: loadSecret(),
  allowSignup: env("ALLOW_SIGNUP") !== "false",
  google:
    env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")
      ? { clientId: env("GOOGLE_CLIENT_ID")!, clientSecret: env("GOOGLE_CLIENT_SECRET")! }
      : null,
  microsoft:
    env("MICROSOFT_CLIENT_ID") && env("MICROSOFT_CLIENT_SECRET")
      ? {
          clientId: env("MICROSOFT_CLIENT_ID")!,
          clientSecret: env("MICROSOFT_CLIENT_SECRET")!,
          tenantId: env("MICROSOFT_TENANT_ID") ?? "common",
        }
      : null,
  /** Extra origins allowed to call the API with cookies (the Vite dev server). */
  trustedOrigins: (env("TRUSTED_ORIGINS") ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  webDist: path.resolve(env("WEB_DIST") ?? path.join(here, "..", "..", "web", "dist")),
  hookPath: path.resolve(here, "..", "hooks", "pre-receive.mjs"),
};

export type SpaceKind = "u" | "g";
export interface SpaceRef {
  kind: SpaceKind;
  id: string;
}
