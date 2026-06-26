import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, agentProcedure } from "@/server/trpc/context";
import { servers, installations, recipes, domains, users, backups } from "@/server/db/schema";
import { eq, and, or, ilike, inArray, sql } from "drizzle-orm";
import { executeOnServer } from "@/lib/ssh";
import { generateKeyPairSync, createHash } from "crypto";
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

  scanContainers: agentProcedure
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
          "echo '---CONTAINERS---'",
          'docker ps --format \'{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}\' 2>&1',
          "echo '---LABELS---'",
          'for c in $(docker ps -q); do echo "=== $c ==="; docker inspect $c --format \'{{.Name}}|{{.Config.Labels}}\' 2>/dev/null; done',
        ].join("\n"),
        30,
      );

      if (!result.success) return { success: false, containers: [], error: result.error };

      const output = result.output || "";
      const containersRaw = output.split("---CONTAINERS---")[1]?.split("---LABELS---")[0]?.trim() || "";
      const labelsRaw = output.split("---LABELS---")[1]?.trim() || "";

      // Parse containers
      const containers = containersRaw
        .split("\n")
        .filter((l) => l.includes("|"))
        .map((l) => {
          const [name, image, ports, status] = l.split("|").map((s) => s?.trim() || "");
          return { name, image, ports, status, running: status.toLowerCase().includes("up") };
        });

      // Check which ones are already registered by matching containerName with installations
      const existing = await ctx.db
        .select()
        .from(installations)
        .where(eq(installations.serverId, input.id));

      const existingNames = existing.map((inst: any) => {
        const p = (inst.params || {}) as any;
        return p.containerName || p.name || inst.recipeId;
      }).filter(Boolean);

      const unknown = containers.filter((c) => !existingNames.includes(c.name));

      // Parse labels for unknown containers
      const labeled: Record<string, string> = {};
      const currentLabels = labelsRaw.split("\n===");
      for (const block of currentLabels) {
        const lines = block.trim().split("\n");
        const cid = lines[0]?.replace(/^\/+/, "").trim();
        if (cid && lines.length > 1) {
          const labelStr = lines.slice(1).join(" ");
          labeled["/" + cid] = labelStr;
        }
      }

      return {
        success: true,
        containers: unknown.map((c) => ({
          ...c,
          labels: labeled[c.name] || "",
          alreadyRegistered: false,
        })),
        totalOnServer: containers.length,
        alreadyRegistered: containers.length - unknown.length,
      };
    }),

  importContainer: agentProcedure
    .input(z.object({
      serverId: z.string(),
      containerName: z.string(),
      image: z.string().optional(),
      port: z.number().int().optional(),
      labels: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [server] = await ctx.db
        .select()
        .from(servers)
        .where(and(eq(servers.id, input.serverId), eq(servers.userId, ctx.user.id!)));
      if (!server) throw new TRPCError({ code: "NOT_FOUND" });

      // Extract port from image or labels if not provided
      let port = input.port;
      if (!port && input.image) {
        const knownPorts: Record<string, number> = {
          n8n: 5678, ghost: 2368, vaultwarden: 80, nextcloud: 80,
          jellyfin: 8096, postgres: 5432, mysql: 3306, redis: 6379,
          mongo: 27017, traefik: 80, nginx: 80, caddy: 80,
        };
        const imgName = input.image.split("/").pop()?.split(":")[0] || "";
        port = knownPorts[imgName] || knownPorts[input.containerName] || undefined;
      }

      // Try to find the port from docker inspect as fallback
      if (!port) {
        const inspect = await executeOnServer(
          input.serverId,
          `docker port ${input.containerName} 2>&1 | head -5 || true`,
          10,
        );
        const portMatch = inspect.output?.match(/(\d+)/);
        if (portMatch) port = parseInt(portMatch[1], 10);
      }

      const [inst] = await ctx.db
        .insert(installations)
        .values({
          serverId: input.serverId,
          recipeId: "app",
          status: "success",
          params: {
            name: input.containerName,
            containerName: input.containerName,
            image: input.image || "unknown",
            port: port || null,
            imported: true,
            importedAt: new Date().toISOString(),
          },
          result: {},
          logs: "",
        })
        .returning();

      return { success: true, id: inst.id, name: input.containerName, port: port || null };
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
        message: `Installation of ${recipe.name} started on port ${port}...`,
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

      // Build new env args
      const envArgs = Object.entries(input.env).map(([k, v]) => `-e ${k}=${v}`).join(" ");

      // Build volume args
      const volArgs = volumes.map(v => `-v ${v}`).join(" ");

      // Build port args
      const portArgs = ports ? ports.split("|").map(p => `-p ${p}`).join(" ") : "";

      // Recreate container
      const script = [
        `echo "Stopping ${container}..."`,
        `docker stop ${container} 2>/dev/null || true`,
        `echo "Removing ${container}..."`,
        `docker rm ${container} 2>/dev/null || true`,
        `echo "Starting with new env..."`,
        `docker run -d --name ${container} --restart ${restart} ${portArgs} ${volArgs} ${envArgs} ${image} 2>&1`,
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
    const userId = (ctx.user as any).id || (ctx.user as any).email || "unknown";
    const salt = process.env.NEXTAUTH_SECRET || "srvly-default-secret";
    const hash = createHash("sha256").update(userId + salt).digest("hex");
    const token = "srvly_" + hash.slice(0, 32);

    // Ensure user exists in DB
    await ctx.db
      .insert(users)
      .values({
        id: userId,
        name: (ctx.user as any).name || null,
        email: (ctx.user as any).email || null,
        image: (ctx.user as any).image || null,
        apiToken: token,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { apiToken: token, name: (ctx.user as any).name, email: (ctx.user as any).email },
      });

    return { token, user: { name: ctx.user.name, email: ctx.user.email } };
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
    .input(z.object({ serverId: z.string(), volumeName: z.string() }))
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

      try {
        const result = await executeOnServer(
          input.serverId,
          buildVolumeBackupScript(input.volumeName, filename),
          300,
        );

        const sizeMatch = result.output?.match(/(\d+)\s*$/m);
        const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

        await ctx.db
          .update(backups)
          .set({
            status: result.success ? "success" : "failed",
            sizeBytes,
            errorMessage: result.success ? null : ((result as any).error || result.output || "unknown"),
          })
          .where(eq(backups.id, row!.id));

        return { success: result.success, backupId: row!.id, filename, sizeBytes };
      } catch (err: any) {
        await ctx.db
          .update(backups)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(backups.id, row!.id));
        return { success: false, error: err.message };
      }
    }),

  dbBackup: agentProcedure
    .input(z.object({
      serverId: z.string(),
      containerName: z.string(),
      dbType: z.enum(["postgres", "mysql", "mongodb", "redis"]),
      dbName: z.string().default(""),
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

      try {
        const result = await executeOnServer(
          input.serverId,
          buildDbBackupScript(input.containerName, input.dbType, input.dbName, filename),
          300,
        );

        const sizeMatch = result.output?.match(/(\d+)\s*$/m);
        const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

        await ctx.db
          .update(backups)
          .set({
            status: result.success ? "success" : "failed",
            sizeBytes,
            errorMessage: result.success ? null : ((result as any).error || result.output || "unknown"),
          })
          .where(eq(backups.id, row!.id));

        return { success: result.success, backupId: row!.id, filename, sizeBytes };
      } catch (err: any) {
        await ctx.db
          .update(backups)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(backups.id, row!.id));
        return { success: false, error: err.message };
      }
    }),

  restoreVolume: agentProcedure
    .input(z.object({ serverId: z.string(), volumeName: z.string(), backupFilename: z.string() }))
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
      containerName: z.string(),
      dbType: z.enum(["postgres", "mysql", "mongodb", "redis"]),
      backupFilename: z.string(),
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

      // Create backup record per mount
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

        try {
          const result = await executeOnServer(
            row.server.id,
            target.script,
            300,
          );

          const sizeMatch = result.output?.match(/(\d+)\s*$/m);
          const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

          await ctx.db
            .update(backups)
            .set({
              status: result.success ? "success" : "failed",
              sizeBytes,
              errorMessage: result.success ? null : ((result as any).error || result.output || "unknown"),
            })
            .where(eq(backups.id, backupRow!.id));

          createdBackups.push({ filename: target.filename, success: result.success, type: target.type });
        } catch (err: any) {
          await ctx.db
            .update(backups)
            .set({ status: "failed", errorMessage: err.message })
            .where(eq(backups.id, backupRow!.id));
          createdBackups.push({ filename: target.filename, success: false, error: err.message, type: target.type });
        }
      }

      const allSuccess = createdBackups.every((b) => b.success);
      return {
        success: allSuccess,
        filename: createdBackups.map((b) => b.filename).join(", "),
        volumes: createdBackups,
        appName,
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
  user: userRouter,
  dashboard: dashboardRouter,
  backup: backupRouter,
});

export type AppRouter = typeof appRouter;
