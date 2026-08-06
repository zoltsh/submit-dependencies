import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveRepositoryDirectory } from '../src/environment/directory';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function temporary(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'submit-directory-test-'));
    roots.push(root);
    return root;
}

describe('repository directory', () => {
    it('returns real repository-relative paths', async () => {
        const root = await temporary();
        await mkdir(join(root, 'services', 'api'), { recursive: true });
        const resolvedRoot = await realpath(root);
        await expect(resolveRepositoryDirectory(root, 'services/api')).resolves.toMatchObject({
            directory: join(resolvedRoot, 'services', 'api'),
            relativeDirectory: 'services/api',
            workspace: resolvedRoot,
        });
        await expect(resolveRepositoryDirectory(root, '.')).resolves.toMatchObject({ relativeDirectory: '.' });
    });

    it('rejects missing workspaces, files, and symlink escapes', async () => {
        const root = await temporary();
        const outside = await temporary();
        await mkdir(join(root, 'project'));
        await writeFile(join(root, 'file'), 'x');
        await symlink(outside, join(root, 'escape'));
        await symlink('project', join(root, 'alias'));
        await expect(resolveRepositoryDirectory(undefined, '.')).rejects.toThrow('ZOLT-INPUT-006');
        await expect(resolveRepositoryDirectory(root, 'file')).rejects.toThrow('ZOLT-INPUT-007');
        await expect(resolveRepositoryDirectory(root, 'escape')).rejects.toThrow('ZOLT-INPUT-004');
        await expect(resolveRepositoryDirectory(root, 'alias')).rejects.toThrow('ZOLT-INPUT-004');
    });
});
