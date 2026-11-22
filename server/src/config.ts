import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// `npm start` does not read .env by itself (Docker Compose does). Load the one
// at the project root so the same file works both ways. Variables already set
// in the environment win. Tests set their own.
const envFile = path.resolve(here, "..", "..", ".env");
if (!process.env.VITEST && fs.existsSync(envFile)) process.loadEnvFile(envFile);

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
  /** Outgoing mail, used for password reset links. Off unless SMTP_HOST is set. */
  smtp: env("SMTP_HOST")
    ? {
        host: env("SMTP_HOST")!,
        port: Number(env("SMTP_PORT") ?? 587),
        // Port 465 speaks TLS from the start; 587 and 25 upgrade with STARTTLS.
        secure: env("SMTP_SECURE") ? env("SMTP_SECURE") === "true" : Number(env("SMTP_PORT") ?? 587) === 465,
        user: env("SMTP_USER"),
        pass: env("SMTP_PASS"),
        from: env("SMTP_FROM") ?? env("SMTP_USER") ?? "margin@localhost",
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
