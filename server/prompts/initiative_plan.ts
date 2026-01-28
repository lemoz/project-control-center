import type { Initiative } from "../db.js";

type InitiativePlanPromptInput = {
  initiative: Initiative;
  projects: Array<{ id: string; name: string; description: string | null }>;
};

function formatProjectList(projects: InitiativePlanPromptInput["projects"]): string {
  if (!projects.length) return "No projects available.";
  return projects
    .map((project) => {
      const desc = project.description ? ` - ${project.description}` : "";
      return `- ${project.id}: ${project.name}${desc}`;
    })
    .join("\n");
}

function formatMilestones(initiative: Initiative): string {
  if (!initiative.milestones.length) return "None defined yet.";
  return initiative.milestones
    .map((milestone) => `- ${milestone.name} (${milestone.target_date})`)
    .join("\n");
}

export function buildInitiativePlanPrompt(input: InitiativePlanPromptInput): string {
  const { initiative, projects } = input;
  return `You are the global agent. Create a lightweight decomposition plan for a cross-project initiative.

Initiative:
- Name: ${initiative.name}
- Description: ${initiative.description}
- Target date: ${initiative.target_date}
- Status: ${initiative.status}
- Existing milestones:
${formatMilestones(initiative)}

Projects available:
${formatProjectList(projects)}

Return ONLY JSON with this schema:
{
  "milestones": [
    {
      "name": "string",
      "target_date": "YYYY-MM-DD",
      "description": "string",
      "projects": [
        {
          "project_id": "string (must match a project id above)",
          "items": [
            {
              "title": "string",
              "description": "string",
              "depends_on": ["string"]
            }
          ]
        }
      ]
    }
  ]
}

Guidelines:
- Keep it lightweight: 2-4 milestones, 2-5 items per project per milestone.
- Items should be WO-sized, actionable, and independent when possible.
- Use depends_on only when necessary; if cross-project, format as "project_id:Title".
- Do NOT create work orders directly.
- Output JSON only, no markdown, no commentary.`;
}
