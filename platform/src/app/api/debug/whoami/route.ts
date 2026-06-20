import { auth } from "@/server/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  return NextResponse.json({
    userId: session?.user?.id || "not logged in",
    name: session?.user?.name || null,
  });
}
