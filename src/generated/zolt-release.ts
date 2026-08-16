import type { ReleaseArtifact, ReleaseTarget } from '../types';

// Workspace-capable release candidate. Keep the version and every platform
// digest aligned with the immutable Zolt channel manifest.
export const ZOLT_VERSION = '0.1.0-zap.20260816.aa64f3e7043e';
export const ZOLT_SOURCE_COMMIT = 'aa64f3e7043e787ff22d4d89f0cab13a7bdc64a8';

const tag = `zolt-zap-${ZOLT_VERSION}`;
const base = `https://github.com/zoltsh/releases/releases/download/${tag}`;

export const ZOLT_RELEASE: Readonly<Record<ReleaseTarget, ReleaseArtifact>> = {
    'linux-arm64': artifact('linux-arm64', '0a4da04965f02dcef14b99c8ad0d84e60ff1829db02624aa82e2d78e3ab6b59c'),
    'linux-x64': artifact('linux-x64', 'a1872cf56f6ad42d4db1a1bc3a45851d12c681f56ea6987d859b114eec7a5b83'),
    'macos-arm64': artifact('macos-arm64', 'c920af8d9fbcf0bdfc277410b14c8bfeb38483017b5568d8f6580b6d84895e73'),
    'macos-x64': artifact('macos-x64', 'dbf881a809627bf3ef7239fe46ebe0e0b00f0c45deea1e4e4730c3f9ad2ed63c'),
};

function artifact(target: ReleaseTarget, sha256: string): ReleaseArtifact {
    const archive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    return { archive, archiveUrl: `${base}/${archive}`, sha256 };
}
