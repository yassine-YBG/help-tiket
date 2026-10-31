# CLAUDE.md

## Working preferences

- **Ask permission before any code change.** Before creating, editing, or deleting any file, describe the proposed change and wait for explicit approval. Do not modify code on your own initiative.
- **Never change versions.** Do not upgrade, downgrade, add, or remove dependencies, and do not edit version numbers in `package.json`, `package-lock.json`, or anywhere else. Work with the versions already in use.
- **Always give your opinion.** For every task or change, share an honest assessment: what's good, what's risky, and what you would do differently.
- **Review for scalability and maintainability.** For every proposed or requested change, check whether it scales and is easy to maintain (structure, separation of concerns, reuse, naming, error handling, consistency with existing patterns). Raise concerns and suggest improvements before implementing.
