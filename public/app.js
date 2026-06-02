const ticketList = document.getElementById("tickets");
const stats = document.getElementById("stats");
const form = document.getElementById("ticketForm");
const statusFilter = document.getElementById("statusFilter");

loadTickets();

document.getElementById("refreshButton").addEventListener("click", loadTickets);
statusFilter.addEventListener("change", loadTickets);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  await api("/api/tickets", { method: "POST", body: payload });
  form.reset();
  await loadTickets();
});

async function loadTickets() {
  const query = statusFilter.value ? `?status=${encodeURIComponent(statusFilter.value)}` : "";
  const data = await api(`/api/tickets${query}`);
  renderStats(data.counts);
  renderTickets(data.tickets);
}

function renderStats(counts) {
  const items = [
    ["Total", counts.total],
    ["Open", counts.open],
    ["Working", counts.in_progress],
    ["Finished", counts.finished],
    ["Verified", counts.verified],
  ];

  stats.innerHTML = items.map(([label, value]) => `<article class="stat"><strong>${value}</strong><span>${label}</span></article>`).join("");
}

function renderTickets(tickets) {
  ticketList.innerHTML = tickets.map(ticketCard).join("") || `<div class="ticket">No tickets found.</div>`;

  document.querySelectorAll("[data-finish]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/tickets/${button.dataset.finish}/resolve`, {
        method: "POST",
        body: {
          type: "manual",
          evidence: ["Finished from frontend dashboard"],
        },
      });
      await loadTickets();
    });
  });

  document.querySelectorAll("[data-verify]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/tickets/${button.dataset.verify}`, {
        method: "PATCH",
        body: {
          status: "verified",
          resolver: { state: "verified", notes: "Marked verified after completion." },
        },
      });
      await loadTickets();
    });
  });
}

function ticketCard(ticket) {
  const finished = ticket.status === "finished" || ticket.status === "verified";
  return `
    <article class="ticket">
      <div class="ticket-top">
        <div>
          <h3>${escapeHtml(ticket.title)}</h3>
          <p class="meta">${escapeHtml(ticket.id)} | ${escapeHtml(ticket.source)} | ${escapeHtml(ticket.priority)} priority</p>
        </div>
        <div class="badge-row">
          <span class="badge ${ticket.status}">${escapeHtml(ticket.status)}</span>
          <span class="badge">${escapeHtml(ticket.resolver.type)}</span>
        </div>
      </div>
      <p class="summary">${escapeHtml(ticket.summary || "No summary added.")}</p>
      <div class="resolver">
        Resolver state: <strong>${escapeHtml(ticket.resolver.state)}</strong><br />
        MCP server: ${escapeHtml(ticket.resolver.mcpServer || "not installed")}<br />
        Agent: ${escapeHtml(ticket.resolver.agent || "not connected")}<br />
        Result: ${escapeHtml(ticket.result?.message || "pending")}
      </div>
      <div class="actions">
        ${finished ? "" : `<button class="primary" data-finish="${ticket.id}">Mark Finished</button>`}
        ${ticket.status === "finished" ? `<button data-verify="${ticket.id}">Mark Verified</button>` : ""}
      </div>
    </article>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
