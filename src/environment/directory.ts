import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { SubmitDependenciesError } from '../errors';

export interface RepositoryDirectory {
    readonly directory: string;
    readonly relativeDirectory: string;
    readonly workspace: string;
}

export async function resolveRepositoryDirectory(
    workspaceInput: string | undefined,
    directoryInput: string,
): Promise<RepositoryDirectory> {
    if (workspaceInput === undefined || workspaceInput.trim() === '') {
        throw new SubmitDependenciesError('ZOLT-INPUT-006', 'GITHUB_WORKSPACE is not set. Run this action after checkout.');
    }
    const workspace = await realPath('GITHUB_WORKSPACE', workspaceInput);
    const candidate = isAbsolute(directoryInput) ? directoryInput : resolve(workspace, directoryInput);
    const directory = await realPath('directory', candidate);
    const rel = relative(workspace, directory);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-004',
            `directory resolves outside GITHUB_WORKSPACE. Resolved path: ${directory}. Choose a project within the checked-out repository.`,
        );
    }
    const logical = relative(workspace, resolve(candidate));
    if (logical !== rel) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-004',
            'directory must not resolve through a symbolic-link alias. Choose the committed project directory directly.',
        );
    }
    return { directory, relativeDirectory: rel === '' ? '.' : rel, workspace };
}

async function realPath(label: string, path: string): Promise<string> {
    try {
        const resolved = await realpath(path);
        const info = await stat(resolved);
        if (!info.isDirectory()) throw new Error('not a directory');
        return resolved;
    } catch (error) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-007',
            `${label} does not resolve to a readable directory: ${path}.`,
            { cause: error },
        );
    }
}
