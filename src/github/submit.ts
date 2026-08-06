import { getOctokit } from '@actions/github';

import { SubmitDependenciesError } from '../errors';
import type { GitHubSubmissionContext } from './context';
import type { DependencySnapshot } from './snapshot';

const API_VERSION = '2026-03-10';
const SNAPSHOT_ENDPOINT = 'POST /repos/{owner}/{repo}/dependency-graph/snapshots';
const REFERENCE_ENDPOINT = 'GET /repos/{owner}/{repo}/git/ref/{ref}';

export interface SnapshotResponse {
    readonly data: {
        readonly id: number;
        readonly result: string;
    };
}

export interface ReferenceResponse {
    readonly data: {
        readonly object: {
            readonly sha: string;
            readonly type: string;
        };
    };
}

export interface SnapshotClient {
    createSnapshot(parameters: SnapshotRequestParameters): Promise<SnapshotResponse>;
    getReference(owner: string, repository: string, ref: string): Promise<ReferenceResponse>;
}

export interface SnapshotRequestParameters extends DependencySnapshot {
    readonly owner: string;
    readonly repo: string;
    readonly [key: string]: unknown;
}

export interface SubmissionResult {
    readonly id: number;
    readonly result: string;
}

export async function submitSnapshot(
    token: string,
    context: GitHubSubmissionContext,
    snapshot: DependencySnapshot,
    client: SnapshotClient = createSnapshotClient(token),
): Promise<SubmissionResult> {
    const branchRef = context.ref.slice('refs/'.length);
    let reference: ReferenceResponse;
    try {
        reference = await client.getReference(context.owner, context.repository, branchRef);
    } catch (error) {
        throw sanitizedGitHubError(error, 'GET', '/git/ref');
    }
    if (
        reference.data.object.type !== 'commit'
        || !/^[a-fA-F0-9]{40}$/u.test(reference.data.object.sha)
    ) {
        throw new SubmitDependenciesError(
            'ZOLT-GITHUB-003',
            'GitHub returned an invalid default-branch reference. No dependency snapshot was submitted.',
        );
    }
    if (reference.data.object.sha.toLowerCase() !== context.sha) {
        throw new SubmitDependenciesError(
            'ZOLT-GITHUB-003',
            'The default branch advanced after this run started. Rerun the workflow; no stale dependency snapshot was submitted.',
        );
    }
    let response: SnapshotResponse;
    try {
        const parameters: SnapshotRequestParameters = {
            ...snapshot,
            owner: context.owner,
            repo: context.repository,
        };
        response = await client.createSnapshot(parameters);
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw sanitizedGitHubError(error, 'POST', '/dependency-graph/snapshots');
    }
    if (!Number.isSafeInteger(response.data.id) || response.data.id < 1) {
        throw new SubmitDependenciesError('ZOLT-GITHUB-002', 'GitHub returned an invalid snapshot ID.');
    }
    return { id: response.data.id, result: response.data.result };
}

function createSnapshotClient(token: string): SnapshotClient {
    const octokit = getOctokit(token, {
        request: {
            headers: {
                accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': API_VERSION,
            },
        },
    });
    return {
        createSnapshot: async (parameters) => await octokit.request(SNAPSHOT_ENDPOINT, parameters),
        getReference: async (owner, repository, ref) => await octokit.request(REFERENCE_ENDPOINT, {
            owner,
            ref,
            repo: repository,
        }),
    };
}

interface RequestFailure {
    readonly request?: { readonly method?: unknown; readonly url?: unknown };
    readonly response?: { readonly headers?: Readonly<Record<string, unknown>>; readonly status?: unknown };
    readonly status?: unknown;
}

function sanitizedGitHubError(
    error: unknown,
    expectedMethod: 'GET' | 'POST',
    endpoint: string,
): SubmitDependenciesError {
    const value = typeof error === 'object' && error !== null ? error as RequestFailure : {};
    const status = number(value.status) ?? number(value.response?.status);
    const requestId = safeHeader(value.response?.headers, 'x-github-request-id');
    const method = safeMethod(value.request?.method) ?? expectedMethod;
    const details = [
        status === undefined ? undefined : `status ${status.toString()}`,
        method,
        endpoint,
        requestId === undefined ? undefined : `request ${requestId}`,
    ].filter((part): part is string => part !== undefined);
    return new SubmitDependenciesError(
        'ZOLT-GITHUB-002',
        `GitHub API request failed (${details.join(', ')}). Verify contents: write permission and the repository dependency graph settings.`,
    );
}

function number(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function safeHeader(headers: Readonly<Record<string, unknown>> | undefined, name: string): string | undefined {
    const value = headers?.[name];
    return typeof value === 'string' && /^[A-Za-z0-9:-]{1,100}$/u.test(value) ? value : undefined;
}

function safeMethod(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Z]{3,10}$/u.test(value) ? value : undefined;
}
