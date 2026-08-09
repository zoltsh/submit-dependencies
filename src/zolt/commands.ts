import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SubmitDependenciesError } from '../errors';
import { publicBufferText, publicErrorMessage, registeredSecrets } from '../public-output';
import type { ActionInputs } from '../types';
import type { RepositoryDirectory } from '../environment/directory';
import { minimalZoltEnvironment, runZolt, type ZoltRunner, validationEnvironment } from './process';
import { parseMachineJson, readMachineJson } from './outputs';
import { selectZoltProject, type ZoltProjectSelection } from './workspace';

export interface ZoltMachineOutputs {
    readonly bom: unknown;
    readonly manifestPath: string;
    readonly mode: 'project' | 'workspace';
    readonly tree: unknown;
    readonly warnings: readonly string[];
}

export interface AnalysisDependencies {
    readonly environment?: NodeJS.ProcessEnv;
    readonly remove?: (path: string) => Promise<void>;
    readonly runner?: ZoltRunner;
    readonly select?: typeof selectZoltProject;
    readonly selection?: ZoltProjectSelection;
    readonly temporaryRoot?: string;
}

export async function captureZoltOutputs(
    binary: string,
    inputs: ActionInputs,
    repository: RepositoryDirectory,
    dependencies: AnalysisDependencies = {},
): Promise<ZoltMachineOutputs> {
    const environment = dependencies.environment ?? process.env;
    const secrets = registeredSecrets(environment, [inputs.githubToken]);
    const selection = dependencies.selection
        ?? await (dependencies.select ?? selectZoltProject)(repository, inputs.workspace);
    const temporaryBase = dependencies.temporaryRoot ?? environment.RUNNER_TEMP ?? tmpdir();
    await mkdir(temporaryBase, { mode: 0o700, recursive: true });
    const work = await mkdtemp(join(temporaryBase, 'zolt-dependency-submission-'));
    const remove = dependencies.remove ?? (async (path: string) => rm(path, { force: true, recursive: true }));
    const runner = dependencies.runner ?? runZolt;
    let result: ZoltMachineOutputs | undefined;
    let operationError: unknown;
    try {
        if (inputs.validateLock) {
            await runner(binary, resolveArguments(selection), {
                cwd: selection.root,
                environment: validationEnvironment(environment, inputs.githubToken, inputs.validationEnv),
                label: 'Zolt locked resolution validation',
            });
        }
        const analysisEnvironment = minimalZoltEnvironment(environment);
        const treeResult = await runner(binary, treeArguments(selection), {
            cwd: selection.root,
            environment: analysisEnvironment,
            label: 'Zolt tree projection',
        });
        const bomPath = join(work, 'bom.json');
        const cacheRoot = join(work, 'empty-cache');
        await mkdir(cacheRoot, { mode: 0o700 });
        const bomResult = await runner(binary, sbomArguments(selection, bomPath, cacheRoot), {
            cwd: selection.root,
            environment: analysisEnvironment,
            label: 'Zolt CycloneDX projection',
        });
        result = {
            bom: await readMachineJson(bomPath, 'Zolt CycloneDX output'),
            manifestPath: selection.manifestPath,
            mode: selection.mode,
            tree: parseMachineJson(treeResult.stdout, 'Zolt tree output'),
            warnings: [treeResult.stderr, bomResult.stderr]
                .map((value) => publicBufferText(value, secrets))
                .filter((value) => value !== ''),
        };
    } catch (error) {
        operationError = error;
    }
    try {
        await remove(work);
    } catch (cleanupError) {
        if (operationError !== undefined) {
            throw new SubmitDependenciesError(
                'ZOLT-CLEANUP-002',
                `${publicErrorMessage(operationError, secrets)} Private analysis-directory cleanup also failed.`,
                { cause: cleanupError },
            );
        }
        throw new SubmitDependenciesError('ZOLT-CLEANUP-002', 'Could not remove the private analysis directory.', {
            cause: cleanupError,
        });
    }
    if (operationError instanceof Error) throw operationError;
    if (operationError !== undefined) {
        throw new SubmitDependenciesError('ZOLT-PROCESS-003', publicErrorMessage(operationError, secrets));
    }
    if (result === undefined) throw new SubmitDependenciesError('ZOLT-PROCESS-002', 'Zolt analysis produced no result.');
    return result;
}

function baseArguments(): string[] {
    return ['--toolchain-check', 'never'];
}

function resolveArguments(selection: ZoltProjectSelection): string[] {
    return [
        ...baseArguments(),
        'resolve',
        ...selection.mode === 'workspace' ? ['--workspace'] : [],
        '--locked',
        '--directory',
        selection.root,
    ];
}

function treeArguments(selection: ZoltProjectSelection): string[] {
    return [
        ...baseArguments(),
        'tree',
        ...selection.mode === 'workspace' ? ['--workspace'] : [],
        '--format',
        'json',
        '--directory',
        selection.root,
    ];
}

function sbomArguments(selection: ZoltProjectSelection, output: string, cacheRoot: string): string[] {
    return [
        ...baseArguments(),
        'sbom',
        ...selection.mode === 'workspace' ? ['--workspace'] : [],
        '--offline',
        '--include-dev',
        '--include-test',
        '--include-provided',
        '--include-tools',
        '--cache-root',
        cacheRoot,
        '--output',
        output,
        '--directory',
        selection.root,
    ];
}
