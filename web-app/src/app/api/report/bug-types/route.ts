import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { normalizeRequiredRulesInput, stringifyRequiredRules } from "@/lib/report";

export async function GET(request: NextRequest) {
  try {
    const bugTypes = await prisma.reportBugType.findMany({
      orderBy: [{ points: "desc" }, { name: "asc" }],
    });
    return apiSuccess(bugTypes);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      name: string;
      points?: number;
      requiredRules?: unknown;
    }>(request);

    if (!body.name?.trim()) return apiError("name is required");
    const requiredRules = normalizeRequiredRulesInput(body.requiredRules);

    const item = await prisma.reportBugType.create({
      data: {
        name: body.name.trim(),
        points: Math.max(0, body.points ?? 0),
        requiredRules: stringifyRequiredRules(requiredRules),
      },
    });

    return apiSuccess(item, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
