import { prisma } from "@/lib/prisma";

export type ReportType = "bug_bounty" | "risk";
export type ReportStatus = "pending" | "submit" | "accept" | "reject" | "ignore";


export interface ReportRequiredRule {
  key: string;
  label: string;
  type: "screenshot" | "text" | "script" | "log" | "etc";
  required: boolean;
}

export const REPORT_TYPES: ReportType[] = ["bug_bounty", "risk"];
export const REPORT_STATUSES: ReportStatus[] = ["pending", "submit", "accept", "reject", "ignore"];
export const REPORT_STATUS_PRIORITY: Record<ReportStatus, number> = {
  pending: 0,
  submit: 1,
  ignore: 2,
  reject: 3,
  accept: 4,
};


export const DEFAULT_REPORT_BUG_TYPES: Array<{
  name: string;
  points: number;
  requiredRules: ReportRequiredRule[];
}> = [
  {
    name: "LPE",
    points: 500,
    requiredRules: [
      { key: "whoami_or_id", label: "whoami/id output screenshot", type: "screenshot", required: true },
      { key: "ipconfig_or_ifconfig", label: "ipconfig/ifconfig output screenshot", type: "screenshot", required: true },
    ],
  },
  {
    name: "RCE",
    points: 400,
    requiredRules: [
      { key: "whoami_or_id", label: "whoami/id output screenshot", type: "screenshot", required: true },
      { key: "ipconfig_or_ifconfig", label: "ipconfig/ifconfig output screenshot", type: "screenshot", required: true },
    ],
  },
  { name: "SQLi", points: 300, requiredRules: [] },
  { name: "SSTI", points: 300, requiredRules: [] },
  { name: "XXE", points: 300, requiredRules: [] },
  { name: "SSRF", points: 200, requiredRules: [] },
  { name: "Path Traversal / File Inclusion", points: 200, requiredRules: [] },
  { name: "IDOR", points: 100, requiredRules: [] },
];

export const DEFAULT_REPORT_RISKS = [
  { name: "LRT", description: "" },
  { name: "Hospital", description: "" },
  { name: "Railway", description: "" },
  { name: "Stadium", description: "" },
  { name: "Business Center", description: "" },
  { name: "Oil Refinery", description: "" },
];

function normalizeRule(value: unknown): ReportRequiredRule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReportRequiredRule>;
  if (!raw.key || typeof raw.key !== "string") return null;
  const key = raw.key.trim();
  if (!key) return null;
  const label = typeof raw.label === "string" ? raw.label.trim() : key;
  const type = raw.type;
  const normalizedType =
    type === "screenshot" || type === "text" || type === "script" || type === "log" || type === "etc"
      ? type
      : "screenshot";

  return {
    key,
    label: label || key,
    type: normalizedType,
    required: Boolean(raw.required),
  };
}

export function parseRequiredRules(raw: string | null | undefined): ReportRequiredRule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRule).filter((v): v is ReportRequiredRule => v !== null);
  } catch {
    return [];
  }
}

export function normalizeRequiredRulesInput(input: unknown): ReportRequiredRule[] {
  if (typeof input === "string") {
    return parseRequiredRules(input);
  }
  if (!Array.isArray(input)) return [];
  return input.map(normalizeRule).filter((v): v is ReportRequiredRule => v !== null);
}

export function stringifyRequiredRules(rules: ReportRequiredRule[]): string {
  return JSON.stringify(rules);
}

export function validateReportDescriptionMarkdown(description: string): string[] {
  const errors: string[] = [];
  const text = description.trim();
  if (!text) {
    errors.push("Description is required.");
    return errors;
  }

  const nonEmptyLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (nonEmptyLines.length < 3) {
    errors.push("Description should include at least 2-3 lines of vulnerability summary.");
  }

  const hasStepByStep = /(^|\n)\s*\d+\.\s+/m.test(text) || /step\s*[-:]?\s*\d+/i.test(text);
  if (!hasStepByStep) {
    errors.push("Description must include step-by-step reproduction.");
  }

  const hasCommandOrScript = /```(?:bash|sh|zsh|python|py|curl|text)?/i.test(text) || /\bcurl\b|\bpython\b|\.py\b/i.test(text);
  if (!hasCommandOrScript) {
    errors.push("Description must include script/curl command sequence.");
  }

  const hasOutput = /\boutput\b/i.test(text) || /```text[\s\S]*```/i.test(text);
  if (!hasOutput) {
    errors.push("Description must include a brief output section.");
  }

  return errors;
}

export function isValidReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

export function isValidReportStatus(value: string): value is ReportStatus {
  return REPORT_STATUSES.includes(value as ReportStatus);
}

export function isProtectedReportStatus(value: string): boolean {
  return value === "submit" || value === "accept";
}

export function resolveReportStatusTransition(
  existingStatus: string,
  requestedStatus?: string
): ReportStatus | null {
  if (!requestedStatus || !isValidReportStatus(requestedStatus)) return null;
  if (!isValidReportStatus(existingStatus)) return requestedStatus;
  if (requestedStatus === existingStatus) return null;

  if ((existingStatus === "reject" || existingStatus === "ignore") && requestedStatus === "pending") {
    return requestedStatus;
  }

  if (REPORT_STATUS_PRIORITY[requestedStatus] < REPORT_STATUS_PRIORITY[existingStatus]) {
    return null;
  }

  return requestedStatus;
}


export async function ensureReportCatalogSeed() {
  const [bugTypeCount, riskCount] = await Promise.all([
    prisma.reportBugType.count(),
    prisma.reportRisk.count(),
  ]);

  if (bugTypeCount === 0) {
    await prisma.reportBugType.createMany({
      data: DEFAULT_REPORT_BUG_TYPES.map((item) => ({
        name: item.name,
        points: item.points,
        requiredRules: stringifyRequiredRules(item.requiredRules),
      })),
    });
  }

  if (riskCount === 0) {
    await prisma.reportRisk.createMany({
      data: DEFAULT_REPORT_RISKS.map((item) => ({
        name: item.name,
        description: item.description,
      })),
    });
  }
}
