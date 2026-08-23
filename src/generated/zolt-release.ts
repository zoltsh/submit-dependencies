import type { ReleaseArtifact, ReleaseTarget } from '../types';

// Workspace-capable release candidate. Keep the version and every platform
// digest aligned with the immutable Zolt channel manifest.
export const ZOLT_VERSION = '0.1.0-zap.20260823.0ea7fe1473b4';
export const ZOLT_SOURCE_COMMIT = '0ea7fe1473b4b852e62c452a04c2518d5e7e93ff';

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', 'bf8a49aab74d2cc05f01f044b15d7b6b8f8263dc8aefe9168fbd827c3a6253c4'),
    'linux-x64': artifact('linux-x64', '11c55e4117d55d1776c5eddca801b8e5f65cc9b16f2c5a8313b9f473547fdd57'),
    'macos-arm64': artifact('macos-arm64', '7bca990eea0f22a4f4b354c22ac3109d89818ed969781d43e0cc6442b428d661'),
    'macos-x64': artifact('macos-x64', '1e5dc1502ebd3c4dc5672db1fd5e557cae7c894ae28dd5dc30b1569ccd47b41f'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
