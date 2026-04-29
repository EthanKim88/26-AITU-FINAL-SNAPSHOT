import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get("key");
    if (key) {
      const setting = await prisma.setting.findUnique({ where: { key } });
      return apiSuccess(setting ?? { key, value: "" });
    }
    const settings = await prisma.setting.findMany();
    return apiSuccess(settings);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await parseBody<{ key: string; value: string }>(request);
    if (!body.key?.trim()) return apiError("key is required");
    const setting = await prisma.setting.upsert({
      where: { key: body.key },
      update: { value: body.value ?? "" },
      create: { key: body.key, value: body.value ?? "" },
    });
    return apiSuccess(setting);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
