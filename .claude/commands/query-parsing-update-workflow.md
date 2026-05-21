---
name: query-parsing-update-workflow
description: Workflow command scaffold for query-parsing-update-workflow in fhir-aggregator-mediator.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /query-parsing-update-workflow

Use this workflow when working on **query-parsing-update-workflow** in `fhir-aggregator-mediator`.

## Goal

Implements or refines query parsing logic, validation, and related runtime behaviors.

## Common Files

- `src/routes.js`
- `src/index.js`
- `tests/integration/routes.test.js`
- `README.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit src/routes.js to update or clarify query parsing logic.
- Edit src/index.js to adjust runtime defaults or integrate parsing changes.
- Optionally update tests/integration/routes.test.js if behavior changes.
- Optionally update README.md or documentation to reflect new parsing behaviors.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.