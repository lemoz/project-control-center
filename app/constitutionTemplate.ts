export const CONSTITUTION_TEMPLATE = `# Constitution

## Decision Heuristics
General principles for making decisions.
- Prefer simple over clever
- Don't add abstractions until the third use case
- Fix the root cause, not the symptom

## Style & Taste
Preferences for code style, communication, and aesthetics.
- Terse commit messages (50 char subject, body if needed)
- Code speaks for itself - minimal comments unless complex
- Prefer explicit over implicit

## Anti-Patterns (Learned Failures)
Things that have gone wrong and should be avoided.
- Never use \`any\` type in TypeScript without explicit justification
- Don't modify db.ts schema without migration plan
- Avoid deeply nested callbacks

## Success Patterns
Approaches that have worked well.
- Test-first approach for bug fixes catches regressions
- Breaking large WOs into small ones improves success rate
- Reading existing code before writing new code

## Domain Knowledge
Project-specific or technical knowledge.
- Chat system uses SSE for real-time updates, not WebSockets
- Work orders use YAML frontmatter with specific required fields
- Runner uses git worktrees for isolation

## Communication
How to interact with the user.
- Be direct, skip preamble
- Show code first, explain after
- Don't ask for confirmation on small changes
`;
