import type { ReleaseArtifact, ReleaseTarget } from '../types';

// Workspace-capable release candidate. Keep the version and every platform
// digest aligned with the immutable Zolt channel manifest.
export const ZOLT_VERSION = '0.1.0-zap.20260806.5ba5361d856f';
export const ZOLT_SOURCE_COMMIT = '5ba5361d856fd43d65e4ca2d933271a6eff01c3f';

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', 'e4855eae2713d478a7813d76f65dc270892c0895e4cc38107666918b1d698e91'),
    'linux-x64': artifact('linux-x64', '81ef2c15a8fade32732baf98b3a94f748404d74593f732f76a661a1e3b8358be'),
    'macos-arm64': artifact('macos-arm64', 'a91be6ca4335fe8e93752320d04e40cc9b8da7ee09b455af87ef48781b5406ff'),
    'macos-x64': artifact('macos-x64', '125c0c0cae5418acdab2c8431b08bca678ca697f610750d638bf58d489a12cca'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
