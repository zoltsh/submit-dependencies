# Architecture

`submit-dependencies` turns one locked Zolt graph into one GitHub dependency
snapshot.

```text
repository and event checks
    |
    v
verified Zolt binary
    |
    v
tree JSON + CycloneDX SBOM
    |
    v
strict decode and graph comparison
    |
    v
GitHub dependency snapshot
```

`state: clear` takes the shorter path from event checks to an empty snapshot
for one explicit manifest path. It never installs or runs Zolt.

## Modules

| Module | Responsibility |
| :--- | :--- |
| `environment` | Resolve paths and allow only default-branch submissions |
| `install` | Download, inspect, verify, and clean up Zolt |
| `zolt` | Select the project or workspace and collect tree and SBOM output |
| `contracts` | Decode the supported Zolt and CycloneDX formats |
| `converter` | Build one external Maven PURL graph |
| `github` | Build and submit the dependency snapshot |

## Rules

1. Repository paths stay inside `GITHUB_WORKSPACE`; submitted locks are tracked,
   unmodified files at `GITHUB_SHA`.
2. The action runs one exact Zolt version with one checksum per target.
3. Tree data supplies scope and directness. CycloneDX supplies Maven PURLs and
   workspace context.
4. Tree and CycloneDX graphs must agree, including exact schema-3 member roots,
   occurrence directness, and member attribution.
5. Direct wins over indirect. Runtime wins over development.
6. Classifiers and non-default artifact types stay distinct.
7. Workspace members are never submitted as external dependencies.
8. Snapshot identity is stable for each repository-relative lockfile path.
9. The default branch tip must still equal the run SHA immediately before POST.
10. The GitHub token never reaches Zolt or machine-output diagnostics.
11. Unknown schemas, scopes, PURLs, edges, or lock versions fail before the API
    call.

## Compatibility

Each action release owns its Zolt version and its tree, lock, CycloneDX, and
PURL rules. Changes to relationship, scope, snapshot identity, correlators, or
PURL normalization require a major release.

Default Maven type normalization lives only in
`src/converter/purl-policy.ts`.
