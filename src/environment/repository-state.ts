import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SubmitDependenciesError } from '../errors';
import type { SubmissionState } from '../types';

const execute = promisify(execFile);

export interface RepositoryStateInput {
    readonly expectedSha: string;
    readonly manifestPath: string;
    readonly state: SubmissionState;
    readonly workspace: string;
}

export interface RepositoryStateOptions {
    readonly environment?: NodeJS.ProcessEnv;
    readonly runner?: GitRunner;
}

export interface GitOptions {
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
}

export type GitRunner = (arguments_: readonly string[], options: GitOptions) => Promise<string>;

export async function verifyRepositoryState(
    input: RepositoryStateInput,
    options: RepositoryStateOptions = {},
): Promise<void> {
    const runner = options.runner ?? runGit;
    const gitOptions: GitOptions = {
        cwd: input.workspace,
        environment: gitEnvironment(options.environment ?? process.env),
    };
    const manifestPathspec = `:(literal)${input.manifestPath}`;
    const head = (await git(
        runner,
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        gitOptions,
        'Could not read the checked-out commit. Run this action after actions/checkout.',
    )).trim();
    if (!/^[a-fA-F0-9]{40}$/u.test(head) || head.toLowerCase() !== input.expectedSha.toLowerCase()) {
        throw repositoryError(
            'The checked-out HEAD does not equal GITHUB_SHA. Check out the triggering commit before submission.',
        );
    }
    if (input.state === 'submit') {
        await git(
            runner,
            ['ls-files', '--error-unmatch', '--', manifestPathspec],
            gitOptions,
            'The selected zolt.lock is not tracked at GITHUB_SHA. Commit the lockfile before submission.',
        );
    }
    const status = await git(
        runner,
        ['status', '--porcelain=v1', '--untracked-files=all', '--', manifestPathspec],
        gitOptions,
        'Could not verify the selected manifest worktree state.',
    );
    if (status !== '') {
        throw repositoryError(
            'The selected manifest differs from GITHUB_SHA. Commit or restore the lockfile before submission.',
        );
    }
}

async function runGit(arguments_: readonly string[], options: GitOptions): Promise<string> {
    const result = await execute('git', [...arguments_], {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.environment,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
    });
    return result.stdout;
}

async function git(
    runner: GitRunner,
    arguments_: readonly string[],
    options: GitOptions,
    message: string,
): Promise<string> {
    try {
        return await runner(arguments_, options);
    } catch (error) {
        throw repositoryError(message, error);
    }
}

function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const allowed = ['LANG', 'LC_ALL', 'PATH', 'TMPDIR'];
    return {
        ...Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
    };
}

function repositoryError(message: string, cause?: unknown): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-GIT-001', message, cause === undefined ? undefined : { cause });
}
