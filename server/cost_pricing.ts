export type ModelPricing = {
  id: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  match: (model: string) => boolean;
};

const DEFAULT_COST_PRICING: ModelPricing[] = [
  {
    id: "claude-3-opus",
    input_cost_per_1k: 0.015,
    output_cost_per_1k: 0.075,
    match: (model) => model.includes("claude-3-opus"),
  },
  {
    id: "claude-3-5-sonnet",
    input_cost_per_1k: 0.003,
    output_cost_per_1k: 0.015,
    match: (model) =>
      model.includes("claude-3-5-sonnet") || model.includes("claude-3.5-sonnet"),
  },
  {
    id: "gpt-4",
    input_cost_per_1k: 0.03,
    output_cost_per_1k: 0.06,
    match: (model) => model.includes("gpt-4"),
  },
  {
    id: "gpt-5.2-codex",
    input_cost_per_1k: 0.03,
    output_cost_per_1k: 0.06,
    match: (model) => model.includes("gpt-5.2-codex"),
  },
];

export function resolveModelPricing(model: string): ModelPricing | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  return DEFAULT_COST_PRICING.find((entry) => entry.match(normalized)) ?? null;
}
