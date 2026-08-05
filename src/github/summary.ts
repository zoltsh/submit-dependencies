import type { ConvertedManifest } from '../converter/convert';

export interface SummaryInput {
    readonly manifest: ConvertedManifest;
    readonly snapshotId: number;
    readonly validateLock: boolean;
    readonly zoltVersion: string;
}

export function renderSummary(input: SummaryInput): string {
    const statistics = input.manifest.statistics;
    const validation = input.validateLock
        ? 'Lock validation was enabled; Zolt may have contacted configured repositories before offline analysis.'
        : 'Analysis was offline and did not resolve or download Maven dependencies.';
    return [
        '## Zolt dependency snapshot',
        '',
        '| Field | Value |',
        '| --- | ---: |',
        `| Snapshot ID | ${input.snapshotId.toString()} |`,
        `| Manifest | \`${escapeCode(input.manifest.sourceLocation)}\` |`,
        `| Mode | ${input.manifest.mode} |`,
        `| External dependencies | ${statistics.externalDependencies.toString()} |`,
        `| Direct / indirect | ${statistics.direct.toString()} / ${statistics.indirect.toString()} |`,
        `| Runtime / development | ${statistics.runtime.toString()} / ${statistics.development.toString()} |`,
        `| Dependency edges | ${statistics.dependencyEdges.toString()} |`,
        `| Zolt | \`${escapeCode(input.zoltVersion)}\` |`,
        '',
        validation,
        '',
    ].join('\n');
}

function escapeCode(value: string): string {
    return value.replace(/`/gu, '\\`').replace(/[\r\n]/gu, ' ');
}
