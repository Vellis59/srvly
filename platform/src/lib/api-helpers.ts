import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";
import type { z } from "zod";

// ─── Rate limiter (in-memory, per-token) ───

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple in-memory rate limiter.
 * Limits to `maxRequests` per `windowMs` per token.
 */
export function checkRateLimit(token: string, maxRequests = 30, windowMs = 60_000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(token);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(token, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: maxRequests - entry.count };
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((val, key) => {
    if (now > val.resetAt) rateLimitMap.delete(key);
  });
}, 300_000);

// ─── Auth ────────────────────────────────────────────────

/**
 * Authenticate a request via Bearer token.
 * Returns the user row or null if invalid.
 */
export async function authUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { users } = await import("@/server/db/schema");
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.apiToken, token))
    .limit(1);
  return user || null;
}

// ─── Response helpers ────────────────────────────────────

export function error(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ...data });
}

// ─── Validation helper ───────────────────────────────────

/**
 * Parse a request body against a Zod schema.
 * Returns a typed result on success, or sends an error response.
 */
export async function validateBody<T extends z.ZodType>(
  req: NextRequest,
  schema: T,
): Promise<{ valid: true; data: z.infer<T> } | { valid: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { valid: false, response: error("Invalid JSON body", 400) };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return {
      valid: false,
      response: error(`Validation failed: ${messages.join("; ")}`, 422),
    };
  }

  return { valid: true, data: result.data };
}
