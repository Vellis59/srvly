import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "@/server/trpc/context";
import { servers, installations, recipes } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

// ─── Server routes ───

export const serverRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select()
      .from(servers)
      .where(eq(servers.userId, ctx.user.id!))
      .orderBy(servers.createdAt);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      return server;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        ip: z.string().min(7).max(50),
        deployAgent: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const token = crypto.randomBytes(32).toString("hex");
      const [server] = await ctx.db
        .insert(servers)
        .values({
          userId: ctx.user.id!,
          name: input.name,
          ip: input.ip,
          agentToken: token,
          status: "pending",
        })
        .returning();
      return server;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      return { success: true };
    }),
});

// ─── Catalog / Recipe routes ───

export const catalogRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select({
        id: recipes.id,
        name: recipes.name,
        description: recipes.description,
        category: recipes.category,
        version: recipes.version,
        icon: recipes.icon,
        dependencies: recipes.dependencies,
      })
      .from(recipes)
      .orderBy(recipes.name);
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [recipe] = await ctx.db
        .select()
        .from(recipes)
        .where(eq(recipes.id, input.id));
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });
      return recipe;
    }),
});

// ─── Installation routes ───

export const installRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select()
      .from(installations)
      .innerJoin(servers, eq(installations.serverId, servers.id))
      .innerJoin(recipes, eq(installations.recipeId, recipes.id))
      .where(eq(servers.userId, ctx.user.id!))
      .orderBy(installations.createdAt);
  }),

  create: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        recipeId: z.string(),
        params: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify server ownership
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      // Get recipe for install instructions
      const [recipe] = await ctx.db
        .select()
        .from(recipes)
        .where(eq(recipes.id, input.recipeId));
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });

      const [inst] = await ctx.db
        .insert(installations)
        .values({
          serverId: input.serverId,
          recipeId: input.recipeId,
          params: input.params || {},
          status: "running",
        })
        .returning();

      // Build install command from recipe
      const recipeData = recipe.recipe as any;
      let script = "";
      if (recipeData?.install?.[0]?.docker) {
        const d = recipeData.install[0].docker;
        const port = d.port?.replace("$PORT:", "") || "80";
        script = `docker pull ${d.image} && docker rm -f ${d.name} 2>/dev/null; docker run -d --name ${d.name} --restart unless-stopped -p ${port}:${port}`;
        for (const v of d.volumes || []) {
          const volName = v.split("/").filter(Boolean).pop() || "data";
          script += ` -v ${d.name}-${volName}:${v}`;
        }
        for (const ep of d.extra_ports || []) {
          script += ` -p ${ep}`;
        }
        script += ` ${d.image}`;
      } else if (recipeData?.install?.[0]?.script) {
        script = recipeData.install[0].script;
      } else {
        script = `docker pull ${recipeData?.params?.image?.default || recipeId} && echo "Image pulled"`;
      }

      // Dispatch to tunnel-server (async)
      const tunnelUrl = process.env.TUNNEL_URL || "http://tunnel-server:8080";
      fetch(`${tunnelUrl}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: inst.id,
          script: script,
          timeout: 120,
        }),
      })
        .then(res => res.json())
        .then(async (result: any) => {
          const status = result?.success ? "success" : "failed";
          await ctx.db
            .update(installations)
            .set({ status, result: result, updatedAt: new Date() })
            .where(eq(installations.id, inst.id));
        })
        .catch(async (err: any) => {
          await ctx.db
            .update(installations)
            .set({ status: "failed", result: { error: err.message }, updatedAt: new Date() })
            .where(eq(installations.id, inst.id));
        });

      return { ...inst, status: "running", message: "Installation en cours..." };
    }),
});

// ─── Main router ───

export const appRouter = router({
  server: serverRouter,
  catalog: catalogRouter,
  install: installRouter,
});

export type AppRouter = typeof appRouter;
