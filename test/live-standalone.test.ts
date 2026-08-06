import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { convert } from '../src/converter/convert';
import { PRESERVE_ZOLT_PURLS } from '../src/converter/purl-policy';
import { installZolt } from '../src/install/install-zolt';
import { resolveTarget } from '../src/install/platform';
import { captureZoltOutputs } from '../src/zolt/commands';

const CLASSIFIED = 'pkg:maven/io.netty/netty-transport-native-epoll@4.1.136.Final?classifier=linux-x86_64&type=jar';
const JUNIT_CONSOLE = 'pkg:maven/org.junit.platform/junit-platform-console@1.11.4?type=jar';
const POM = 'pkg:maven/org.springframework.boot/spring-boot-dependencies@3.5.5?type=pom';
const SLF4J = 'pkg:maven/org.slf4j/slf4j-api@2.0.17?type=jar';
const UNREACHABLE = 'pkg:maven/org.example/unreachable@1.0.0?type=jar';

describe('live pinned Zolt standalone contract', () => {
    it.runIf(process.env.RUN_LIVE_ZOLT_STANDALONE === 'true')(
        'converts the committed schema-1 fixture with the published binary',
        async () => {
            const expectedTarget = process.env.EXPECTED_ZOLT_TARGET;
            if (expectedTarget === undefined) throw new Error('EXPECTED_ZOLT_TARGET is required for the live standalone test.');
            const directory = await realpath(join(import.meta.dirname, 'fixtures', 'live-standalone'));
            const installed = await installZolt(resolveTarget(process.platform, process.arch));
            try {
                expect(installed.target).toBe(expectedTarget);
                const machine = await captureZoltOutputs(installed.binary, {
                    directory: '.',
                    githubToken: 'must-not-reach-zolt',
                    state: 'submit',
                    validateLock: false,
                    workspace: 'false',
                }, {
                    directory,
                    relativeDirectory: '.',
                    workspace: directory,
                });
                const tree = record(machine.tree, 'tree');
                const roots = stringArray(tree.roots, 'tree.roots');
                expect(roots.filter((value) => value === 'org.slf4j:slf4j-api:2.0.17')).toHaveLength(2);

                const result = convert({ ...machine, purlPolicy: PRESERVE_ZOLT_PURLS });
                expect(result).toMatchObject({ mode: 'project', treeSchema: 1 });
                expect(result.statistics).toEqual({
                    dependencyEdges: 27,
                    development: 7,
                    direct: 3,
                    externalDependencies: 16,
                    indirect: 13,
                    runtime: 9,
                });
                expect(result.dependencies.get(SLF4J)).toMatchObject({ relationship: 'direct', scope: 'runtime' });
                expect(result.dependencies.get(JUNIT_CONSOLE)).toMatchObject({
                    relationship: 'indirect',
                    scope: 'development',
                });
                expect(result.dependencies.has(CLASSIFIED)).toBe(true);
                expect(result.dependencies.has(POM)).toBe(true);

                const unreachableTree = structuredClone(tree);
                arrayProperty(unreachableTree, 'packages').push({
                    id: 'org.example:unreachable',
                    version: '1.0.0',
                    coordinate: 'org.example:unreachable:1.0.0',
                    scope: 'test',
                    direct: false,
                    dependencies: [],
                    policies: [],
                });
                const unreachableBom = structuredClone(record(machine.bom, 'bom'));
                arrayProperty(unreachableBom, 'components').push({
                    type: 'library',
                    'bom-ref': UNREACHABLE,
                    group: 'org.example',
                    name: 'unreachable',
                    version: '1.0.0',
                    purl: UNREACHABLE,
                    scope: 'required',
                });
                arrayProperty(unreachableBom, 'dependencies').push({ ref: UNREACHABLE, dependsOn: [] });
                expect(() => convert({
                    bom: unreachableBom,
                    manifestPath: machine.manifestPath,
                    purlPolicy: PRESERVE_ZOLT_PURLS,
                    tree: unreachableTree,
                })).toThrow(/ZOLT-GRAPH-016.*unreachable from every accepted root/u);
            } finally {
                await installed.cleanup();
            }
        },
        120_000,
    );
});

function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value as Record<string, unknown>;
}

function arrayProperty(value: Record<string, unknown>, key: string): unknown[] {
    const property = value[key];
    if (!Array.isArray(property)) throw new Error(`${key} must be an array.`);
    return property;
}

function stringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${label} must be a string array.`);
    }
    return value as string[];
}
