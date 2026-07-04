import { Queue, Worker, ConnectionOptions } from "bullmq";
import { URL } from "url";
import { executeOnServer } from "./ssh";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";
import { installations, backups, servers } from "@/server/db/schema";

export function getRedisConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname || "localhost",
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
    };
  } catch {
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

const globalForQueue = globalThis as unknown as {
  sshQueue: Queue | undefined;
  sshWorker: Worker | undefined;
};

let sshQueue: any;
export { sshQueue };

const isNextBuild = process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const noopQueue = {
  add: async () => ({ id: "noop" }),
};

if (isNextBuild) {
  // Next.js imports API/tRPC modules while collecting build metadata. Do not open
  // a Redis socket during `next build`; production runtime still creates BullMQ.
  sshQueue = noopQueue;
} else if (process.env.NODE_ENV !== "production") {
  try {
    const { Queue } = require("bullmq");
    sshQueue = new Queue("ssh-tasks", {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    globalForQueue.sshQueue = sshQueue;
  } catch (e) {
    console.warn("Redis unavailable during build; using noop queue.");
    sshQueue = noopQueue;
  }
} else {
  // In production, assume Redis is available.
  const { Queue } = require("bullmq");
  sshQueue = new Queue("ssh-tasks", {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
    },
  });
}

export interface SshJobData {
  serverId: string;
  script: string;
  timeout: number;
  dbTable: "installations" | "backups";
  dbId: string;
}

// Start the worker immediately when this file is imported
let sshWorker: any;
if (!isNextBuild && process.env.NODE_ENV !== "production") {
  try {
    const { Worker } = require("bullmq");
    sshWorker = new (Worker as any)(
      "ssh-tasks",
      async (job: any) => {
        const { serverId, script, timeout, dbTable, dbId } = job.data;
        console.log(`[Worker] Starting job ${job.id} of type ${dbTable} for server ${serverId}`);

        try {
          const result = await executeOnServer(serverId, script, timeout);

          if (dbTable === "installations") {
            // original job logic unchanged

          const status = result.success ? "success" : "failed";
          await db
            .update(installations)
            .set({
              status,
              result,
              logs: result.output || "",
              updatedAt: new Date(),
            })
            .where(eq(installations.id, dbId));

          if (result.success) {
            await db
              .update(servers)
              .set({ status: "connected", lastSeen: new Date() })
              .where(eq(servers.id, serverId));
          }
        } else if (dbTable === "backups") {
          const sizeMatch = result.output?.match(/(\d+)\s*$/m);
          const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

          await db
            .update(backups)
            .set({
              status: result.success ? "success" : "failed",
              sizeBytes,
              errorMessage: result.success ? null : (result.error || result.output || "unknown"),
            })
            .where(eq(backups.id, dbId));
        }

        console.log(`[Worker] Job ${job.id} completed successfully`);
      } catch (err: any) {
        console.error(`[Worker] Job ${job.id} failed:`, err);

        // Update database with failure status on uncaught error
        if (dbTable === "installations") {
          await db
            .update(installations)
            .set({
              status: "failed",
              result: { error: err.message },
              logs: err.message,
              updatedAt: new Date(),
            })
            .where(eq(installations.id, dbId));
        } else if (dbTable === "backups") {
          await db
            .update(backups)
            .set({
              status: "failed",
              errorMessage: err.message,
            })
            .where(eq(backups.id, dbId));
        }

        throw err;
      }
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 2, // run up to 2 deployments concurrently
    }
  );

  globalForQueue.sshWorker = sshWorker;
    } catch (e) {
      console.warn("Failed to create SSH worker:", e);
    }
  }
