import { ScadaDashboardClient } from "@/components/scada/scada-dashboard-client";
import { getScadaSummary } from "@/lib/scada-summary";

export default async function ScadaPage() {
  const summary = await getScadaSummary();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">SCADA</h1>
      <ScadaDashboardClient initialSummary={JSON.parse(JSON.stringify(summary))} />
    </div>
  );
}
