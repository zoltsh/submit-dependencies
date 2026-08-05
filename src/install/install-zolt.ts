import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ZOLT_RELEASE, ZOLT_VERSION } from '../generated/zolt-release';
import { SubmitDependenciesError } from '../errors';
import type { ReleaseTarget } from '../types';
import { extractArchive, inspectArchive } from './archive';
import { ArchiveDownloader, type DownloadResult } from './download';
import { verifyZoltVersion } from './verify';

export interface InstalledZolt {
    readonly binary: string;
    readonly sha256: string;
    readonly target: ReleaseTarget;
    readonly version: string;
    cleanup(): Promise<void>;
}

export interface InstallDependencies {
    readonly downloader?: Downloader;
    readonly temporaryRoot?: string;
    readonly verifyVersion?: typeof verifyZoltVersion;
}

export interface Downloader {
    readonly dispose: () => void;
    readonly download: (url: URL, destination: string) => Promise<DownloadResult>;
}

export async function installZolt(target: ReleaseTarget, dependencies: InstallDependencies = {}): Promise<InstalledZolt> {
    const release = ZOLT_RELEASE[target];
    const expectedArchive = `zolt-${ZOLT_VERSION}-${target}.tar.gz`;
    const expectedUrl = `https://github.com/zoltsh/releases/releases/download/zolt-zap-${ZOLT_VERSION}/${expectedArchive}`;
    if (release.archive !== expectedArchive || release.archiveUrl !== expectedUrl || !/^[0-9a-f]{64}$/u.test(release.sha256)) {
        throw new SubmitDependenciesError('ZOLT-INSTALL-013', `Embedded release metadata for ${target} is invalid.`);
    }
    const temporaryBase = dependencies.temporaryRoot ?? process.env.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { recursive: true });
    const work = await mkdtemp(join(temporaryBase, 'zolt-dependency-submission-'));
    const downloader = dependencies.downloader ?? new ArchiveDownloader();
    let retained = false;
    try {
        const archive = resolve(work, release.archive);
        const download = await downloader.download(new URL(release.archiveUrl), archive);
        if (download.sha256 !== release.sha256) {
            throw new SubmitDependenciesError(
                'ZOLT-INSTALL-003',
                `Downloaded Zolt archive failed SHA-256 verification. Expected: ${release.sha256}. Actual: ${download.sha256}. No executable was run.`,
            );
        }
        const expectedRoot = release.archive.slice(0, -'.tar.gz'.length);
        await inspectArchive(archive, expectedRoot);
        const binary = await extractArchive(archive, resolve(work, 'extract'), expectedRoot);
        await (dependencies.verifyVersion ?? verifyZoltVersion)(binary, ZOLT_VERSION);
        retained = true;
        return {
            binary,
            cleanup: async () => rm(work, { force: true, recursive: true }),
            sha256: release.sha256,
            target,
            version: ZOLT_VERSION,
        };
    } finally {
        downloader.dispose();
        if (!retained) await rm(work, { force: true, recursive: true });
    }
}
