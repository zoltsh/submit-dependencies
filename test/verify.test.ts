import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyZoltVersion } from '../src/install/verify';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function executable(stdout: string, stderr = ''): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'submit-version-test-'));
    roots.push(root);
    const path = join(root, 'zolt');
    await writeFile(path, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout)}\nprintf '%s' ${JSON.stringify(stderr)} >&2\n`);
    await chmod(path, 0o755);
    return path;
}

describe('version verification', () => {
    it('accepts only exact clean version output', async () => {
        await expect(verifyZoltVersion(await executable('1.2.3'), '1.2.3')).resolves.toBeUndefined();
        await expect(verifyZoltVersion(await executable('1.2.4'), '1.2.3')).rejects.toThrow('ZOLT-INSTALL-011');
        await expect(verifyZoltVersion(await executable('1.2.3', 'warning'), '1.2.3')).rejects.toThrow('ZOLT-INSTALL-011');
        await expect(verifyZoltVersion('/missing/zolt', '1.2.3')).rejects.toThrow('ZOLT-INSTALL-012');
    });
});
