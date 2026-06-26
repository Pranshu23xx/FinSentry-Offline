const { runOfflineAgent } = require("./offline-agent");

const result = runOfflineAgent({
  inboxDir: process.env.INBOX_DIR,
  ticketsFile: process.env.TICKETS_FILE,
});

console.log(`Agent run: ${result.runId}`);
console.log(`Files seen: ${result.filesSeen}`);
console.log(`Tickets created: ${result.ticketsCreated}`);
console.log(`Inbox: ${result.inboxDir}`);
console.log(`Tickets: ${result.ticketsFile}`);

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
