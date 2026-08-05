import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RepositoryDirectory } from '../src/environment/directory';
import { selectZoltProject } from '../src/zolt/workspace';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function repository(relativeDirectory = '.'): Promise<RepositoryDirectory> {
    const temporary = await mkdtemp(join(tmpdir(), 'submit-workspace-test-'));
    roots.push(temporary);
    const workspace = await realpath(temporary);
    const directory = relativeDirectory === '.' ? workspace : join(workspace, relativeDirectory);
    await mkdir(directory, { recursive: true });
    return { directory, relativeDirectory, workspace };
}

async function project(root: string): Promise<void> {
    await writeFile(join(root, 'zolt.toml'), '[project]\nname = "demo"\n');
    await writeFile(join(root, 'zolt.lock'), 'version = 5\n');
}

describe('Zolt project selection', () => {
    it('selects an exact standalone directory without walking upward', async () => {
        const repo = await repository('services/api');
        await project(repo.directory);
        await expect(selectZoltProject(repo, 'false')).resolves.toEqual({
            lockfile: join(repo.directory, 'zolt.lock'),
            manifestPath: 'services/api/zolt.lock',
            mode: 'project',
            root: repo.directory,
        });
    });

    it('discovers root-config and legacy workspaces from members', async () => {
        const rootConfig = await repository('apps/api');
        await writeFile(join(rootConfig.workspace, 'zolt.toml'), '[workspace] # root\nname = "demo"\n');
        await writeFile(join(rootConfig.workspace, 'zolt.lock'), 'version = 5\n');
        await expect(selectZoltProject(rootConfig, 'auto')).resolves.toMatchObject({
            manifestPath: 'zolt.lock', mode: 'workspace', root: rootConfig.workspace,
        });

        const legacy = await repository('modules/core');
        await writeFile(join(legacy.workspace, 'zolt-workspace.toml'), 'name = "demo"\n');
        await writeFile(join(legacy.workspace, 'zolt.lock'), 'version = 5\n');
        await expect(selectZoltProject(legacy, 'true')).resolves.toMatchObject({ mode: 'workspace', root: legacy.workspace });
    });

    it('fails clearly when required discovery or files are missing', async () => {
        const repo = await repository();
        await expect(selectZoltProject(repo, 'true')).rejects.toThrow('ZOLT-WORKSPACE-001');
        await writeFile(join(repo.workspace, 'zolt.toml'), '[project]\nname = "demo"\n');
        await expect(selectZoltProject(repo, 'false')).rejects.toThrow('ZOLT-WORKSPACE-002');
    });

    it('rejects a lockfile symlink escaping the repository', async () => {
        const repo = await repository();
        const outside = await repository();
        await writeFile(join(repo.workspace, 'zolt.toml'), '[project]\nname = "demo"\n');
        await writeFile(join(outside.workspace, 'outside.lock'), 'version = 5\n');
        await symlink(join(outside.workspace, 'outside.lock'), join(repo.workspace, 'zolt.lock'));
        await expect(selectZoltProject(repo, 'false')).rejects.toThrow('ZOLT-WORKSPACE-003');
    });
});
