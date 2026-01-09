# Success Criteria Guide

Use success criteria to define the north star for a project. Keep it short, outcome-focused, and easy to verify.

## Checklist
- Outcome-first: describe the result, not the tasks.
- User-visible: state what changes for users or stakeholders.
- Bounded: clarify scope and the finish line.
- Measurable: include a few metrics with targets.
- Stable: avoid criteria that change every week.

## Tips for success metrics
- Keep it to 3-7 metrics.
- Each metric should have a clear target.
- Current is optional but helpful for progress tracking.
- Prefer numbers or percentages so progress can be computed.

## Example (software project)
```yaml
success_criteria: |
  Production-ready MVP with core features delivered.
  CI green with automated tests passing.
  Deployed and usable by real users.

success_metrics:
  - name: "Core features complete"
    target: 5
    current: 2
  - name: "Test coverage"
    target: "80%"
  - name: "Open bugs"
    target: 0
    current: 3
```
