import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const tag = request.nextUrl.searchParams.get("tag");
    const host = request.nextUrl.searchParams.get("host");
    const notes = await prisma.note.findMany({
      where: {
        ...(tag ? { tags: { contains: tag } } : {}),
        ...(host ? { host: { contains: host } } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    return apiSuccess(notes);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{ content: string; tags?: string; host?: string }>(request);
    if (!body.content?.trim()) return apiError("content is required");
    const note = await prisma.note.create({
      data: { content: body.content.trim(), tags: body.tags ?? "", host: body.host ?? "" },
    });
    return apiSuccess(note, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
