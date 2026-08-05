# Canary

Use a disposable private repository to test GitHub's dependency graph before a
release. Keep it free of application code, secrets, and unrelated workflows.

## Fixture

Commit Zolt manifests and locks with:

- a standalone project with direct and transitive dependencies;
- a two-member workspace with one shared dependency;
- runtime and development copies of the same dependency;
- direct and indirect copies of the same dependency;
- a classified JAR and a non-default artifact type;
- a child edge used by only one workspace member; and
- a known vulnerable Maven version stored only as lockfile data.

Generate and review the locks before the workflow runs. Leave `validate-lock`
at `false` for normal canary runs.

## Submit

1. Enable GitHub Actions, the dependency graph, and Dependabot alerts.
2. Add a default-branch `workflow_dispatch` workflow with `contents: write`.
3. Pin checkout and this action to full commit SHAs.
4. Run the action once for each lockfile.
5. Check dependency counts, scopes, relationships, PURLs, and child edges.
6. Confirm workspace members are absent and the vulnerable PURL produces the
   expected alert.

If a default JAR does not match its advisory, test a build that omits the
`type=jar` qualifier and record the result.

## Replace

Remove one dependency and one child edge without moving the lockfile. Rerun the
same workflow and confirm GitHub removes the old package and edge while leaving
other manifests unchanged.

## Fail

- Run with `contents: read` and require submission to fail.
- Confirm errors contain no token, response body, repository data, or machine
  output.
- Commit a corrupted lock and require failure before submission, then restore
  the fixture.
- Test stale manifests separately with `validate-lock: true`; that check may
  contact configured repositories.

Keep the action commit, workflow run links, counts, and PURL result with the
release record. Delete the canary repository when finished.
