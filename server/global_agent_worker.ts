import {
  getClaudeCliPathOverride,
  getGlobalAgentId,
  getGlobalAgentMaxIterations,
  getGlobalAgentType,
} from "./config.js";
import { runGlobalAgentShift } from "./global_agent.js";

const maxIterations = getGlobalAgentMaxIterations();
const agentType = getGlobalAgentType();
const agentId = getGlobalAgentId();
const claudePath = getClaudeCliPathOverride();

const result = await runGlobalAgentShift({
  agentType,
  agentId,
  maxIterations,
  claudePath: claudePath ?? undefined,
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
