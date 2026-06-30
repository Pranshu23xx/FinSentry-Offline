const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, "mcp", "data");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "ticket-mcp-dashboard", storage: TICKETS_FILE });
});

app.get("/api/tickets", (req, res) => {
  const { status, source } = req.query;
  let tickets = readTickets();

  if (status) {
    tickets = tickets.filter((ticket) => ticket.status === status);
  }

  if (source) {
    tickets = tickets.filter((ticket) => ticket.source.toLowerCase() === String(source).toLowerCase());
  }

  res.json({ tickets, counts: ticketCounts(tickets) });
});

app.get("/api/tickets/:id", (req, res) => {
  const ticket = readTickets().find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found." });
  }
  res.json({ ticket });
});

app.post("/api/tickets", (req, res) => {
  const tickets = readTickets();
  const ticket = normalizeTicket(req.body);
  tickets.unshift(ticket);
  writeTickets(tickets);
  res.status(201).json({ ticket });
});

app.patch("/api/tickets/:id", (req, res) => {
  const tickets = readTickets();
  const ticket = tickets.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const allowedStatuses = ["open", "in_progress", "blocked", "finished", "verified"];
  if (req.body.status && !allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowedStatuses.join(", ")}.` });
  }

  Object.assign(ticket, {
    title: req.body.title ?? ticket.title,
    source: req.body.source ?? ticket.source,
    summary: req.body.summary ?? ticket.summary,
    priority: req.body.priority ?? ticket.priority,
    status: req.body.status ?? ticket.status,
    steps: Array.isArray(req.body.steps) ? req.body.steps : ticket.steps,
    updatedAt: now(),
  });

  if (req.body.resolver) {
    ticket.resolver = { ...ticket.resolver, ...req.body.resolver };
  }

  if (req.body.status === "finished") {
    ticket.finishedAt = ticket.finishedAt || now();
    ticket.resolver.state = "completed";
  }

  writeTickets(tickets);
  res.json({ ticket });
});

app.post("/api/tickets/:id/resolve", (req, res) => {
  const tickets = readTickets();
  const ticket = tickets.find((item) => item.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const runner = createResolverRunner(req.body);
  const result = runner.resolve(ticket);

  Object.assign(ticket, {
    status: "finished",
    finishedAt: now(),
    updatedAt: now(),
    resolver: {
      ...ticket.resolver,
      type: result.resolverType,
      state: "completed",
      mcpServer: result.mcpServer,
      agent: result.agent,
      lastRunId: result.runId,
      notes: result.notes,
    },
    result: {
      message: result.message,
      evidence: result.evidence,
      completedBy: result.resolverType,
      completedAt: now(),
    },
  });

  writeTickets(tickets);
  res.json({ ticket });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Ticket MCP dashboard running at http://localhost:${PORT}`);
});

function readTickets() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(TICKETS_FILE, "utf8"));
}

function writeTickets(tickets) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function createResolverRunner(config = {}) {
  return {
    resolve(ticket) {
      const resolverType = config.type || ticket.resolver?.type || "manual";
      const mcpServer = config.mcpServer || ticket.resolver?.mcpServer || null;
      const agent = config.agent || ticket.resolver?.agent || null;

      return {
        resolverType,
        mcpServer,
        agent,
        runId: `run_${crypto.randomUUID().slice(0, 8)}`,
        notes: "Placeholder resolver completed the ticket. Replace createResolverRunner with MCP or agent execution later.",
        message: `Ticket ${ticket.id} marked finished.`,
        evidence: config.evidence || [],
      };
    },
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

function now() {
  return new Date().toISOString();
}
