import { describe, expect, it, vi } from 'vitest';

import type { ConvertedManifest } from '../src/converter/convert';
import { SubmitDependenciesError } from '../src/errors';
import type { GitHubSubmissionContext } from '../src/github/context';
import { runAction, type ActionCore, type ActionDependencies } from '../src/main';
import type { InstalledZolt } from '../src/install/install-zolt';

function actionCore(values: Record<string, string>): ActionCore & {
    failed: string[];
    infoMock: ReturnType<typeof vi.fn>;
    outputs: Map<string, unknown>;
    secrets: string[];
} {
    const failed: string[] = [];
    const infoMock = vi.fn();
    const outputs: Map<string, unknown> = new Map();
    const secrets: string[] = [];
    return {
        failed,
        getInput: (name) => values[name] ?? '',
        info: infoMock,
        infoMock,
        outputs,
        secrets,
        setFailed: (message) => failed.push(String(message)),
        setOutput: (name, value) => outputs.set(name, value),
        setSecret: (value) => secrets.push(value),
    };
}

const submissionContext: GitHubSubmissionContext = {
    attempt: '2', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '123',
    serverUrl: 'https://github.com', sha: 'a'.repeat(40),
};

function manifest(mode: 'project' | 'workspace' = 'project'): ConvertedManifest {
    const purl = 'pkg:maven/org.example/a@1.0.0?type=jar';
    return {
        dependencies: new Map([[purl, {
            dependencies: [], packageUrl: purl, relationship: 'direct', scope: 'runtime',
        }]]),
        ...mode === 'workspace' ? { lockVersion: 5 } : {},
        mode,
        name: 'zolt.lock',
        sourceLocation: 'zolt.lock',
        statistics: {
            dependencyEdges: 0, development: 0, direct: 1, externalDependencies: 1, indirect: 0, runtime: 1,
        },
        treeSchema: mode === 'workspace' ? 3 : 1,
    };
}

function happyDependencies(core: ActionCore): ActionDependencies & {
    cleanup: ReturnType<typeof vi.fn>;
    verifyManifest: ReturnType<typeof vi.fn>;
    viewCleanup: ReturnType<typeof vi.fn>;
} {
    const cleanup = vi.fn(async () => {
        await Promise.resolve();
    });
    const verifyManifest = vi.fn(async () => {
        await Promise.resolve();
    });
    const viewCleanup = vi.fn(async () => {
        await Promise.resolve();
    });
    const installed: InstalledZolt = {
        binary: '/private/zolt', cleanup, sha256: 'a'.repeat(64), target: 'linux-x64', version: '1.2.3',
    };
    return {
        architecture: 'x64',
        capture: async () => await Promise.resolve({
            bom: {}, manifestPath: 'zolt.lock', mode: 'project', tree: {}, warnings: ['one warning'],
        }),
        cleanup,
        convertGraph: () => manifest(),
        core,
        environment: { DEPLOY_PASSWORD: 'non-github-secret', PATH: '/bin' },
        install: async () => await Promise.resolve(installed),
        now: () => new Date('2026-08-05T00:00:00.000Z'),
        platform: 'linux',
        prepareRepository: async () => await Promise.resolve({
            cleanup: viewCleanup,
            directoryInput: '.',
            verifyManifest,
            workspace: '/repo',
        }),
        resolveContext: async () => await Promise.resolve({
            event: { defaultBranch: 'main', eventName: 'push' },
            repository: { directory: '/repo', relativeDirectory: '.', workspace: '/repo' },
        }),
        resolveSubmissionContext: () => submissionContext,
        selectProject: async () => await Promise.resolve({
            lockfile: '/repo/zolt.lock', manifestPath: 'zolt.lock', mode: 'project', root: '/repo',
        }),
        submit: async () => await Promise.resolve({ id: 456, result: 'SUCCESS' }),
        verifyManifest,
        viewCleanup,
        writeSummary: async () => {
            await Promise.resolve();
        },
    };
}

