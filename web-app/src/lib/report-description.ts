export type ReportType = "bug_bounty" | "risk";

export function buildDefaultReportDescription(reportType: ReportType): string {
  const replayTarget = reportType === "bug_bounty" ? "PoC" : "chain";
  const resultLine = reportType === "bug_bounty"
    ? "- Vulnerability confirmed with the final proof and concise impact."
    : "- Objective achieved with the final proof artifact or protected data.";

  return `## Description
Explain in 1-2 lines what was achieved and why it matters.

The replay script for this report is \`python3 steps.py\`. It reproduces the ${replayTarget} below and saves any supporting artifacts in this directory.

## Step 1 - Initial Access
- Briefly describe the first reproducible action.
- Relevant URL or command: \`python3 steps.py\`

Output:

\`\`\`text
key proof line
\`\`\`

## Step 2 - Follow-on Action
- Briefly describe the next step in the sequence.
- Relevant URL, request, or artifact: \`http://target/path\`

Output:

\`\`\`text
key proof line
\`\`\`

## Result
${resultLine}`;
}
