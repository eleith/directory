# Working on Directory

Start with [README.md](README.md) and [docs/development.md](docs/development.md).
Local planning notes, when present, live in `.plans/foundation/architecture.md`
and `.plans/foundation/implementation.md`. They are not build inputs.

## Review and delivery

- Work in small, meaningful commit-sized changes and reasonably small PRs.
- Complete agent code review before handing changes to the owner.
- When the owner requests staged review, stage only one coherent commit at a
  time and wait for their review before preparing the next staged commit.
- Do not commit or push without the owner's manual review and explicit
  authorization. Permission to stage is not permission to commit or push.
- At each handoff, report checks actually run, outstanding limitations, and useful
  manual tests beyond code review. Never describe an unrun check as passing.
- Preserve operator configuration, prototype files, and unrelated changes.

## Engineering

- Use the pinned Node and pnpm versions. Keep dependency versions exact; shared
  tools use the workspace catalog.
- Use strict TypeScript, ESLint with Svelte rules, and Prettier.
- Keep tests beside the code as `*.test.ts`; browser tests live in `apps/web/e2e`.
- Keep server code out of browser imports. Settings are configuration, not a
  database or an admin editor.
- Keep comments for necessary context; do not narrate straightforward code.
- Do not add speculative abstractions, a worker, live service integrations, or
  a second lint/format toolchain.
