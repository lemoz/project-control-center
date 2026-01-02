import type {
  BuilderResult,
  ProviderSettings,
  ReviewVerdict,
  WorkOrderInput,
} from "./types.js";
import type { Provider } from "./provider.js";

export const codexProvider: Provider = {
  name: "codex",

  async runBuilder(workOrder: WorkOrderInput, settings: ProviderSettings): Promise<BuilderResult> {
    // Stub implementation: later will shell out to Codex CLI with work order context.
    return {
      summary: `Codex builder stub for ${workOrder.id} (${settings.model}).`,
      filesChanged: [],
      diff: "",
      tests: [],
      risks: ["Builder is not implemented yet."],
    };
  },

  async runReviewer(workOrder: WorkOrderInput, builder: BuilderResult, settings: ProviderSettings): Promise<ReviewVerdict> {
    // Stub implementation: later will call a fresh agent for PR-style review.
    return {
      status: "approved",
      notes: [
        `Codex reviewer stub for ${workOrder.id} (${settings.model}).`,
        ...builder.risks,
      ],
    };
  },
};
