import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, agentProcedure } from "@/server/trpc/context";
import { servers, installations, recipes, domains, users, backups, categories } from "@/server/db/schema";
import { eq, and, or, ilike, inArray, sql } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { generateKeyPairSync, createHash } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { encryptKey } from "@/lib/crypto";
import { sshQueue } from "@/lib/queue";

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
        sshKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        // Lock user record to prevent race conditions on server limit check
        const [userRecord] = await tx
          .select({ plan: users.plan, maxServers: users.maxServers })
          .from(users)
          .where(eq(users.id, ctx.user.id!))
          .for("update")
          .limit(1);

        const maxServers = userRecord?.maxServers ?? 1;
        if (maxServers > 0) {
          const existingCount = await tx
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(servers)
            .where(eq(servers.userId, ctx.user.id!));
          const currentCount = existingCount[0]?.count ?? 0;
          if (currentCount >= maxServers) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: maxServers === 1
                ? "Free plan limited to 1 server. Self-host srvly for unlimited servers, or upgrade."
                : `Your plan allows up to ${maxServers} servers. Self-host srvly or upgrade for more.`,
            });
          }
        }

        let sshPrivateKey: string;
        let sshPublicKey: string;

        if (input.sshKey) {
          // Generate srvly's own key pair
          const { publicKey, privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 4096,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
          });
          sshPrivateKey = privateKey;
          sshPublicKey = pemToOpenSsh(privateKey);
        } else {
          // Generate fresh key pair (default behavior)
          const { publicKey, privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 4096,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs1", format: "pem" },
          });
          sshPrivateKey = privateKey;
          sshPublicKey = pemToOpenSsh(privateKey);
        }

        const [server] = await tx
          .insert(servers)
          .values({
            userId: ctx.user.id!,
            name: input.name,
            ip: input.ip,
            sshPrivateKey: encryptKey(sshPrivateKey),
            sshPublicKey,
            userSshKey: input.sshKey || null,
            status: "pending",
          })
          .returning();

        return {
          server,
          sshPrivateKey,
          sshPublicKey,
        };
      });

      // If user provided a key, return combined installation command
      return {
        ...result.server,
        sshPrivateKey: result.sshPrivateKey, // return plaintext to the creator for api compatibility
        userSshKey: input.sshKey || null,
        connectCommand: input.sshKey
          ? `echo '${input.sshKey}' >> /root/.ssh/authorized_keys && echo '${result.sshPublicKey}' >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && mkdir -p /root/.ssh && chmod 700 /root/.ssh`
          : `echo '${result.sshPublicKey}' >> /root/.ssh/authorized_keys\nchmod 600 /root/.ssh/authorized_keys\nmkdir -p /root/.ssh && chmod 700 /root/.ssh`,
      };
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

      // Detect which setup step was completed from output markers
      const output = result.output || "";
      const currentInfo = (server.systemInfo || {}) as Record<string, any>;
      const setupSteps = { ...((currentInfo.setupSteps || {}) as Record<string, boolean>) };

      if (output.includes("SECURITY DONE")) setupSteps.security = true;
      if (output.includes("DOCKER DONE")) setupSteps.docker = true;
      if (output.includes("NGINX DONE")) setupSteps.nginx = true;
      if (output.includes("SSL TOOLING INSTALLED")) setupSteps.ssl = true;

      const hasStepUpdates = Object.values(setupSteps).some(Boolean);

      // Build update payload
      const updateData: Record<string, any> = {};

      if (result.success && server.status === "pending") {
        updateData.status = "connected";
        updateData.lastSeen = new Date();
      } else if (result.success) {
        updateData.lastSeen = new Date();
      }

      if (hasStepUpdates) {
        updateData.systemInfo = { ...currentInfo, setupSteps };
      }

      if (Object.keys(updateData).length > 0) {
        await ctx.db
          .update(servers)
          .set(updateData)
          .where(eq(servers.id, input.id));
      }

      return result;
    }),

  checkServices: agentProcedure
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
          "echo '---DOCKER---'",
          "docker --version 2>/dev/null && echo 'DOCKER_ENGINE_OK' || true",
          'docker ps --format "{{.Names}}|{{.Status}}|{{.Image}}" 2>/dev/null | head -30',
          "echo '---CADDY---'",
          "caddy version 2>/dev/null && echo 'CADDY_OK' || echo 'CADDY:not found'",
          'systemctl is-active caddy 2>/dev/null || true',
          "echo '---NGINX---'",
          "nginx -v 2>&1 && echo 'NGINX_OK' || echo 'NGINX:not found'",
          'systemctl is-active nginx 2>/dev/null || true',
          "echo '---UFW---'",
          "ufw status verbose 2>/dev/null | head -10 || echo 'UFW:not found'",
          "echo '---FAIL2BAN---'",
          "fail2ban-client status 2>/dev/null | head -5 || echo 'FAIL2BAN:not found'",
          "echo '---DISK---'",
          'df -h / 2>/dev/null | awk \'NR==2{print $2"|"$3"|"$4"|"$5}\' || echo "0|0|0|0"',
          "echo '---RAM---'",
          'free -m 2>/dev/null | awk \'/^Mem:/{print $2"|"$3"|"$4}\' || echo "0|0|0"',
          "echo '---UPTIME---'",
          "uptime -p 2>/dev/null || uptime",
        ].join("\n"),
        30,
      );

      if (!result.success) return { success: false, output: result.output, error: result.error };

      const output = result.output || "";
      const services: Record<string, string> = {};

      const extract = (marker: string) => {
        const parts = output.split(`---${marker}---`);
        if (parts.length < 2) return "";
        return parts[1].split("\n---")[0]?.trim() || "";
      };

      services.docker = extract("DOCKER");
      services.caddy = extract("CADDY");
      services.nginx = extract("NGINX");
      services.ufw = extract("UFW");
      services.fail2ban = extract("FAIL2BAN");

      // Disk & RAM
      const diskRaw = extract("DISK");
      const ramRaw = extract("RAM");
      const uptime = extract("UPTIME");

      // Detect which services are active
      const status: Record<string, "installed" | "missing" | "error"> = {};
      status.docker = services.docker.includes("DOCKER_ENGINE_OK") ? "installed" : "missing";
      status.nginx = services.nginx.includes("NGINX_OK") ? "installed" : "missing";
      status.caddy = services.caddy.includes("CADDY_OK") ? "installed" : "missing";
      status.ufw = services.ufw.includes("Status: active") || services.ufw.includes("Status: inactive") ? "installed" : "missing";
      status.fail2ban = services.fail2ban.includes("Status") ? "installed" : "missing";

      // Update system info with refreshed data
      const currentInfo = (server.systemInfo || {}) as Record<string, any>;
      const updates: Record<string, any> = { lastSeen: new Date() };

      // Parse disk: "size|used|avail|use%"
      if (diskRaw && diskRaw !== "0|0|0|0") {
        const dp = diskRaw.split("|");
        currentInfo.diskTotal = dp[0]?.replace("G", "") || currentInfo.diskTotal;
        currentInfo.diskUsed = dp[1]?.replace("G", "") || currentInfo.diskUsed;
        currentInfo.diskAvailable = dp[2]?.replace("G", "") || currentInfo.diskAvailable;
        currentInfo.diskUsePct = dp[3] || "";
      }
      // Parse RAM: "total|used|available"
      if (ramRaw && ramRaw !== "0|0|0") {
        const rp = ramRaw.split("|");
        currentInfo.ramTotal = parseInt(rp[0]) || currentInfo.ramTotal;
        currentInfo.ramUsed = parseInt(rp[1]) || currentInfo.ramUsed;
        currentInfo.ramAvailable = parseInt(rp[2]) || currentInfo.ramAvailable;
      }
      if (uptime) currentInfo.uptime = uptime.replace(/^up\s*/, "");

      currentInfo.services = status;
      updates.systemInfo = currentInfo;

      await ctx.db.update(servers).set(updates).where(eq(servers.id, input.id));

      return {
        success: true,
        services: status,
        containers: services.docker.split("\n").filter((l) => l.includes("|")).length,
        disk: currentInfo.diskTotal ? `${currentInfo.diskUsed}/${currentInfo.diskTotal}GB` : null,
        ram: currentInfo.ramTotal ? `${Math.round(currentInfo.ramUsed/1024*10)/10}/${Math.round(currentInfo.ramTotal/1024*10)/10}GB` : null,
        uptime: currentInfo.uptime || null,
      };
    }),

  collectMetrics: agentProcedure
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
          "echo '---LOAD---'",
          "cat /proc/loadavg 2>/dev/null | awk '{print $1,$2,$3}' || echo '0 0 0'",
          "echo '---RAM---'",
          "free -m 2>/dev/null | awk '/^Mem:/{print $2,$3,$4,$7}' || echo '0 0 0 0'",
          "echo '---DISK---'",
          "df -BG / 2>/dev/null | awk 'NR==2{print $2,$3,$4,$5}' | sed 's/G//g' || echo '0 0 0 0%'",
          "echo '---DOCKER---'",
          "docker info --format '{{.ContainersRunning}}/{{.Containers}}' 2>/dev/null || echo '0/0'",
          "docker system df --format '{{.Type}}|{{.Size}}' 2>/dev/null | head -5",
          "docker ps -q 2>/dev/null | wc -l",
          "echo '---UPTIME---'",
          "uptime -p 2>/dev/null || uptime",
        ].join("\n"),
        15,
      );

      if (!result.success) return { success: false, output: result.output, error: result.error };

      const output = result.output || "";

      // Parse load
      const loadMatch = output.match(/---LOAD---\n(.+?)\n/);
      const loadParts = loadMatch ? loadMatch[1].trim().split(/\s+/) : ["0","0","0"];

      // Parse RAM
      const ramMatch = output.match(/---RAM---\n(.+?)\n/);
      const ramParts = ramMatch ? ramMatch[1].trim().split(/\s+/) : ["0","0","0","0"];

      // Parse disk
      const diskMatch = output.match(/---DISK---\n(.+?)\n/);
      const diskParts = diskMatch ? diskMatch[1].trim().split(/\s+/) : ["0","0","0","0%"];

      // Parse docker
      const dockerLine = (output.split("---DOCKER---")[1]?.split("---UPTIME---")[0] || "").trim();
      const containerLine = dockerLine.split("\n").filter(l => l.includes("/"))[0] || "0/0";
      const [containersRunning, containersTotal] = containerLine.split("/").map(Number);

      // Current disk
      const currentInfo = (server.systemInfo || {}) as Record<string, any>;
      const metricsHistory = (currentInfo.metricsHistory || []) as any[];

      const entry = {
        ts: new Date().toISOString(),
        cpuLoad1: parseFloat(loadParts[0]) || 0,
        cpuLoad5: parseFloat(loadParts[1]) || 0,
        cpuLoad15: parseFloat(loadParts[2]) || 0,
        ramTotal: parseInt(ramParts[0]) || 0,
        ramUsed: parseInt(ramParts[1]) || 0,
        ramAvailable: parseInt(ramParts[3]) || parseInt(ramParts[2]) || 0,
        diskTotal: parseInt(diskParts[0]) || 0,
        diskUsed: parseInt(diskParts[1]) || 0,
        diskAvailable: parseInt(diskParts[2]) || 0,
        diskUsePct: (diskParts[3] || "0%").replace("%", ""),
        containersRunning: containersRunning || 0,
        containersTotal: containersTotal || 0,
      };

      // Keep last 48 entries
      metricsHistory.push(entry);
      if (metricsHistory.length > 48) metricsHistory.splice(0, metricsHistory.length - 48);

      // Update server info
      await ctx.db
        .update(servers)
        .set({
          systemInfo: {
            ...currentInfo,
            ramTotal: entry.ramTotal,
            ramUsed: entry.ramUsed,
            ramAvailable: entry.ramAvailable,
            diskTotal: entry.diskTotal,
            diskUsed: entry.diskUsed,
            diskAvailable: entry.diskAvailable,
            diskUsePct: entry.diskUsePct,
            uptime: (output.split("---UPTIME---")[1] || "").trim().replace(/^up\s*/, "") || currentInfo.uptime,
            metricsHistory,
          },
          lastSeen: new Date(),
        })
        .where(eq(servers.id, input.id));

      return { success: true, ...entry, metricsCount: metricsHistory.length };
    }),

  metrics: agentProcedure
    .input(z.object({ id: z.string(), limit: z.number().int().positive().default(24) }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!server) return { metrics: [], warnings: [] };

      const info = (server.systemInfo || {}) as Record<string, any>;
      const history = (info.metricsHistory || []).slice(-input.limit);

      // Compute warnings
      const warnings: string[] = [];
      if (history.length > 0) {
        const latest = history[history.length - 1];
        const diskPct = parseFloat(latest.diskUsePct || "0");
        const ramTotal = latest.ramTotal || 1;
        const ramPct = Math.round((latest.ramUsed / ramTotal) * 100);
        if (diskPct > 85) warnings.push(`⚠️ Disk at ${diskPct}% — critical threshold exceeded`);
        else if (diskPct > 70) warnings.push(`⚡ Disk at ${diskPct}% — approaching limit`);
        if (ramPct > 85) warnings.push(`⚠️ RAM at ${ramPct}% — critical`);
        else if (ramPct > 70) warnings.push(`⚡ RAM at ${ramPct}% — elevated`);
        const cpuLoad1 = latest.cpuLoad1 || 0;
        if (cpuLoad1 > 2.0) warnings.push(`⚠️ CPU load high (${cpuLoad1})`);
        else if (cpuLoad1 > 1.0) warnings.push(`⚡ CPU load elevated (${cpuLoad1})`);
        if (latest.containersRunning < latest.containersTotal) {
          warnings.push(`⚠️ ${latest.containersTotal - latest.containersRunning} container(s) not running`);
        }
      }

      return { metrics: history, warnings };
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
  list: publicProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          subcategory: z.string().optional(),
          search: z.string().optional(),
          sort: z.enum(["name", "recent"]).optional(),
          limit: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [];

      if (input?.category) {
        conditions.push(eq(recipes.category, input.category));
      }
      if (input?.subcategory) {
        conditions.push(eq(recipes.subcategory, input.subcategory));
      }
      if (input?.search) {
        conditions.push(
          or(
            ilike(recipes.name, `%${input.search}%`),
            ilike(recipes.description, `%${input.search}%`)
          )
        );
      }

      const results = await ctx.db
        .select({
          id: recipes.id,
          name: recipes.name,
          description: recipes.description,
          category: recipes.category,
          subcategory: recipes.subcategory,
          version: recipes.version,
          icon: recipes.icon,
          dependencies: recipes.dependencies,
        })
        .from(recipes)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(input?.sort === "recent" ? recipes.createdAt : recipes.name);

      return input?.limit ? results.slice(0, input.limit) : results;
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

  /** Return taxonomy with per-category counts */
  categories: publicProcedure.query(async ({ ctx }) => {
    const all = await ctx.db
      .select({ category: recipes.category })
      .from(recipes);

    const counts: Record<string, number> = {};
    for (const r of all) {
      const cat = r.category || "other";
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const { TAXONOMY } = await import("@/lib/taxonomy");
    return TAXONOMY.map((cat) => ({
      ...cat,
      count: counts[cat.id] || 0,
    }));
  }),

  /** Get category page: category info + apps grouped by subcategory */
  category: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { TAXONOMY } = await import("@/lib/taxonomy");
      const catDef = TAXONOMY.find((c) => c.id === input.id);
      if (!catDef) throw new TRPCError({ code: "NOT_FOUND" });

      const apps = await ctx.db
        .select({
          id: recipes.id,
          name: recipes.name,
          description: recipes.description,
          subcategory: recipes.subcategory,
          version: recipes.version,
          icon: recipes.icon,
          dependencies: recipes.dependencies,
        })
        .from(recipes)
        .where(eq(recipes.category, input.id))
        .orderBy(recipes.name);

      // Group by subcategory
      const grouped: Record<string, typeof apps> = {};
      for (const app of apps) {
        const sub = app.subcategory || "_uncategorized";
        if (!grouped[sub]) grouped[sub] = [];
        grouped[sub].push(app);
      }

      return {
        category: catDef,
        total: apps.length,
        subcategories: catDef.subcategories.map((sc) => ({
          ...sc,
          apps: grouped[sc.id] || [],
        })),
        uncategorized: grouped["_uncategorized"] || [],
      };
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

      // Queue the deployment task in BullMQ
      await sshQueue.add("install", {
        serverId: input.serverId,
        script,
        timeout: 180,
        dbTable: "installations",
        dbId: inst.id,
      });

      return {
        id: inst.id,
        port: port,
        script: script,
        message: `Installation of ${recipe.name} queued on port ${port}...`,
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

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId || "app";
      const domain = params.domain || null;
      const safeName = row.installation.recipeId || container;
      const networkName = `srvly-${safeName.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;

      // Build comprehensive cleanup script
      const script = [
        `echo ">>> Stopping & removing container ${container}..."`,
        `docker stop ${container} 2>/dev/null || true`,
        `docker rm -f ${container} 2>/dev/null || true`,
        `docker rm -f ${safeName}-mysql 2>/dev/null || true`,
        ``,
        `echo ">>> Removing Docker network ${networkName}..."`,
        `docker network rm ${networkName} 2>/dev/null || true`,
        ``,
        `echo ">>> Cleaning up data directories..."`,
        `rm -rf "/opt/srvly/${container}" 2>/dev/null || true`,
        `rm -f "/tmp/srvly-${container}.env" 2>/dev/null || true`,
        ``,
        // Remove reverse proxy config if domain is set
        domain ? [
          `echo ">>> Removing proxy config for ${domain}..."`,
          // Caddy — remove block from any Caddyfile
          `for CFG in /opt/srvly/infra/Caddyfile /etc/caddy/Caddyfile; do`,
          `  if [ -f "$CFG" ]; then`,
          `    sed -i "/^${domain} {/,/^}/d" "$CFG" 2>/dev/null || true`,
          `  fi`,
          `done`,
          // nginx — remove config file
          `rm -f "/etc/nginx/sites-enabled/${domain}.conf" 2>/dev/null || true`,
          ``,
          // Reload whichever proxy is active
          `echo ">>> Reloading reverse proxy..."`,
          `if command -v caddy &>/dev/null && docker ps -q --filter name=caddy 2>/dev/null | grep -q .; then`,
          `  docker exec $(docker ps -q --filter name=caddy) caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true`,
          `elif command -v caddy &>/dev/null; then`,
          `  caddy reload 2>/dev/null || systemctl reload caddy 2>/dev/null || true`,
          `elif command -v nginx &>/dev/null; then`,
          `  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true`,
          `fi`,
        ].join("\n") : null,
        ``,
        `echo "CLEANUP_DONE"`,
      ]
        .filter(Boolean)
        .join("\n");

      await executeOnServer(row.server.id, script, 30).catch(() => {});

      // Delete associated domain records from DB
      if (domain) {
        await ctx.db
          .delete(domains)
          .where(and(eq(domains.name, domain), eq(domains.serverId, row.server.id)))
          .catch(() => {});
      }
      // Also try by targetApp matching container or recipeId
      await ctx.db
        .delete(domains)
        .where(
          and(
            eq(domains.serverId, row.server.id),
            eq(domains.targetApp, container),
          ),
        )
        .catch(() => {});

      // Delete installation record
      await ctx.db.delete(installations).where(eq(installations.id, input.id));
      return { success: true, message: `${container} uninstalled and cleaned up` };
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

      return { id: inst.id, message: `${input.name} registered` };
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

      return { success: true, message: `${container} stopped` };
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

      return { success: true, message: `${container} started` };
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

  assignCategory: agentProcedure
    .input(z.object({ id: z.string(), categoryId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership: installation → server → user
      const [row] = await ctx.db
        .select({ installation: installations })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // If categoryId is set, verify it belongs to user
      if (input.categoryId) {
        const [cat] = await ctx.db
          .select()
          .from(categories)
          .where(and(eq(categories.id, input.categoryId), eq(categories.userId, ctx.user.id!)));
        if (!cat) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      }

      await ctx.db
        .update(installations)
        .set({ categoryId: input.categoryId })
        .where(eq(installations.id, input.id));
      return { success: true };
    }),

  detectContainers: agentProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.serverId,
        `docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>&1 | sort`,
        15
      );

      if (!result.success) return { success: false, containers: [], error: result.error };

      const lines = (result.output || "").trim().split("\n");
      const containers = lines
        .filter((l: string) => l.includes("|"))
        .map((l: string) => {
          const parts = l.split("|");
          const ports = parts[3] || "";
          // Extract host port from "0.0.0.0:8080->80/tcp" or "8080/tcp"
          const hostPortMatch = ports.match(/(\d+)->/) || ports.match(/^(\d+)\/tcp/);
          return {
            name: parts[0],
            image: parts[1],
            status: parts[2]?.toLowerCase().includes("up") ? "running" : "stopped",
            ports,
            port: hostPortMatch ? parseInt(hostPortMatch[1]) : null,
          };
        });

      return { success: true, containers };
    }),

  get: agentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          installation: installations,
          server: servers,
        })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Also fetch recipe info if available
      let recipe = null;
      if (row.installation.recipeId && row.installation.recipeId !== "app") {
        const [r] = await ctx.db
        .select()
        .from(recipes)
        .where(eq(recipes.id, row.installation.recipeId))
        .limit(1);
        recipe = r || null;
      }

      return {
        ...row.installation,
        server: row.server,
        recipe,
      };
    }),

  containerStats: agentProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.serverId,
        [
          "echo '---STATS---'",
          "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>&1",
          "echo '---SIZE---'",
          "docker ps --size --format '{{.Names}}|{{.Size}}' 2>&1",
        ].join("\n"),
        15,
      );

      if (!result.success) return { success: false, output: result.output, error: result.error };

      const output = result.output || "";
      const statsPart = output.split("---STATS---")[1]?.split("---SIZE---")[0]?.trim() || "";
      const sizePart = output.split("---SIZE---")[1]?.trim() || "";

      const stats: Record<string, any> = {};
      for (const line of statsPart.split("\n")) {
        const parts = line.split("|");
        if (parts.length >= 4) {
          const name = parts[0].replace(/^\//, "");
          stats[name] = { cpu: parts[1]?.trim() || "—", mem: parts[2]?.trim() || "—", memPct: parts[3]?.trim() || "—" };
        }
      }

      const sizes: Record<string, string> = {};
      for (const line of sizePart.split("\n")) {
        const parts = line.split("|");
        if (parts.length >= 2) sizes[parts[0]] = parts[1]?.trim() || "—";
      }

      return { success: true, stats, sizes };
    }),

  inspect: agentProcedure
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
        [
          `echo '---CONFIG---'`,
          `docker inspect ${container} 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)[0]
    c = d['Config']
    h = d['HostConfig']
    n = d['NetworkSettings']
    ns = n['Networks']
    net = list(ns.keys())[0] if ns else 'bridge'
    ports = []
    if h.get('PortBindings'):
        for k,v in h['PortBindings'].items():
            cport = k.split('/')[0]
            hport = v[0]['HostPort'] if v else cport
            ports.append(f'{hport}:{cport}')
    vols = h.get('Binds') or []
    print('IMAGE=' + (c.get('Image') or ''))
    print('STATUS=' + (d['State']['Status'] or 'unknown'))
    print('HEALTH=' + (d['State'].get('Health',{}).get('Status', 'none') or 'none'))
    print('STARTED=' + (d['State'].get('StartedAt','') or ''))
    print('RESTART=' + (h.get('RestartPolicy',{}).get('Name', 'no') or 'no'))
    print('NETWORK=' + net)
    print('PORTS=' + '|'.join(ports))
    print('VOLUMES=' + '|'.join(vols))
    for e in (c.get('Env') or []):
        print('ENV:' + e)
except Exception as ex:
    print('ERROR=' + str(ex))
" 2>&1 || echo 'CONTAINER_NOT_FOUND'`,
          `echo '---UPTIME---'`,
          `docker inspect ${container} --format='{{.State.StartedAt}}' 2>/dev/null | xargs -I{} sh -c 'echo "{}" && python3 -c "
import datetime, sys
start = sys.argv[1].split('.')[0].replace('T',' ').replace('Z','')
try:
    s = datetime.datetime.strptime(start, '%Y-%m-%d %H:%M:%S')
    now = datetime.datetime.utcnow()
    d = now - s
    days = d.days
    hours = d.seconds // 3600
    mins = (d.seconds % 3600) // 60
    print(f'UPTIME={days}d {hours}h {mins}m')
except:
    print('UPTIME=unknown')
" "{}"' || echo 'UPTIME=unknown'`,
        ].join("\n"),
        15,
      );

      if (!result.success) return { success: false, error: result.error };

      const output = result.output || "";
      const configPart = (output.split("---CONFIG---")[1]?.split("---UPTIME---")[0] || "").trim();
      const uptimePart = (output.split("---UPTIME---")[1] || "").trim();
      if (configPart.includes("CONTAINER_NOT_FOUND")) return { success: false, error: "Container not found" };

      // Parse config
      const config: Record<string, string> = {};
      const env: Record<string, string> = {};
      for (const line of configPart.split("\n")) {
        if (line.startsWith("ENV:")) {
          const eqIdx = line.indexOf("=", 4);
          if (eqIdx > 4) {
            env[line.substring(4, eqIdx)] = line.substring(eqIdx + 1);
          }
        } else if (line.includes("=")) {
          const [k, ...v] = line.split("=");
          config[k] = v.join("=");
        }
      }

      // Parse uptime
      const uptimeLine = uptimePart.includes("UPTIME=") ? uptimePart.split("\n").filter(l => l.startsWith("UPTIME="))[0] : "";
      const uptime = uptimeLine ? uptimeLine.replace("UPTIME=", "") : "";

      return {
        success: true,
        status: config.STATUS || "unknown",
        health: config.HEALTH || "none",
        uptime: uptime || config.STARTED || "unknown",
        image: config.IMAGE || "",
        restartPolicy: config.RESTART || "",
        network: config.NETWORK || "",
        ports: config.PORTS || "",
        volumes: config.VOLUMES || "",
        env,
      };
    }),

  updateEnv: agentProcedure
    .input(z.object({
      id: z.string(),
      env: z.record(z.string(), z.string()),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const container = params.containerName || params.name || row.installation.recipeId;

      // Validate container name to prevent execution bugs
      if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
        return { success: false, error: "Invalid container name format" };
      }

      // Validate env keys and values
      for (const [k, v] of Object.entries(input.env)) {
        if (!/^[a-zA-Z0-9_-]+$/.test(k)) {
          return { success: false, error: `Invalid environment variable key format: ${k}` };
        }
      }

      // Get current container config via docker inspect
      const result = await executeOnServer(
        row.server.id,
        `docker inspect ${container} 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)[0]
c = d['Config']
h = d['HostConfig']
n = d['NetworkSettings']
ns = n['Networks']
net = list(ns.keys())[0] if ns else 'bridge'
ports = []
if h.get('PortBindings'):
    for k,v in h['PortBindings'].items():
        cport = k.split('/')[0]
        hport = v[0]['HostPort'] if v else cport
        ports.append(f'{hport}:{cport}')
vols = h.get('Binds') or []
print('IMAGE=' + (c.get('Image') or ''))
print('RESTART=' + (h.get('RestartPolicy',{}).get('Name', 'no') or 'no'))
print('NETWORK=' + net)
print('PORTS=' + '|'.join(ports))
print('VOLUMES=' + '|'.join(vols))
for e in (c.get('Env') or []):
    print('ENV:' + e)
" 2>&1 || echo 'CONTAINER_NOT_FOUND'`,
        15,
      );

      if (!result.success || (result.output || "").includes("CONTAINER_NOT_FOUND")) {
        return { success: false, error: "Container not found" };
      }

      const output = result.output || "";
      let image = "", restart = "unless-stopped", network = "", ports = "", volumes: string[] = [];
      for (const line of output.split("\n")) {
        if (line.startsWith("IMAGE=")) image = line.substring(6);
        if (line.startsWith("RESTART=")) restart = line.substring(8);
        if (line.startsWith("NETWORK=")) network = line.substring(8);
        if (line.startsWith("PORTS=")) ports = line.substring(6);
        if (line.startsWith("VOLUMES=")) volumes = line.substring(8).split("|").filter(Boolean);
      }

      // Build volume args
      const volArgs = volumes.map(v => `-v ${v}`).join(" ");

      // Build port args
      const portArgs = ports ? ports.split("|").map(p => `-p ${p}`).join(" ") : "";

      // Recreate container with safe .env file (Heredoc literal 'ENV_EOF')
      const envLines = Object.entries(input.env).map(([k, v]) => `${k}=${v}`).join("\n");
      const envFilePath = `/tmp/srvly-${container}.env`;

      const script = [
        `cat > "${envFilePath}" << 'ENV_EOF'`,
        envLines,
        `ENV_EOF`,
        `echo "Stopping ${container}..."`,
        `docker stop ${container} 2>/dev/null || true`,
        `echo "Removing ${container}..."`,
        `docker rm ${container} 2>/dev/null || true`,
        `echo "Starting with new env..."`,
        `docker run -d --name ${container} --restart ${restart} ${portArgs} ${volArgs} --env-file "${envFilePath}" ${image} 2>&1`,
        `rm -f "${envFilePath}"`,
        `echo "RESTARTED"`,
      ].join("\n");

      const runResult = await executeOnServer(row.server.id, script, 30);

      if (runResult.success) {
        // Update stored params with new env
        const currentParams = (row.installation.params as any) || {};
        await ctx.db
          .update(installations)
          .set({
            params: { ...currentParams, env: input.env },
            updatedAt: new Date(),
          })
          .where(eq(installations.id, input.id));

        return { success: true, message: "Container recreated with new environment" };
      }

      return runResult;
    }),
});

