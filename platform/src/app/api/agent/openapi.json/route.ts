import { NextResponse } from "next/server";
import { buildOpenApiSpec } from "@/lib/api-spec";

// ─── GET /api/agent/openapi.json ───
// Returns the OpenAPI 3.0 specification for the srvly Agent API.
// AI agents can ingest this to understand how to interact with srvly.

export async function GET() {
  const spec = buildOpenApiSpec();
  return NextResponse.json(spec, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}
