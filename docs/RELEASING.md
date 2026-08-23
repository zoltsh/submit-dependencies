# Releasing

Action releases use the JavaScript committed in `dist/`. They do not publish an
npm package.

## Prepare

1. Set `ACTION_VERSION` in `src/constants.ts` to the exact immutable version
   tag without the leading `v`.
2. Update `src/generated/zolt-release.ts` with one published Zolt version, its
   source commit, and all four archive checksums.
3. Run `npm ci`, `npm audit`, `npm run bundle`, and `scripts/check`.
4. Confirm the four-target integration job and Windows rejection job pass for
   the exact commit.
5. Run the [GitHub canary](./CANARY.md) and confirm its dependency snapshot
   reports the expected detector version.
6. Review the source diff, `dist/index.js`, and `dist/licenses.txt`.
7. Confirm `main` is clean and protected.

## Publish

1. Create an OpenPGP-signed annotated version tag on the reviewed commit.
2. Push the immutable tag.
3. Create a GitHub release from the tag.
4. Move the `v0` and matching minor compatibility tag only after the immutable
   versioned release is public and verified.
5. Update Zolt workflows to the release commit's full SHA.

Do not rebuild `dist/` while tagging. The reviewed commit is the release
artifact.

## Verify

- Confirm the tag resolves to the reviewed signed commit.
- Run a consumer workflow pinned to the full commit SHA.
- Confirm the expected Zolt version, snapshot ID, and dependency count.
- Confirm replacement removes stale dependencies.
- Confirm insufficient permissions fail without leaking sensitive data.
