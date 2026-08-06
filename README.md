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
> This action is pre-release. Pin it to a reviewed full commit SHA.

## Use

Run on the default branch. Pin checkout and this action to full commit SHAs.

```yaml
name: Submit Zolt dependencies

on:
  push:
    branches: [main]
    paths:
      - "**/zolt.toml"
      - "**/zolt-workspace.toml"
      - "**/zolt.lock"
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
rejects pull requests, merge queues, forks, and non-default branches.

## What it does

The action installs a checksum-pinned Zolt release, reads the committed lockfile
with `zolt tree` and `zolt sbom`, checks that both graphs agree, and submits the
result to GitHub.

The checkout must be at `GITHUB_SHA`. In submit mode, the selected `zolt.lock`
must be tracked and unmodified. Generated or modified lockfiles are rejected.

It includes direct and transitive dependencies, scopes, classifiers, artifact
types, and child edges. Workspace members are excluded as first-party packages.

Normal analysis is offline from Maven repositories. Network requests download
Zolt, verify the default-branch tip, and submit the snapshot. The action does
not build the project or run project code.

Before posting, it verifies that the default branch still points to the run's
commit. The workflow concurrency group prevents an older run from finishing
after a newer one.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Token used to submit the snapshot |
| `validate-lock` | `false` | Run `zolt resolve --locked`; may contact configured repositories |
| `state` | `submit` | `submit` a lock graph or `clear` its previous snapshot |
| `manifest-path` | — | Canonical repository-relative `zolt.lock` path; required only with `state: clear` |

## Workspaces

`workspace: auto` searches upward for a workspace. `workspace: true` requires
one. `workspace: false` submits only the selected project.

Both modern workspaces declared in `zolt.toml` and legacy
`zolt-workspace.toml` files are supported.

## Removed or renamed lockfiles

Clear the old manifest identity after deleting or renaming a lockfile:

```yaml
- uses: zoltsh/submit-dependencies@<full-commit-sha>
  with:
    state: clear
    manifest-path: services/old/zolt.lock
```

This submits an empty snapshot with the old lockfile's stable identity. It does
not install or run Zolt. For a rename, submit the new path and clear the old
path. If one workflow submits several locks, append a stable manifest key to
that job's concurrency group so unrelated locks do not cancel each other.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `snapshot-id` | GitHub dependency snapshot ID |
| `dependency-count` | Submitted external dependency count |
| `zolt-version` | Verified Zolt version used; empty for `state: clear` |

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is not supported.

## Compatibility

The action accepts Zolt tree schemas 1 and 3 and workspace lock version 5. It
bundles Zolt `0.1.0-zap.20260806.5ba5361d856f` from source commit
[`5ba5361d856fd43d65e4ca2d933271a6eff01c3f`](https://github.com/zoltsh/zolt/commit/5ba5361d856fd43d65e4ca2d933271a6eff01c3f).

## Read more

| Read | When you need it |
| :--- | :--- |
| [Architecture](./docs/ARCHITECTURE.md) | Understand the modules and graph rules |
| [Security](./SECURITY.md) | Review what the action trusts and rejects |
| [Release guide](./docs/RELEASING.md) | Publish an action release |
| [Canary guide](./docs/CANARY.md) | Test GitHub dependency-graph behavior |

## Development

Use Node 22.18 or newer in the Node 22 line, or Node 24 or newer. GitHub runs
the committed bundle with Node 24.

```sh
npm ci
scripts/check
```

`scripts/check` checks types and style, runs the tests, rebuilds `dist/` for
comparison, and validates the action and workflows.

## License

MIT. See [LICENSE](./LICENSE).
