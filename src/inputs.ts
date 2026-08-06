import type * as core from '@actions/core';

import { SubmitDependenciesError } from './errors';
import { parseZoltManifestPath } from './manifest-path';
import type { ActionInputs, SubmissionState, WorkspaceMode } from './types';

export interface InputReader {
    getInput(name: string, options?: core.InputOptions): string;
}

export function readInputs(reader: InputReader, maskSecret: (secret: string) => void = () => undefined): ActionInputs {
    const githubToken = reader.getInput('github-token');
    if (githubToken !== '') maskSecret(githubToken);
    const directory = reader.getInput('directory').trim() || '.';
    if (directory.includes('\0')) {
        throw new SubmitDependenciesError('ZOLT-INPUT-001', 'directory contains a NUL byte. Choose a repository directory.');
    }
    const workspace = parseWorkspace(reader.getInput('workspace'));
    const validateLock = parseBoolean('validate-lock', reader.getInput('validate-lock'));
    const state = parseState(reader.getInput('state'));
    const manifestPathInput = reader.getInput('manifest-path', { trimWhitespace: false });
    const manifestPath = parseZoltManifestPath(manifestPathInput);
    if (githubToken.trim() === '') {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-002',
            'github-token is empty. Use the default github.token or provide a token with contents: write.',
        );
    }
    if (state === 'clear') {
        if (manifestPath === undefined) {
            throw new SubmitDependenciesError(
                'ZOLT-INPUT-009',
                'manifest-path must name the repository-relative zolt.lock to clear.',
            );
        }
        return { directory, githubToken, manifestPath, state, validateLock, workspace };
    }
    if (manifestPathInput !== '') {
        throw new SubmitDependenciesError('ZOLT-INPUT-009', 'manifest-path is only valid when state is clear.');
    }
    return { directory, githubToken, state, validateLock, workspace };
}

export function parseState(value: string): SubmissionState {
    const normalized = value.trim() || 'submit';
    if (normalized === 'submit' || normalized === 'clear') return normalized;
    throw new SubmitDependenciesError(
        'ZOLT-INPUT-008',
        `state must be submit or clear; received ${JSON.stringify(normalized)}.`,
    );
}

export function parseWorkspace(value: string): WorkspaceMode {
    const normalized = value.trim() || 'auto';
    if (normalized === 'auto' || normalized === 'true' || normalized === 'false') return normalized;
    throw new SubmitDependenciesError(
        'ZOLT-INPUT-003',
        `workspace must be auto, true, or false; received ${JSON.stringify(normalized)}.`,
    );
}

export function parseBoolean(name: string, value: string): boolean {
    const normalized = value.trim() || 'false';
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new SubmitDependenciesError(
        'ZOLT-INPUT-005',
        `${name} must be true or false; received ${JSON.stringify(normalized)}.`,
    );
}
