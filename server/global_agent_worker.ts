import { runGlobalAgentShift } from "./global_agent.js";

const maxIterationsRaw = process.env.CONTROL_CENTER_GLOBAL_MAX_ITERATIONS;
const maxIterationsValue = maxIterationsRaw ? Number(maxIterationsRaw) : NaN;
const maxIterations =
  Number.isFinite(maxIterationsValue) && maxIterationsValue > 0
    ? Math.trunc(maxIterationsValue)
    : undefined;

const agentType = process.env.CONTROL_CENTER_GLOBAL_AGENT_TYPE ?? "claude_cli";
const agentId = process.env.CONTROL_CENTER_GLOBAL_AGENT_ID ?? "global-agent";
const claudePath = process.env.CONTROL_CENTER_CLAUDE_PATH;

const result = await runGlobalAgentShift({
  agentType,
  agentId,
  maxIterations,
  claudePath: claudePath && claudePath.trim() ? claudePath.trim() : undefined,
  onLog: (line) => {
    // eslint-disable-next-line no-console
    console.log(line);
  },
});

if (!result.ok) {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: result.error,
        active_shift_id: result.activeShift.id,
      },
      null,
      2
    )
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      ok: true,
      shift_id: result.shift.id,
      handoff_id: result.handoff.id,
      actions: result.actions,
    },
    null,
    2
  )
);
