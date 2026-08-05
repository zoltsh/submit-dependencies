# Architecture

`submit-dependencies` is an adapter between two versioned contracts: Zolt's
machine-readable locked graph and GitHub's dependency snapshot API.

```text
repository and event policy
        |
verified pinned Zolt binary
        |
tree JSON + CycloneDX 1.5
        |
strict decoders and graph comparison
        |
deterministic GitHub snapshot
        |
sanitized Octokit submission
```

## Boundaries

`src/environment` resolves repository paths and enforces default-branch event
policy before installation. `src/install` verifies immutable release metadata,
archive bytes, archive structure, and exact `zolt --version` output.

`src/zolt` discovers the selected standalone project or workspace and invokes
only `resolve --locked` when requested, `tree --format json`, and `sbom
--offline`. It uses a private empty cache and removes its temporary directory.

`src/contracts` accepts only the Zolt tree v1/v2 and CycloneDX 1.5 subsets the
action release understands. The decoders do not coerce unknown values or ignore
unknown fields.

`src/converter` is pure. Tree data provides scope and directness; CycloneDX
provides canonical Maven PURLs and workspace context. The converter preserves
type/classifier identity, collapses scope and workspace-context copies, excludes
first-party members, and requires the normalized tree and SBOM graphs to agree.

`src/github` builds a stable manifest and correlator, then sends one request to
GitHub. It never logs or exposes the snapshot body. The action reports only the
snapshot ID, dependency count, pinned Zolt version, and a compact job summary.
The request types are local and deliberately small; the current dependency
submission toolkit is not bundled because its helper behavior and transport
dependency surface do not fit this action's logging and vulnerability gates.

## Compatibility rules

An action release owns one Zolt version and the precise tree, lock, CycloneDX,
and PURL policies tested with it. Unknown schema or lock versions fail closed.
Changing relationship, scope, manifest identity, correlator, or PURL semantics
requires a major action release.

`src/converter/purl-policy.ts` is the only place allowed to change default Maven
type normalization. The first release gate must prove GitHub advisory matching
for each PURL variant before that policy is frozen.
