import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { SubmitDependenciesError } from '../errors';
import type { RepositoryDirectory } from '../environment/directory';
import { BoundedFileError, readBoundedRegularFile } from '../files';
import type { WorkspaceMode } from '../types';

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const WORKSPACE_TABLE = /^\s*\[\s*workspace\s*\]\s*(?:#.*)?$/mu;

export interface ZoltProjectSelection {
    readonly lockfile: string;
    readonly manifestPath: string;
    readonly mode: 'project' | 'workspace';
    readonly root: string;
}

export async function selectZoltProject(
    repository: RepositoryDirectory,
    workspaceMode: WorkspaceMode,
): Promise<ZoltProjectSelection> {
    if (workspaceMode === 'false') return standalone(repository, repository.directory);
    const workspaceRoot = await discoverWorkspace(repository);
    if (workspaceRoot !== undefined) return workspace(repository, workspaceRoot);
    if (workspaceMode === 'true') {
        throw new SubmitDependenciesError(
            'ZOLT-WORKSPACE-001',
            `No Zolt workspace was found from ${repository.relativeDirectory}. Expected zolt.toml with [workspace]. Set workspace: false to submit a standalone project.`,
        );
    }
    return standalone(repository, repository.directory);
}

async function discoverWorkspace(repository: RepositoryDirectory): Promise<string | undefined> {
    let current = repository.directory;
    while (contained(repository.workspace, current)) {
        const rootConfig = await regularFileInside(resolve(current, 'zolt.toml'), repository.workspace, false);
        if (rootConfig !== undefined && await containsWorkspaceTable(rootConfig)) return current;
        if (current === repository.workspace) break;
        current = dirname(current);
    }
    return undefined;
}

async function workspace(repository: RepositoryDirectory, root: string): Promise<ZoltProjectSelection> {
    const lockfile = await requiredFile(resolve(root, 'zolt.lock'), repository.workspace, 'workspace zolt.lock');
    return { lockfile, manifestPath: repositoryRelative(repository.workspace, lockfile), mode: 'workspace', root };
}

async function standalone(repository: RepositoryDirectory, root: string): Promise<ZoltProjectSelection> {
    await requiredFile(resolve(root, 'zolt.toml'), repository.workspace, 'standalone zolt.toml');
    const lockfile = await requiredFile(resolve(root, 'zolt.lock'), repository.workspace, 'standalone zolt.lock');
    return { lockfile, manifestPath: repositoryRelative(repository.workspace, lockfile), mode: 'project', root };
}

async function requiredFile(path: string, workspaceRoot: string, label: string): Promise<string> {
    const file = await regularFileInside(path, workspaceRoot, true);
    if (file === undefined) {
        throw new SubmitDependenciesError('ZOLT-WORKSPACE-002', `Required ${label} was not found at ${path}.`);
    }
    return file;
}

async function regularFileInside(path: string, workspaceRoot: string, required: boolean): Promise<string | undefined> {
    try {
        const logical = await lstat(path);
        if (!logical.isFile() || logical.isSymbolicLink()) {
            throw new SubmitDependenciesError('ZOLT-WORKSPACE-004', `Expected a regular file at ${path}.`);
        }
        const resolved = await realpath(path);
        if (!contained(workspaceRoot, resolved)) {
            throw new SubmitDependenciesError('ZOLT-WORKSPACE-003', `Configuration path resolves outside GITHUB_WORKSPACE: ${path}.`);
        }
        const info = await lstat(resolved);
        if (!info.isFile() || info.isSymbolicLink()) {
            throw new SubmitDependenciesError('ZOLT-WORKSPACE-004', `Expected a regular file at ${path}.`);
        }
        return resolved;
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) return undefined;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new SubmitDependenciesError('ZOLT-WORKSPACE-005', `Could not inspect ${path}.`, { cause: error });
    }
}

async function containsWorkspaceTable(path: string): Promise<boolean> {
    try {
        return WORKSPACE_TABLE.test((await readBoundedRegularFile(path, MAX_CONFIG_BYTES)).toString('utf8'));
    } catch (error) {
        if (error instanceof BoundedFileError && error.reason === 'too-large') {
            throw new SubmitDependenciesError(
                'ZOLT-WORKSPACE-006',
                `Zolt config ${path} exceeds ${MAX_CONFIG_BYTES.toString()} bytes.`,
                { cause: error },
            );
        }
        throw new SubmitDependenciesError('ZOLT-WORKSPACE-005', `Could not read Zolt config ${path}.`, { cause: error });
    }
}

function repositoryRelative(workspaceRoot: string, path: string): string {
    const value = relative(workspaceRoot, path);
    if (value === '' || isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
        throw new SubmitDependenciesError('ZOLT-WORKSPACE-003', `Lockfile is outside GITHUB_WORKSPACE: ${path}.`);
    }
    return value.split(sep).join('/');
}

function contained(root: string, candidate: string): boolean {
    const value = relative(root, candidate);
    return value === '' || !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`);
}
