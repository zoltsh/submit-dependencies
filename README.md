# submit-dependencies

Submit Zolt's complete locked dependency graph to GitHub.

The action installs one checksum-pinned Zolt release, reads `zolt.lock` through
Zolt's tree and CycloneDX projections, verifies that those projections agree,
and submits the resulting Maven PURLs to GitHub's dependency graph. It does not
build the project or contact Maven repositories by default.

> [!IMPORTANT]
> This repository is pre-release. The implementation is complete through local
> submission testing, but the embedded Zolt pin is an installer bootstrap that
> predates the final workspace tree contract. Do not publish an action tag until
> the release gates in [docs/RELEASING.md](docs/RELEASING.md) pass.

## Use

Run on the default branch and pin both checkout and this action to full commit
SHAs:

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

concurrency:
  group: zolt-dependency-submission-${{ github.ref }}
  cancel-in-progress: true

jobs:
  submit:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<full-commit-sha>
        with:
          persist-credentials: false
      - uses: zoltsh/submit-dependencies@<full-commit-sha>
```

GitHub requires `contents: write` to create a dependency snapshot. The action
rejects pull requests, merge queues, forks, and non-default branches so those
runs cannot replace the default-branch graph.

## Inputs

| Input | Default | Meaning |
| :--- | :---: | :--- |
| `directory` | `.` | Project directory, or any directory inside the target workspace |
| `workspace` | `auto` | `auto`, `true`, or `false` |
| `github-token` | `github.token` | Token used only for GitHub submission |
| `validate-lock` | `false` | Run `zolt resolve --locked`; may contact configured repositories |

`workspace: auto` searches upward inside `GITHUB_WORKSPACE` for either a
`zolt.toml` containing `[workspace]` or a legacy `zolt-workspace.toml`.
`workspace: false` uses only the selected directory. `workspace: true` fails if
no workspace is found.

## Outputs

| Output | Meaning |
| :--- | :--- |
| `snapshot-id` | GitHub dependency snapshot ID |
| `dependency-count` | Number of submitted external dependencies |
| `zolt-version` | Exact verified Zolt version used |

## Behavior

Normal analysis has only two network operations: downloading the immutable Zolt
release asset and submitting the snapshot to GitHub. Tree and SBOM generation
run with an absolute verified binary, argument arrays, no shell, an empty private
cache, `--offline`, and a minimal environment that excludes the GitHub token.

Every external direct and transitive dependency is submitted. Runtime evidence
wins over development-only evidence, and direct evidence wins over indirect.
Maven classifiers and non-default artifact types remain distinct. Workspace
members are excluded as first-party packages. Unknown schemas, scopes, PURLs,
edges, or tree/SBOM disagreements fail before any API call.

The result feeds GitHub's dependency graph, dependency review, and Dependabot
vulnerability alerts. This action does not provide native Dependabot version
updates for Zolt files.

## Compatibility

| Action | Bundled Zolt | Tree schemas | Workspace lock version |
| :--- | :--- | :---: | :---: |
| pre-release | installer bootstrap only | 1, 2 | 5 |

The table will name the production Zolt pin when the first workspace-capable
release passes the canary.

## Development

Use Node 22.18 or newer in the Node 22 line, or Node 24 or newer. GitHub runs the
committed bundle with Node 24.

```sh
npm ci
scripts/check
```

`scripts/check` validates types and style, runs the coverage-gated tests,
rebuilds `dist/` for byte comparison, and validates action/workflow YAML.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the trust boundaries and
[docs/RELEASING.md](docs/RELEASING.md) for the remaining external gates.

## License

MIT. See [LICENSE](LICENSE).
