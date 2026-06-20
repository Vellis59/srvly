import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

export async function createContext(opts: FetchCreateContextFnOptions) {
  const session = await auth();
  return { db, session, headers: opts.headers };
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
