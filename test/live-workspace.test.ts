import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { convert } from '../src/converter/convert';
import { PRESERVE_ZOLT_PURLS } from '../src/converter/purl-policy';
import { ZOLT_SOURCE_COMMIT } from '../src/generated/zolt-release';
import { installZolt } from '../src/install/install-zolt';
import { resolveTarget } from '../src/install/platform';
import { captureZoltOutputs } from '../src/zolt/commands';

const execute = promisify(execFile);

describe('live pinned Zolt workspace contract', () => {
    it.runIf(process.env.RUN_LIVE_ZOLT_WORKSPACE === 'true')(
        'converts the pinned Zolt source workspace with the published binary',
        async () => {
            const workspaceInput = process.env.ZOLT_LIVE_WORKSPACE;
            const expectedTarget = process.env.EXPECTED_ZOLT_TARGET;
            if (workspaceInput === undefined || expectedTarget === undefined) {
                throw new Error('ZOLT_LIVE_WORKSPACE and EXPECTED_ZOLT_TARGET are required for the live workspace test.');
            }
            const workspace = await realpath(workspaceInput);
            const source = await execute('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' });
            expect(source.stdout.trim()).toBe(ZOLT_SOURCE_COMMIT);

            const installed = await installZolt(resolveTarget(process.platform, process.arch));
            try {
                expect(installed.target).toBe(expectedTarget);
                const machine = await captureZoltOutputs(installed.binary, {
                    directory: '.',
                    githubToken: 'must-not-reach-zolt',
                    state: 'submit',
                    validationEnv: [],
                    validateLock: false,
                    workspace: 'true',
                }, {
                    directory: workspace,
                    relativeDirectory: '.',
                    workspace,
                });
                const result = convert({ ...machine, purlPolicy: PRESERVE_ZOLT_PURLS });

                expect(result).toMatchObject({ lockVersion: 6, mode: 'workspace', treeSchema: 3 });
                expect(result.statistics).toEqual({
                    dependencyEdges: 21,
                    development: 21,
                    direct: 14,
                    externalDependencies: 30,
                    indirect: 16,
                    runtime: 9,
                });
                expect(result.dependencies.size).toBe(30);
                expect([...result.dependencies.keys()]).not.toContainEqual(expect.stringContaining('/sh.zolt/'));
                for (const [purl, dependency] of result.dependencies) {
                    expect(dependency.dependencies).not.toContain(purl);
                    for (const child of dependency.dependencies) expect(result.dependencies.has(child)).toBe(true);
                }
                expect(machine.warnings).toEqual([
                    expect.stringMatching(/^\d+ dependencies have unknown licenses/u),
                ]);
            } finally {
                await installed.cleanup();
            }
        },
        120_000,
    );
});
