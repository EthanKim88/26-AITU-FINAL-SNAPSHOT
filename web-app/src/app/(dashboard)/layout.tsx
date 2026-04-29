import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pendingReportCount = await prisma.report.count({ where: { status: "pending" } });

  return (
    <SidebarProvider>
      <AppSidebar pendingReportCount={pendingReportCount} />
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
        </header>
        <main className="flex-1 min-w-0 max-w-full overflow-x-hidden p-4 [&>*]:min-w-0 [&>*]:max-w-full">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
