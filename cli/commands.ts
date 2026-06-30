export interface CommandResult {
  lines: string[];
  success: boolean;
}

const path = require("path");
const fs = require("fs");

function getMcpServerPath(): string {
  const cliDir = __dirname;
  return path.resolve(cliDir, "..", "mcp", "mcp-server.js");
}

function writeOpenCodeConfig(projectDir: string): string {
  const configPath = path.join(projectDir, "opencode.json");
  const mcpServerPath = getMcpServerPath().replace(/\\/g, "\\\\");

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      finsentry: {
        type: "local",
        command: ["node", getMcpServerPath()],
        enabled: true,
        env: {},
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}

export async function cmdInstall(): Promise<CommandResult> {
  const lines: string[] = [];
  const projectDir = process.cwd();

  const opencodePath = path.join(projectDir, "opencode.json");
  if (fs.existsSync(opencodePath)) {
    const existing = JSON.parse(fs.readFileSync(opencodePath, "utf8"));
    if (existing.mcp?.finsentry) {
      lines.push("FinSentry MCP already registered in this project.");
    } else {
      existing.mcp = existing.mcp || {};
      existing.mcp.finsentry = {
        type: "local",
        command: ["node", getMcpServerPath()],
        enabled: true,
        env: {},
      };
      if (!existing.$schema) {
        existing.$schema = "https://opencode.ai/config.json";
      }
      fs.writeFileSync(opencodePath, JSON.stringify(existing, null, 2) + "\n");
      lines.push("Added FinSentry MCP to existing opencode.json.");
    }
  } else {
    writeOpenCodeConfig(projectDir);
    lines.push("Created opencode.json with FinSentry MCP config.");
  }
  lines.push("");

  const { fetchAllGuidelines } = require("../mcp/fetcher");
  const results = await fetchAllGuidelines();
  const cached = results.filter((r: any) => r.status === "cached").length;
  const downloaded = results.filter((r: any) => r.status === "downloaded").length;
  const errors = results.filter((r: any) => r.status === "error");
  lines.push(`Fetched ${results.length} guidelines.`);
  if (downloaded > 0) lines.push(`  Downloaded: ${downloaded}`);
  if (cached > 0) lines.push(`  Already cached: ${cached}`);
  if (errors.length > 0) {
    for (const e of errors) {
      lines.push(`  FAILED: ${e.id} — ${e.error}`);
    }
  }
  lines.push("");
  lines.push("Restart OpenCode for the MCP server to load.");
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
