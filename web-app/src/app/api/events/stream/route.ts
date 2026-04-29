import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let lastEventId = request.nextUrl.searchParams.get("lastId") ?? "";

  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        try {
          const events = await prisma.event.findMany({
            where: {
              ...(lastEventId ? { id: { gt: lastEventId } } : {}),
            },
            orderBy: { createdAt: "asc" },
            take: 50,
          });
          if (events.length > 0) {
            lastEventId = events[events.length - 1].id;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(events)}\n\n`)
            );
          } else {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        } catch {
          clearInterval(interval);
          controller.close();
        }
      };

      const interval = setInterval(poll, 3000);
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
