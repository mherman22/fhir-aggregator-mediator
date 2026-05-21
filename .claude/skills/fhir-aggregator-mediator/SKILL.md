```markdown
# fhir-aggregator-mediator Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance for contributing to the `fhir-aggregator-mediator` JavaScript codebase. It covers coding conventions, common workflows, and testing patterns observed in the repository. The focus is on query parsing logic, code review feedback loops, and maintaining consistency in code style and structure.

## Coding Conventions

- **File Naming:**  
  Use camelCase for file names.  
  _Example:_  
  ```
  src/queryParser.js
  tests/integration/routes.test.js
  ```

- **Import Style:**  
  Use relative imports for modules within the project.  
  _Example:_  
  ```js
  import { parseQuery } from './queryParser';
  ```

- **Export Style:**  
  Use named exports for functions and objects.  
  _Example:_  
  ```js
  // In src/queryParser.js
  export function parseQuery(query) { ... }
  ```

- **Commit Messages:**  
  Follow [Conventional Commits](https://www.conventionalcommits.org/).  
  Prefixes include: `chore`, `refactor`, `feat`, `fix`.  
  _Example:_  
  ```
  feat: add support for advanced query parameters
  refactor: simplify route validation logic
  ```

## Workflows

### Query Parsing Update Workflow
**Trigger:** When adding, fixing, or refactoring query parsing or compatibility logic  
**Command:** `/update-query-parsing`

1. Edit `src/routes.js` to update or clarify query parsing logic.
2. Edit `src/index.js` to adjust runtime defaults or integrate parsing changes.
3. Optionally update `tests/integration/routes.test.js` if behavior changes.
4. Optionally update `README.md` or documentation to reflect new parsing behaviors.
5. Commit your changes using a relevant prefix (`feat`, `fix`, or `refactor`).

_Example commit:_  
```
feat: improve query parsing for nested parameters
```

### Code Review Feedback Iteration Workflow
**Trigger:** When addressing code review feedback or improving code clarity and documentation  
**Command:** `/address-review-feedback`

1. Edit `src/routes.js` and/or `src/index.js` to address feedback or polish code/comments.
2. Commit with a `chore:` or `refactor:` message indicating review feedback or code polish.

_Example commit:_  
```
chore: update comments and clarify variable names after review
```

## Testing Patterns

- **Test File Naming:**  
  Test files follow the `*.test.*` pattern and are typically located in the `tests/integration/` directory.  
  _Example:_  
  ```
  tests/integration/routes.test.js
  ```

- **Testing Framework:**  
  The specific testing framework is not detected, but tests are written in JavaScript and likely use a standard JS testing tool (e.g., Jest, Mocha).

- **Test Structure:**  
  Tests are organized to mirror the structure of the source files they validate.

_Example test snippet:_  
```js
import { parseQuery } from '../../src/queryParser';

describe('parseQuery', () => {
  it('should handle basic query parameters', () => {
    // test implementation
  });
});
```

## Commands

| Command                  | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| /update-query-parsing    | Start the query parsing update workflow                        |
| /address-review-feedback | Begin iteration based on code review feedback or code polishing |
```
