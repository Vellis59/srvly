import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "@/server/trpc/context";
import { servers, installations, recipes, domains } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { generateKeyPairSync, createPublicKey } from "crypto";

// ─── SSH key conversion ───

/**
 * Convert a SPKI PEM public key to OpenSSH authorized_keys format (ssh-rsa AAAA...).
 */
export function pemToOpenSsh(spkiPem: string): string {
  const key = createPublicKey(spkiPem);
  // Export as JWK to extract raw RSA parameters
  const jwk = key.export({ format: "jwk" });

  const n = Buffer.from(jwk.n!, "base64url");
  const eBuf = Buffer.from(jwk.e!, "base64url");

  const algo = Buffer.from("ssh-rsa", "utf8");

  // SSH wire format: length-prefixed strings: algo, exponent, modulus
  const len = 4 + algo.length + 4 + eBuf.length + 4 + n.length;
  const buf = Buffer.alloc(len);
  let off = 0;

  buf.writeUInt32BE(algo.length, off);
  off += 4;
  algo.copy(buf, off);
  off += algo.length;

  buf.writeUInt32BE(eBuf.length, off);
  off += 4;
  eBuf.copy(buf, off);
  off += eBuf.length;

  buf.writeUInt32BE(n.length, off);
  off += 4;
  n.copy(buf, off);

  return `ssh-rsa ${buf.toString("base64")} srvly@platform\n`;
}

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Generate SSH key pair
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 4096,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs1", format: "pem" },
      });

      // Convert SPKI PEM to OpenSSH authorized_keys format
      const sshPublicKey = pemToOpenSsh(publicKey);

      const [server] = await ctx.db
        .insert(servers)
        .values({
          userId: ctx.user.id!,
          name: input.name,
          ip: input.ip,
          sshPrivateKey: privateKey,
          sshPublicKey,
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

  execute: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        script: z.string(),
        timeout: z.number().int().positive().default(60),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(input.id, input.script, input.timeout);

      // Update status to connected on first successful command
      if (result.success && server.status === "pending") {
        await ctx.db
          .update(servers)
          .set({ status: "connected", lastSeen: new Date() })
          .where(eq(servers.id, input.id));
      } else if (result.success && server.status === "connected") {
        await ctx.db
          .update(servers)
          .set({ lastSeen: new Date() })
          .where(eq(servers.id, input.id));
      }

      return result;
    }),

  testConnection: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(input.id, "echo 'OK' && hostname", 15);

      if (result.success) {
        await ctx.db
          .update(servers)
          .set({ status: "connected", lastSeen: new Date() })
          .where(eq(servers.id, input.id));
      }

      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
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
      const safeName = recipe.id.replace(/[^a-zA-Z0-9_.-]/g, "-");
      const networkName = `srvly-${safeName}`;
      const hasMysql = Object.values(recipeData?.services || {}).some((svc: any) => (svc.type || "") === "mysql");
      let mysqlUserPass = "";
      if (Object.keys(recipeData?.services || {}).length > 0) {
        script += `docker network create ${networkName} 2>/dev/null || true\n`;
      }

      // 1. Handle service dependencies (MySQL, etc.)
      const services = recipeData?.services || {};
      for (const [svcName, svcConfig] of Object.entries(services) as [string, any][]) {
        const svcType = svcConfig.type || svcName;
        const svcVersion = svcConfig.version || "latest";
        if (svcType === "mysql") {
          const mysqlRootPass = `srvly_${Math.random().toString(36).slice(2, 10)}`;
          mysqlUserPass = `srvly_${Math.random().toString(36).slice(2, 10)}`;
          script += `# Setup MySQL dependency\n`;
          script += `MYSQL_ROOT_PASS="${mysqlRootPass}"\n`;
          script += `MYSQL_USER_PASS="${mysqlUserPass}"\n`;
          script += `docker rm -f ${safeName}-mysql 2>/dev/null || true\n`;
          script += `docker run -d --name ${safeName}-mysql --network ${networkName} `;
          script += `-e MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASS `;
          script += `-e MYSQL_DATABASE=${safeName} `;
          script += `-e MYSQL_USER=${safeName} `;
          script += `-e MYSQL_PASSWORD=$MYSQL_USER_PASS `;
          script += `--restart unless-stopped `;
          script += `mysql:${svcVersion} 2>&1\n`;
          script += `echo "Waiting for MySQL..."\n`;
          script += `for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do\n`;
          script += `  if docker exec ${safeName}-mysql mysqladmin ping -u root -p$MYSQL_ROOT_PASS --silent 2>/dev/null; then echo "MySQL ready!"; break; fi\n`;
          script += `  sleep 3\n`;
          script += `done\n\n`;
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
        script += `docker rm -f ${d.name} 2>/dev/null || true\n`;

        const volumeArgs: string[] = [];
        for (const vol of d.volumes || []) {
          const volDir = vol.split("/").filter(Boolean).pop() || "data";
          const hostDir = `/opt/srvly/${d.name}-${volDir}`;
          script += `mkdir -p ${hostDir}\n`;
          script += `chown -R 1000:1000 ${hostDir} 2>/dev/null || true\n`;
          volumeArgs.push(`-v ${hostDir}:${vol}`);
        }

        script += `docker run -d --name ${d.name} --restart unless-stopped`;
        if (Object.keys(services).length > 0) {
          script += ` --network ${networkName}`;
        }
        script += ` -p ${resolvedPort}`;

        if (hasMysql) {
          script += ` -e database__client=mysql`;
          script += ` -e database__connection__host=${safeName}-mysql`;
          script += ` -e database__connection__user=${safeName}`;
          script += ` -e database__connection__password=$MYSQL_USER_PASS`;
          script += ` -e database__connection__database=${safeName}`;
        }

        for (const arg of volumeArgs) {
          script += ` ${arg}`;
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
        script += `  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || true)\n`;
        script += `  [ -z "$CODE" ] && CODE=000\n`;
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

      // Dispatch to member server via SSH (async but tracked)
      executeOnServer(input.serverId, script, 180)
        .then(async (result) => {
          const status = result.success ? "success" : "failed";
          await ctx.db
            .update(installations)
            .set({ status, result, logs: result.output || "", updatedAt: new Date() })
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

      // Kill Docker containers via SSH
      const r = await ctx.db.select().from(recipes).where(eq(recipes.id, row.installation.recipeId)).then(r => r[0]);
      const container = (r?.recipe as any)?.install?.[0]?.docker?.name || "app";
      await executeOnServer(row.server.id, `docker rm -f ${container} 2>/dev/null; docker rm -f ${container}-mysql 2>/dev/null; echo "REMOVED"`, 15).catch(() => {});

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
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
}
NGINX
nginx -t && systemctl reload nginx
echo "NGINX_CONFIGURED"
`;

        executeOnServer(input.serverId, nginxScript, 30).catch(() => {});
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

      // Remove Nginx config via SSH
      executeOnServer(domain.server.id, `rm -f /etc/nginx/sites-enabled/${domain.domain.name}.conf && nginx -t && systemctl reload nginx && echo "REMOVED"`, 15).catch(() => {});

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
