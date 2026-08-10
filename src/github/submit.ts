import { getOctokit } from '@actions/github';

import { SubmitDependenciesError } from '../errors';
import type { GitHubSubmissionContext } from './context';
import type { DependencySnapshot } from './snapshot';

const API_VERSION = '2026-03-10';
const SNAPSHOT_ENDPOINT = 'POST /repos/{owner}/{repo}/dependency-graph/snapshots';
const REFERENCE_ENDPOINT = 'GET /repos/{owner}/{repo}/git/ref/{ref}';

export interface SnapshotClient {
    createSnapshot(parameters: SnapshotRequestParameters): Promise<unknown>;
    getReference(owner: string, repository: string, ref: string): Promise<unknown>;
}

export interface SnapshotRequestParameters extends DependencySnapshot {
    readonly owner: string;
    readonly repo: string;
    readonly [key: string]: unknown;
}

export interface SubmissionResult {
    readonly id: number;
    readonly result: 'SUCCESS';
}

export async function submitSnapshot(
    token: string,
    context: GitHubSubmissionContext,
    snapshot: DependencySnapshot,
    client: SnapshotClient = createSnapshotClient(token),
): Promise<SubmissionResult> {
    const branchRef = context.ref.slice('refs/'.length);
    let referenceResponse: unknown;
    try {
        referenceResponse = await client.getReference(context.owner, context.repository, branchRef);
    } catch (error) {
        throw sanitizedGitHubError(error, 'GET', '/git/ref');
    }
    const reference = decodeReferenceResponse(referenceResponse);
    if (reference === undefined) {
        throw new SubmitDependenciesError(
            'ZOLT-GITHUB-003',
            'GitHub returned an invalid default-branch reference. No dependency snapshot was submitted.',
        );
    }
    if (reference.sha.toLowerCase() !== context.sha) {
        throw new SubmitDependenciesError(
            'ZOLT-GITHUB-003',
            'The default branch advanced after this run started. Rerun the workflow; no stale dependency snapshot was submitted.',
        );
    }
    let response: unknown;
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
    const result = decodeSnapshotResponse(response);
    if (result === undefined) {
        throw new SubmitDependenciesError('ZOLT-GITHUB-002', 'GitHub returned an invalid snapshot success response.');
    }
    return result;
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

function decodeReferenceResponse(value: unknown): { readonly sha: string } | undefined {
    const data = field(value, 'data');
    const object = field(data, 'object');
    const sha = field(object, 'sha');
    const type = field(object, 'type');
    return type === 'commit' && typeof sha === 'string' && /^[a-fA-F0-9]{40}$/u.test(sha)
        ? { sha }
        : undefined;
}

function decodeSnapshotResponse(value: unknown): SubmissionResult | undefined {
    const data = field(value, 'data');
    const id = number(field(data, 'id'));
    return id !== undefined && id >= 1 && field(data, 'result') === 'SUCCESS'
        ? { id, result: 'SUCCESS' }
        : undefined;
}

function field(value: unknown, name: string): unknown {
    return typeof value === 'object' && value !== null
        ? (value as Readonly<Record<string, unknown>>)[name]
        : undefined;
}

function safeHeader(headers: Readonly<Record<string, unknown>> | undefined, name: string): string | undefined {
    const value = headers?.[name];
    return typeof value === 'string' && /^[A-Za-z0-9:-]{1,100}$/u.test(value) ? value : undefined;
}

function safeMethod(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Z]{3,10}$/u.test(value) ? value : undefined;
}
