---
name: code-review-feedback-iteration-workflow
description: Workflow command scaffold for code-review-feedback-iteration-workflow in fhir-aggregator-mediator.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /code-review-feedback-iteration-workflow

Use this workflow when working on **code-review-feedback-iteration-workflow** in `fhir-aggregator-mediator`.

## Goal

Addresses code review feedback or polishes code and comments, typically without major logic changes.

## Common Files

- `src/routes.js`
- `src/index.js`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit src/routes.js and/or src/index.js to address feedback or polish code/comments.
- Commit with a 'chore:' or 'refactor:' message indicating review feedback or code polish.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.