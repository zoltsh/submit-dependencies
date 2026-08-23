<p align="center">
  <img src="https://raw.githubusercontent.com/zoltsh/zolt/main/logo.svg" alt="zolt" width="720">
</p>

<h3 align="center">Submit Zolt dependencies to GitHub</h3>

<p align="center">
  Dependency graph, dependency review, and Dependabot alerts from <code>zolt.lock</code>.
</p>

<p align="center">
  <a href="#use">Use</a>
  <span> · </span>
  <a href="#inputs">Inputs</a>
  <span> · </span>
  <a href="#workspaces">Workspaces</a>
  <span> · </span>
  <a href="./SECURITY.md">Security</a>
  <span> · </span>
  <a href="#development">Development</a>
</p>

<br />

> [!IMPORTANT]
> Pin this action to a reviewed full commit SHA.

## Use

Run on the default branch. Pin checkout and this action to full commit SHAs.

```yaml
name: Submit Zolt dependencies

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: zolt-dependency-submission-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  submit:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          persist-credentials: false

      - uses: zoltsh/submit-dependencies@<full-commit-sha>
```

GitHub requires `contents: write` to accept dependency snapshots. The action
rejects pull requests, merge queues, non-default branches, and attempts to
submit across repositories. A fork can submit to its own dependency graph. Run
the workflow for every default-branch commit so a newer commit can replace a
stale lock-changing run.

## What it does

Before downloading or running Zolt, the action copies the tracked files from
the exact `GITHUB_SHA` into a private directory. It reads Zolt configuration and
the lockfile only from that copy. Dirty files in the checkout cannot change the
graph.

The selected checkout `zolt.lock` must still have the same mode and bytes as
`GITHUB_SHA`. The action checks it before installing Zolt and again before
submitting.

The action runs `zolt tree` and `zolt sbom` with a checksum-pinned Zolt release,
checks that both graphs agree, and submits the result to GitHub.

It includes direct and transitive dependencies, scopes, classifiers, artifact
types, and child edges. Workspace members are excluded as first-party packages.

Normal analysis is offline from Maven repositories. Network requests download
Zolt, verify the default-branch tip, and submit the snapshot. The action does
not build the project or run project code.

Immediately before posting, it rejects a run if the default branch has already
advanced. The workflow concurrency group cancels most older runs, but GitHub
does not make the separate branch check and snapshot submission atomic.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Token used to submit the snapshot |
| `validate-lock` | `false` | With `state: submit`, run `zolt resolve --locked`; may contact configured repositories |
| `validation-env` | — | With `state: submit`, environment variable names passed to locked validation, one per line |
| `state` | `submit` | `submit` a lock graph or `clear` its previous snapshot |
| `manifest-path` | — | Canonical repository-relative `zolt.lock` path; required only with `state: clear` |

### Lock validation

Normal analysis never contacts Maven repositories. With `validate-lock: true`,
the pinned Zolt binary also runs `resolve --locked`. Validation receives a small
baseline environment plus only the variables named by `validation-env`:

```yaml
- uses: zoltsh/submit-dependencies@<full-commit-sha>
  env:
    MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
    MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
  with:
    validate-lock: true
    validation-env: |
      MAVEN_USERNAME
      MAVEN_PASSWORD
```

GitHub credential channels cannot be selected. A named value containing the
GitHub token is rejected before Zolt runs. Every selected value is registered
for runner masking and action-output redaction, regardless of its variable name.

## Limits

The immutable repository view accepts at most 50,000 tracked entries, 512 MiB
in total, and 256 MiB for one blob. These limits cover the whole repository,
even when `directory` selects a small project. Remove tracked generated or
oversized files, or use a smaller repository, if a limit is exceeded.

## Workspaces

`workspace: auto` searches upward for a workspace. `workspace: true` requires
one. `workspace: false` submits only the selected project.

Workspaces use the final `[workspace]` domain in the root `zolt.toml`.

## Removed or renamed lockfiles

Clear the old manifest identity after deleting or renaming a lockfile:

```yaml
- uses: zoltsh/submit-dependencies@<full-commit-sha>
  with:
    state: clear
    manifest-path: services/old/zolt.lock
```

This submits an empty snapshot with the old lockfile's stable identity. It does
not install or run Zolt. Lock validation inputs are rejected when clearing. For
a rename, submit the new path and clear the old path. If one workflow submits
several locks, append a stable manifest key to that job's concurrency group so
unrelated locks do not cancel each other.

The path must be absent from `GITHUB_SHA`, the checkout index, and the checkout.
A path that never existed is also accepted, so repeating a clear is safe.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `snapshot-id` | GitHub dependency snapshot ID |
| `dependency-count` | Submitted external dependency count |
| `zolt-version` | Verified Zolt version used; empty for `state: clear` |

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is not supported, including for `state: clear`.

The action supports GitHub.com only. GitHub Enterprise Server is not currently
supported.

## Compatibility

The action accepts Zolt tree schemas 1 and 3 and final workspace lock version
7. It bundles Zolt `0.1.0-zap.20260823.0ea7fe1473b4` from source commit
[`0ea7fe1473b4b852e62c452a04c2518d5e7e93ff`](https://github.com/zoltsh/zolt/commit/0ea7fe1473b4b852e62c452a04c2518d5e7e93ff).

## Read more

| Read | When you need it |
| :--- | :--- |
| [Architecture](./docs/ARCHITECTURE.md) | Understand the modules and graph rules |
| [Security](./SECURITY.md) | Review what the action trusts and rejects |
| [Release guide](./docs/RELEASING.md) | Publish an action release |
| [Canary guide](./docs/CANARY.md) | Test GitHub dependency-graph behavior |

## Development

Use Node 24 or newer. GitHub runs the committed bundle with Node 24.

```sh
npm ci
scripts/check
```

`scripts/check` checks types and style, runs the tests, rebuilds `dist/` for
comparison, and validates the action and workflows.

## License

MIT. See [LICENSE](./LICENSE).
