# GitHub dependency-graph canary

Run this canary in a disposable private repository before publishing an action
tag. Keep the repository free of application code, secrets, package execution,
and unrelated workflows.

## Fixture contract

Commit Zolt manifests and locks that jointly cover:

- a standalone project with a direct runtime dependency and a transitive child;
- a workspace with at least two first-party members sharing one external
  dependency in different scopes and member contexts;
- one classified JAR and one non-default artifact type;
- one dependency repeated as direct and indirect, and as runtime and
  development, so the winning evidence is observable;
- one external child edge that appears in only one workspace context; and
- one known vulnerable Maven version used only as inert lockfile data.

Generate and review the locks outside the canary workflow. Normal canary runs
must leave `validate-lock` at `false`, execute no project code, and contact no
Maven repository.

## Baseline run

1. Enable GitHub Actions, the dependency graph, and Dependabot alerts for the
   canary repository.
2. Add a default-branch `workflow_dispatch` workflow with `contents: write`.
3. Check out with `persist-credentials: false` and invoke the candidate action
   by its full 40-character commit SHA once per lockfile.
4. Record each action output, job summary, manifest path, dependency count,
   relationship, scope, PURL, and child edge.
5. Confirm workspace members are absent and the inert vulnerable PURL produces
   the expected advisory match. If the current default JAR PURL does not match,
   test an isolated candidate that omits `type=jar` before freezing
   `src/converter/purl-policy.ts`.

## Replacement run

1. Remove one external dependency and one child edge without changing the
   manifest path.
2. Commit the new lockfiles to the default branch and rerun the same workflow.
3. Confirm the same correlator replaces the prior snapshot, the removed package
   and edge disappear, and unrelated manifests remain intact.

## Permission and failure run

1. Run the same candidate from a separate job with only `contents: read` and
   require the action step to fail.
2. Confirm the failure contains a bounded status and endpoint but no token,
   response body, repository contents, or machine-output document.
3. Commit an intentionally corrupted lock, require analysis to fail before
   submission, then restore the baseline lock. Test stale-manifest detection
   separately with `validate-lock: true`, acknowledging its documented network
   access.

Keep screenshots or API evidence with the candidate commit, workflow run URLs,
and observed PURL policy. Delete the canary repository after the release record
is complete.
