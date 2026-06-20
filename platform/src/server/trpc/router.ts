import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "@/server/trpc/context";
import { servers, installations, recipes, domains } from "@/server/db/schema";
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
        port: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const [recipe] = await ctx.db
        .select()
        .from(recipes)
        .where(eq(recipes.id, input.recipeId));
      if (!recipe) throw new TRPCError({ code: "NOT_FOUND" });

      const recipeData = recipe.recipe as any;
      const params = input.params || {};

      // Resolve variables
      const defaultPort = recipeData?.params?.port?.default || 80;
      const port = input.port || defaultPort;
      const image = recipeData?.params?.image?.default || "alpine";

      // Build full script
      let script = "set -e\n\n";

      // 1. Handle service dependencies (MySQL, etc.)
      const services = recipeData?.services || {};
      for (const [svcName, svcConfig] of Object.entries(services) as [string, any][]) {
        const svcType = svcConfig.type || svcName;
        const svcVersion = svcConfig.version || "latest";
        if (svcType === "mysql") {
          script += `# Setup MySQL dependency\n`;
          script += `docker rm -f ${recipe.name}-mysql 2>/dev/null; `;
          script += `docker run -d --name ${recipe.name}-mysql `;
          script += `-e MYSQL_ROOT_PASSWORD=srvly_${Math.random().toString(36).slice(2, 10)} `;
          script += `-e MYSQL_DATABASE=${recipe.name} `;
          script += `-e MYSQL_USER=${recipe.name} `;
          script += `-e MYSQL_PASSWORD=srvly_${Math.random().toString(36).slice(2, 10)} `;
          script += `--restart unless-stopped `;
          script += `mysql:${svcVersion} 2>&1\n`;
          script += `echo "MySQL started for ${recipe.name}"\n\n`;
        }
      }

      // 2. Pull + run the app container
      const installStage = recipeData?.install?.[0];
      if (installStage?.docker) {
        const d = installStage.docker;
        const resolvedImage = d.image?.replace("$IMAGE", image) || image;
        const resolvedPort = d.port?.replace("$PORT:", `${port}:`).replace("$PORT", `${port}`) || `${port}:${defaultPort}`;

        script += `# Pull image\n`;
        script += `docker pull ${resolvedImage} 2>&1 || echo "PULL_FAILED"\n\n`;

        script += `# Remove old container and run\n`;
        script += `docker rm -f ${d.name} 2>/dev/null; `;
        script += `docker run -d --name ${d.name} --restart unless-stopped -p ${resolvedPort}`;

        // Volumes
        for (const vol of d.volumes || []) {
          const volDir = vol.split("/").filter(Boolean).pop() || "data";
          script += ` -v /opt/srvly/${d.name}-${volDir}:${vol}`;
        }

        // Extra ports
        for (const ep of d.extra_ports || []) {
          script += ` -p ${ep}`;
        }

        // Env vars from recipe params
        for (const [pKey, pVal] of Object.entries(recipeData?.params || {})) {
          if (pKey === "port" || pKey === "image") continue;
          const p = pVal as any;
          const pDefault = p.default || "";
          script += ` -e ${pKey.toUpperCase()}=${pDefault}`;
        }

        script += ` ${resolvedImage} 2>&1\n\n`;

        // 3. Verify — retry until ready
        script += `# Verify installation (retry loop)\n`;
        script += `for i in 1 2 3 4 5 6; do\n`;
        script += `  echo "Check attempt $i..."\n`;
        script += `  sleep 10\n`;
        script += `  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null)\n`;
        script += `  echo "  HTTP $CODE"\n`;
        script += `  if [ "$CODE" != "000" ]; then\n`;
        script += `    echo "APP_READY"\n`;
        script += `    exit 0\n`;
        script += `  fi\n`;
        script += `done\n`;
        script += `echo "VERIFY_FAILED after 60s"\n`;

      } else if (installStage?.script) {
        script += installStage.script;
      } else {
        script += `docker pull ${image} && echo "IMAGE_PULLED"\n`;
      }

      // Create installation record
      const [inst] = await ctx.db
        .insert(installations)
        .values({
          serverId: input.serverId,
          recipeId: input.recipeId,
          params: { ...params, port, image },
          status: "running",
        })
        .returning();

      // Dispatch to tunnel-server (async but tracked)
      const tunnelUrl = process.env.TUNNEL_URL || "http://tunnel-server:8080";
      fetch(`${tunnelUrl}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: inst.id,
          script: script,
          timeout: 180,
        }),
      })
        .then(res => res.json())
        .then(async (result: any) => {
          const status = result?.success ? "success" : "failed";
          await ctx.db
            .update(installations)
            .set({ status, result, logs: result?.output || "", updatedAt: new Date() })
            .where(eq(installations.id, inst.id));
        })
        .catch(async (err: any) => {
          await ctx.db
            .update(installations)
            .set({ status: "failed", result: { error: err.message }, updatedAt: new Date() })
            .where(eq(installations.id, inst.id));
        });

      return {
        id: inst.id,
        port: port,
        script: script,
        message: `Installation de ${recipe.name} lancée sur le port ${port}...`,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Kill Docker containers
      const tunnelUrl = process.env.TUNNEL_URL || "http://tunnel-server:8080";
      const r = await ctx.db.select().from(recipes).where(eq(recipes.id, row.installation.recipeId)).then(r => r[0]);
      const container = (r?.recipe as any)?.install?.[0]?.docker?.name || "app";
      await fetch(`${tunnelUrl}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: `kill-${input.id}`,
          script: `docker rm -f ${container} 2>/dev/null; docker rm -f ${container}-mysql 2>/dev/null; echo "REMOVED"`,
          timeout: 15,
        }),
      }).catch(() => {});

      await ctx.db.delete(installations).where(eq(installations.id, input.id));
      return { success: true };
    }),
});

