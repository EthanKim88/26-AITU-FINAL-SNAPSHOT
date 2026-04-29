import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";
import fs from "node:fs";
import path from "node:path";

const LOOT_DIR = path.join(process.cwd(), "..", "loots");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const loot = await prisma.loot.findUnique({
      where: { id },
      include: { host: { select: { ip: true, hostname: true } } },
    });
    if (!loot) return apiError("Loot not found", 404);

    // Read file content from disk
    const absPath = path.join(LOOT_DIR, loot.localPath);
    let content = "";
    if (fs.existsSync(absPath)) {
      content = fs.readFileSync(absPath, "utf-8");
    }

    return apiSuccess({ ...loot, content });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
