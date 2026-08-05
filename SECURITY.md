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

- Paths must stay inside the checked-out repository. Symlink escapes fail.
- Zolt release URLs and targets are fixed. Archives must match their SHA-256 and
  expected layout.
- Archives cannot contain traversal paths, links, special files, or unexpected
  roots.
- Zolt runs by absolute path with argument arrays and no shell.
- Tree and CycloneDX output is size-bounded and strictly decoded.
- Both graphs must describe the same dependencies before submission.
- The GitHub token is masked, kept out of Zolt's environment, and removed from
  failure messages.
- Normal analysis is Maven-offline. `validate-lock: true` is the documented
  exception.

The action cannot protect a compromised runner, workflow, selected action
commit, or embedded Zolt release.

See [Architecture](./docs/ARCHITECTURE.md) for the implementation boundaries.
