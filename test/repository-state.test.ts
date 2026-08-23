import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createRepositoryView,
    type GitRunner,
    type RepositoryView,
} from '../src/environment/repository-state';

const execute = promisify(execFile);
const roots: string[] = [];
const views: RepositoryView[] = [];

afterEach(async () => {
    await Promise.all(views.splice(0).map(async (view) => view.cleanup()));
    await Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('immutable repository view', () => {
    it('rejects invalid repository identity and paths before analysis', async () => {
        const repository = await committedRepository();
        await expect(createRepositoryView({
            directory: '.', expectedSha: repository.sha, workspace: undefined,
        })).rejects.toThrow(/ZOLT-GIT-001.*GITHUB_WORKSPACE is not set/u);
        await expect(createRepositoryView({
            directory: '.', expectedSha: 'short', workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*full 40- or 64-character/u);
        await expect(createRepositoryView({
            directory: '.', expectedSha: 'b'.repeat(40), workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*HEAD does not equal GITHUB_SHA/u);
        await expect(createRepositoryView({
            directory: '../outside', expectedSha: repository.sha, workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*directory resolves outside/u);

        const view = await openView(repository);
        await expect(view.verifyManifest({ manifestPath: 'missing/zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*not a regular tracked blob/u,
        );
        await view.cleanup();
        await expect(view.cleanup()).resolves.toBeUndefined();
    });

    it('analyzes exact committed files and rechecks the source lock bytes', async () => {
        const repository = await committedRepository();
        const view = await openView(repository);
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).resolves.toBeUndefined();
        await expect(readFile(join(view.workspace, 'zolt.toml'), 'utf8')).resolves.toBe('[project]\nname = "demo"\n');

        await writeFile(join(repository.root, 'zolt.toml'), '[project]\nname = "dirty"\n');
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).resolves.toBeUndefined();
        await expect(readFile(join(view.workspace, 'zolt.toml'), 'utf8')).resolves.toBe('[project]\nname = "demo"\n');

        await writeFile(join(repository.root, 'zolt.lock'), 'modified');
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*differs from GITHUB_SHA/u,
        );
    });

    it('rejects assume-unchanged and skip-worktree index flags explicitly', async () => {
        for (const flag of ['--assume-unchanged', '--skip-worktree']) {
            const repository = await committedRepository();
            await git(repository.root, ['update-index', flag, '--', 'zolt.lock']);
            const view = await openView(repository);
            await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
                /ZOLT-GIT-001.*nonstandard index state/u,
            );
        }
    });

    it('rejects staged content and a worktree symlink in place of the committed lock', async () => {
        const staged = await committedRepository();
        await writeFile(join(staged.root, 'zolt.lock'), 'staged');
        await git(staged.root, ['add', '--', 'zolt.lock']);
        const stagedView = await openView(staged);
        await expect(stagedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*differs from GITHUB_SHA/u,
        );

        const linked = await committedRepository();
        await rm(join(linked.root, 'zolt.lock'));
        await symlink('README.md', join(linked.root, 'zolt.lock'));
        const linkedView = await openView(linked);
        await expect(linkedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*differs from GITHUB_SHA/u,
        );
    });

    it('detects private-view mutation before snapshot construction', async () => {
        const repository = await committedRepository();
        const view = await openView(repository);
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).resolves.toBeUndefined();
        await writeFile(join(view.workspace, 'zolt.lock'), 'mutated during analysis');
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*private repository view changed/u,
        );

        const added = await committedRepository();
        const addedView = await openView(added);
        await writeFile(join(addedView.workspace, 'injected.txt'), 'injected\n');
        await expect(addedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*private repository view changed/u,
        );

        const linked = await committedRepository();
        const linkedView = await openView(linked);
        await rm(join(linkedView.workspace, 'scripts', 'README-link'));
        await symlink('../zolt.lock', join(linkedView.workspace, 'scripts', 'README-link'));
        await expect(linkedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).rejects.toThrow(
            /ZOLT-GIT-001.*changed or unsafe symbolic link/u,
        );
    });

    it('accepts deleted and never-created tombstones but rejects live or recreated locks', async () => {
        const existing = await committedRepository();
        const existingView = await openView(existing);
        await expect(existingView.verifyManifest({ manifestPath: 'zolt.lock', state: 'clear' })).rejects.toThrow(
            /ZOLT-GIT-001.*still exists at GITHUB_SHA/u,
        );

        const deleted = await committedRepository();
        await rm(join(deleted.root, 'zolt.lock'));
        await git(deleted.root, ['add', '--update', '--', 'zolt.lock']);
        await commit(deleted.root, 'delete lock');
        deleted.sha = (await git(deleted.root, ['rev-parse', 'HEAD'])).trim();
        const deletedView = await openView(deleted);
        await expect(deletedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'clear' })).resolves.toBeUndefined();
        await expect(deletedView.verifyManifest({ manifestPath: 'never/zolt.lock', state: 'clear' })).resolves.toBeUndefined();

        await writeFile(join(deleted.root, 'zolt.lock'), 'recreated without a commit');
        await expect(deletedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'clear' })).rejects.toThrow(
            /ZOLT-GIT-001.*exists in the checkout/u,
        );
        await git(deleted.root, ['add', '--', 'zolt.lock']);
        await expect(deletedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'clear' })).rejects.toThrow(
            /ZOLT-GIT-001.*exists in the checkout index/u,
        );
        await commit(deleted.root, 'recreate lock');
        deleted.sha = (await git(deleted.root, ['rev-parse', 'HEAD'])).trim();
        const recreatedView = await openView(deleted);
        await expect(recreatedView.verifyManifest({ manifestPath: 'zolt.lock', state: 'clear' })).rejects.toThrow(
            /ZOLT-GIT-001.*still exists at GITHUB_SHA/u,
        );
    });

    it('exports exact blobs even when archive attributes request omission or substitution', async () => {
        const repository = await committedRepository();
        const lock = 'version = 7\nmarker = "$Format:%H$"\n';
        await writeFile(join(repository.root, 'zolt.lock'), lock);
        await writeFile(join(repository.root, '.gitattributes'), [
            'zolt.toml export-ignore',
            'zolt.lock export-subst',
            '',
        ].join('\n'));
        await git(repository.root, ['add', '--', '.gitattributes', 'zolt.lock']);
        await commit(repository.root, 'add archive attributes');
        repository.sha = (await git(repository.root, ['rev-parse', 'HEAD'])).trim();

        const view = await openView(repository);
        await expect(readFile(join(view.workspace, 'zolt.toml'), 'utf8')).resolves.toBe('[project]\nname = "demo"\n');
        await expect(readFile(join(view.workspace, 'zolt.lock'), 'utf8')).resolves.toBe(lock);
        await expect(view.verifyManifest({ manifestPath: 'zolt.lock', state: 'submit' })).resolves.toBeUndefined();
    });

    it('rejects a committed symbolic link that escapes the repository view', async () => {
        const repository = await committedRepository();
        await symlink('/tmp/outside', join(repository.root, 'unsafe-link'));
        await git(repository.root, ['add', '--', 'unsafe-link']);
        await commit(repository.root, 'add unsafe link');
        repository.sha = (await git(repository.root, ['rev-parse', 'HEAD'])).trim();

        await expect(openView(repository)).rejects.toThrow(
            /ZOLT-GIT-001.*unsafe symbolic link/u,
        );
    });

    it('uses a credential-free Git environment and reports Git failures generically', async () => {
        const repository = await committedRepository();
        const calls: Array<{ readonly arguments_: readonly string[]; readonly environment: NodeJS.ProcessEnv }> = [];
        const runner: GitRunner = async (arguments_, options) => {
            await Promise.resolve();
            calls.push({ arguments_, environment: options.environment });
            throw new Error('raw git failure with secret');
        };
        await expect(createRepositoryView({
            directory: '.', expectedSha: repository.sha, workspace: repository.root,
        }, {
            environment: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', DEPLOY_PASSWORD: 'secret', PATH: '/bin' },
            runner,
        })).rejects.toThrow(
            'ZOLT-GIT-001: Could not read the checked-out commit. Run this action after actions/checkout.',
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]?.arguments_).toEqual(['rev-parse', '--verify', 'HEAD^{commit}']);
        expect(calls[0]?.environment).toEqual({
            GIT_ATTR_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_OPTIONAL_LOCKS: '0',
            PATH: '/bin',
        });
    });
});

