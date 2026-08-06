import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyZoltVersion } from '../src/install/verify';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function executable(stdout: string, stderr = '', rejectSecrets = false): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'submit-version-test-'));
    roots.push(root);
    const path = join(root, 'zolt');
    const guard = rejectSecrets
        ? 'if env | grep -E \'^(INPUT_GITHUB-TOKEN|GITHUB_TOKEN|SENTINEL|AWS_ACCESS_KEY_ID)=\' >/dev/null; then exit 9; fi\n'
        : '';
    await writeFile(path, `#!/bin/sh\n${guard}printf '%s' ${JSON.stringify(stdout)}\nprintf '%s' ${JSON.stringify(stderr)} >&2\n`);
    await chmod(path, 0o755);
    return path;
}

describe('version verification', () => {
    it('accepts only exact clean version output', async () => {
        const environment = { PATH: '/bin:/usr/bin' };
        await expect(verifyZoltVersion(await executable('1.2.3'), '1.2.3', environment)).resolves.toBeUndefined();
        await expect(verifyZoltVersion(await executable('1.2.4'), '1.2.3', environment)).rejects.toThrow('ZOLT-INSTALL-011');
        await expect(verifyZoltVersion(await executable('1.2.3', 'warning'), '1.2.3', environment)).rejects.toThrow('ZOLT-INSTALL-011');
        await expect(verifyZoltVersion('/missing/zolt', '1.2.3', environment)).rejects.toThrow('ZOLT-INSTALL-012');
    });

    it('does not pass repository or runner credentials to the version probe', async () => {
        await expect(verifyZoltVersion(await executable('1.2.3', '', true), '1.2.3', {
            AWS_ACCESS_KEY_ID: 'cloud',
            GITHUB_TOKEN: 'github',
            'INPUT_GITHUB-TOKEN': 'input',
            PATH: '/bin:/usr/bin',
            SENTINEL: 'arbitrary',
        })).resolves.toBeUndefined();
    });
});
