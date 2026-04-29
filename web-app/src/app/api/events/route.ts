import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const type = url.searchParams.get("type");
    const category = url.searchParams.get("category");
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    const events = await prisma.event.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
    return apiSuccess(events);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      type: string;
      message: string;
      category?: string;
      source?: string;
      data?: string;
      host?: string;
    }>(request);
    if (!body.type || !body.message) return apiError("type and message are required");
    const event = await prisma.event.create({
      data: {
        type: body.type,
        message: body.message,
        category: body.category ?? "general",
        source: body.source ?? "",
        data: body.data ?? "{}",
        host: body.host ?? "",
      },
    });
    return apiSuccess(event, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
