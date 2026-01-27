export type WorkOrderPromptReference = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  goal: string | null;
  depends_on: string[];
  estimate_hours: number | null;
};

export type WorkOrderGenerationPromptInput = {
  projectName: string;
  description: string;
  type?: string;
  priority?: number | null;
  knownTags: string[];
  references: WorkOrderPromptReference[];
  constitution?: string;
};

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function formatReference(ref: WorkOrderPromptReference): string {
  const tags = ref.tags.length ? ref.tags.join(", ") : "none";
  const deps = ref.depends_on.length ? ref.depends_on.join(", ") : "none";
  const goal = ref.goal ? truncate(ref.goal) : "none";
  const estimate =
    typeof ref.estimate_hours === "number" && Number.isFinite(ref.estimate_hours)
      ? `${ref.estimate_hours}h`
      : "n/a";
  return `- ${ref.id} | ${ref.title} | status: ${ref.status} | tags: ${tags} | deps: ${deps} | est: ${estimate} | goal: ${goal}`;
}

export function buildWorkOrderGenerationPrompt(
  input: WorkOrderGenerationPromptInput
): string {
  const lines: string[] = [];
  lines.push("# Work Order Draft");
  lines.push("");
  lines.push(`Project: ${input.projectName}`);
  lines.push(`Request: ${input.description.trim()}`);
  if (input.type) lines.push(`Type: ${input.type}`);
  if (typeof input.priority === "number" && Number.isFinite(input.priority)) {
    lines.push(`Priority hint: ${input.priority}`);
  }
  if (input.constitution && input.constitution.trim()) {
    lines.push("");
    lines.push("<constitution>");
    lines.push(input.constitution.trim());
    lines.push("</constitution>");
    lines.push("");
    lines.push("Follow the constitution above when drafting the work order.");
  }
  lines.push("");
  lines.push("Return ONLY a JSON object with these keys:");
  lines.push(
    [
      "title",
      "goal",
      "context",
      "acceptance_criteria",
      "non_goals",
      "stop_conditions",
      "tags",
      "depends_on",
      "estimate_hours",
      "priority",
      "suggestions",
    ].join(", ")
  );
  lines.push("");
  lines.push("Guidance:");
  lines.push("- Use concise, testable acceptance criteria.");
  lines.push("- Use stop conditions that explicitly say when to pause for clarification.");
  lines.push("- depends_on MUST only include IDs from the references below.");
  lines.push("- Prefer tags from the known tags list.");
  lines.push("- suggestions should list any missing details you need.");
  lines.push("");
  lines.push(
    `Known tags: ${input.knownTags.length ? input.knownTags.join(", ") : "none"}`
  );
  lines.push("");
  lines.push("Reference work orders:");
  if (input.references.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...input.references.map((ref) => formatReference(ref)));
  }
  lines.push("");
  lines.push("Output JSON only.");
  return lines.join("\n");
}
