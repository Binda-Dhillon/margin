import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { config } from "./config.js";
import { db } from "./db.js";
import { escapeHtml, mailEnabled, sendMail } from "./mail.js";

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

/**
 * The address the browser used to reach this server, so sign-in works from
 * any machine that can reach it (a Tailscale IP or name, a LAN address)
 * without listing each one in PUBLIC_URL or TRUSTED_ORIGINS.
 *
 * Better Auth's origin check stops other sites from posting to this one. A
 * page on another site sends its own Origin, which will not match the Host it
 * is posting to, so it is still refused.
 */
function sameOrigins(request?: Request): string[] {
  if (!request) return [];
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  return hosts
    .flatMap((h) => (h ? h.split(",").map((s) => s.trim()) : []))
    .filter((h) => /^[A-Za-z0-9.\-:[\]]+$/.test(h))
    .flatMap((h) => [`http://${h}`, `https://${h}`]);
}

/** `<redirectTo>?reset=<token>`, falling back to PUBLIC_URL. */
function resetLink(url: string, token: string): string {
  let target = `${config.publicUrl}/`;
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    if (callback && /^https?:\/\//.test(callback)) target = callback;
  } catch {
    /* keep the fallback */
  }
  const link = new URL(target);
  link.searchParams.set("reset", token);
  return link.toString();
}

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
  trustedOrigins: (request) => [config.publicUrl, ...config.trustedOrigins, ...sameOrigins(request)],
  // On by default except under a test runner; keep it on so tests cover it.
  advanced: { disableOriginCheck: false },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    disableSignUp: !config.allowSignup,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      // The link opens the app on the address the request came from (checked
      // against trusted origins by Better Auth), so a reset asked for on the
      // laptop links back to the laptop's address for this server.
      const link = resetLink(url, token);
      if (!mailEnabled()) {
        console.warn(`[auth] Password reset asked for ${user.email}, but SMTP is not set up.`);
        return;
      }
      try {
        await sendMail({
          to: user.email,
          subject: "Reset your Margin password",
          text: [
            `Hi ${user.name},`,
            "",
            "Someone asked to reset the password for your Margin account. Open this link within an hour to choose a new one:",
            "",
            link,
            "",
            "If that was not you, ignore this email. Your password stays the same.",
          ].join("\n"),
          html: `<p>Hi ${escapeHtml(user.name)},</p>
<p>Someone asked to reset the password for your Margin account. Open this link within an hour to choose a new one:</p>
<p><a href="${escapeHtml(link)}">Choose a new password</a></p>
<p>If that was not you, ignore this email. Your password stays the same.</p>`,
        });
      } catch (err) {
        // Answer the same either way, so the form never reveals which emails have accounts.
        console.error(`[auth] Could not send the password reset email to ${user.email}:`, err);
      }
    },
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
