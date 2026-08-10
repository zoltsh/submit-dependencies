# Security

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/zoltsh/submit-dependencies/security/advisories/new).
Do not open a public issue.

Include the action ref, runner target, workflow inputs, and a small reproduction.
Do not include credentials or private repository data.

## Versions

Security fixes are applied to the latest release. Pin the action to a full
commit SHA and update that pin after a fix is released.

## Model

The action treats repository paths, event data, Zolt archives, machine output,
and GitHub API failures as untrusted.

- Paths must stay inside the checked-out repository. Symlink aliases and escapes
  fail.
- Before any download or Zolt command, tracked blobs from the exact `GITHUB_SHA`
  are copied from Git objects into a private analysis directory. Checkout
  configuration does not reach Zolt.
- The private copy is checked for changed, missing, or added files before the
  snapshot is built.
- Submitted locks must be regular tracked blobs. Their mode, bytes, and standard
  index state are checked before installation and again before submission.
- A cleared lock path must be absent from `GITHUB_SHA`, the index, and the
  checkout.
- Zolt release URLs and targets are fixed. Archives must match their SHA-256 and
  expected layout.
- Archives cannot contain traversal paths, links, special files, or unexpected
  roots.
- Zolt runs by absolute path with argument arrays and no shell.
- Tree and CycloneDX output is size-bounded and strictly decoded.
- Both graphs must describe the same dependencies before submission. Schema-3
  member roots must agree with exact occurrence directness and attribution.
- Version, tree, and SBOM commands receive only path, locale, and temporary-file
  variables. Validation receives a small baseline plus only names selected by
  `validation-env`; GitHub credential channels and values containing the GitHub
  token fail closed. Every selected value is masked and included in diagnostic
  redaction regardless of its variable name.
- All public diagnostics are control-stripped, bounded, and redacted before
  reaching the runner log.
- The default branch tip is checked immediately before every snapshot POST.
  GitHub exposes no atomic check-and-submit operation, so the branch can still
  advance in the small interval between those two API requests.
- Normal analysis is Maven-offline. `validate-lock: true` is the documented
  exception.

The action cannot protect a compromised runner, workflow, selected action
commit, or embedded Zolt release.

See [Architecture](./docs/ARCHITECTURE.md) for the implementation boundaries.