interface FixtureRepository {
    readonly root: string;
    sha: string;
}

async function committedRepository(): Promise<FixtureRepository> {
    const root = await mkdtemp(join(tmpdir(), 'submit-repository-state-'));
    roots.push(root);
    await git(root, ['init', '--initial-branch=main']);
    await writeFile(join(root, 'README.md'), 'fixture\n');
    await writeFile(join(root, 'zolt.toml'), '[project]\nname = "demo"\n');
    await writeFile(join(root, 'zolt.lock'), 'version = 7\n');
    await writeFile(join(root, 'empty'), '');
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts', 'run'), '#!/bin/sh\n');
    await chmod(join(root, 'scripts', 'run'), 0o755);
    await symlink('../README.md', join(root, 'scripts', 'README-link'));
    await git(root, [
        'add', '--', 'README.md', 'empty', 'scripts/README-link', 'scripts/run', 'zolt.toml', 'zolt.lock',
    ]);
    await commit(root, 'fixture');
    return { root, sha: (await git(root, ['rev-parse', 'HEAD'])).trim() };
}

async function openView(repository: FixtureRepository): Promise<RepositoryView> {
    const view = await createRepositoryView({
        directory: '.', expectedSha: repository.sha, workspace: repository.root,
    });
    views.push(view);
    return view;
}

async function commit(root: string, message: string): Promise<void> {
    await git(root, [
        '-c', 'user.name=test', '-c', 'user.email=test@example.com',
        'commit', '--no-gpg-sign', '-m', message,
    ]);
}

async function git(cwd: string, arguments_: readonly string[]): Promise<string> {
    const result = await execute('git', [...arguments_], { cwd, encoding: 'utf8' });
    return result.stdout;
}