// ─── Domain routes ───

export const userRouter = router({
  getToken: agentProcedure.query(async ({ ctx }) => {
    const user = ctx.user as any;
    const userId = user.id || user.email || "unknown";

    // First, try to read existing token from DB
    const [existing] = await ctx.db
      .select({ apiToken: users.apiToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing?.apiToken) {
      return { token: existing.apiToken, user: { name: user.name, email: user.email } };
    }

    // No existing token → generate a deterministic one and save
    const salt = process.env.NEXTAUTH_SECRET || "srvly-default-secret";
    const hash = createHash("sha256").update(userId + salt).digest("hex");
    const token = "srvly_" + hash.slice(0, 32);

    await ctx.db
      .insert(users)
      .values({
        id: userId,
        name: user.name || null,
        email: user.email || null,
        image: user.image || null,
        apiToken: token,
        plan: "free",
        maxServers: 1,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { apiToken: token, name: user.name, email: user.email },
      });

    return { token, plan: "free", maxServers: 1, user: { name: user.name, email: user.email } };
  }),

  getPlan: agentProcedure.query(async ({ ctx }) => {
    const [userRecord] = await ctx.db
      .select({ plan: users.plan, maxServers: users.maxServers, webhookUrl: users.webhookUrl, webhookMention: users.webhookMention })
      .from(users)
      .where(eq(users.id, ctx.user.id!))
      .limit(1);
    return {
      plan: userRecord?.plan ?? "free",
      maxServers: userRecord?.maxServers ?? 1,
      webhookUrl: userRecord?.webhookUrl ?? null,
      webhookMention: userRecord?.webhookMention ?? null,
      currentServers: await ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(servers)
        .where(eq(servers.userId, ctx.user.id!))
        .then(r => r[0]?.count ?? 0),
    };
  }),

  regenerateToken: agentProcedure.mutation(async ({ ctx }) => {
    const userId = (ctx.user as any).id || (ctx.user as any).email || "unknown";
    const salt = process.env.NEXTAUTH_SECRET || "srvly-default-secret";
    const ts = Date.now().toString(36);
    const hash = createHash("sha256").update(userId + salt + ts).digest("hex");
    const token = "srvly_" + hash.slice(0, 32);

    await ctx.db
      .update(users)
      .set({ apiToken: token })
      .where(eq(users.id, userId));

    return { token };
  }),

  saveWebhookUrl: agentProcedure
    .input(z.object({ url: z.string().max(500).nullable(), mention: z.string().max(100).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set({ webhookUrl: input.url, webhookMention: input.mention })
        .where(eq(users.id, ctx.user.id!));
      return { success: true };
    }),

  sendToAgent: agentProcedure
    .input(z.object({ text: z.string().min(1).max(10000) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select({ webhookUrl: users.webhookUrl, webhookMention: users.webhookMention })
        .from(users)
        .where(eq(users.id, ctx.user.id!))
        .limit(1);

      if (!user?.webhookUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No webhook URL configured. Set one in Settings." });
      }

      const text = user.webhookMention ? `@${user.webhookMention} ${input.text}` : input.text;

      const payload = {
        text,
        username: "srvly",
        icon_url: "https://srvly.app/favicon.ico",
      };

      try {
        const res = await fetch(user.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
          throw new Error(`Webhook responded with ${res.status}: ${await res.text().catch(() => "unknown")}`);
        }

        return { success: true };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to send to agent: ${err.message}`,
        });
      }
    }),
});

export const domainRouter = router({
  list: agentProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) return [];

      const rows = await ctx.db
        .select()
        .from(domains)
        .where(eq(domains.serverId, input.serverId))
        .orderBy(domains.createdAt);

      // Enrich with installation names
      const enriched = [];
      for (const d of rows) {
        let appName = d.targetApp || null;
        if (d.targetApp) {
          // targetApp can be either an installation UUID or a plain app name
          // Try UUID match first, then fallback to matching by params->>name
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.targetApp);
          let inst = null;
          if (isUuid) {
            const rows2 = await ctx.db
              .select({ params: installations.params })
              .from(installations)
              .where(eq(installations.id, d.targetApp))
              .limit(1);
            inst = rows2[0] || null;
          } else {
            // Match by recipeId or name in params
            const allInstalls = await ctx.db
              .select({ id: installations.id, params: installations.params, recipeId: installations.recipeId })
              .from(installations)
              .where(eq(installations.serverId, input.serverId));
            inst = allInstalls.find((i: any) => {
              const p = i.params as any;
              return i.recipeId === d.targetApp || p?.name === d.targetApp;
            }) || null;
          }
          if (inst) {
            const p = inst.params as any;
            appName = (p?.name) || d.targetApp;
          }
        }
        enriched.push({ ...d, appName });
      }
      return enriched;
    }),

  listAll: agentProcedure
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: domains.id,
          name: domains.name,
          sslStatus: domains.sslStatus,
          targetPort: domains.targetPort,
          targetApp: domains.targetApp,
          createdAt: domains.createdAt,
          serverId: servers.id,
          serverName: servers.name,
          serverIp: servers.ip,
        })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(eq(servers.userId, ctx.user.id!))
        .orderBy(domains.createdAt);

      // Enrich with installation names using a single batch lookup
      const appNameMap = new Map<string, string>();
      for (const row of rows) {
        if (row.targetApp) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.targetApp);
          if (isUuid && !appNameMap.has(row.targetApp)) {
            appNameMap.set(row.targetApp, "");
          }
        }
      }
      if (appNameMap.size > 0) {
        const uuids = Array.from(appNameMap.keys());
        const insts = await ctx.db
          .select({ id: installations.id, params: installations.params })
          .from(installations)
          .where(inArray(installations.id, uuids));
        for (const inst of insts) {
          const p = inst.params as any;
          appNameMap.set(inst.id, p?.name || "");
        }
      }

      return rows.map((r) => ({
        ...r,
        appName: r.targetApp && appNameMap.has(r.targetApp) ? appNameMap.get(r.targetApp) || r.targetApp : r.targetApp || null,
      }));
    }),

  add: agentProcedure
    .input(z.object({
      serverId: z.string(),
      name: z.string().min(3).max(255),
      targetPort: z.number().int().optional(),
      targetApp: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const domainRegex = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
      if (!domainRegex.test(input.name)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid domain format" });
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

      // Auto-configure Nginx if port is specified
      if (domain && input.targetPort) {
        const safeName = input.name.replace(/[^a-zA-Z0-9.-]/g, "-");
        const nginxScript = [
          `mkdir -p /var/www/certbot`,
          `cat > /etc/nginx/sites-enabled/${safeName}.conf << 'NGINX'`,
          `server {`,
          `    listen 80;`,
          `    server_name ${input.name};`,
          `    location /.well-known/acme-challenge/ {`,
          `        root /var/www/certbot;`,
          `    }`,
          `    location / {`,
          `        proxy_pass http://127.0.0.1:${input.targetPort};`,
          `        proxy_set_header Host $host;`,
          `        proxy_set_header X-Real-IP $remote_addr;`,
          `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
          `        proxy_set_header X-Forwarded-Proto $scheme;`,
          `    }`,
          `}`,
          `'NGINX'`,
          `nginx -t && systemctl reload nginx && echo "NGINX_CONFIGURED"`,
        ].join("\n");
        executeOnServer(input.serverId, nginxScript, 30).catch(() => {});
      }

      return domain;
    }),

  delete: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      const safeName = domain.domain.name.replace(/[^a-zA-Z0-9.-]/g, "-");
      executeOnServer(
        domain.server.id,
        `rm -f /etc/nginx/sites-enabled/${safeName}.conf && nginx -t && systemctl reload nginx && echo "REMOVED"`,
        15
      ).catch(() => {});

      await ctx.db.delete(domains).where(eq(domains.id, input.id));
      return { success: true };
    }),

  checkDns: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      const name = domain.domain.name;
      const serverIp = domain.server.ip;

      // Try to resolve DNS
      const dnsResult = await executeOnServer(
        domain.server.id,
        `nslookup ${name} 2>/dev/null | awk '/^Address: /{print $2}' | head -1 || ` +
        `dig +short ${name} 2>/dev/null | head -1 || ` +
        `host ${name} 2>/dev/null | awk '/has address/{print $4}' | head -1 || echo "UNRESOLVABLE"`,
        10
      );

      const resolved = (dnsResult.output || "").trim();
      const matches = resolved === serverIp;
      const matchesAny = resolved && (resolved.includes(serverIp) || serverIp.includes(resolved));

      return {
        success: true,
        domain: name,
        serverIp,
        resolved: resolved || "Unresolvable",
        match: matches || matchesAny,
        status: matches || matchesAny ? "ok" : resolved === "UNRESOLVABLE" ? "no_dns" : "wrong_ip",
      };
    }),

  checkHttp: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      const name = domain.domain.name;
      const result = await executeOnServer(
        domain.server.id,
        `curl -sS -o /dev/null -w "%{http_code}" --max-time 10 http://${name} 2>/dev/null || echo "TIMEOUT"`,
        15
      );
      const httpsResult = await executeOnServer(
        domain.server.id,
        `curl -sS -o /dev/null -w "%{http_code}" --max-time 10 https://${name} 2>/dev/null || echo "TIMEOUT"`,
        15
      );

      const httpCode = (result.output || "").trim();
      const httpsCode = (httpsResult.output || "").trim();

      return {
        success: true,
        http: httpCode === "TIMEOUT" ? null : httpCode,
        https: httpsCode === "TIMEOUT" ? null : httpsCode,
      };
    }),

  checkSsl: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      const name = domain.domain.name;
      const result = await executeOnServer(
        domain.server.id,
        `echo | openssl s_client -servername ${name} -connect ${name}:443 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null || echo "NO_SSL"`,
        15
      );

      const output = (result.output || "").trim();
      if (output === "NO_SSL" || !output) {
        return { success: true, ssl: false };
      }

      // Parse dates
      const notBefore = output.match(/notBefore=(.+)/)?.[1]?.trim() || "";
      const notAfter = output.match(/notAfter=(.+)/)?.[1]?.trim() || "";
      const subject = output.match(/subject= ?(.+)/)?.[1]?.trim() || "";

      // Calculate days until expiry
      let daysLeft = null;
      if (notAfter) {
        const expiry = new Date(notAfter);
        const now = new Date();
        daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        success: true,
        ssl: true,
        subject,
        issuedAt: notBefore,
        expiresAt: notAfter,
        daysLeft,
        expired: daysLeft !== null && daysLeft <= 0,
        expiresSoon: daysLeft !== null && daysLeft > 0 && daysLeft <= 30,
      };
    }),

  generateProxy: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db
        .select({ domain: domains, server: servers })
        .from(domains)
        .innerJoin(servers, eq(domains.serverId, servers.id))
        .where(and(eq(domains.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!domain) throw new TRPCError({ code: "NOT_FOUND" });

      const d = domain.domain;
      const port = d.targetPort || 80;
      const safeName = d.name.replace(/[^a-zA-Z0-9.-]/g, "-");

      // Detect which proxy is installed
      const detectResult = await executeOnServer(
        domain.server.id,
        "which nginx 2>/dev/null && echo 'nginx' || which caddy 2>/dev/null && echo 'caddy' || echo 'none'",
        10
      );
      const proxyType = (detectResult.output || "").trim();

      let script = "";
      if (proxyType === "nginx") {
        script = [
          `mkdir -p /var/www/certbot`,
          `cat > /etc/nginx/sites-enabled/${safeName}.conf << 'NGINX'`,
          `server {`,
          `    listen 80;`,
          `    server_name ${d.name};`,
          `    `,
          `    location /.well-known/acme-challenge/ {`,
          `        root /var/www/certbot;`,
          `    }`,
          `    `,
          `    location / {`,
          `        proxy_pass http://127.0.0.1:${port};`,
          `        proxy_set_header Host $host;`,
          `        proxy_set_header X-Real-IP $remote_addr;`,
          `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
          `        proxy_set_header X-Forwarded-Proto $scheme;`,
          `    }`,
          `}`,
          `'NGINX'`,
          `echo "Nginx config generated for ${d.name}"`,
          `nginx -t 2>&1 && systemctl reload nginx 2>&1 && echo "Nginx reloaded" || echo "Nginx config error"`,
        ].join("\n");
      } else if (proxyType === "caddy") {
        script = [
          `cat >> /etc/caddy/Caddyfile << 'CADDY'`,
          ``,
          `${d.name} {`,
          `    reverse_proxy 127.0.0.1:${port}`,
          `}`,
          `'CADDY'`,
          `caddy reload --config /etc/caddy/Caddyfile 2>&1 && echo "Caddy reloaded" || echo "Caddy error"`,
        ].join("\n");
      } else {
        script = `echo "No reverse proxy found. Install nginx or caddy first."`;
      }

      const result = await executeOnServer(domain.server.id, script, 15);
      return {
        success: result.success,
        proxyType,
        output: result.output,
        error: result.error,
      };
    }),
});

// ─── Category router ───

export const categoryRouter = router({
  list: agentProcedure.query(async ({ ctx }) => {
    return await ctx.db
      .select()
      .from(categories)
      .where(eq(categories.userId, ctx.user.id!))
      .orderBy(categories.sortOrder, categories.createdAt);
  }),

  create: agentProcedure
    .input(z.object({ name: z.string().min(1).max(50), icon: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [cat] = await ctx.db
        .insert(categories)
        .values({ userId: ctx.user.id!, name: input.name, icon: input.icon || "📁" })
        .returning();
      return cat;
    }),

  update: agentProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(50).optional(), icon: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [cat] = await ctx.db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.id), eq(categories.userId, ctx.user.id!)));
      if (!cat) throw new TRPCError({ code: "NOT_FOUND" });
      const [updated] = await ctx.db
        .update(categories)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.icon ? { icon: input.icon } : {}),
        })
        .where(eq(categories.id, input.id))
        .returning();
      return updated;
    }),

  delete: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [cat] = await ctx.db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.id), eq(categories.userId, ctx.user.id!)));
      if (!cat) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.delete(categories).where(eq(categories.id, input.id));
      return { success: true };
    }),
});

// ─── Main router ───

export const dashboardRouter = router({
  stats: agentProcedure.query(async ({ ctx }) => {
    const userServers = await ctx.db
      .select()
      .from(servers)
      .where(eq(servers.userId, ctx.user.id!));

    const serverIds = userServers.map((s) => s.id);

    // Installation counts by status
    let installByStatus: { status: string; count: number }[] = [];
    let domainCount = 0;
    if (serverIds.length > 0) {
      installByStatus = await ctx.db
        .select({
          status: installations.status,
          count: sql<number>`cast(count(*) as int)`,
        })
        .from(installations)
        .where(inArray(installations.serverId, serverIds))
        .groupBy(installations.status);

      const dc = await ctx.db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(domains)
        .where(inArray(domains.serverId, serverIds));
      domainCount = dc[0]?.count || 0;
    }

    const catalogCount = await ctx.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(recipes);

    const getCount = (status: string) =>
      installByStatus.find((r) => r.status === status)?.count || 0;

    // Aggregate system info across servers
    let totalDiskTotal = 0,
      totalDiskUsed = 0,
      totalRamTotal = 0,
      totalRamUsed = 0;
    for (const s of userServers) {
      const info = (s.systemInfo || {}) as Record<string, any>;
      totalDiskTotal += parseInt(info.diskTotal) || 0;
      totalDiskUsed += parseInt(info.diskUsed) || 0;
      totalRamTotal += parseInt(info.ramTotal) || 0;
      totalRamUsed += parseInt(info.ramUsed) || 0;
    }

    return {
      totalServers: userServers.length,
      connectedServers: userServers.filter((s) => s.status === "connected").length,
      pendingServers: userServers.filter((s) => s.status === "pending").length,
      totalDomains: domainCount,
      totalCatalog: catalogCount[0]?.count || 0,
      // Installation counts
      installSuccess: getCount("success"),
      installRunning: getCount("running"),
      installFailed: getCount("failed"),
      installStopped: getCount("stopped"),
      totalApps: installByStatus.reduce((sum, r) => sum + r.count, 0),
      // Aggregated disk/RAM
      totalDiskTotal,
      totalDiskUsed,
      totalRamTotal,
      totalRamUsed,
    };
  }),

  recentActivity: agentProcedure
    .input(z.object({ limit: z.number().int().positive().default(8) }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.id! === "") return [];
      const rows = await ctx.db
        .select({
          id: installations.id,
          recipeId: installations.recipeId,
          status: installations.status,
          params: installations.params,
          updatedAt: installations.updatedAt,
          createdAt: installations.createdAt,
          serverName: servers.name,
          serverId: servers.id,
          recipeName: recipes.name,
        })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .innerJoin(recipes, eq(installations.recipeId, recipes.id))
        .where(eq(servers.userId, ctx.user.id!))
        .orderBy(
          sql`COALESCE(${installations.updatedAt}, ${installations.createdAt}) DESC`
        )
        .limit(input?.limit || 8);

      return rows;
    }),
});

// ─── Backup routes (Phase 6) ───

const BACKUP_DIR = "/srvly-backups";

function buildVolumeBackupScript(volumeName: string, filename: string): string {
  // Stop nothing, use a temp container to mount the volume and tar it.
  // This avoids disrupting running containers that use the volume.
  return [
    `mkdir -p ${BACKUP_DIR}`,
    `docker run --rm -v ${volumeName}:/volume -v ${BACKUP_DIR}:/backup alpine sh -c "tar czf /backup/${filename} -C /volume ."`,
    `ls -lh ${BACKUP_DIR}/${filename}`,
    `stat -c '%s' ${BACKUP_DIR}/${filename}`,
  ].join("\n");
}

function buildDbBackupScript(container: string, dbType: string, dbName: string, filename: string): string {
  let cmd = "";
  if (dbType === "postgres") {
    cmd = `docker exec ${container} pg_dump -U postgres ${dbName} > ${BACKUP_DIR}/${filename}`;
  } else if (dbType === "mysql") {
    cmd = `docker exec ${container} sh -c 'mysqldump --all-databases -uroot -p"$MYSQL_ROOT_PASSWORD"' > ${BACKUP_DIR}/${filename}`;
  } else if (dbType === "mongodb") {
    cmd = `docker exec ${container} mongodump --archive > ${BACKUP_DIR}/${filename}`;
  } else if (dbType === "redis") {
    cmd = `docker exec ${container} sh -c 'redis-cli SAVE && cat /data/dump.rdb' > ${BACKUP_DIR}/${filename}`;
  }
  return [
    `mkdir -p ${BACKUP_DIR}`,
    cmd,
    `ls -lh ${BACKUP_DIR}/${filename}`,
    `stat -c '%s' ${BACKUP_DIR}/${filename}`,
  ].join("\n");
}

function buildVolumeRestoreScript(volumeName: string, backupFilename: string): string {
  return [
    `ls -lh ${BACKUP_DIR}/${backupFilename}`,
    `docker run --rm -v ${volumeName}:/volume -v ${BACKUP_DIR}:/backup alpine sh -c "cd /volume && tar xzf /backup/${backupFilename} --strip-components=0"`,
    `echo "RESTORED"`,
  ].join("\n");
}

function buildDbRestoreScript(container: string, dbType: string, backupFilename: string): string {
  let cmd = "";
  if (dbType === "postgres") {
    cmd = `cat ${BACKUP_DIR}/${backupFilename} | docker exec -i ${container} psql -U postgres`;
  } else if (dbType === "mysql") {
    cmd = `docker exec -i ${container} sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < ${BACKUP_DIR}/${backupFilename}`;
  } else if (dbType === "mongodb") {
    cmd = `docker exec -i ${container} mongorestore --archive < ${BACKUP_DIR}/${backupFilename}`;
  } else if (dbType === "redis") {
    cmd = `docker exec -i ${container} sh -c 'cat > /data/dump.rdb' < ${BACKUP_DIR}/${backupFilename} && docker restart ${container}`;
  }
  return [
    `ls -lh ${BACKUP_DIR}/${backupFilename}`,
    cmd,
    `echo "RESTORED"`,
  ].join("\n");
}

export const backupRouter = router({
  list: agentProcedure
    .input(z.object({ serverId: z.string(), limit: z.number().int().positive().default(20) }))
    .query(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) return [];

      const rows = await ctx.db
        .select()
        .from(backups)
        .where(eq(backups.serverId, input.serverId))
        .orderBy(sql`${backups.createdAt} DESC`)
        .limit(input.limit);

      // For volume backups with hash-like names, try to resolve to a human name
      // by finding which container(s) mount the volume on the server.
      return await Promise.all(rows.map(async (row) => {
        if (row.type === "volume" && /^[0-9a-f]{20,}/.test(row.targetName)) {
          try {
            const r = await executeOnServer(
              input.serverId,
              `docker ps -a --format '{{.Names}}|{{.Mounts}}' 2>&1 | grep -F '${row.targetName}' | head -1`,
              10,
            );
            const line = (r.output || "").trim().split("\n")[0];
            if (line) {
              const [containerName] = line.split("|");
              if (containerName) {
                // Find linked installation
                const installs = await ctx.db
                  .select()
                  .from(installations)
                  .where(eq(installations.serverId, input.serverId));
                const linked = installs.find((i: any) => {
                  const p = (i.params || {}) as any;
                  return p.containerName === containerName || p.name === containerName || i.recipeId === containerName;
                });
                if (linked) {
                  const p = (linked.params || {}) as any;
                  return { ...row, humanName: p.name || linked.recipeId || containerName };
                }
                return { ...row, humanName: containerName };
              }
            }
          } catch {}
        }
        return { ...row, humanName: null as string | null };
      }));
    }),

  discoverTargets: agentProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.serverId,
        [
          "echo '---VOLUMES---'",
          "docker volume ls --format '{{.Name}}' 2>&1",
          "echo '---CONTAINERS---",
          'docker ps -a --format "{{.Names}}|{{.Image}}" 2>&1',
        ].join("\n"),
        15,
      );

      if (!result.success) return { success: false, volumes: [], containers: [] };

      const output = result.output || "";
      const volPart = output.split("---VOLUMES---")[1]?.split("---CONTAINERS---")[0]?.trim() || "";
      const conPart = output.split("---CONTAINERS---")[1]?.trim() || "";

      const volumes = volPart.split("\n").filter((l) => l.trim()).slice(0, 50);
      const containers = conPart
        .split("\n")
        .filter((l) => l.includes("|"))
        .map((l) => {
          const [name, image] = l.split("|");
          return { name: name.trim(), image: image.trim() };
        })
        .slice(0, 50);

      // Identify DB containers by image name
      const dbContainers = containers.filter((c) =>
        /postgres|mysql|mariadb|mongo|redis|cockroach/i.test(c.image)
      );

      return { success: true, volumes, containers, dbContainers };
    }),

  volumeBackup: agentProcedure
    .input(z.object({
      serverId: z.string(),
      volumeName: z.string().regex(/^[a-zA-Z0-9_.-]+$/, "Invalid volume name format"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const safeVol = input.volumeName.replace(/[^a-zA-Z0-9_.-]/g, "-");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `${safeVol}-${ts}.tar.gz`;

      const [row] = await ctx.db
        .insert(backups)
        .values({
          serverId: input.serverId,
          userId: ctx.user.id!,
          type: "volume",
          targetName: input.volumeName,
          filename,
          status: "running",
        })
        .returning();

      // Submit backup job to BullMQ queue
      await sshQueue.add("backup", {
        serverId: input.serverId,
        script: buildVolumeBackupScript(input.volumeName, filename),
        timeout: 300,
        dbTable: "backups",
        dbId: row!.id,
      });

      return { success: true, backupId: row!.id, filename };
    }),

  dbBackup: agentProcedure
    .input(z.object({
      serverId: z.string(),
      containerName: z.string().regex(/^[a-zA-Z0-9_.-]+$/, "Invalid container name format"),
      dbType: z.enum(["postgres", "mysql", "mongodb", "redis"]),
      dbName: z.string().regex(/^[a-zA-Z0-9_.-]*$/, "Invalid database name format").default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const safeName = input.containerName.replace(/[^a-zA-Z0-9_.-]/g, "-");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ext = input.dbType === "redis" ? "rdb" : input.dbType === "mongodb" ? "archive" : "sql";
      const filename = `${safeName}-${input.dbType}-${ts}.${ext}`;

      const [row] = await ctx.db
        .insert(backups)
        .values({
          serverId: input.serverId,
          userId: ctx.user.id!,
          type: input.dbType,
          targetName: input.containerName + (input.dbName ? `:${input.dbName}` : ""),
          filename,
          status: "running",
        })
        .returning();

      // Submit DB backup job to BullMQ queue
      await sshQueue.add("backup", {
        serverId: input.serverId,
        script: buildDbBackupScript(input.containerName, input.dbType, input.dbName, filename),
        timeout: 300,
        dbTable: "backups",
        dbId: row!.id,
      });

      return { success: true, backupId: row!.id, filename };
    }),

  restoreVolume: agentProcedure
    .input(z.object({
      serverId: z.string(),
      volumeName: z.string().regex(/^[a-zA-Z0-9_.-]+$/, "Invalid volume name format"),
      backupFilename: z.string().regex(/^[a-zA-Z0-9_.-]+\.tar\.gz$/, "Invalid backup filename format"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.serverId,
        buildVolumeRestoreScript(input.volumeName, input.backupFilename),
        300,
      );

      return { success: result.success, output: result.output, error: (result as any).error };
    }),

  restoreDb: agentProcedure
    .input(z.object({
      serverId: z.string(),
      containerName: z.string().regex(/^[a-zA-Z0-9_.-]+$/, "Invalid container name format"),
      dbType: z.enum(["postgres", "mysql", "mongodb", "redis"]),
      backupFilename: z.string().regex(/^[a-zA-Z0-9_.-]+\.(sql|rdb|archive)$/, "Invalid backup filename format"),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await executeOnServer(
        input.serverId,
        buildDbRestoreScript(input.containerName, input.dbType, input.backupFilename),
        300,
      );

      return { success: result.success, output: result.output, error: (result as any).error };
    }),

  appBackup: agentProcedure
    .input(z.object({ installationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Look up installation + server + resolve container name
      const [row] = await ctx.db
        .select({ installation: installations, server: servers })
        .from(installations)
        .innerJoin(servers, eq(installations.serverId, servers.id))
        .where(and(eq(installations.id, input.installationId), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (row.installation.params as any) || {};
      const appName = params.name || row.installation.recipeId || "app";
      const containerName = params.containerName || params.name || row.installation.recipeId;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const safeApp = appName.replace(/[^a-zA-Z0-9_.-]/g, "-");

      // Inspect container to find its volumes
      // Returns entries like "type|name|source|dest" for each mount
      // type: 'volume' (named Docker volume) or 'bind' (host directory mount)
      const inspectResult = await executeOnServer(
        row.server.id,
        `docker inspect ${containerName} --format '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Source}}|{{end}}' 2>&1 || echo INSPECT_FAILED`,
        30,
      );

      if (!inspectResult.success || (inspectResult.output || "").includes("INSPECT_FAILED")) {
        return { success: false, error: `Cannot inspect container "${containerName}" — make sure SSH and Docker are working.` };
      }

      const mounts = (inspectResult.output || "")
        .replace("INSPECT_FAILED", "")
        .trim()
        .split("\n")
        .filter((m: string) => m && m.length > 0);

      if (mounts.length === 0) {
        return { success: false, error: `Container "${containerName}" has no mount points to backup.` };
      }

      // Build the list of backups: each named volume OR each bind mount source
      const backupTargets: { filename: string; script: string; type: string }[] = [];
      for (const line of mounts) {
        const [type, name, source] = line.split("|");
        if (!source) continue;

        if (type === "volume" && name) {
          // Named volume — use docker run helper
          const safe = (name.length > 40 ? name.slice(0, 40) : name);
          const filename = `${safeApp}-vol-${safe}-${ts}.tar.gz`;
          backupTargets.push({
            filename,
            type: "volume",
            script: [
              `mkdir -p ${BACKUP_DIR}`,
              `docker run --rm -v ${name}:/volume -v ${BACKUP_DIR}:/backup alpine sh -c "tar czf /backup/${filename} -C /volume ."`,
              `ls -lh ${BACKUP_DIR}/${filename}`,
              `stat -c '%s' ${BACKUP_DIR}/${filename}`,
            ].join("\n"),
          });
        } else if (type === "bind") {
          // Bind mount — tar the host directory directly
          const safe = (source.replace(/\//g, "_").slice(0, 40).replace(/^_+|_+$/g, "")) || "data";
          const filename = `${safeApp}-bind-${safe}-${ts}.tar.gz`;
          backupTargets.push({
            filename,
            type: "bind",
            script: [
              `mkdir -p ${BACKUP_DIR}`,
              `test -e "${source}" && tar czf ${BACKUP_DIR}/${filename} -C "${source}" . || echo "MISSING"`,
              `ls -lh ${BACKUP_DIR}/${filename} 2>/dev/null`,
              `stat -c '%s' ${BACKUP_DIR}/${filename} 2>/dev/null`,
            ].join("\n"),
          });
        }
      }

      if (backupTargets.length === 0) {
        return { success: false, error: `Container "${containerName}" has no backupable mounts (named volume or bind mount).` };
      }

      // Create backup record per mount and queue them
      const createdBackups: any[] = [];

      for (const target of backupTargets) {
        const [backupRow] = await ctx.db
          .insert(backups)
          .values({
            serverId: row.server.id,
            userId: ctx.user.id!,
            installationId: row.installation.id,
            type: "volume",
            targetName: target.filename.replace(/-\d{4}-\d{2}-\d{2}T.*\.tar\.gz$/, ""), // strip timestamp
            filename: target.filename,
            status: "running",
          })
          .returning();

        // Submit app backup mount target to BullMQ queue
        await sshQueue.add("backup", {
          serverId: row.server.id,
          script: target.script,
          timeout: 300,
          dbTable: "backups",
          dbId: backupRow!.id,
        });

        createdBackups.push({ filename: target.filename, success: true, type: target.type });
      }

      return {
        success: true,
        filename: createdBackups.map((b) => b.filename).join(", "),
        volumes: createdBackups,
        appName,
        message: "App backups queued successfully",
      };
    }),

  restoreApp: agentProcedure
    .input(z.object({
      installationId: z.string(),
      backupId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Look up the backup + verify ownership + ensure it belongs to this installation
      const [bk] = await ctx.db
        .select()
        .from(backups)
        .innerJoin(servers, eq(backups.serverId, servers.id))
        .where(and(
          eq(backups.id, input.backupId),
          eq(backups.installationId, input.installationId),
          eq(servers.userId, ctx.user.id!),
        ));
      if (!bk) throw new TRPCError({ code: "NOT_FOUND" });
      if (bk.backups.status !== "success") {
        return { success: false, error: "Backup is not in success state" };
      }

      const [inst] = await ctx.db
        .select()
        .from(installations)
        .where(eq(installations.id, input.installationId));
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });

      const params = (inst.params as any) || {};
      const containerName = params.containerName || params.name || inst.recipeId;
      const serverId = bk.backups.serverId;

      // Determine what to restore from the backup filename pattern
      // Filenames are: {appName}-vol-{name}-{ts}.tar.gz or {appName}-bind-{path}-{ts}.tar.gz
      const filename = bk.backups.filename;
      let script = "";
      const isVolume = filename.includes("-vol-");
      const isBind = filename.includes("-bind-");

      if (isVolume) {
        // Find the volume name by re-running inspect on the container
        const inspectResult = await executeOnServer(
          serverId,
          `docker inspect ${containerName} --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}|{{end}}{{end}}' 2>&1 || echo INSPECT_FAILED`,
          15,
        );
        const volOutput = (inspectResult.output || "").replace("INSPECT_FAILED", "").trim();
        const volumeName = volOutput.split("|").filter((v) => v)[0];
        if (!volumeName) {
          return { success: false, error: "No named volume found on container." };
        }
        script = [
          `ls -lh ${BACKUP_DIR}/${filename}`,
          `docker run --rm -v ${volumeName}:/volume -v ${BACKUP_DIR}:/backup alpine sh -c "cd /volume && tar xzf /backup/${filename}"`,
          `echo "RESTORED_VOLUME"`,
        ].join("\n");
      } else if (isBind) {
        // Find the bind source from the inspect
        const inspectResult = await executeOnServer(
          serverId,
          `docker inspect ${containerName} --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}|{{end}}{{end}}' 2>&1 || echo INSPECT_FAILED`,
          15,
        );
        const bindOutput = (inspectResult.output || "").replace("INSPECT_FAILED", "").trim();
        const bindSource = bindOutput.split("|").filter((v) => v)[0];
        if (!bindSource) {
          return { success: false, error: "No bind mount found on container." };
        }
        script = [
          `ls -lh ${BACKUP_DIR}/${filename}`,
          `tar xzf ${BACKUP_DIR}/${filename} -C "${bindSource}"`,
          `echo "RESTORED_BIND"`,
        ].join("\n");
      } else {
        return { success: false, error: "Backup type unrecognized (not volume or bind)." };
      }

      const result = await executeOnServer(serverId, script, 300);
      return {
        success: result.success,
        output: result.output,
        error: result.success ? undefined : ((result as any).error || result.output || "unknown"),
      };
    }),

  delete: agentProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(backups)
        .innerJoin(servers, eq(backups.serverId, servers.id))
        .where(and(eq(backups.id, input.id), eq(servers.userId, ctx.user.id!)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Remove the file on the server (best-effort)
      try {
        await executeOnServer(
          row.backups.serverId,
          `rm -f ${BACKUP_DIR}/${row.backups.filename} && echo "FILE_DELETED"`,
          15,
        );
      } catch {}

      await ctx.db.delete(backups).where(eq(backups.id, input.id));
      return { success: true };
    }),
});

export const appRouter = router({
  server: serverRouter,
  catalog: catalogRouter,
  install: installRouter,
  domain: domainRouter,
  category: categoryRouter,
  user: userRouter,
  dashboard: dashboardRouter,
  backup: backupRouter,
});

export type AppRouter = typeof appRouter;
