import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET() {
  try {
    const checklists = await prisma.attackChecklist.findMany({
      include: {
        host: { select: { id: true, ip: true, hostname: true } },
        session: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(checklists);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      hostId?: string;
      hostIp?: string;
      sessionId?: number;
      notes?: string;
    }>(request);
    const checklist = await prisma.attackChecklist.create({
      data: {
        hostId: body.hostId || null,
        hostIp: body.hostIp ?? "",
        sessionId: body.sessionId ?? null,
        notes: body.notes ?? "",
      },
      include: {
        host: { select: { id: true, ip: true, hostname: true } },
        session: { select: { id: true, title: true, status: true } },
      },
    });
    return apiSuccess(checklist, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
