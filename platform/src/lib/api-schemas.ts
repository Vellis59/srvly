import { z } from "zod";

// ─── Common reusable types ──────────────────────────────

const uuid = z.string().uuid("Must be a valid UUID");
const portNumber = z.coerce.number().int().min(1).max(65535);
const domainName = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    "Invalid domain name",
  );

// ─── POST /api/agent/docker/deploy ─────────────────────

export const dockerDeploySchema = z.object({
  serverId: uuid,
  name: z.string().min(1).max(100),
  image: z.string().min(1, "Image is required").max(500),
  port: portNumber.optional().default(3000),
  domain: domainName.optional(),
  env: z.record(z.string(), z.string()).optional(),
  volumes: z
    .array(
      z.string().regex(/^[^:]+:.+$/, "Volume must be in format hostPath:containerPath"),
    )
    .optional(),
});

export type DockerDeployInput = z.infer<typeof dockerDeploySchema>;

// ─── POST /api/agent/install/register ──────────────────

export const installRegisterSchema = z.object({
  serverId: uuid,
  name: z.string().min(1).max(100),
  port: portNumber.optional(),
  domain: z.string().max(253).optional(),
  image: z.string().max(500).optional(),
  containerName: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

// ─── GET /api/agent/install (query params) ─────────────

export const installListSchema = z.object({
  serverId: uuid,
});

// ─── POST /api/agent/install/exec ──────────────────────

export const installExecSchema = z.object({
  installationId: uuid,
  command: z.string().min(1, "command is required").max(5000),
  workdir: z.string().max(500).optional(),
  container: z.boolean().optional().default(false),
  timeout: z.coerce.number().int().min(5).max(120).optional().default(30),
});

// ─── POST /api/agent/install/logs ──────────────────────

export const installLogsSchema = z.object({
  installationId: uuid,
  tail: z.coerce.number().int().min(10).max(500).optional().default(50),
});

// ─── POST /api/agent/proxy/configure ───────────────────

export const proxyConfigureSchema = z.object({
  installationId: uuid,
  domain: domainName.optional(),
  port: portNumber.optional(),
});

// ─── POST /api/dispatch ────────────────────────────────

export const dispatchSchema = z.object({
  serverId: uuid.optional(),
  script: z.string().min(1, "script is required").max(50000),
  timeout: z.coerce.number().int().min(5).max(300).optional().default(60),
});

// ─── POST /api/domains/enable-ssl ──────────────────────

export const enableSslSchema = z.object({
  domainId: uuid,
});

// ─── POST /api/agent/files/write ────────────────────────

export const fileWriteSchema = z.object({
  serverId: uuid,
  path: z.string().min(1, "path is required").max(2000),
  content: z.string().max(50000),
  mode: z.string().regex(/^[0-7]{3,4}$/, "Mode must be octal like 644 or 600").optional(),
});

// ─── POST /api/agent/files/read ─────────────────────────

export const fileReadSchema = z.object({
  serverId: uuid,
  path: z.string().min(1, "path is required").max(2000),
});
