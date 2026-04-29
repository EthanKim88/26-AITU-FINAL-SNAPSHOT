"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Map,
  Network,
  KeyRound,
  Shield,
  Factory,
  Clock,
  Upload,
  StickyNote,
  Settings,
  Brain,
  ListTodo,
  Zap,
  FileText,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { label: "Battle Map", href: "/battle-map", icon: Map },
  { label: "Network", href: "/network", icon: Network },
  { label: "Credentials", href: "/credentials", icon: KeyRound },
  { label: "AD", href: "/ad", icon: Shield },
  { label: "SCADA", href: "/scada", icon: Factory },
  { label: "Timeline", href: "/timeline", icon: Clock },
  { label: "Import", href: "/import", icon: Upload },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Actions", href: "/actions", icon: Zap },
  { label: "Sessions", href: "/sessions", icon: Brain },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Reports", href: "/reports", icon: FileText },
];

export function AppSidebar({ pendingReportCount }: { pendingReportCount: number }) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-2">
          <span className="text-lg font-bold tracking-tight">AITU Final 2026</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const pendingCount = item.href === "/reports" ? pendingReportCount : null;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      className={pendingCount !== null ? "pr-8" : undefined}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {pendingCount !== null && <SidebarMenuBadge>{pendingCount}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/settings" />} isActive={pathname === "/settings"}>
              <Settings className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
