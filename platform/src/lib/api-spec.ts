import generateSchema from "zod-to-json-schema";
import type { z } from "zod";

// ─── Types ─────────────────────────────────────────────────

interface EndpointInfo {
  path: string;
  method: "get" | "post";
  summary: string;
  description?: string;
  /** For POST: input schema */
  inputSchema?: z.ZodType;
  /** For GET: query params schema */
  querySchema?: z.ZodType;
  /** Path parameters like {id} */
  pathParams?: { name: string; description?: string; schema?: Record<string, unknown> }[];
  /** Response shape description */
  responseDescription?: string;
  authRequired: boolean;
  tags: string[];
}

// ─── Endpoint definitions ───────────────────────────────────

// Lazy imports to avoid circular deps at module level
function getEndpoints(): EndpointInfo[] {
  // We import lazily so the module can be loaded at build time
  // without requiring DB connections
  const { dockerDeploySchema, installRegisterSchema, installListSchema, installExecSchema, installLogsSchema, proxyConfigureSchema, dispatchSchema, enableSslSchema, fileWriteSchema, fileReadSchema } = require("./api-schemas");

  return [
    {
      path: "/api/agent/servers",
      method: "get",
      summary: "List servers accessible to the agent",
      description: "Returns all servers the authenticated agent can access. Uses Bearer token authentication.",
      authRequired: true,
      tags: ["Agent", "Servers"],
      responseDescription: "Array of servers with id, name, ip, os, ram, status",
    },
    {
      path: "/api/agent/docker/deploy",
      method: "post",
      summary: "Deploy a Docker application",
      description: "Deploys a Docker container on a target server. Pulls the image, creates the container with env vars, volumes, and optional reverse proxy.",
      inputSchema: dockerDeploySchema,
      authRequired: true,
      tags: ["Agent", "Docker"],
    },
    {
      path: "/api/agent/install/register",
      method: "post",
      summary: "Register an app installation",
      description: "Records an application installation in the database without actually deploying anything. Used when the agent installs an app manually.",
      inputSchema: installRegisterSchema,
      authRequired: true,
      tags: ["Agent", "Installations"],
    },
    {
      path: "/api/agent/install",
      method: "get",
      summary: "List installations on a server",
      description: "Returns all registered app installations for a given server.",
      querySchema: installListSchema,
      authRequired: true,
      tags: ["Agent", "Installations"],
    },
    {
      path: "/api/agent/install/exec",
      method: "post",
      summary: "Execute commands on a server",
      description: "Runs shell commands on a server, either on the host or inside a Docker container. This is the primary debugging tool for agents.",
      inputSchema: installExecSchema,
      authRequired: true,
      tags: ["Agent", "Installations"],
    },
    {
      path: "/api/agent/install/logs",
      method: "post",
      summary: "Fetch Docker container logs",
      description: "Retrieves recent logs from a Docker container for debugging purposes.",
      inputSchema: installLogsSchema,
      authRequired: true,
      tags: ["Agent", "Installations"],
    },
    {
      path: "/api/agent/proxy/configure",
      method: "post",
      summary: "Configure Caddy reverse proxy",
      description: "Adds or updates a Caddy reverse proxy entry for an existing installation.",
      inputSchema: proxyConfigureSchema,
      authRequired: true,
      tags: ["Agent", "Proxy"],
    },
    {
      path: "/api/agent/servers/{id}/containers",
      method: "get",
      summary: "List Docker containers on a server",
      description: "Returns a structured JSON list of all Docker containers (running and stopped) on a server, along with disk and memory usage.",
      pathParams: [
        { name: "id", description: "Server UUID" },
      ],
      authRequired: true,
      tags: ["Agent", "Docker", "Monitoring"],
      responseDescription: "Array of containers with id, name, image, status, state, ports",
    },
    {
      path: "/api/agent/files/write",
      method: "post",
      summary: "Write a file on a server",
      description: "Writes content to a file using heredoc — safe from shell injection. The agent does not need to escape special characters. Blocks dangerous paths (shadow, sudoers, ssh keys).",
      inputSchema: fileWriteSchema,
      authRequired: true,
      tags: ["Agent", "Files"],
    },
    {
      path: "/api/agent/files/read",
      method: "post",
      summary: "Read a file from a server",
      description: "Reads a file and returns its content base64-encoded, plus a decoded text preview (first 10KB).",
      inputSchema: fileReadSchema,
      authRequired: true,
      tags: ["Agent", "Files"],
    },
    {
      path: "/api/deploy",
      method: "get",
      summary: "Download deployment script",
      description: "Returns the all-in-one server setup script (hardening + Docker + srvly). No authentication required.",
      authRequired: false,
      tags: ["Infrastructure"],
    },
    {
      path: "/api/dispatch",
      method: "post",
      summary: "Execute SSH commands on a server",
      description: "Low-level SSH command execution. Requires Bearer token. Prefer /api/agent/install/exec for most use cases.",
      inputSchema: dispatchSchema,
      authRequired: true,
      tags: ["Agent", "Infrastructure"],
    },
    {
      path: "/api/domains/enable-ssl",
      method: "post",
      summary: "Enable SSL for a domain",
      description: "Provisions Let's Encrypt SSL certificate for a managed domain via certbot.",
      inputSchema: enableSslSchema,
      authRequired: true,
      tags: ["Domains"],
    },
  ];
}

