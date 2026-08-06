import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyRepositoryState, type GitRunner } from '../src/environment/repository-state';

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

describe('repository state', () => {
    it('requires the exact checked-out commit and a tracked clean lockfile', async () => {
        const repository = await committedRepository();
        await expect(verifyRepositoryState({
            expectedSha: repository.sha,
            manifestPath: 'zolt.lock',
            state: 'submit',
            workspace: repository.root,
        })).resolves.toBeUndefined();

        await writeFile(join(repository.root, 'zolt.lock'), 'modified');
        await expect(verifyRepositoryState({
            expectedSha: repository.sha,
            manifestPath: 'zolt.lock',
            state: 'submit',
            workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*differs from GITHUB_SHA/u);
    });

    it('accepts a clean committed deletion in clear mode', async () => {
        const repository = await committedRepository();
        await rm(join(repository.root, 'zolt.lock'));
        await git(repository.root, ['add', '--update', '--', 'zolt.lock']);
        await git(repository.root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com',
            'commit', '--no-gpg-sign', '-m', 'delete lock']);
        const sha = (await git(repository.root, ['rev-parse', 'HEAD'])).trim();

        await expect(verifyRepositoryState({
            expectedSha: sha,
            manifestPath: 'zolt.lock',
            state: 'clear',
            workspace: repository.root,
        })).resolves.toBeUndefined();
    });

    it('rejects a different HEAD and untracked manifests', async () => {
        const repository = await committedRepository(false);
        await expect(verifyRepositoryState({
            expectedSha: 'b'.repeat(40),
            manifestPath: 'zolt.lock',
            state: 'submit',
            workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*HEAD does not equal GITHUB_SHA/u);
        await expect(verifyRepositoryState({
            expectedSha: repository.sha,
            manifestPath: 'zolt.lock',
            state: 'submit',
            workspace: repository.root,
        })).rejects.toThrow(/ZOLT-GIT-001.*not tracked/u);
    });

    it('uses a credential-free environment and reports Git failures generically', async () => {
        const calls: Array<{ readonly arguments_: readonly string[]; readonly environment: NodeJS.ProcessEnv }> = [];
        const runner: GitRunner = async (arguments_, options) => {
            await Promise.resolve();
            calls.push({ arguments_, environment: options.environment });
            if (arguments_[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
            if (arguments_[0] === 'ls-files') return 'zolt.lock\n';
            return '';
        };
        await verifyRepositoryState({
            expectedSha: 'a'.repeat(40), manifestPath: 'zolt.lock', state: 'submit', workspace: '/repo',
        }, {
            environment: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', DEPLOY_PASSWORD: 'secret', PATH: '/bin' },
            runner,
        });
        expect(calls.map((call) => call.arguments_[0])).toEqual(['rev-parse', 'ls-files', 'status']);
        expect(calls[1]?.arguments_).toEqual([
            'ls-files', '--error-unmatch', '--', ':(literal)zolt.lock',
        ]);
        expect(calls[2]?.arguments_).toEqual([
            'status', '--porcelain=v1', '--untracked-files=all', '--', ':(literal)zolt.lock',
        ]);
        expect(calls[0]?.environment).toEqual({
            GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', PATH: '/bin',
        });

        const failing: GitRunner = async () => {
            await Promise.resolve();
            throw new Error('raw git failure with secret');
        };
        await expect(verifyRepositoryState({
            expectedSha: 'a'.repeat(40), manifestPath: 'zolt.lock', state: 'clear', workspace: '/repo',
        }, { runner: failing })).rejects.toThrow(
            'ZOLT-GIT-001: Could not read the checked-out commit. Run this action after actions/checkout.',
        );
    });
});

async function committedRepository(trackLock = true): Promise<{ readonly root: string; readonly sha: string }> {
    const root = await mkdtemp(join(tmpdir(), 'submit-repository-state-'));
    roots.push(root);
    await git(root, ['init', '--initial-branch=main']);
    await writeFile(join(root, 'README.md'), 'fixture');
    await writeFile(join(root, 'zolt.lock'), 'version = 5');
    await git(root, ['add', '--', 'README.md']);
    if (trackLock) await git(root, ['add', '--', 'zolt.lock']);
    await git(root, ['-c', 'user.name=test', '-c', 'user.email=test@example.com',
        'commit', '--no-gpg-sign', '-m', 'fixture']);
    const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();
    return { root, sha };
}

async function git(cwd: string, arguments_: readonly string[]): Promise<string> {
    const result = await execute('git', [...arguments_], { cwd, encoding: 'utf8' });
    return result.stdout;
}
