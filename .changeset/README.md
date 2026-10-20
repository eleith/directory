# Changesets

- Run `pnpm changeset` with a feature or fix to record its app impact for
  `@directory/web` or `@directory/cli` (major, minor or patch).
- `@directory/config` is internal and ignored for independent releases. Record
  behavior/schema changes in an explicit changeset for the consuming app(s).
- When ready, manually run `pnpm version:apps` to consume pending changesets,
  synchronize the two private apps in lockstep and generate changelogs. Review
  and commit the release changes only with owner authorization.
- Only after review and authorization, run `pnpm tag:apps` to create local Git
  tags; pushing them is a separate, explicitly authorized step.

See the [manual release workflow](../docs/development.md#manual-app-releases).