// ─── Helpers ────────────────────────────────────────────────

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return generateSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: "object", description: "Schema conversion failed" };
  }
}

function buildParameters(querySchema: z.ZodType): Record<string, unknown>[] {
  const jsonSchema = zodToJsonSchema(querySchema);
  const props = (jsonSchema.properties as Record<string, unknown>) || {};
  const required = (jsonSchema.required as string[]) || [];
  return Object.entries(props).map(([name, prop]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: prop,
  }));
}

function buildRequestBody(inputSchema: z.ZodType): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(inputSchema);
  return {
    required: true,
    content: {
      "application/json": {
        schema: jsonSchema,
      },
    },
  };
}

function buildResponseBody(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string", description: "Error message (present only when success=false)" },
          },
        },
      },
    },
  };
}

// ─── Spec builder ───────────────────────────────────────────

export function buildOpenApiSpec(baseUrl?: string): Record<string, unknown> {
  const endpoints = getEndpoints();
  const paths: Record<string, unknown> = {};

  for (const ep of endpoints) {
    const method = ep.method;
    const pathItem: Record<string, unknown> = {
      summary: ep.summary,
      description: ep.description || ep.summary,
      tags: ep.tags,
      responses: {
        "200": buildResponseBody(ep.responseDescription || "Success"),
        "401": {
          description: "Unauthorized — missing or invalid Bearer token",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", enum: [false] },
                  error: { type: "string", example: "Invalid token" },
                },
              },
            },
          },
        },
        "422": {
          description: "Validation failed — input does not match schema",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", enum: [false] },
                  error: { type: "string", example: "Validation failed: image: Required" },
                },
              },
            },
          },
        },
      },
    };

    if (ep.authRequired) {
      (pathItem as any).security = [{ BearerToken: [] }];
    }

    if (ep.inputSchema) {
      (pathItem as any).requestBody = buildRequestBody(ep.inputSchema);
    }

    if (ep.querySchema) {
      (pathItem as any).parameters = buildParameters(ep.querySchema);
    }

    // Add path parameters (e.g. {id})
    if (ep.pathParams) {
      const pp = ep.pathParams.map((p) => ({
        name: p.name,
        in: "path",
        required: true,
        description: p.description || "",
        schema: p.schema || { type: "string" },
      }));
      if ((pathItem as any).parameters) {
        (pathItem as any).parameters = [...(pathItem as any).parameters, ...pp];
      } else {
        (pathItem as any).parameters = pp;
      }
    }

    if (!paths[ep.path]) {
      paths[ep.path] = {};
    }
    (paths[ep.path] as Record<string, unknown>)[method] = pathItem;
  }

  const spec: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title: "srvly Agent API",
      version: "0.2.0",
      description:
        "REST API for AI agents to interact with srvly — deploy apps, run commands, fetch logs, configure proxies, and manage servers.\n\n" +
        "## Authentication\n\n" +
        "Most endpoints require a Bearer token in the `Authorization` header:\n" +
        "```\n" +
        "Authorization: Bearer <your-api-token>\n" +
        "```\n\n" +
        "Your API token is visible on the server detail page in the srvly dashboard, or in Settings.\n\n" +
        "## Agent Workflow\n\n" +
        "1. **Discover servers** — `GET /api/agent/servers`\n" +
        "2. **Deploy an app** — `POST /api/agent/docker/deploy`\n" +
        "3. **Debug** — `POST /api/agent/install/exec` and `POST /api/agent/install/logs`\n" +
        "4. **Configure proxy** — `POST /api/agent/proxy/configure`",
      contact: {
        name: "srvly",
        url: "https://github.com/Vellis59/srvly",
      },
      license: {
        name: "MIT",
        url: "https://github.com/Vellis59/srvly/blob/master/LICENSE",
      },
    },
    servers: [
      {
        url: baseUrl || "https://console.srvly.app",
        description: "Production server",
      },
      {
        url: "https://YOUR_DOMAIN",
        description: "Your self-hosted instance",
      },
    ],
    components: {
      securitySchemes: {
        BearerToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "UUID or srvly_xxx token",
          description: "API token found in server settings or dashboard",
        },
      },
    },
    paths,
  };

  return spec;
}
