import { describe, expect, it } from 'vitest';

import { convert, type ConvertedManifest } from '../src/converter/convert';
import { normalizeForGitHub, PRESERVE_ZOLT_PURLS } from '../src/converter/purl-policy';
import {
    component,
    purl,
    projectBom,
    projectTree,
    workspaceBom,
    workspaceTree,
    type PackageFixture,
} from './converter-fixtures';

function logical(manifest: ConvertedManifest): unknown {
    return {
        ...manifest,
        dependencies: [...manifest.dependencies],
    };
}

describe('pure dependency converter', () => {
    it('converts a direct runtime dependency and transitive chain', () => {
        const a = purl('org.example', 'a', '1.0.0');
        const b = purl('org.example', 'b', '2.0.0');
        const tree = projectTree([
            { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                dependencies: ['org.example:b:2.0.0:jar:runtime'] },
            { id: 'org.example:b', version: '2.0.0', scope: 'runtime', direct: false },
        ]);
        const bom = projectBom([component(a), component(b)], { [a]: [b], [b]: [] });

        const result = convert({ bom, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree });

        expect([...result.dependencies]).toEqual([
            [a, { dependencies: [b], packageUrl: a, relationship: 'direct', scope: 'runtime' }],
            [b, { dependencies: [], packageUrl: b, relationship: 'indirect', scope: 'runtime' }],
        ]);
        expect(result.statistics).toEqual({
            dependencyEdges: 1, development: 0, direct: 1, externalDependencies: 2, indirect: 1, runtime: 2,
        });
    });

    it('makes direct and runtime evidence win across scope copies', () => {
        const value = purl('org.example', 'shared', '1.0.0');
        const tree = projectTree([
            { id: 'org.example:shared', version: '1.0.0', scope: 'compile', direct: true },
            { id: 'org.example:shared', version: '1.0.0', scope: 'test', direct: false },
        ]);
        const result = convert({
            bom: projectBom([component(value)], { [value]: [] }),
            manifestPath: 'services/api/zolt.lock',
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree,
        });
        expect(result.dependencies.get(value)).toMatchObject({ relationship: 'direct', scope: 'runtime' });
        expect(result.sourceLocation).toBe('services/api/zolt.lock');
    });

    it('preserves classifiers and non-default artifact types', () => {
        const classified = purl('org.example', 'agent', '0.9.0', 'jar', 'runtime');
        const zip = purl('org.example', 'bundle', '3.0.0', 'zip');
        const tree = projectTree([
            { id: 'org.example:agent', version: '0.9.0', type: 'jar', classifier: 'runtime',
                scope: 'tool-coverage', direct: true },
            { id: 'org.example:bundle', version: '3.0.0', type: 'zip', scope: 'runtime', direct: true },
        ]);
        const result = convert({
            bom: projectBom([component(classified), component(zip)], { [classified]: [], [zip]: [] }),
            manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree,
        });
        expect([...result.dependencies.keys()]).toEqual([classified, zip]);
        expect(result.dependencies.get(classified)?.scope).toBe('development');
        expect(result.dependencies.get(zip)?.scope).toBe('runtime');
    });

    it('excludes workspace members and unions contextual external graphs', () => {
        const shared = purl('org.example', 'shared', '1.0.0');
        const extra = purl('org.example', 'extra', '2.0.0');
        const apiContext = `${shared}#zolt-context=apps%2Fapi`;
        const coreContext = `${shared}#zolt-context=modules%2Fcore`;
        const packages: PackageFixture[] = [
            { id: 'com.example:core', version: '0.1.0', scope: 'compile', direct: true,
                members: ['apps/api'], dependencies: ['org.example:shared:1.0.0:jar:compile'] },
            { id: 'org.example:extra', version: '2.0.0', scope: 'compile', direct: false,
                members: ['apps/api'] },
            { id: 'org.example:shared', version: '1.0.0', scope: 'compile', direct: true,
                members: ['apps/api', 'modules/core'], dependencies: ['org.example:extra:2.0.0:jar:compile'] },
            { id: 'org.example:shared', version: '1.0.0', scope: 'test', direct: true,
                members: ['modules/core'] },
        ];
        const bom = workspaceBom(
            [component(shared, apiContext), component(shared, coreContext), component(extra)],
            { [apiContext]: [extra], [coreContext]: [], [extra]: [] },
        );

        const result = convert({ bom, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: workspaceTree(packages) });

        expect([...result.dependencies]).toEqual([
            [extra, { dependencies: [], packageUrl: extra, relationship: 'indirect', scope: 'runtime' }],
            [shared, { dependencies: [extra], packageUrl: shared, relationship: 'direct', scope: 'runtime' }],
        ]);
        expect(result).toMatchObject({ lockVersion: 5, mode: 'workspace', treeSchema: 2 });
        expect([...result.dependencies.keys()].some((value) => value.includes('com.example'))).toBe(false);
    });

    it('returns byte-equivalent logical output for shuffled package and component order', () => {
        const a = purl('org.example', 'a', '1.0.0');
        const b = purl('org.example', 'b', '2.0.0');
        const packages: PackageFixture[] = [
            { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                dependencies: ['org.example:b:2.0.0:jar:runtime'] },
            { id: 'org.example:b', version: '2.0.0', scope: 'runtime', direct: false },
        ];
        const first = convert({
            bom: projectBom([component(a), component(b)], { [a]: [b], [b]: [] }),
            manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree: projectTree(packages),
        });
        const second = convert({
            bom: projectBom([component(b), component(a)], { [a]: [b], [b]: [] }),
            manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree: projectTree([...packages].reverse()),
        });
        expect(JSON.stringify(logical(second))).toBe(JSON.stringify(logical(first)));
    });

    it('accepts an empty locked graph', () => {
        const result = convert({
            bom: projectBom([], {}), manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: projectTree([]),
        });
        expect(result.dependencies.size).toBe(0);
        expect(result.statistics.externalDependencies).toBe(0);
    });

    it('fails closed on contract, join, edge, and graph disagreements', () => {
        const value = purl('org.example', 'a', '1.0.0');
        const validTree = projectTree([{ id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true }]);
        const validBom = projectBom([component(value)], { [value]: [] });
        const run = (tree: unknown, bom: unknown = validBom): ConvertedManifest => convert({
            bom, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree,
        });

        expect(() => run({ ...validTree, schemaVersion: 3 })).toThrow('ZOLT-CONTRACT-001');
        const unknownScope = structuredClone(validTree);
        const firstPackage = (unknownScope.packages as Array<Record<string, unknown>>).at(0);
        if (firstPackage === undefined) throw new Error('fixture has no package');
        firstPackage.scope = 'unknown';
        expect(() => run(unknownScope)).toThrow('unknown');
        const missing = projectBom([], {});
        expect(() => run(validTree, missing)).toThrow('ZOLT-GRAPH-006');
        const dangling = projectTree([{ id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
            dependencies: ['org.example:b:2.0.0:jar:runtime'] }]);
        expect(() => run(dangling)).toThrow('ZOLT-GRAPH-009');
        const mismatch = projectBom([
            component(value), component(purl('org.example', 'extra', '2.0.0')),
        ], { [value]: [], [purl('org.example', 'extra', '2.0.0')]: [] });
        expect(() => run(validTree, mismatch)).toThrow('ZOLT-GRAPH-012');
    });

    it.each(['', '/zolt.lock', 'nested\\zolt.lock', 'nested/../zolt.lock'])('rejects unsafe manifest path %j', (manifestPath) => {
        expect(() => convert({
            bom: projectBom([], {}), manifestPath, purlPolicy: PRESERVE_ZOLT_PURLS, tree: projectTree([]),
        })).toThrow('ZOLT-GRAPH-013');
    });

    it.each([
        'org.example:b:2.0.0',
        'org.example:b:2.0.0:jar',
    ])('accepts an unambiguous legacy dependency edge %s', (edge) => {
        const a = purl('org.example', 'a', '1.0.0');
        const b = purl('org.example', 'b', '2.0.0');
        const result = convert({
            bom: projectBom([component(a), component(b)], { [a]: [b], [b]: [] }),
            manifestPath: 'zolt.lock',
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: projectTree([
                { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true, dependencies: [edge] },
                { id: 'org.example:b', version: '2.0.0', scope: 'provided', direct: false },
            ]),
        });
        expect(result.dependencies.get(a)?.dependencies).toEqual([b]);
        expect(result.dependencies.get(b)?.scope).toBe('runtime');
    });

    it.each([
        'org.example:b:2.0.0:jar:runtime:extra',
        'org.example::2.0.0',
    ])('rejects malformed dependency edge %s', (edge) => {
        const a = purl('org.example', 'a', '1.0.0');
        expect(() => convert({
            bom: projectBom([component(a)], { [a]: [] }), manifestPath: 'zolt.lock',
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: projectTree([{ id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                dependencies: [edge] }]),
        })).toThrow('ZOLT-GRAPH-011');
    });

    it('rejects ambiguous legacy edges and normalization self-edges', () => {
        const a = purl('org.example', 'a', '1.0.0');
        const b = purl('org.example', 'b', '2.0.0');
        expect(() => convert({
            bom: projectBom([component(a), component(b)], { [a]: [b], [b]: [] }),
            manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: projectTree([
                { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                    dependencies: ['org.example:b:2.0.0'] },
                { id: 'org.example:b', version: '2.0.0', scope: 'compile', direct: false },
                { id: 'org.example:b', version: '2.0.0', scope: 'test', direct: false },
            ]),
        })).toThrow('ambiguous');

        expect(() => convert({
            bom: projectBom([component(a)], { [a]: [] }), manifestPath: 'zolt.lock',
            purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: projectTree([
                { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true,
                    dependencies: ['org.example:a:1.0.0:jar:test'] },
                { id: 'org.example:a', version: '1.0.0', scope: 'test', direct: false },
            ]),
        })).toThrow('ZOLT-GRAPH-010');
    });

    it('rejects workspace projection mismatches before submission', () => {
        const external = purl('org.example', 'a', '1.0.0');
        const packages: PackageFixture[] = [
            { id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true, members: ['apps/api'] },
        ];
        const countMismatch = workspaceBom([component(external)], { [external]: [] });
        const rootDependency = (countMismatch.dependencies as Array<Record<string, unknown>>)[0];
        if (rootDependency === undefined) throw new Error('fixture has no root dependency');
        rootDependency.dependsOn = (rootDependency.dependsOn as string[]).slice(0, 1);
        expect(() => convert({
            bom: countMismatch, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: workspaceTree(packages),
        })).toThrow('Workspace tree lists');

        const missingMemberPurl = workspaceBom([component(external)], { [external]: [] });
        const member = (missingMemberPurl.components as Array<Record<string, unknown>>)[0];
        if (member === undefined) throw new Error('fixture has no member');
        delete member.purl;
        delete member.group;
        delete member.version;
        expect(() => convert({
            bom: missingMemberPurl, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS,
            tree: workspaceTree(packages),
        })).toThrow('has no canonical Maven PURL');
    });

    it('rejects an external CycloneDX component without a PURL', () => {
        const tree = projectTree([{ id: 'org.example:a', version: '1.0.0', scope: 'compile', direct: true }]);
        const bom = projectBom([component(purl('org.example', 'a', '1.0.0'))], {});
        const external = (bom.components as Array<Record<string, unknown>>)[0];
        if (external === undefined) throw new Error('fixture has no component');
        delete external.purl;
        delete external.group;
        delete external.version;
        expect(() => convert({ bom, manifestPath: 'zolt.lock', purlPolicy: PRESERVE_ZOLT_PURLS, tree }))
            .toThrow('ZOLT-GRAPH-005');
    });
});

describe('PURL policy', () => {
    it('isolates default jar normalization and preserves all meaningful qualifiers', () => {
        const ordinary = purl('org.example', 'a', '1.0.0');
        const classified = purl('org.example', 'a', '1.0.0', 'jar', 'tests');
        const zip = purl('org.example', 'a', '1.0.0', 'zip');
        expect(normalizeForGitHub(ordinary, { omitDefaultJarType: true })).toBe('pkg:maven/org.example/a@1.0.0');
        expect(normalizeForGitHub(classified, { omitDefaultJarType: true }))
            .toBe('pkg:maven/org.example/a@1.0.0?classifier=tests');
        expect(normalizeForGitHub(zip, { omitDefaultJarType: true })).toBe(zip);
        expect(normalizeForGitHub(ordinary, PRESERVE_ZOLT_PURLS)).toBe(ordinary);
    });
});
