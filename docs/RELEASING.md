# Releasing

The action is pinned to workspace-capable Zolt candidate
`0.1.0-zap.20260805.4d8ad3208ada`. No action tag should be published until the
remaining gates pass.

## v0.1.0 gates

1. **Complete:** publish one Zolt release containing workspace tree schema v2
   and its frozen golden contracts.
2. **Complete:** replace `src/generated/zolt-release.ts` with that exact version
   and the SHA-256 digest for all four supported release archives.
3. Run `scripts/check`, `npm audit`, and the real installer matrix on Linux x64,
   Linux ARM64, macOS x64, and macOS ARM64. Verify Windows fails immediately.
   CI runs the published binary against the exact pinned Zolt source workspace
   on every supported runner. A local installer-only check is
   `RUN_LIVE_ZOLT_INSTALL=true npx vitest run test/live-install.test.ts`.
4. Run a private canary containing standalone, workspace, classifier,
   non-default-type, scope-duplicate, contextual-edge, and inert vulnerable-PURL
   fixtures.
5. Confirm dependency counts, first-party exclusion, direct/runtime merge rules,
   child edges, snapshot replacement, stale dependency removal, and permission
   failure behavior in GitHub's current dependency graph.
6. Decide the default-JAR PURL policy from observed advisory matching. Apply any
   change only through `src/converter/purl-policy.ts`, then repeat the canary.
7. Confirm normal mode contacts no Maven repository and every API failure path
   keeps token material out of logs.
8. Review the committed Node 24 bundle and bundled licenses. Require a clean
   rebuild with `scripts/check`.
9. Commit with the repository signing convention, create a signed `v0.1.0` tag,
   and publish no moving major tag yet.
10. Record the immutable action commit in the README and dogfood it in
    `zoltsh/zolt`.

Follow [CANARY.md](CANARY.md) for the private GitHub dependency-graph proof in
gates 4 through 7.

The canary repository, release tag, publication, and dogfood workflow are
external state changes and are intentionally not created by local verification.
