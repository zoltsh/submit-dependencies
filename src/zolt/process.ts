import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SubmitDependenciesError } from '../errors';

const execute = promisify(execFile);
export const MAX_MACHINE_DOCUMENT_BYTES = 64 * 1024 * 1024;

export interface ZoltProcessResult {
    readonly stderr: Buffer;
    readonly stdout: Buffer;
}

export type ZoltRunner = (
    binary: string,
    arguments_: readonly string[],
    options: ZoltProcessOptions,
) => Promise<ZoltProcessResult>;

export interface ZoltProcessOptions {
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly label: string;
}

export async function runZolt(
    binary: string,
    arguments_: readonly string[],
    options: ZoltProcessOptions,
): Promise<ZoltProcessResult> {
    try {
        const result = await execute(binary, [...arguments_], {
            cwd: options.cwd,
            encoding: 'buffer',
            env: options.environment,
            maxBuffer: MAX_MACHINE_DOCUMENT_BYTES,
            timeout: 120_000,
            windowsHide: true,
        });
        return { stderr: result.stderr, stdout: result.stdout };
    } catch (error) {
        throw new SubmitDependenciesError(
            'ZOLT-PROCESS-001',
            `${options.label} failed.`,
            { cause: error },
        );
    }
}

export function minimalZoltEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const allowed = ['LANG', 'LC_ALL', 'PATH', 'RUNNER_TEMP', 'TMPDIR'];
    return Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}

export function validationEnvironment(
    source: NodeJS.ProcessEnv,
    githubToken: string,
    requestedNames: readonly string[],
): NodeJS.ProcessEnv {
    const denied = new Set([
        'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
        'ACTIONS_ID_TOKEN_REQUEST_URL',
        'ACTIONS_RUNTIME_TOKEN',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'INPUT_GITHUB-TOKEN',
        'INPUT_GITHUB_TOKEN',
    ]);
    const baseline: NodeJS.ProcessEnv = {
        ...minimalZoltEnvironment(source),
        ...source.HOME === undefined ? {} : { HOME: source.HOME },
    };
    const result = Object.fromEntries(
        Object.entries(baseline).filter(([, value]) => value?.includes(githubToken) !== true),
    );
    for (const name of requestedNames) {
        if (denied.has(name) || /^ACTIONS_.*(?:TOKEN|URL)$/u.test(name) || /^(?:GH|GITHUB)_.*(?:PAT|TOKEN)$/u.test(name)) {
            throw new SubmitDependenciesError(
                'ZOLT-INPUT-011',
                `validation-env cannot pass GitHub credential channel ${name}.`,
            );
        }
        const value = source[name];
        if (value === undefined) {
            throw new SubmitDependenciesError('ZOLT-INPUT-011', `validation-env variable ${name} is not set.`);
        }
        if (value.includes(githubToken)) {
            throw new SubmitDependenciesError(
                'ZOLT-INPUT-011',
                `validation-env variable ${name} contains the GitHub token and cannot be passed to Zolt.`,
            );
        }
        result[name] = value;
    }
    return result;
}
