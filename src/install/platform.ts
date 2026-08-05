import { ACTION_VERSION } from '../constants';
import { SubmitDependenciesError } from '../errors';
import type { ReleaseTarget } from '../types';

export function resolveTarget(platform: NodeJS.Platform, architecture: string): ReleaseTarget {
    if (platform === 'linux' && architecture === 'x64') return 'linux-x64';
    if (platform === 'linux' && architecture === 'arm64') return 'linux-arm64';
    if (platform === 'darwin' && architecture === 'x64') return 'macos-x64';
    if (platform === 'darwin' && architecture === 'arm64') return 'macos-arm64';
    if (platform === 'win32') {
        throw new SubmitDependenciesError(
            'ZOLT-INSTALL-001',
            `zoltsh/submit-dependencies v${ACTION_VERSION} does not support Windows runners. Use a Linux or macOS runner.`,
        );
    }
    throw new SubmitDependenciesError(
        'ZOLT-INSTALL-002',
        `Unsupported runner platform ${platform}/${architecture}. Supported targets: linux-x64, linux-arm64, macos-x64, macos-arm64.`,
    );
}