// ─── Domain routes ───

export const domainRouter = router({
  list: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify server ownership
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) return [];

      return await ctx.db
        .select()
        .from(domains)
        .where(eq(domains.serverId, input.serverId))
        .orderBy(domains.createdAt);
    }),

  add: protectedProcedure
    .input(z.object({
      serverId: z.string(),
      name: z.string().min(3).max(255),
      targetPort: z.number().int().optional(),
      targetApp: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify server ownership
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      // Basic domain validation
      const domainRegex = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
      if (!domainRegex.test(input.name)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Domaine invalide" });
      }

      const [domain] = await ctx.db
        .insert(domains)
        .values({
          serverId: input.serverId,
          name: input.name,
          targetPort: input.targetPort,
          targetApp: input.targetApp,
          sslStatus: "pending",
        })
        .returning();

      // Auto-configure Nginx on the server (if app+port specified)
      if (domain && input.targetPort) {
        const nginxScript = `
mkdir -p /var/www/certbot
cat > /etc/nginx/sites-enabled/${input.name}.conf << NGINX
server {
    listen 80;
    server_name ${input.name};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:${input.targetPort};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
nginx -t && systemctl reload nginx
echo "NGINX_CONFIGURED"
`;

        fetch(`${process.env.TUNNEL_URL || "http://tunnel-server:8080"}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            server_id: "unknown",
            command_id: `nginx-${domain.id}`,
            script: nginxScript,
            timeout: 30,
          }),
        }).catch(() => {});
      }

      return domain;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Find domain + verify ownership
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      // Remove Nginx config
      fetch(`${process.env.TUNNEL_URL || "http://tunnel-server:8080"}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: `nginx-rm-${input.id}`,
          script: `rm -f /etc/nginx/sites-enabled/${domain.domain.name}.conf && nginx -t && systemctl reload nginx && echo "REMOVED"`,
          timeout: 15,
        }),
      }).catch(() => {});

      await ctx.db.delete(domains).where(eq(domains.id, input.id));
      return { success: true };
    }),
});

// ─── Main router ───

export const appRouter = router({
  server: serverRouter,
  catalog: catalogRouter,
  install: installRouter,
  domain: domainRouter,
});

export type AppRouter = typeof appRouter;
