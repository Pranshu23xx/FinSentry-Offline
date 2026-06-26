const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const DEFAULT_INBOX_DIR = path.join(DATA_DIR, "regulatory-inbox");
const DEFAULT_PROCESSED_FILE = path.join(DATA_DIR, "processed-circulars.json");

const actionKeywords = [
  "must",
  "shall",
  "should",
  "required",
  "ensure",
  "submit",
  "report",
  "disclose",
  "verify",
  "validate",
  "monitor",
  "maintain",
  "implement",
  "notify",
  "prohibit",
  "not permit",
  "audit",
  "record",
  "retain",
];

function runOfflineAgent(options = {}) {
  const ticketsFile = options.ticketsFile || DEFAULT_TICKETS_FILE;
  const inboxDir = options.inboxDir || DEFAULT_INBOX_DIR;
  const processedFile = options.processedFile || DEFAULT_PROCESSED_FILE;

  ensureJsonFile(ticketsFile, []);
  ensureJsonFile(processedFile, []);
  fs.mkdirSync(inboxDir, { recursive: true });

  const tickets = readJson(ticketsFile);
  const processed = readJson(processedFile);
  const processedKeys = new Set(processed.map((item) => item.fileKey));
  const circularFiles = listCircularFiles(inboxDir);
  const runId = `agent_${crypto.randomUUID().slice(0, 8)}`;
  const created = [];
  const skipped = [];

  circularFiles.forEach((filePath) => {
    const fileKey = fingerprintFile(filePath);
    const relativePath = path.relative(inboxDir, filePath);

    if (processedKeys.has(fileKey)) {
      skipped.push({ file: relativePath, reason: "already processed" });
      return;
    }

    const circular = readCircular(filePath);
    const maps = extractMaps(circular);

    maps.forEach((map, index) => {
      const ticket = mapToTicket({
        circular,
        map,
        index,
        runId,
        fileKey,
        relativePath,
      });
      tickets.unshift(ticket);
      created.push(ticket);
    });

    processed.push({
      fileKey,
      file: relativePath,
      source: circular.source,
      title: circular.title,
      mapsCreated: maps.length,
      processedAt: now(),
      runId,
    });
  });

  writeJson(ticketsFile, tickets);
  writeJson(processedFile, processed);

  return {
    runId,
    inboxDir,
    ticketsFile,
    processedFile,
    filesSeen: circularFiles.length,
    ticketsCreated: created.length,
    created,
    skipped,
  };
}

function listCircularFiles(inboxDir) {
  return fs
    .readdirSync(inboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(inboxDir, entry.name))
    .filter((filePath) => [".txt", ".md"].includes(path.extname(filePath).toLowerCase()))
    .sort();
}

function readCircular(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);
  const title = stripMarkdown(nonEmpty[0] || path.basename(filePath));
  const source = detectSource(`${path.basename(filePath)}\n${content}`);

  return {
    filePath,
    title,
    source,
    content,
    lines,
  };
}

function extractMaps(circular) {
  const candidates = [];
  const lines = circular.lines.filter(Boolean);

  lines.forEach((line) => {
    const normalized = stripMarkdown(line);
    if (normalized.length < 30) return;
    if (!hasActionLanguage(normalized)) return;
    candidates.push(normalized);
  });

  if (!candidates.length) {
    splitSentences(circular.content).forEach((sentence) => {
      if (sentence.length >= 30 && hasActionLanguage(sentence)) {
        candidates.push(sentence);
      }
    });
  }

  return dedupe(candidates).slice(0, 25).map((text) => ({
    statement: text,
    requiredChange: toRequiredChange(text),
    acceptanceCriteria: toAcceptanceCriteria(text),
    priority: classifyPriority(text),
    domain: classifyDomain(text),
  }));
}

function mapToTicket({ circular, map, index, runId, fileKey, relativePath }) {
  const createdAt = now();
  const stableHash = crypto
    .createHash("sha256")
    .update(`${fileKey}:${index}:${map.statement}`)
    .digest("hex")
    .slice(0, 10);

  return {
    id: `map_${stableHash}`,
    title: `${circular.source}: ${map.requiredChange}`,
    source: circular.source,
    summary: map.statement,
    status: "open",
    priority: map.priority,
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
    resolver: {
      type: "offline-agent",
      state: "ready_for_developer",
      mcpServer: "local-json-bridge",
      agent: "finsentry-offline-agent",
      lastRunId: runId,
      notes: "Created offline from a local circular file. Can be exposed through a local MCP server later.",
    },
    map: {
      id: `MAP-${stableHash.toUpperCase()}`,
      circularTitle: circular.title,
      circularFile: relativePath,
      sourceFingerprint: fileKey,
      domain: map.domain,
      measurableActionPoint: map.statement,
      requiredCodeChange: map.requiredChange,
      acceptanceCriteria: map.acceptanceCriteria,
    },
    steps: [
      map.requiredChange,
      "Update the relevant code, config, validation, logging, or reporting path.",
      "Add local evidence in the result/evidence field when marking finished.",
      "Mark verified after compliance review.",
    ],
    result: null,
  };
}

function toRequiredChange(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (/report|submit|return|filing/i.test(compact)) return `Implement reporting control: ${shorten(compact)}`;
  if (/disclose|transparen|consent/i.test(compact)) return `Implement disclosure or consent control: ${shorten(compact)}`;
  if (/audit|record|retain|maintain/i.test(compact)) return `Implement audit evidence control: ${shorten(compact)}`;
  if (/monitor|alert|detect/i.test(compact)) return `Implement monitoring control: ${shorten(compact)}`;
  if (/prohibit|not permit|must not|shall not/i.test(compact)) return `Implement blocking validation: ${shorten(compact)}`;
  return `Implement compliance control: ${shorten(compact)}`;
}

function toAcceptanceCriteria(text) {
  return [
    "Relevant code path or configuration is updated.",
    "A local test, log sample, or manual evidence note proves the behavior.",
    `Evidence maps back to: ${shorten(text, 140)}`,
  ];
}

function classifyPriority(text) {
  if (/must|shall|required|prohibit|shall not|must not|immediate|penalty/i.test(text)) return "high";
  if (/should|submit|report|monitor|audit/i.test(text)) return "medium";
  return "low";
}

function classifyDomain(text) {
  if (/kyc|customer|borrower|consent|disclosure/i.test(text)) return "customer-protection";
  if (/report|return|submit|filing/i.test(text)) return "regulatory-reporting";
  if (/audit|record|retain|log|evidence/i.test(text)) return "auditability";
  if (/security|access|authentication|encryption|data/i.test(text)) return "data-security";
  if (/loan|lending|interest|fee|recovery/i.test(text)) return "lending";
  return "general-compliance";
}

function detectSource(text) {
  if (/\bRBI\b|Reserve Bank of India/i.test(text)) return "RBI";
  if (/\bSEBI\b/i.test(text)) return "SEBI";
  if (/\bFINRA\b/i.test(text)) return "FINRA";
  if (/\bSEC\b|Securities and Exchange Commission/i.test(text)) return "SEC";
  return "Regulatory";
}

function hasActionLanguage(text) {
  const lower = text.toLowerCase();
  return actionKeywords.some((keyword) => lower.includes(keyword));
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function shorten(text, max = 96) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fingerprintFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function ensureJsonFile(filePath, fallback) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
  }
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  DEFAULT_INBOX_DIR,
  DEFAULT_PROCESSED_FILE,
  DEFAULT_TICKETS_FILE,
  runOfflineAgent,
};
