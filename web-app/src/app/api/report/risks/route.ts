import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET() {
  try {
    const risks = await prisma.reportRisk.findMany({
      orderBy: [{ point: "desc" }, { name: "asc" }],
    });
    return apiSuccess(risks);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      name: string;
      description?: string;
    }>(request);

    if (!body.name?.trim()) return apiError("name is required");
    const item = await prisma.reportRisk.create({
      data: {
        name: body.name.trim(),
        description: body.description ?? "",
      },
    });

    return apiSuccess(item, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
