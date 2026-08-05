import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { ZOLT_VERSION } from '../src/generated/zolt-release';
import { installZolt } from '../src/install/install-zolt';
import { resolveTarget } from '../src/install/platform';

const execute = promisify(execFile);

describe('live pinned Zolt installer', () => {
    it.runIf(process.env.RUN_LIVE_ZOLT_INSTALL === 'true')(
        'downloads, verifies, executes, and removes the current platform archive',
        async () => {
            const installed = await installZolt(resolveTarget(process.platform, process.arch));
            try {
                const result = await execute(installed.binary, ['--version'], { encoding: 'utf8' });
                expect([ZOLT_VERSION, `${ZOLT_VERSION}\n`]).toContain(result.stdout);
                expect(result.stderr).toBe('');
            } finally {
                await installed.cleanup();
            }
            await expect(access(installed.binary)).rejects.toThrow();
        },
        120_000,
    );
});
