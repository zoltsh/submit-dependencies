import { SubmitDependenciesError } from '../errors';

export interface GitHubSubmissionContext {
    readonly attempt: string;
    readonly owner: string;
    readonly ref: string;
    readonly repository: string;
    readonly runId: string;
    readonly serverUrl: string;
    readonly sha: string;
}

export function readGitHubSubmissionContext(
    environment: NodeJS.ProcessEnv = process.env,
): GitHubSubmissionContext {
    const repositoryName = required(environment, 'GITHUB_REPOSITORY');
    const parts = repositoryName.split('/');
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))) {
        throw contextError('GITHUB_REPOSITORY must have the form owner/repository.');
    }
    const [owner, repository] = parts;
    if (owner === undefined || repository === undefined) throw contextError('GITHUB_REPOSITORY is malformed.');
    const sha = required(environment, 'GITHUB_SHA');
    if (!/^[a-fA-F0-9]{40}$/u.test(sha)) throw contextError('GITHUB_SHA must be a 40-character commit SHA.');
    const ref = required(environment, 'GITHUB_REF');
    if (!ref.startsWith('refs/heads/')) throw contextError('GITHUB_REF must identify a branch.');
    const runId = positiveInteger(environment, 'GITHUB_RUN_ID');
    const attempt = positiveInteger(environment, 'GITHUB_RUN_ATTEMPT');
    const serverUrl = required(environment, 'GITHUB_SERVER_URL').replace(/\/$/u, '');
    if (serverUrl !== 'https://github.com') throw contextError('GITHUB_SERVER_URL must be https://github.com.');
    return { attempt, owner, ref, repository, runId, serverUrl, sha: sha.toLowerCase() };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
    const value = environment[name]?.trim();
    if (value === undefined || value === '') throw contextError(`${name} is required.`);
    return value;
}

function positiveInteger(environment: NodeJS.ProcessEnv, name: string): string {
    const value = required(environment, name);
    if (!/^[1-9][0-9]*$/u.test(value)) throw contextError(`${name} must be a positive integer.`);
    return value;
}

function contextError(message: string): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-GITHUB-001', `Invalid GitHub Actions context: ${message}`);
}
