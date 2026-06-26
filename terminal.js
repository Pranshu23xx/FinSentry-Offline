const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { DEFAULT_INBOX_DIR, runOfflineAgent } = require("./offline-agent");

const DATA_DIR = path.join(__dirname, "data");
const TICKETS_FILE = process.env.TICKETS_FILE || path.join(DATA_DIR, "tickets.json");
const statuses = ["open", "in_progress", "blocked", "finished", "verified"];
const priorities = ["high", "medium", "low"];

const rl = readline.createInterface({ input, output });

main()
  .catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });

async function main() {
  ensureDataFile();
  clearScreen();
  printHeader();
  console.log("Mode: offline local JSON");
  console.log(`Storage: ${TICKETS_FILE}\n`);

  let done = false;
  while (!done) {
    printMenu();
    const choice = await ask("Choose an option");

    if (choice === "1") listTickets();
    else if (choice === "2") await createTicket();
    else if (choice === "3") await finishTicket();
    else if (choice === "4") await verifyTicket();
    else if (choice === "5") await inspectTicket();
    else if (choice === "6") await filterTickets();
    else if (choice === "7") await runAgentFromTerminal();
    else if (choice.toLowerCase() === "q") done = true;
    else console.log("\nUnknown option. Choose 1-6 or q.");

    if (!done) await pause();
    clearScreen();
    printHeader();
    console.log("Mode: offline local JSON");
    console.log(`Storage: ${TICKETS_FILE}\n`);
  }

  console.log("\nGoodbye.");
}

function listTickets(filters = {}) {
  const tickets = findTickets(filters);
  printCounts(ticketCounts(tickets));

  if (!tickets.length) {
    console.log("\nNo tickets found.");
    return;
  }

  console.log("");
  tickets.forEach((ticket, index) => printTicketSummary(ticket, index + 1));
}

async function createTicket() {
  console.log("\nCreate Ticket");
  const title = await askRequired("Title");
  const source = await askDefault("Source", "Manual");
  const priority = await askChoice("Priority", priorities, "medium");
  const summary = await askDefault("Summary", "");

  const tickets = readTickets();
  const ticket = normalizeTicket({ title, source, priority, summary });
  tickets.unshift(ticket);
  writeTickets(tickets);

  console.log(`\nCreated ${ticket.id}`);
}

async function finishTicket() {
  console.log("\nFinish Ticket");
  const id = await askRequired("Ticket ID");
  const type = await askDefault("Resolver type", "manual");
  const mcpServer = await askDefault("MCP server name, optional", "");
  const agent = await askDefault("Agent name, optional", "");
  const evidenceText = await askDefault("Evidence note", "Finished from terminal frontend");

  const ticket = updateTicket(id, (item) => {
    const completedAt = now();
    item.status = "finished";
    item.finishedAt = item.finishedAt || completedAt;
    item.updatedAt = completedAt;
    item.resolver = {
      ...item.resolver,
      type,
      state: "completed",
      mcpServer: mcpServer || null,
      agent: agent || null,
      lastRunId: `run_${crypto.randomUUID().slice(0, 8)}`,
      notes: "Offline terminal resolver completed the ticket. Replace this step with MCP or agent execution later.",
    };
    item.result = {
      message: `Ticket ${item.id} marked finished.`,
      evidence: evidenceText ? [evidenceText] : [],
      completedBy: type,
      completedAt,
    };
  });

  console.log(`\n${ticket.id} is now ${ticket.status}.`);
  console.log(`Run ID: ${ticket.resolver.lastRunId}`);
}

async function verifyTicket() {
  console.log("\nVerify Finished Ticket");
  const id = await askRequired("Ticket ID");

  const ticket = updateTicket(id, (item) => {
    item.status = "verified";
    item.updatedAt = now();
    item.resolver = {
      ...item.resolver,
      state: "verified",
      notes: "Marked verified from offline terminal frontend.",
    };
  });

  console.log(`\n${ticket.id} is now ${ticket.status}.`);
}

async function inspectTicket() {
  console.log("\nInspect Ticket");
  const id = await askRequired("Ticket ID");
  const ticket = readTickets().find((item) => item.id === id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);

  console.log("");
  console.log(`ID:        ${ticket.id}`);
  console.log(`Title:     ${ticket.title}`);
  console.log(`Source:    ${ticket.source}`);
  console.log(`Priority:  ${ticket.priority}`);
  console.log(`Status:    ${ticket.status}`);
  console.log(`Created:   ${formatDate(ticket.createdAt)}`);
  console.log(`Updated:   ${formatDate(ticket.updatedAt)}`);
  console.log(`Finished:  ${ticket.finishedAt ? formatDate(ticket.finishedAt) : "not finished"}`);
  console.log(`Summary:   ${ticket.summary || "none"}`);
  console.log("");
  console.log("Resolver");
  console.log(`  Type:      ${ticket.resolver.type}`);
  console.log(`  State:     ${ticket.resolver.state}`);
  console.log(`  MCP:       ${ticket.resolver.mcpServer || "not installed"}`);
  console.log(`  Agent:     ${ticket.resolver.agent || "not connected"}`);
  console.log(`  Last run:  ${ticket.resolver.lastRunId || "none"}`);
  console.log(`  Notes:     ${ticket.resolver.notes || "none"}`);

  if (ticket.result) {
    console.log("");
    console.log("Result");
    console.log(`  Message:   ${ticket.result.message}`);
    console.log(`  By:        ${ticket.result.completedBy}`);
    console.log(`  At:        ${formatDate(ticket.result.completedAt)}`);
    console.log(`  Evidence:  ${(ticket.result.evidence || []).join("; ") || "none"}`);
  }
}

