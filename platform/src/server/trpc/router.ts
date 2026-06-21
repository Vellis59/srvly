import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, agentProcedure } from "@/server/trpc/context";
import { servers, installations, recipes, domains, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

// ─── SSH key conversion (uses system ssh-keygen) ───

function pemToOpenSsh(privateKeyPem: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srvly-key-"));
  const keyPath = path.join(tmpDir, "id_rsa");
  fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  try {
    const output = execSync(
      `ssh-keygen -y -f "${keyPath}" 2>/dev/null`,
      { encoding: "utf8", timeout: 5000 },
    );
    return output.trim() + "\n";
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Server routes ───

export const serverRouter = router({
  list: agentProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select()
      .from(servers)
      .where(eq(servers.userId, ctx.user.id!))
      .orderBy(servers.createdAt);
  }),

  get: agentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });
      return server;
    }),

  create: agentProcedure
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

      // Extract public key via ssh-keygen (guarantees correct OpenSSH format)
      const sshPublicKey = pemToOpenSsh(privateKey);

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

  delete: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      return { success: true };
    }),

  execute: agentProcedure
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

  testConnection: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.id,
        [
          "echo '---OS---'",
          "cat /etc/os-release 2>/dev/null | head -5 || cat /etc/*release 2>/dev/null | head -3 || uname -a",
          "echo '---RAM---'",
          "free -m 2>/dev/null | awk '/^Mem:/{print $2\" \"$3\" \"$4}' || echo '0 0 0'",
          "echo '---DISK---'",
          "df -BG / 2>/dev/null | awk 'NR==2{print $2\" \"$3\" \"$4}' || echo '0 0 0'",
          "echo '---UPTIME---'",
          "uptime -p 2>/dev/null || uptime",
          "echo '---HOSTNAME---'",
          "hostname",
        ].join("\n"),
        15,
      );

      if (result.success) {
        let detectedOs = null;
        let systemInfo: Record<string, any> = {};
        const output = result.output || "";

        // OS
        const osMatch = output.match(/---OS---\n([\s\S]*?)---RAM---/);
        if (osMatch) {
          const osRaw = osMatch[1].trim().split("\n").slice(0, 3).join("; ");
          const pretty = osRaw.match(/PRETTY_NAME="?([^"\n]+)"?/);
          detectedOs = pretty ? pretty[1] : osRaw.slice(0, 100);
        }

        // RAM: total used available (MB)
        const ramMatch = output.match(/---RAM---\n(.+?)\n/);
        if (ramMatch) {
          const parts = ramMatch[1].trim().split(/\s+/);
          if (parts.length >= 3) {
            systemInfo.ramTotal = parseInt(parts[0], 10) || 0;
            systemInfo.ramUsed = parseInt(parts[1], 10) || 0;
            systemInfo.ramAvailable = parseInt(parts[2], 10) || 0;
          }
        }

        // Disk: size used available (GB suffix)
        const diskMatch = output.match(/---DISK---\n(.+?)\n/);
        if (diskMatch) {
          const parts = diskMatch[1].trim().split(/\s+/);
          if (parts.length >= 3) {
            systemInfo.diskTotal = parseInt(parts[0].replace("G", ""), 10) || 0;
            systemInfo.diskUsed = parseInt(parts[1].replace("G", ""), 10) || 0;
            systemInfo.diskAvailable = parseInt(parts[2].replace("G", ""), 10) || 0;
          }
        }

        // Uptime
        const uptimeMatch = output.match(/---UPTIME---\n(.+?)\n/);
        if (uptimeMatch) {
          systemInfo.uptime = uptimeMatch[1].trim().replace(/^up\s*/, "");
        }

        const detectedRam = systemInfo.ramTotal || null;

        await ctx.db
          .update(servers)
          .set({
            status: "connected",
            lastSeen: new Date(),
            os: detectedOs,
            ram: detectedRam,
            systemInfo,
          })
          .where(eq(servers.id, input.id));

        // Build readable summary
        const parts: string[] = [];
        parts.push(`OS: ${detectedOs || "inconnu"}`);
        if (systemInfo.ramTotal) {
          const total = (systemInfo.ramTotal / 1024).toFixed(1);
          const used = (systemInfo.ramUsed / 1024).toFixed(1);
          parts.push(`RAM: ${used}/${total} Go`);
        }
        if (systemInfo.diskTotal) {
          parts.push(`Disque: ${systemInfo.diskUsed}/${systemInfo.diskTotal} Go`);
        }
        if (systemInfo.uptime) {
          parts.push(`Uptime: ${systemInfo.uptime}`);
        }

        return { success: true, output: parts.join(" \u2022 ") };
      }

      return {
        success: false,
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
  list: agentProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select()
      .from(installations)
      .innerJoin(servers, eq(installations.serverId, servers.id))
      .innerJoin(recipes, eq(installations.recipeId, recipes.id))
      .where(eq(servers.userId, ctx.user.id!))
      .orderBy(installations.createdAt);
  }),

  create: agentProcedure
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

  delete: agentProcedure
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

  // ── Agent API ──────────────────────────────────────────────

  register: agentProcedure
    .input(
      z.object({
        serverId: z.string(),
        name: z.string().min(1),
        type: z.string().default("app"),
        port: z.number().int().optional(),
        domain: z.string().optional(),
        image: z.string().optional(),
        containerName: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const [inst] = await ctx.db
        .insert(installations)
        .values({
          serverId: input.serverId,
          recipeId: input.type || "app",
          status: "success",
          params: {
            name: input.name,
            port: input.port,
            domain: input.domain,
            image: input.image,
            containerName: input.containerName,
            notes: input.notes,
          },
          result: {},
          logs: "",
        })
        .returning();

      return { id: inst.id, message: `${input.name} enregistrée` };
    }),

  update: agentProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["running", "success", "failed", "stopped"]).optional(),
        port: z.number().int().optional(),
        domain: z.string().optional(),
        containerName: z.string().optional(),
        logs: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const currentParams = (row.installation.params as any) || {};
      const updates: any = { updatedAt: new Date() };
      if (input.status) updates.status = input.status;
      if (input.logs !== undefined) updates.logs = input.logs;
      if (input.port || input.domain || input.containerName || input.notes) {
        updates.params = {
          ...currentParams,
          ...(input.port ? { port: input.port } : {}),
          ...(input.domain ? { domain: input.domain } : {}),
          ...(input.containerName ? { containerName: input.containerName } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        };
      }

      await ctx.db
        .update(installations)
        .set(updates)
        .where(eq(installations.id, input.id));

      return { success: true };
    }),

  // ── App Actions (SSH) ──────────────────────────────────────

  logs: agentProcedure
    .input(z.object({ id: z.string(), lines: z.number().int().default(100) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      const result = await executeOnServer(
        row.server.id,
        `docker logs --tail ${input.lines} ${container} 2>&1 || echo "CONTAINER_NOT_FOUND"`,
        15,
      );

      return result;
    }),

  restart: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      const result = await executeOnServer(
        row.server.id,
        `docker restart ${container} 2>&1 && echo "RESTARTED" || echo "RESTART_FAILED"`,
        15,
      );

      return result;
    }),

  stop: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      await executeOnServer(row.server.id, `docker stop ${container} 2>&1`, 15).catch(() => {});
      await ctx.db
        .update(installations)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(installations.id, input.id));

      return { success: true, message: `${container} arrêté` };
    }),

  start: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      await executeOnServer(row.server.id, `docker start ${container} 2>&1`, 15).catch(() => {});
      await ctx.db
        .update(installations)
        .set({ status: "success", updatedAt: new Date() })
        .where(eq(installations.id, input.id));

      return { success: true, message: `${container} démarré` };
    }),

  getEnv: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      const result = await executeOnServer(
        row.server.id,
        `docker inspect ${container} --format='{{range .Config.Env}}{{println .}}{{end}}' 2>&1 || echo "CONTAINER_NOT_FOUND"`,
        15,
      );

      return result;
    }),

  listForServer: agentProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) return [];

      return await ctx.db
        .select()
        .from(installations)
        .where(eq(installations.serverId, input.serverId))
        .orderBy(installations.createdAt);
    }),
});

// ─── Domain routes ───

export const userRouter = router({
  getToken: agentProcedure.query(async ({ ctx }) => {
    let token = ctx.user.apiToken;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      await ctx.db
        .update(users)
        .set({ apiToken: token })
        .where(eq(users.id, ctx.user.id));
    }
    return { token, user: { name: ctx.user.name, email: ctx.user.email } };
  }),

  regenerateToken: agentProcedure.mutation(async ({ ctx }) => {
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await ctx.db
      .update(users)
      .set({ apiToken: token })
      .where(eq(users.id, ctx.user.id));
    return { token };
  }),
});

export const domainRouter = router({
  list: agentProcedure
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

  add: agentProcedure
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

  delete: agentProcedure
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
  user: userRouter,
});

export type AppRouter = typeof appRouter;
