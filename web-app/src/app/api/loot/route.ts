import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import fs from "node:fs";
import path from "node:path";

const LOOT_DIR = path.join(process.cwd(), "..", "loots");

export async function GET(request: NextRequest) {
  try {
    const hostId = request.nextUrl.searchParams.get("hostId");
    const lootType = request.nextUrl.searchParams.get("lootType");
    const loot = await prisma.loot.findMany({
      where: {
        ...(hostId ? { hostId } : {}),
        ...(lootType ? { lootType } : {}),
      },
      include: { host: { select: { ip: true, hostname: true } } },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(loot);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      hostId?: string;
      hostIp?: string;
      port?: number;
      lootType?: string;
      filename: string;
      content: string;
      source?: string;
      notes?: string;
    }>(request);

    if (!body.filename?.trim()) return apiError("filename is required");
    if (body.content === undefined) return apiError("content is required");

    // Resolve hostId from hostIp if needed
    let hostId = body.hostId || null;
    let hostIp = "";
    if (!hostId && body.hostIp) {
      const host = await prisma.host.findUnique({ where: { ip: body.hostIp }, select: { id: true, ip: true } });
      if (host) {
        hostId = host.id;
        hostIp = host.ip;
      }
    } else if (hostId) {
      const host = await prisma.host.findUnique({ where: { id: hostId }, select: { ip: true } });
      if (host) hostIp = host.ip;
    }

    // Build file path: loots/<ip>/<port>/<filename> or loots/<ip>/<filename>
    const ipDir = hostIp || "unknown";
    const dirName = body.port != null ? path.join(ipDir, String(body.port)) : ipDir;
    const relPath = path.join(dirName, body.filename.trim());
    const absDir = path.join(LOOT_DIR, dirName);
    const absPath = path.join(LOOT_DIR, relPath);

    // Write file to disk
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(absPath, body.content, "utf-8");
    const size = Buffer.byteLength(body.content, "utf-8");

    // Save metadata to DB
    const loot = await prisma.loot.create({
      data: {
        hostId,
        lootType: body.lootType ?? "file",
        filename: body.filename.trim(),
        localPath: relPath,
        port: body.port ?? null,
        source: body.source ?? "",
        size,
        notes: body.notes ?? "",
      },
    });

    // Timeline event
    await prisma.event.create({
      data: {
        type: "loot",
        category: "general",
        source: body.source ?? "",
        message: `Loot saved: ${body.filename.trim()} (${body.lootType ?? "file"}) from ${hostIp || "unknown host"}`,
        host: hostIp,
      },
    });

    return apiSuccess(loot, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
