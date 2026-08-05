# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/zoltsh/submit-dependencies/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected action ref, runner target, workflow inputs, and a minimal
reproduction. Do not include credentials or private repository data.

## Supported versions

This action is not released yet. After v0.1.0, security fixes will be applied to
the current action line. Workflows should pin the action to a full commit SHA and
update that pin after a fix is reviewed and released.

## Security boundary

The action treats paths, event payloads, Zolt archives, Zolt machine output,
CycloneDX documents, and GitHub API failures as untrusted.

- Repository inputs and discovered lockfiles must resolve inside the real
  `GITHUB_WORKSPACE`; symlink escapes are rejected.
- Zolt release URLs and targets are allowlisted. Archives are checksum-verified,
  inspected before extraction, and rejected for traversal, links, special
  entries, unexpected roots, or missing executables.
- The verified binary is invoked by absolute path with argument arrays and no
  shell. Machine documents are size-bounded and strictly decoded.
- The GitHub token is masked immediately, never passed to Zolt, and removed from
  failure messages. API diagnostics contain only a status, method, fixed
  endpoint, request ID, and a short safe message.
- Dependency submission occurs only after independent tree and CycloneDX graphs
  normalize to the same external PURL graph.
- Normal dependency analysis is Maven-offline. `validate-lock: true` explicitly
  allows Zolt to contact the repositories configured by the project.

The action cannot protect against a compromised runner, a compromised action
commit already selected by the workflow, a malicious workflow with access to
its token, or compromise of the exact Zolt release and checksum metadata
embedded in that selected action commit.

The implementation boundaries are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
