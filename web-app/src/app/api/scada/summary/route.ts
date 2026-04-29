import { apiError, apiSuccess } from "@/lib/api";
import { getScadaSummary } from "@/lib/scada-summary";

export async function GET() {
  try {
    const summary = await getScadaSummary();
    return apiSuccess(summary);
  } catch (e) {
    console.error("Failed to fetch SCADA summary:", e);
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