describe('action adapter', () => {
    it('runs analysis, submits a snapshot, sets outputs, summarizes, and cleans up', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        const dependencies = happyDependencies(core);
        const install = vi.fn(dependencies.install);
        const submit = vi.fn(dependencies.submit);
        const writeSummary = vi.fn(dependencies.writeSummary);
        await runAction({ ...dependencies, install, submit, writeSummary });

        expect(core.secrets).toEqual(['super-secret', 'non-github-secret']);
        expect(core.outputs).toEqual(new Map<string, unknown>([
            ['snapshot-id', 456], ['dependency-count', 1], ['zolt-version', '1.2.3'],
        ]));
        expect(core.failed).toEqual([]);
        expect(dependencies.cleanup).toHaveBeenCalledOnce();
        expect(dependencies.viewCleanup).toHaveBeenCalledOnce();
        expect(submit).toHaveBeenCalledWith('super-secret', submissionContext, expect.objectContaining({
            scanned: '2026-08-05T00:00:00.000Z', version: 0,
        }));
        expect(dependencies.verifyManifest).toHaveBeenCalledTimes(2);
        expect(dependencies.verifyManifest).toHaveBeenNthCalledWith(1, {
            manifestPath: 'zolt.lock', state: 'submit',
        });
        expect(dependencies.verifyManifest).toHaveBeenNthCalledWith(2, {
            manifestPath: 'zolt.lock', state: 'submit',
        });
        expect(dependencies.verifyManifest.mock.invocationCallOrder[0]).toBeLessThan(
            install.mock.invocationCallOrder[0] ?? 0,
        );
        expect(dependencies.verifyManifest.mock.invocationCallOrder[1]).toBeLessThan(
            submit.mock.invocationCallOrder[0] ?? 0,
        );
        expect(writeSummary).toHaveBeenCalledWith(expect.stringContaining('| Snapshot ID | 456 |'));
        expect(core.infoMock).toHaveBeenCalledWith('Zolt warning: one warning');
    });

    it('submits a manifest tombstone without installing or running Zolt', async () => {
        const core = actionCore({
            'github-token': 'super-secret',
            'manifest-path': 'services/removed/zolt.lock',
            state: 'clear',
        });
        const dependencies = happyDependencies(core);
        const install = vi.fn(dependencies.install);
        const capture = vi.fn(dependencies.capture);
        const submit = vi.fn(dependencies.submit);
        const writeSummary = vi.fn(dependencies.writeSummary);
        await runAction({ ...dependencies, capture, install, submit, writeSummary });

        expect(install).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
        expect(dependencies.cleanup).not.toHaveBeenCalled();
        expect(dependencies.viewCleanup).toHaveBeenCalledOnce();
        expect(core.outputs).toEqual(new Map<string, unknown>([
            ['snapshot-id', 456], ['dependency-count', 0], ['zolt-version', ''],
        ]));
        expect(submit).toHaveBeenCalledWith('super-secret', submissionContext, expect.any(Object));
        expect(dependencies.verifyManifest).toHaveBeenCalledTimes(2);
        expect(dependencies.verifyManifest).toHaveBeenCalledWith({
            manifestPath: 'services/removed/zolt.lock', state: 'clear',
        });
        const submitted = submit.mock.calls.at(0)?.[2];
        expect(submitted?.manifests['services/removed/zolt.lock']?.resolved).toEqual({});
        expect(writeSummary).toHaveBeenCalledWith(expect.stringContaining('Zolt dependency snapshot cleared'));
    });

    it('reports expected failures without leaking the token', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        await runAction({
            ...happyDependencies(core),
            capture: async () => {
                await Promise.resolve();
                throw new SubmitDependenciesError(
                    'ZOLT-TEST-001',
                    'failure contained super-secret and non-github-secret',
                    { cause: new Error('raw command --password super-secret') },
                );
            },
        });
        expect(core.failed).toEqual(['ZOLT-TEST-001: failure contained *** and ***']);
    });

    it('does not submit when the final repository check fails', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        const dependencies = happyDependencies(core);
        dependencies.verifyManifest
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new SubmitDependenciesError(
                'ZOLT-GIT-001',
                'The private repository view changed after export.',
            ));
        const submit = vi.fn(dependencies.submit);

        await runAction({ ...dependencies, submit });

        expect(core.failed).toEqual([
            'ZOLT-GIT-001: The private repository view changed after export.',
        ]);
        expect(submit).not.toHaveBeenCalled();
    });

    it('sanitizes external directory and branch values in informational logs', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        await runAction({
            ...happyDependencies(core),
            resolveContext: async () => await Promise.resolve({
                event: { defaultBranch: 'main\n::error::branch', eventName: 'push' },
                repository: {
                    directory: '/repo', relativeDirectory: '.\n::warning::directory', workspace: '/repo',
                },
            }),
        });
        const first = String(core.infoMock.mock.calls[0]?.[0]);
        expect(first).not.toContain('\n');
        expect(first).not.toContain('::error::');
        expect(first).not.toContain('::warning::');
    });

    it('reports an empty token before creating any external adapters', async () => {
        const core = actionCore({});
        await runAction({ core });
        expect(core.failed).toEqual([expect.stringContaining('ZOLT-INPUT-002')]);
    });

    it('does not expose unexpected error messages or debug stacks and supports the real clock default', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        const dependencies = happyDependencies(core);
        Reflect.deleteProperty(dependencies, 'now');
        await runAction({
            ...dependencies,
            environment: { ACTIONS_STEP_DEBUG: 'true' },
            submit: async () => {
                await Promise.resolve();
                throw new Error('debug super-secret');
            },
        });
        expect(core.failed[0]).toBe('ZOLT-UNEXPECTED-001: Unexpected action failure.');
        expect(core.failed[0]).not.toContain('super-secret');
        expect(core.failed[0]).not.toContain('at ');
    });

    it('sanitizes multiline, ANSI, workflow-command-shaped, and long warnings', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        await runAction({
            ...happyDependencies(core),
            capture: async () => await Promise.resolve({
                bom: {},
                manifestPath: 'zolt.lock',
                mode: 'project',
                tree: {},
                warnings: [`\u001B[31m::error:: first\nsecond non-github-secret ${'x'.repeat(5000)}`],
            }),
        });
        const warning = core.infoMock.mock.calls
            .map(([message]) => String(message))
            .find((message) => message.startsWith('Zolt warning:'));
        expect(warning).toBeDefined();
        expect(warning).not.toContain('\u001B');
        expect(warning).not.toContain('::error::');
        expect(warning).not.toContain('non-github-secret');
        expect(warning?.length).toBeLessThanOrEqual(4110);
    });

    it('fails closed when selected and emitted graph modes disagree', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        const submit = vi.fn(async () => await Promise.resolve({ id: 1, result: 'SUCCESS' as const }));
        await runAction({ ...happyDependencies(core), convertGraph: () => manifest('workspace'), submit });
        expect(core.failed[0]).toContain('ZOLT-GRAPH-015');
        expect(submit).not.toHaveBeenCalled();
    });

    it('reports cleanup failures', async () => {
        const core = actionCore({ 'github-token': 'super-secret' });
        const dependencies = happyDependencies(core);
        dependencies.cleanup.mockRejectedValueOnce(new Error('cleanup failed'));
        await runAction(dependencies);
        expect(core.failed[0]).toContain('ZOLT-CLEANUP-001');
    });
});
