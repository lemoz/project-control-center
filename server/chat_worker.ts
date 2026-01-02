import { runChatRun } from "./chat_agent.js";

const runId = process.argv[2];
if (!runId) {
  // eslint-disable-next-line no-console
  console.error("Usage: chat_worker <runId>");
  process.exit(1);
}

process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("Chat worker unhandledRejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("Chat worker uncaughtException:", err);
  process.exit(1);
});

await runChatRun(runId);

