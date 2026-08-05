import type { ActionInputs } from '../types';
import { resolveRepositoryDirectory, type RepositoryDirectory } from './directory';
import { enforceEventPolicy, type EventPolicyResult } from './events';

export interface ExecutionContext {
    readonly event: EventPolicyResult;
    readonly repository: RepositoryDirectory;
}

export async function resolveExecutionContext(
    inputs: ActionInputs,
    environment: NodeJS.ProcessEnv = process.env,
): Promise<ExecutionContext> {
    const [repository, event] = await Promise.all([
        resolveRepositoryDirectory(environment.GITHUB_WORKSPACE, inputs.directory),
        enforceEventPolicy({
            eventName: environment.GITHUB_EVENT_NAME,
            eventPath: environment.GITHUB_EVENT_PATH,
            ref: environment.GITHUB_REF,
            repository: environment.GITHUB_REPOSITORY,
        }),
    ]);
    return { event, repository };
}