async function filterTickets() {
  console.log("\nFilter Tickets");
  const status = await askChoice("Status", ["all", ...statuses], "all");
  const source = await askDefault("Source, optional", "");

  listTickets({
    status: status === "all" ? "" : status,
    source,
  });
}

async function runAgentFromTerminal() {
  console.log("\nRun Offline Compliance Agent");
  console.log("Drop .txt or .md circulars into the inbox, then run this option.");
  const inboxDir = await askDefault("Inbox folder", DEFAULT_INBOX_DIR);

  const result = runOfflineAgent({
    ticketsFile: TICKETS_FILE,
    inboxDir,
  });

  console.log(`\nAgent run: ${result.runId}`);
  console.log(`Files seen: ${result.filesSeen}`);
  console.log(`Tickets created: ${result.ticketsCreated}`);
  console.log(`Inbox: ${result.inboxDir}`);

  if (result.created.length) {
    console.log("\nCreated MAP tickets:");
    result.created.forEach((ticket, index) => {
      console.log(`${index + 1}. ${ticket.id} - ${ticket.title}`);
    });
  }

  if (result.skipped.length) {
    console.log("\nSkipped files:");
    result.skipped.forEach((item) => {
      console.log(`- ${item.file}: ${item.reason}`);
    });
  }
}

function findTickets(filters = {}) {
  let tickets = readTickets();
  if (filters.status) {
    tickets = tickets.filter((ticket) => ticket.status === filters.status);
  }
  if (filters.source) {
    tickets = tickets.filter((ticket) => ticket.source.toLowerCase() === filters.source.toLowerCase());
  }
  return tickets;
}

function updateTicket(id, updater) {
  const tickets = readTickets();
  const ticket = tickets.find((item) => item.id === id);
  if (!ticket) throw new Error(`Ticket not found: ${id}`);
  updater(ticket);
  writeTickets(tickets);
  return ticket;
}

function readTickets() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(TICKETS_FILE, "utf8"));
}

function writeTickets(tickets) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
}

function ensureDataFile() {
  fs.mkdirSync(path.dirname(TICKETS_FILE), { recursive: true });
  if (!fs.existsSync(TICKETS_FILE)) {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify([], null, 2));
  }
}

function normalizeTicket(input = {}) {
  const createdAt = now();
  return {
    id: input.id || `tkt_${crypto.randomUUID().slice(0, 8)}`,
    title: String(input.title || "Untitled ticket").trim(),
    source: String(input.source || "Manual").trim(),
    summary: String(input.summary || "").trim(),
    status: input.status || "open",
    priority: input.priority || "medium",
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
    resolver: {
      type: input.resolver?.type || "manual",
      state: input.resolver?.state || "not_started",
      mcpServer: input.resolver?.mcpServer || null,
      agent: input.resolver?.agent || null,
      lastRunId: null,
      notes: input.resolver?.notes || "Ready for future MCP or AI agent execution.",
    },
    steps: Array.isArray(input.steps) ? input.steps : [],
    result: null,
  };
}

function ticketCounts(tickets) {
  return tickets.reduce(
    (counts, ticket) => {
      counts.total += 1;
      counts[ticket.status] = (counts[ticket.status] || 0) + 1;
      return counts;
    },
    { total: 0, open: 0, in_progress: 0, blocked: 0, finished: 0, verified: 0 },
  );
}

function printHeader() {
  console.log("========================================");
  console.log(" Ticket MCP Dashboard - Terminal");
  console.log("========================================\n");
}

function printMenu() {
  console.log("1. List tickets");
  console.log("2. Create ticket");
  console.log("3. Mark ticket finished");
  console.log("4. Mark ticket verified");
  console.log("5. Inspect ticket JSON");
  console.log("6. Filter tickets");
  console.log("7. Run offline compliance agent");
  console.log("q. Quit\n");
}

function printCounts(counts) {
  console.log("Counts");
  console.log(`  Total: ${counts.total}`);
  console.log(`  Open: ${counts.open}`);
  console.log(`  In progress: ${counts.in_progress}`);
  console.log(`  Blocked: ${counts.blocked}`);
  console.log(`  Finished: ${counts.finished}`);
  console.log(`  Verified: ${counts.verified}`);
}

function printTicketSummary(ticket, index) {
  const finished = ticket.status === "finished" || ticket.status === "verified" ? "done" : "pending";
  console.log(`${index}. ${ticket.title}`);
  console.log(`   ID: ${ticket.id}`);
  console.log(`   ${ticket.source} | ${ticket.priority} | ${ticket.status} | ${finished}`);
  console.log(`   Resolver: ${ticket.resolver.type}/${ticket.resolver.state}`);
  console.log(`   ${ticket.summary || "No summary."}`);
  console.log("");
}

async function ask(label) {
  const answer = await rl.question(`${label}: `);
  return answer.trim();
}

async function askRequired(label) {
  while (true) {
    const value = await ask(label);
    if (value) return value;
    console.log(`${label} is required.`);
  }
}

async function askDefault(label, fallback) {
  const suffix = fallback ? ` [${fallback}]` : "";
  const value = await ask(`${label}${suffix}`);
  return value || fallback;
}

async function askChoice(label, choices, fallback) {
  while (true) {
    const value = await askDefault(`${label} (${choices.join("/")})`, fallback);
    if (choices.includes(value)) return value;
    console.log(`Choose one of: ${choices.join(", ")}`);
  }
}

async function pause() {
  await rl.question("\nPress Enter to continue...");
}

function clearScreen() {
  process.stdout.write("\x1Bc");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function now() {
  return new Date().toISOString();
}
