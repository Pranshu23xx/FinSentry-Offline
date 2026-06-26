# FinSentry Offline

An offline terminal-first compliance ticket system for turning regulatory circulars into Measurable Action Point tickets.

The goal is to model the FinSentry workflow without requiring internet, cloud AI, Jira, Postgres, or a running MCP server. Compliance teams can drop local RBI/SEBI/FINRA/SEC circular text files into an inbox, run the offline agent, and get structured JSON tickets that developers can resolve locally.

## Offline Run

```bash
npm install
npm run terminal
```

This is the main offline workflow.

## Offline Agent Workflow

1. Put regulatory circulars into:

```txt
data/regulatory-inbox/
```

Use `.txt` or `.md` files for the offline version.

2. Run the offline agent:

```bash
npm run agent
```

Or open the terminal dashboard:

```bash
npm run terminal
```

Then choose:

```txt
7. Run offline compliance agent
```

3. The agent reads each new circular, extracts Measurable Action Points (MAPs), and creates tickets in:

```txt
data/tickets.json
```

4. Developers resolve those tickets from the terminal dashboard and mark them `finished`.

5. Compliance marks them `verified` after reviewing local evidence.

## Optional Web Run

```bash
npm install
npm start
```

Open:

```txt
http://localhost:4000
```

## Terminal Frontend

For offline use, run:

```bash
npm run terminal
```

This does not need the backend server, internet, Postgres, or MCP to be running. It reads and writes the local JSON file directly:

```txt
data/tickets.json
```

The terminal frontend can:

- list tickets,
- create tickets,
- run the offline compliance agent,
- mark tickets as `finished`,
- mark tickets as `verified`,
- inspect the full ticket JSON fields,
- filter by status or source.

To use another local JSON file:

```bash
TICKETS_FILE=C:\path\to\tickets.json npm run terminal
```

The web API is still available with `npm start`, but it is optional.

## Project Structure

```txt
ticket-mcp-dashboard/
  terminal.js            Offline terminal frontend
  offline-agent.js       Local rule-based circular-to-MAP agent
  run-agent.js           One-command offline agent runner
  server.js              Optional Express API server
  data/tickets.json      Local JSON ticket storage
  data/processed-circulars.json
                          Tracks circular files already processed
  data/regulatory-inbox/ Local folder for RBI/SEBI/etc circulars
  public/index.html      Frontend dashboard
  public/app.js          Frontend API calls and ticket rendering
  public/styles.css      Dashboard styling
  package.json           Node project config
```

## API

### Health

```txt
GET /api/health
```

Returns app status and the JSON storage file path.

### List Tickets

```txt
GET /api/tickets
GET /api/tickets?status=open
GET /api/tickets?source=RBI
```

Returns tickets and status counts.

### Get One Ticket

```txt
GET /api/tickets/:id
```

Returns one ticket by ID.

### Create Ticket

```txt
POST /api/tickets
```

Example body:

```json
{
  "title": "Check SEC rule update",
  "source": "SEC",
  "priority": "high",
  "summary": "Compare the latest source update with our checklist."
}
```

### Update Ticket

```txt
PATCH /api/tickets/:id
```

Example body:

```json
{
  "status": "finished"
}
```

Valid statuses:

```txt
open, in_progress, blocked, finished, verified
```

### Resolve Ticket

```txt
POST /api/tickets/:id/resolve
```

This marks the ticket as `finished` and writes resolver metadata into the JSON.

Example body:

```json
{
  "type": "manual",
  "evidence": ["Finished from frontend dashboard"]
}
```

## Ticket JSON Shape

```json
{
  "id": "tkt_sec_rbi_001",
  "title": "Check RBI digital lending update",
  "source": "RBI",
  "summary": "Review recent RBI guidance.",
  "status": "open",
  "priority": "high",
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z",
  "finishedAt": null,
  "resolver": {
    "type": "offline-agent",
    "state": "ready_for_developer",
    "mcpServer": "local-json-bridge",
    "agent": "finsentry-offline-agent",
    "lastRunId": "agent_12345678",
    "notes": "Created offline from a local circular file."
  },
  "map": {
    "id": "MAP-1234567890",
    "circularTitle": "RBI Digital Lending Sample Circular",
    "circularFile": "sample-rbi-digital-lending.md",
    "domain": "customer-protection",
    "measurableActionPoint": "Banks must disclose all fees and charges to borrowers before loan execution.",
    "requiredCodeChange": "Implement disclosure or consent control...",
    "acceptanceCriteria": []
  },
  "steps": [],
  "result": null
}
```

When a ticket is resolved, `status` becomes `finished`, `finishedAt` is set, and `result` is filled.

## Future MCP or Agent Integration

The offline agent is in:

```js
offline-agent.js
```

Today it uses local rule-based extraction so the system stays offline.

Later, an MCP server can expose `data/tickets.json` to IDE assistants. The bridge would answer questions like:

```txt
What compliance changes do I need to make?
```

by returning open MAP tickets from the local JSON file.

Future online or advanced versions can:

- fetch RBI circulars from official portals,
- parse PDFs directly,
- use LangGraph or another agent runtime,
- sync open MAPs to a local MCP server,
- receive verification output,
- write `result`, `resolver.lastRunId`, and `status: "finished"` back into `tickets.json`.
