import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass ?? "" } : undefined,
    })
  : null;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Test hook: replaces SMTP so tests can read what would have been sent. */
let capture: ((mail: Mail) => void) | null = null;
export function captureMail(fn: ((mail: Mail) => void) | null) {
  capture = fn;
}

export function mailEnabled(): boolean {
  return !!transport || !!capture;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (capture) return capture(mail);
  if (!transport || !config.smtp) throw new Error("Email is not set up on this server (SMTP_HOST is empty)");
  await transport.sendMail({ from: config.smtp.from, ...mail });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
