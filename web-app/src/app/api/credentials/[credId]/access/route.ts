import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ credId: string }> }
) {
  try {
    const { credId } = await params;
    const body = await parseBody<{
      hostId: string;
      protocol?: string;
      port?: number | null;
      status?: string;
      isAdmin?: boolean;
      notes?: string;
    }>(request);
    if (!body.hostId) return apiError("hostId is required");

    const protocol = body.protocol ?? "smb";
    const port = body.port ?? null;
    const status = body.status ?? "untested";
    const testedAt = status !== "untested" ? new Date() : null;

    const include = { host: { select: { id: true, ip: true, hostname: true } } } as const;

    // Find existing record for this (cred, host, protocol, port) combination
    const existing = await prisma.credentialAccess.findFirst({
      where: { credentialId: credId, hostId: body.hostId, protocol, port },
    });

    if (existing) {
      // Update existing record
      const access = await prisma.credentialAccess.update({
        where: { id: existing.id },
        data: {
          ...(body.status !== undefined && { status, testedAt }),
          ...(body.isAdmin !== undefined && { isAdmin: body.isAdmin }),
          ...(body.notes !== undefined && { notes: body.notes }),
        },
        include,
      });
      return apiSuccess(access);
    }

    // Create new record
    const access = await prisma.credentialAccess.create({
      data: {
        credentialId: credId,
        hostId: body.hostId,
        protocol,
        port,
        status,
        isAdmin: body.isAdmin ?? false,
        testedAt,
        notes: body.notes ?? "",
      },
      include,
    });
    return apiSuccess(access, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
