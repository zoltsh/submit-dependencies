import { describe, expect, it } from 'vitest';

import type { ConvertedManifest } from '../src/converter/convert';
import { buildClearSnapshot, buildSnapshot, manifestCorrelator } from '../src/github/snapshot';

function manifest(): ConvertedManifest {
    const a = 'pkg:maven/org.example/a@1.0.0?type=jar';
    const b = 'pkg:maven/org.example/b@2.0.0?type=jar';
    return {
        dependencies: new Map([
            [a, { dependencies: [b], packageUrl: a, relationship: 'direct', scope: 'runtime' }],
            [b, { dependencies: [], packageUrl: b, relationship: 'indirect', scope: 'development' }],
        ]),
        lockVersion: 5,
        mode: 'workspace',
        name: 'zolt.lock',
        sourceLocation: 'zolt.lock',
        statistics: {
            dependencyEdges: 1, development: 1, direct: 1, externalDependencies: 2, indirect: 1, runtime: 1,
        },
        treeSchema: 3,
    };
}

describe('dependency snapshot construction', () => {
    it('builds a deterministic GitHub snapshot envelope', () => {
        const result = buildSnapshot({
            context: {
                attempt: '3', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '42',
                serverUrl: 'https://github.com', sha: 'a'.repeat(40),
            },
            manifest: manifest(),
            scanned: new Date('2026-08-05T12:34:56.000Z'),
            zoltVersion: '0.2.0',
        });
        expect(result).toMatchObject({
            version: 0,
            sha: 'a'.repeat(40),
            ref: 'refs/heads/main',
            scanned: '2026-08-05T12:34:56.000Z',
            job: {
                id: '42.3',
                correlator: 'zolt-925d8d1b1a21766aa320',
                html_url: 'https://github.com/zoltsh/demo/actions/runs/42',
            },
            detector: {
                name: 'zoltsh/submit-dependencies', version: '0.1.0',
                url: 'https://github.com/zoltsh/submit-dependencies',
                metadata: {
                    lock_version: 5, mode: 'workspace', sbom_spec: '1.5', state: 'submit', tree_schema: 3,
                    zolt_version: '0.2.0',
                },
            },
        });
        expect(result.manifests['zolt.lock']?.resolved).toEqual({
            'pkg:maven/org.example/a@1.0.0?type=jar': {
                dependencies: ['pkg:maven/org.example/b@2.0.0?type=jar'],
                package_url: 'pkg:maven/org.example/a@1.0.0?type=jar', relationship: 'direct', scope: 'runtime',
            },
            'pkg:maven/org.example/b@2.0.0?type=jar': {
                dependencies: [], package_url: 'pkg:maven/org.example/b@2.0.0?type=jar',
                relationship: 'indirect', scope: 'development',
            },
        });
    });

    it('uses stable distinct correlators and represents project lock versions as unknown', () => {
        const workspaceManifest = manifest();
        const project: ConvertedManifest = {
            dependencies: workspaceManifest.dependencies,
            mode: 'project',
            name: workspaceManifest.name,
            sourceLocation: workspaceManifest.sourceLocation,
            statistics: workspaceManifest.statistics,
            treeSchema: 1,
        };
        const snapshot = buildSnapshot({
            context: { attempt: '1', owner: 'o', ref: 'refs/heads/main', repository: 'r', runId: '1',
                serverUrl: 'https://github.com', sha: 'b'.repeat(40) },
            manifest: project, scanned: new Date(0), zoltVersion: '1.0.0',
        });
        expect(snapshot.detector.metadata.lock_version).toBe('unknown');
        expect(manifestCorrelator('services/api/zolt.lock')).not.toBe(manifestCorrelator('zolt.lock'));
    });

    it('builds an empty tombstone with the same stable manifest identity', () => {
        const context = {
            attempt: '2', owner: 'zoltsh', ref: 'refs/heads/main', repository: 'demo', runId: '43',
            serverUrl: 'https://github.com', sha: 'b'.repeat(40),
        };
        const result = buildClearSnapshot({
            context,
            manifestPath: 'services/old/zolt.lock',
            scanned: new Date('2026-08-05T12:35:00.000Z'),
        });
        expect(result.detector.metadata).toEqual({ state: 'clear' });
        expect(result.job.correlator).toBe(manifestCorrelator('services/old/zolt.lock'));
        expect(result.manifests).toEqual({
            'services/old/zolt.lock': {
                file: { source_location: 'services/old/zolt.lock' },
                name: 'services/old/zolt.lock',
                resolved: {},
            },
        });
    });
});
