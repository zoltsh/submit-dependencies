import { createHash } from 'node:crypto';

import { ACTION_VERSION } from '../constants';
import type { ConvertedManifest } from '../converter/convert';
import type { GitHubSubmissionContext } from './context';

export interface SnapshotDependency {
    readonly dependencies: string[];
    readonly package_url: string;
    readonly relationship: 'direct' | 'indirect';
    readonly scope: 'runtime' | 'development';
}

export interface DependencySnapshot {
    readonly detector: {
        readonly metadata: Readonly<Record<string, string | number | boolean>>;
        readonly name: string;
        readonly url: string;
        readonly version: string;
    };
    readonly job: {
        readonly correlator: string;
        readonly html_url: string;
        readonly id: string;
    };
    readonly manifests: Readonly<Record<string, {
        readonly file: { readonly source_location: string };
        readonly name: string;
        readonly resolved: Readonly<Record<string, SnapshotDependency>>;
    }>>;
    readonly ref: string;
    readonly scanned: string;
    readonly sha: string;
    readonly version: 0;
}

export interface BuildSnapshotInput {
    readonly context: GitHubSubmissionContext;
    readonly manifest: ConvertedManifest;
    readonly scanned: Date;
    readonly zoltVersion: string;
}

export interface BuildClearSnapshotInput {
    readonly context: GitHubSubmissionContext;
    readonly manifestPath: string;
    readonly scanned: Date;
}

const DETECTOR_NAME = 'zoltsh/submit-dependencies';
const DETECTOR_URL = 'https://github.com/zoltsh/submit-dependencies';

export function buildSnapshot(input: BuildSnapshotInput): DependencySnapshot {
    const resolved: Record<string, SnapshotDependency> = {};
    for (const [purl, dependency] of input.manifest.dependencies) {
        resolved[purl] = {
            dependencies: [...dependency.dependencies],
            package_url: dependency.packageUrl,
            relationship: dependency.relationship,
            scope: dependency.scope,
        };
    }
    const metadata: Record<string, string | number | boolean> = {
        lock_version: input.manifest.lockVersion ?? 'unknown',
        mode: input.manifest.mode,
        sbom_spec: '1.5',
        state: 'submit',
        tree_schema: input.manifest.treeSchema,
        zolt_version: input.zoltVersion,
    };
    return {
        detector: { metadata, name: DETECTOR_NAME, url: DETECTOR_URL, version: ACTION_VERSION },
        job: snapshotJob(input.context, input.manifest.sourceLocation),
        manifests: {
            [input.manifest.sourceLocation]: {
                file: { source_location: input.manifest.sourceLocation },
                name: input.manifest.name,
                resolved,
            },
        },
        ref: input.context.ref,
        scanned: input.scanned.toISOString(),
        sha: input.context.sha,
        version: 0,
    };
}

export function buildClearSnapshot(input: BuildClearSnapshotInput): DependencySnapshot {
    return {
        detector: {
            metadata: { state: 'clear' },
            name: DETECTOR_NAME,
            url: DETECTOR_URL,
            version: ACTION_VERSION,
        },
        job: snapshotJob(input.context, input.manifestPath),
        manifests: {
            [input.manifestPath]: {
                file: { source_location: input.manifestPath },
                name: input.manifestPath,
                resolved: {},
            },
        },
        ref: input.context.ref,
        scanned: input.scanned.toISOString(),
        sha: input.context.sha,
        version: 0,
    };
}

function snapshotJob(context: GitHubSubmissionContext, manifestPath: string): DependencySnapshot['job'] {
    return {
        correlator: manifestCorrelator(manifestPath),
        html_url: `${context.serverUrl}/${context.owner}/${context.repository}/actions/runs/${context.runId}`,
        id: `${context.runId}.${context.attempt}`,
    };
}

export function manifestCorrelator(manifestPath: string): string {
    return `zolt-${createHash('sha256').update(manifestPath).digest('hex').slice(0, 20)}`;
}
