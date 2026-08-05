import { access, chmod, copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { create } from 'tar';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZOLT_RELEASE, ZOLT_VERSION } from '../src/generated/zolt-release';
import { installZolt, type Downloader } from '../src/install/install-zolt';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

async function archive(target: 'macos-arm64'): Promise<string> {
    const temporary = await mkdtemp(join(tmpdir(), 'submit-install-test-'));
    roots.push(temporary);
    const archiveRoot = ZOLT_RELEASE[target].archive.slice(0, -'.tar.gz'.length);
    const source = join(temporary, 'source');
    await mkdir(join(source, archiveRoot, 'bin'), { recursive: true });
    const binary = join(source, archiveRoot, 'bin', 'zolt');
    await writeFile(binary, '#!/bin/sh\nexit 0\n');
    await chmod(binary, 0o755);
    const path = join(temporary, 'fixture.tar.gz');
    await create({ cwd: source, file: path, gzip: true }, [archiveRoot]);
    return path;
}

function downloader(source: string, sha256: string): Downloader & { dispose: ReturnType<typeof vi.fn> } {
    const dispose = vi.fn();
    return {
        dispose,
        download: async (_url, destination) => {
            await copyFile(source, destination);
            return { bytes: 10, sha256 };
        },
    };
}

describe('pinned installer', () => {
    it('retains a verified private binary until explicit cleanup', async () => {
        const source = await archive('macos-arm64');
        const transport = downloader(source, ZOLT_RELEASE['macos-arm64'].sha256);
        const verify = vi.fn(async (_binary: string, version: string) => {
            await Promise.resolve();
            expect(version).toBe(ZOLT_VERSION);
        });
        const installed = await installZolt('macos-arm64', { downloader: transport, verifyVersion: verify });
        await expect(access(installed.binary)).resolves.toBeUndefined();
        expect(installed).toMatchObject({ target: 'macos-arm64', version: ZOLT_VERSION });
        expect(verify).toHaveBeenCalledOnce();
        expect(transport.dispose).toHaveBeenCalledOnce();
        await installed.cleanup();
        await expect(access(installed.binary)).rejects.toThrow();
    });

    it('fails before extraction on a checksum mismatch', async () => {
        const source = await archive('macos-arm64');
        const transport = downloader(source, '0'.repeat(64));
        await expect(installZolt('macos-arm64', { downloader: transport })).rejects.toThrow('ZOLT-INSTALL-003');
        expect(transport.dispose).toHaveBeenCalledOnce();
    });
});
