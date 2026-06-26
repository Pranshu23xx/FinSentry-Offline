const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const { fetchAllGuidelines, getCachedRegulations, getRegulationText, getRegistry, RBI_SOURCES } = require("./fetcher");

const server = new McpServer({
  name: "FinSentry RBI Scanner",
  version: "1.0.0",
});

server.tool(
  "fetch_rbi_guidelines",
  "Download all 8 RBI Master Direction PDFs, extract text, and cache locally. Idempotent — skips already cached files.",
  {
    force: z.boolean().optional().describe("Set to true to re-download already cached guidelines"),
  },
  async ({ force }) => {
    const results = await fetchAllGuidelines(force);
    const cached = results.filter((r) => r.status === "cached").length;
    const downloaded = results.filter((r) => r.status === "downloaded").length;
    const errors = results.filter((r) => r.status === "error");

    let text = `Fetched ${results.length} guidelines. ${downloaded} new, ${cached} already cached.`;
    if (errors.length) {
      text += `\nErrors: ${errors.map((e) => `${e.id}: ${e.error}`).join("; ")}`;
    }
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.tool(
  "list_regulations",
  "List all cached RBI regulations with metadata.",
  {},
  async () => {
    const regs = getCachedRegulations();
    if (!regs.length) {
      return {
        content: [{ type: "text", text: "No regulations cached yet. Run fetch_rbi_guidelines first." }],
      };
    }
    const lines = regs.map(
      (r) => `${r.id} | ${r.name} | ${r.category} | fetched ${r.fetchedAt}`
    );
    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

server.tool(
  "get_regulation_text",
  "Return the full extracted text of a cached RBI regulation by ID (e.g. DPSC-2021).",
  {
    id: z.string().describe("Regulation ID like DPSC-2021, AUTH-2025, CR-2024, IT-GRC-2023, KYC-2025, FRAUD-2024, PAY-2025, PPI-2021"),
  },
  async ({ id }) => {
    const text = getRegulationText(id);
    if (!text) {
      const valid = RBI_SOURCES.map((s) => s.id).join(", ");
      return {
        content: [{ type: "text", text: `Regulation "${id}" not found in cache. Run fetch_rbi_guidelines first. Valid IDs: ${valid}` }],
      };
    }
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.tool(
  "search_regulations",
  "Search across all cached regulation texts for a keyword or phrase.",
  {
    query: z.string().describe("Keyword or phrase to search for"),
  },
  async ({ query }) => {
    const regs = getCachedRegulations();
    const results = [];
    for (const reg of regs) {
      const text = getRegulationText(reg.id);
      if (!text) continue;
      const lines = text.split("\n");
      const matches = lines
        .map((line, i) => ({ line: i + 1, text: line.trim() }))
        .filter((l) => l.text.toLowerCase().includes(query.toLowerCase()));
      if (matches.length) {
        results.push({
          id: reg.id,
          name: reg.name,
          matches: matches.slice(0, 10),
          totalMatches: matches.length,
        });
      }
    }
    if (!results.length) {
      return {
        content: [{ type: "text", text: `No matches found for "${query}" in any cached regulation.` }],
      };
    }
    const lines = results.flatMap((r) => {
      const header = `\n${r.id} — ${r.name} (${r.totalMatches} matches):`;
      const matchLines = r.matches.map((m) => `  L${m.line}: ${m.text.slice(0, 120)}`);
      return [header, ...matchLines];
    });
    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

server.resource(
  "regulations-list",
  "finsentry://regulations",
  async (uri) => {
    const regs = getCachedRegulations();
    const text = regs.length
      ? regs.map((r) => `${r.id} — ${r.name} [${r.category}]`).join("\n")
      : "No regulations cached yet. Run fetch_rbi_guidelines first.";
    return {
      contents: [{ uri: uri.href, text }],
    };
  }
);

server.resource(
  "regulation-text",
  new ResourceTemplate("finsentry://regulations/{id}", { list: undefined }),
  async (uri, { id }) => {
    const text = getRegulationText(id);
    if (!text) {
      return {
        contents: [{ uri: uri.href, text: `Regulation "${id}" not found in cache.` }],
      };
    }
    return {
      contents: [{ uri: uri.href, text }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[mcp-server] Fatal: ${err.message}`);
  process.exit(1);
});
