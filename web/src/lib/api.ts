import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ baseURL: window.location.origin });

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Could not reach the server");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, String(message));
  }
  return data as T;
}

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}
export interface Member extends User {
  role: string;
}
export interface Group {
  id: string;
  name: string;
  role: string;
  createdBy: string;
  createdAt: number;
  inviteCode: string;
  dueLabel: string | null;
  dueDate: string | null;
  members: Member[];
}
export interface ServerNotification {
  id: string;
  kind: string;
  payload: Record<string, string>;
  createdAt: number;
}
export interface Me {
  user: User;
  groups: Group[];
  notifications: ServerNotification[];
}
export interface ServerConfig {
  providers: { google: boolean; microsoft: boolean };
  allowSignup: boolean;
  publicUrl: string;
}
