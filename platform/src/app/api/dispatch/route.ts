import { NextRequest, NextResponse } from "next/server";

const TUNNEL_URL = process.env.TUNNEL_URL || "http://tunnel-server:8080";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(`${TUNNEL_URL}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((body.timeout || 60) * 1000 + 5000),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "proxy error" },
      { status: 502 }
    );
  }
}
