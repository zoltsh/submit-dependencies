import { describe, expect, it } from 'vitest';

import type { ConvertedManifest } from '../src/converter/convert';
import { renderSummary } from '../src/github/summary';

const manifest: ConvertedManifest = {
    dependencies: new Map(), mode: 'project', name: 'nested/zolt.lock', sourceLocation: 'nested/zolt.lock',
    statistics: { dependencyEdges: 2, development: 1, direct: 1, externalDependencies: 3, indirect: 2, runtime: 2 },
    treeSchema: 1,
};

describe('action summary', () => {
    it('reports graph counts and default offline behavior', () => {
        const summary = renderSummary({ manifest, snapshotId: 99, validateLock: false, zoltVersion: '0.2.0' });
        expect(summary).toContain('| Snapshot ID | 99 |');
        expect(summary).toContain('| Direct / indirect | 1 / 2 |');
        expect(summary).toContain('Analysis was offline');
    });

    it('explains the opt-in network boundary', () => {
        const summary = renderSummary({ manifest, snapshotId: 99, validateLock: true, zoltVersion: '0.2.0' });
        expect(summary).toContain('may have contacted configured repositories');
    });
});
