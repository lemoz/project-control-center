import type { Initiative } from "../db.js";

type InitiativePlanPromptInput = {
  initiative: Initiative;
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    path: string;
    tech_stack: string;
    recent_wos: string[];
  }>;
  guidance?: string | null;
};

function formatProjectList(projects: InitiativePlanPromptInput["projects"]): string {
  if (!projects.length) return "No projects available.";
  return projects
    .map((project) => {
      const desc = project.description ? `  Description: ${project.description}` : "";
      const recent = project.recent_wos.length
        ? project.recent_wos.join("; ")
        : "None";
      const details = [
        `- ${project.id}: ${project.name}`,
        `  Path: ${project.path}`,
        `  Tech: ${project.tech_stack}`,
        `  Recent WOs: ${recent}`,
      ];
      if (desc) details.push(desc);
      return details.join("\n");
    })
    .join("\n");
}

export function buildInitiativePlanPrompt(input: InitiativePlanPromptInput): string {
  const { initiative, projects } = input;
  const guidance = input.guidance?.trim() ? input.guidance.trim() : "None";
  const targetDate = initiative.target_date ? initiative.target_date : "unspecified";
  return `You are generating work SUGGESTIONS for an initiative across multiple repos.
These are suggestions that will be sent to project shifts, who will decide
whether to create WOs from them.

Initiative: ${initiative.name}
Description: ${initiative.description}
Target date: ${targetDate}
Guidance: ${guidance}

Involved Projects:
${formatProjectList(projects)}

Generate work SUGGESTIONS for each project that together implement this initiative.
- Each suggestion should be small and focused (2-4 hours of work)
- Suggest cross-project dependencies (project shifts will set actual depends_on)
- Order dependencies correctly (backend before API before frontend)
- Include acceptance criteria specific to that repo's role
- These are SUGGESTIONS - project shifts may adjust or reject them

Output JSON:
{
  "suggestions": [
    {
      "project_id": "...",
      "suggested_title": "...",
      "suggested_goal": "...",
      "suggested_acceptance_criteria": ["..."],
      "suggested_dependencies": ["project_id:description"],
      "estimated_hours": 2
    }
  ]
}

Output JSON only, no markdown, no commentary.`;
}
