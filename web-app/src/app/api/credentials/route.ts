import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

const accessInclude = {
  include: { host: { select: { id: true, ip: true, hostname: true } } },
} as const;

export async function GET() {
  try {
    const credentials = await prisma.credential.findMany({
      include: { accesses: accessInclude },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(credentials);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      username: string;
      secret?: string;
      secretType?: string;
      credType?: string;
      domain?: string;
      linkedService?: string;
      source?: string;
      notes?: string;
      hostId?: string;
    }>(request);
    if (!body.username?.trim()) return apiError("username is required");

    if (body.hostId) {
      const host = await prisma.host.findUnique({ where: { id: body.hostId } });
      if (!host) return apiError("host not found", 404);
    }

    // Dedup: check if (username, secret, secretType) already exists
    const username = body.username.trim();
    const secret = body.secret ?? "";
    const secretType = body.secretType ?? "password";

    const existing = await prisma.credential.findFirst({
      where: { username, secret, secretType },
    });

    const credential = existing ?? await prisma.credential.create({
      data: {
        username,
        secret,
        secretType,
        credType: body.credType ?? "unknown",
        domain: body.domain ?? "",
        linkedService: body.linkedService ?? "",
        source: body.source ?? "",
        notes: body.notes ?? "",
      },
    });

    if (body.hostId) {
      await prisma.credentialAccess.create({
        data: {
          credentialId: credential.id,
          hostId: body.hostId,
          protocol: "unknown",
          port: null,
          status: "untested",
        },
      });
    }

    const result = await prisma.credential.findUnique({
      where: { id: credential.id },
      include: { accesses: accessInclude },
    });
    return apiSuccess(result, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
