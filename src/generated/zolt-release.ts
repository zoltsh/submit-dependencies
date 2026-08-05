import type { ReleaseArtifact, ReleaseTarget } from '../types';

// Workspace-capable release candidate. Keep the version and every platform
// digest aligned with the immutable Zolt channel manifest.
export const ZOLT_VERSION = '0.1.0-zap.20260805.4d8ad3208ada';
export const ZOLT_SOURCE_COMMIT = '4d8ad3208ada1085861241cb2e5d42ade1a00cdf';

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', '20cc3f1a6ce1cf1a6418248a772d9d239564394ac0962885a193f88b49286c6f'),
    'linux-x64': artifact('linux-x64', '35b6157054a53ca2f50ff6bbb3d69289ba8e4dff3ba47e5920beb4e992dab1fc'),
    'macos-arm64': artifact('macos-arm64', '59c5d0df71783f25f59754cdbfe90702e0d0e1b3927b366b599fdaba7784b117'),
    'macos-x64': artifact('macos-x64', '2a39ffe3ffc0ea2e547603773278749e1282b641046346fef951984bced90716'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
