import type { ReleaseArtifact, ReleaseTarget } from '../types';

// Bootstrap pin for installer verification. Replace this generated object with
// the first release containing the final tree --workspace contract before v0.1.0.
export const ZOLT_VERSION = '0.1.0-zap.20260804.5a2d1dca56ef';

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', 'c899630c4c022a78c4c76fee79eeaecaf3568584212a63da5770c4c74d789c8d'),
    'linux-x64': artifact('linux-x64', '36602d50c5fcb5ae5f67312138b4781c5097d3a291c4dbd185b0711d25ed60c2'),
    'macos-arm64': artifact('macos-arm64', 'd97f66869e5bf71328e92dd7cbc737a641999d0ab4e249e4eb61df39459f83ac'),
    'macos-x64': artifact('macos-x64', '502f7464664aed6489ff642570aec98d79d9c9f0458726c7c0a53130bd6601e1'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
