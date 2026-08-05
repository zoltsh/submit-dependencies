import { getOctokit } from '@actions/github';

import { SubmitDependenciesError } from '../errors';
import type { GitHubSubmissionContext } from './context';
import type { DependencySnapshot } from './snapshot';

const API_VERSION = '2026-03-10';
const ENDPOINT = 'POST /repos/{owner}/{repo}/dependency-graph/snapshots';

export interface SnapshotResponse {
    readonly data: {
        readonly id: number;
        readonly result: string;
    };
}

export interface SnapshotClient {
    request(route: typeof ENDPOINT, parameters: Record<string, unknown>): Promise<SnapshotResponse>;
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
    try {
        const response = await client.request(ENDPOINT, {
            ...snapshot,
            owner: context.owner,
            repo: context.repository,
        });
        if (!Number.isSafeInteger(response.data.id) || response.data.id < 1) {
            throw new Error('GitHub returned an invalid snapshot ID.');
        }
        return { id: response.data.id, result: response.data.result };
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw sanitizedSubmissionError(error, token);
    }
}

function createSnapshotClient(token: string): SnapshotClient {
    return getOctokit(token, {
        request: {
            headers: {
                accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': API_VERSION,
            },
        },
    });
}

interface RequestFailure {
    readonly message?: unknown;
    readonly request?: { readonly method?: unknown; readonly url?: unknown };
    readonly response?: { readonly headers?: Readonly<Record<string, unknown>>; readonly status?: unknown };
    readonly status?: unknown;
}

function sanitizedSubmissionError(error: unknown, token: string): SubmitDependenciesError {
    const value = typeof error === 'object' && error !== null ? error as RequestFailure : {};
    const status = number(value.status) ?? number(value.response?.status);
    const requestId = safeHeader(value.response?.headers, 'x-github-request-id');
    const method = safeMethod(value.request?.method);
    const endpoint = '/dependency-graph/snapshots';
    const message = safeMessage(value.message, token);
    const details = [
        status === undefined ? undefined : `status ${status.toString()}`,
        method,
        endpoint,
        requestId === undefined ? undefined : `request ${requestId}`,
        message,
    ].filter((part): part is string => part !== undefined);
    return new SubmitDependenciesError(
        'ZOLT-GITHUB-002',
        `GitHub rejected the dependency snapshot (${details.join(', ')}). Verify contents: write permission and the repository dependency graph settings.`,
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

function safeMessage(value: unknown, token: string): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/[\r\n\t]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (
        normalized === ''
        || normalized.length > 200
        || normalized.includes(token)
        || /token|authorization|bearer/iu.test(normalized)
    ) return undefined;
    return normalized;
}
