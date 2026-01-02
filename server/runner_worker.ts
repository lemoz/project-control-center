import { runRun } from "./runner_agent.js";

const runId = process.argv[2];
if (!runId) {
  // eslint-disable-next-line no-console
  console.error("Usage: runner_worker <runId>");
  process.exit(1);
}

process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("Runner worker unhandledRejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("Runner worker uncaughtException:", err);
  process.exit(1);
});

await runRun(runId);

