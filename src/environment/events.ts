import { readFile, stat } from 'node:fs/promises';

import { MAX_EVENT_BYTES } from '../constants';
import { SubmitDependenciesError } from '../errors';

interface EventEnvironment {
    readonly eventName: string | undefined;
    readonly eventPath: string | undefined;
    readonly ref: string | undefined;
    readonly repository: string | undefined;
}

export interface EventPolicyResult {
    readonly defaultBranch: string;
    readonly eventName: 'push' | 'workflow_dispatch';
}

export async function enforceEventPolicy(environment: EventEnvironment): Promise<EventPolicyResult> {
    const eventName = environment.eventName;
    if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
        throw unsupportedEvent(eventName ?? 'unknown');
    }
    if (environment.eventPath === undefined || environment.repository === undefined || environment.ref === undefined) {
        throw new SubmitDependenciesError(
            'ZOLT-EVENT-002',
            'GitHub event context is incomplete. Run on push or workflow_dispatch for the default branch.',
        );
    }
    const event = await readEvent(environment.eventPath);
    const repository = object(event.repository, 'repository');
    const defaultBranch = string(repository.default_branch, 'repository.default_branch');
    const fullName = string(repository.full_name, 'repository.full_name');
    if (fullName !== environment.repository) {
        throw new SubmitDependenciesError(
            'ZOLT-EVENT-003',
            `Event repository ${fullName} does not match GITHUB_REPOSITORY ${environment.repository}. Fork-originated submissions are not supported.`,
        );
    }
    const expectedRef = `refs/heads/${defaultBranch}`;
    if (environment.ref !== expectedRef) {
        throw new SubmitDependenciesError(
            'ZOLT-EVENT-004',
            `Dependency snapshots may only be submitted from the default branch ${expectedRef}; received ${environment.ref}.`,
        );
    }
    return { defaultBranch, eventName };
}

function unsupportedEvent(eventName: string): SubmitDependenciesError {
    return new SubmitDependenciesError(
        'ZOLT-EVENT-001',
        `Event ${eventName} is not supported. Configure push or workflow_dispatch on the default branch; do not submit snapshots from pull requests or merge queues.`,
    );
}

async function readEvent(path: string): Promise<Record<string, unknown>> {
    try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_EVENT_BYTES) throw new Error('event payload is not a bounded regular file');
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        return object(value, 'event payload');
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw new SubmitDependenciesError('ZOLT-EVENT-005', `Could not read GitHub event payload ${path}.`, { cause: error });
    }
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new SubmitDependenciesError('ZOLT-EVENT-006', `${label} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value === '') {
        throw new SubmitDependenciesError('ZOLT-EVENT-007', `${label} must be a nonempty string.`);
    }
    return value;
}
