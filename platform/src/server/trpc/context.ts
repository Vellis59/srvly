import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import "@/lib/queue";

export async function createContext(opts: FetchCreateContextFnOptions) {
  const session = await auth();

  // Check for API token in Authorization header
  let apiUser = null;
  const authHeader = (opts as any).info?.headers?.get?.("authorization") || (opts as any).req?.headers?.get?.("authorization") || "";
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (token) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.apiToken, token))
        .limit(1);
      apiUser = user || null;
    }
  }

  return { db, session, apiUser };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

// Base router & procedure
export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure (requires auth)
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});

/**
 * Procedure that accepts either a browser session OR an API Bearer token.
 * Agents use the token, browser users use the session.
 */
export const agentProcedure = t.procedure.use(({ ctx, next }) => {
  const user = ctx.session?.user || ctx.apiUser;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session ou token requis" });
  }
  return next({ ctx: { ...ctx, user } });
});
