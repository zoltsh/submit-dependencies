import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RepositoryDirectory } from '../src/environment/directory';
import { SubmitDependenciesError } from '../src/errors';
import type { ActionInputs } from '../src/types';
import { captureZoltOutputs } from '../src/zolt/commands';
import type { ZoltProcessOptions, ZoltProcessResult } from '../src/zolt/process';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => rm(root, { force: true, recursive: true }))));

async function temporary(): Promise<string> {
    const value = await mkdtemp(join(tmpdir(), 'submit-command-test-'));
    roots.push(value);
    return value;
}

describe('Zolt command orchestration', () => {
    it('runs locked validation, tree, and offline SBOM with isolated environments', async () => {
        const root = await temporary();
        const temporaryRoot = await temporary();
        const calls: Array<{ args: readonly string[]; options: ZoltProcessOptions }> = [];
        const runner = vi.fn(async (_binary: string, args: readonly string[], options: ZoltProcessOptions): Promise<ZoltProcessResult> => {
            calls.push({ args, options });
            const outputIndex = args.indexOf('--output');
            if (outputIndex !== -1) {
                const output = args.at(outputIndex + 1);
                if (output === undefined) throw new Error('missing output fixture argument');
                await writeFile(output, '{"bom":true}');
            }
            return {
                stderr: Buffer.from(args.includes('sbom') ? 'license warning\n' : ''),
                stdout: Buffer.from(args.includes('tree') ? '{"tree":true}' : ''),
            };
        });
        const repository: RepositoryDirectory = { directory: root, relativeDirectory: '.', workspace: root };
        const inputs: ActionInputs = {
            directory: '.', githubToken: 'github-secret', state: 'submit', validationEnv: ['MAVEN_SECRET'],
            validateLock: true, workspace: 'true',
        };
        const result = await captureZoltOutputs('/verified/zolt', inputs, repository, {
            environment: {
                ACTIONS_FUTURE_TOKEN: 'future-github-bearer',
                ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-bearer',
                ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
                GITHUB_TOKEN: 'github-secret',
                HOME: '/home/runner',
                INPUT_GITHUB_TOKEN: 'github-secret',
                MAVEN_SECRET: 'repository-secret',
                PATH: '/bin',
                RUNNER_TEMP: temporaryRoot,
            },
            runner,
            select: async () => {
                await Promise.resolve();
                return { lockfile: join(root, 'zolt.lock'), manifestPath: 'zolt.lock', mode: 'workspace', root };
            },
            temporaryRoot,
        });

        expect(calls).toHaveLength(3);
        expect(calls[0]?.args).toContain('resolve');
        expect(calls[0]?.args).toContain('--locked');
        expect(calls[0]?.options.environment.MAVEN_SECRET).toBe('repository-secret');
        expect(Object.values(calls[0]?.options.environment ?? {})).not.toContain('github-secret');
        expect(calls[0]?.options.environment).not.toHaveProperty('ACTIONS_FUTURE_TOKEN');
        expect(calls[0]?.options.environment).not.toHaveProperty('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
        expect(calls[0]?.options.environment).not.toHaveProperty('ACTIONS_ID_TOKEN_REQUEST_URL');
        expect(calls[1]?.args).toContain('tree');
        expect(calls[1]?.args).toContain('--workspace');
        expect(calls[2]?.args).toEqual(expect.arrayContaining([
            'sbom', '--workspace', '--offline', '--include-dev', '--include-test', '--include-provided', '--include-tools',
        ]));
        expect(calls[2]?.options.environment).toEqual({ PATH: '/bin', RUNNER_TEMP: temporaryRoot });
        expect(result).toEqual({
            bom: { bom: true }, manifestPath: 'zolt.lock', mode: 'workspace', tree: { tree: true },
            warnings: ['license warning'],
        });
        const sbomCall = calls.at(2);
        if (sbomCall === undefined) throw new Error('missing SBOM call');
        const work = sbomCall.args.at(sbomCall.args.indexOf('--output') + 1);
        if (work === undefined) throw new Error('missing work path');
        await expect(access(work)).rejects.toThrow();
    });

    it('preserves the operation failure when cleanup also fails', async () => {
        const root = await temporary();
        const inputs: ActionInputs = {
            directory: '.', githubToken: 'secret', state: 'submit', validationEnv: [],
            validateLock: false, workspace: 'false',
        };
        await expect(captureZoltOutputs('/verified/zolt', inputs, {
            directory: root, relativeDirectory: '.', workspace: root,
        }, {
            remove: async () => {
                await Promise.resolve();
                throw new Error('cleanup failed');
            },
            runner: async () => {
                await Promise.resolve();
                throw new SubmitDependenciesError(
                    'ZOLT-PROCESS-001',
                    'tree failed with raw-secret',
                    { cause: new Error('raw command output raw-secret') },
                );
            },
            select: async () => {
                await Promise.resolve();
                return { lockfile: join(root, 'zolt.lock'), manifestPath: 'zolt.lock', mode: 'project', root };
            },
            temporaryRoot: root,
            environment: { DEPLOY_PASSWORD: 'raw-secret' },
        })).rejects.toThrow(/tree failed with \*\*\*.*cleanup also failed/u);
    });
});
