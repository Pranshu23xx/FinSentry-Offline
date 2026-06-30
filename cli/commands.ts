export interface CommandResult {
  lines: string[];
  success: boolean;
}

export async function cmdInstall(): Promise<CommandResult> {
  const { fetchAllGuidelines } = require("../mcp/fetcher");
  const results = await fetchAllGuidelines();
  const cached = results.filter((r: any) => r.status === "cached").length;
  const downloaded = results.filter((r: any) => r.status === "downloaded").length;
  const errors = results.filter((r: any) => r.status === "error");
  const lines: string[] = [];
  lines.push(`Fetched ${results.length} guidelines.`);
  if (downloaded > 0) lines.push(`  Downloaded: ${downloaded}`);
  if (cached > 0) lines.push(`  Already cached: ${cached}`);
  if (errors.length > 0) {
    for (const e of errors) {
      lines.push(`  FAILED: ${e.id} — ${e.error}`);
    }
  }
  return { lines, success: errors.length === 0 };
}

export async function cmdStatus(): Promise<CommandResult> {
  const { getCachedRegulations } = require("../mcp/fetcher");
  const regs = getCachedRegulations();
  if (regs.length === 0) {
    return { lines: ["No guidelines cached yet. Run /install first."], success: true };
  }
  const lines: string[] = [
    `Guidelines cached: ${regs.length}/8`,
    "",
    ...regs.map((r: any) => `  ${r.id.padEnd(12)} ${r.name}`),
  ];
  return { lines, success: true };
}

export async function cmdHelp(): Promise<CommandResult> {
  return {
    lines: [
      "",
      "  /install    Download and cache all 8 RBI guidelines",
      "  /status     Show cached guidelines and stats",
      "  /help       Show this help message",
      "",
      "  Ctrl+C      Exit",
      "",
    ],
    success: true,
  };
}
