import { prisma } from "@/lib/prisma";
import { ensureReportCatalogSeed } from "@/lib/report";
import { ReportsClient } from "@/components/reports/reports-client";

export default async function ReportsPage() {
  await ensureReportCatalogSeed();

  const [reports, bugTypes, risks] = await Promise.all([
    prisma.report.findMany({
      include: {
        bugType: true,
        risk: true,
        attachments: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.reportBugType.findMany({
      orderBy: [{ points: "desc" }, { name: "asc" }],
    }),
    prisma.reportRisk.findMany({
      orderBy: [{ point: "desc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <h1 className="text-2xl font-bold mb-4">Reports</h1>
      <ReportsClient
        initialReports={JSON.parse(JSON.stringify(reports))}
        initialBugTypes={JSON.parse(JSON.stringify(bugTypes))}
        initialRisks={JSON.parse(JSON.stringify(risks))}
      />
    </div>
  );
}
