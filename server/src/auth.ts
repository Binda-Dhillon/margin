import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { config } from "./config.js";
import { db } from "./db.js";

/** Same rules the sign-up form shows live (Screen 1). */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/\d/.test(password)) problems.push("a number");
  if (!/[^A-Za-z0-9\s]/.test(password)) problems.push("a symbol");
  return problems;
}

const socialProviders: Record<string, unknown> = {};
if (config.google) socialProviders.google = { ...config.google };
if (config.microsoft) socialProviders.microsoft = { ...config.microsoft };

let migrated = false;

export const auth = betterAuth({
  logger: {
    // On first boot the tables do not exist until migrateAuth() has run;
    // the library's warning about that would only alarm a self-hoster.
    log(level, message, ...args) {
      if (!migrated && String(message).includes("Database schema mismatch")) return;
      const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      out(`[auth] ${message}`, ...args);
    },
  },
  baseURL: config.publicUrl,
  secret: config.secret,
  database: db,
  trustedOrigins: [config.publicUrl, ...config.trustedOrigins],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    disableSignUp: !config.allowSignup,
  },
  socialProviders: socialProviders as never,
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google", "microsoft"] },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" || ctx.path === "/change-password" || ctx.path === "/reset-password") {
        const body = (ctx.body ?? {}) as { password?: string; newPassword?: string };
        const password = body.newPassword ?? body.password ?? "";
        const problems = passwordProblems(password);
        if (problems.length) {
          throw new APIError("BAD_REQUEST", { message: `Password needs ${problems.join(", ")}.` });
        }
      }
    }),
  },
});

export async function migrateAuth() {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  migrated = true;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export async function userFromHeaders(headers: Headers): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return null;
    const u = session.user;
    return { id: u.id, name: u.name, email: u.email, image: u.image ?? null };
  } catch {
    return null;
  }
}
