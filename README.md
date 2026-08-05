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

It includes direct and transitive dependencies, scopes, classifiers, artifact
types, and child edges. Workspace members are excluded as first-party packages.

Normal analysis is offline from Maven repositories. The only network requests
download Zolt and submit the snapshot. The action does not build the project or
run project code.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or a directory inside the workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Token used to submit the snapshot |
| `validate-lock` | `false` | Run `zolt resolve --locked`; may contact configured repositories |

## Workspaces

`workspace: auto` searches upward for a workspace. `workspace: true` requires
one. `workspace: false` submits only the selected project.

Both modern workspaces declared in `zolt.toml` and legacy
`zolt-workspace.toml` files are supported.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `snapshot-id` | GitHub dependency snapshot ID |
| `dependency-count` | Submitted external dependency count |
| `zolt-version` | Verified Zolt version used |

## Runners

Supported targets are `linux-x64`, `linux-arm64`, `macos-x64`, and
`macos-arm64`. Windows is not supported.

## Compatibility

The action bundles Zolt `0.1.0-zap.20260805.4d8ad3208ada`. It accepts Zolt tree
schemas 1 and 2 and workspace lock version 5.

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
