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
    const validationEnv = parseValidationEnv(reader.getInput('validation-env', { trimWhitespace: false }));
    const state = parseState(reader.getInput('state'));
    if (state === 'clear' && (validateLock || validationEnv.length !== 0)) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-012',
            'validate-lock and validation-env are only valid when state is submit.',
        );
    }
    if (!validateLock && validationEnv.length !== 0) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-010',
            'validation-env is only valid when validate-lock is true.',
        );
    }
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
        return { directory, githubToken, manifestPath, state, validationEnv, validateLock, workspace };
    }
    if (manifestPathInput !== '') {
        throw new SubmitDependenciesError('ZOLT-INPUT-009', 'manifest-path is only valid when state is clear.');
    }
    return { directory, githubToken, state, validationEnv, validateLock, workspace };
}

export function parseValidationEnv(value: string): readonly string[] {
    if (value.length > 4096) {
        throw new SubmitDependenciesError('ZOLT-INPUT-010', 'validation-env exceeds 4096 characters.');
    }
    const names = value.split(/\r?\n/u).map((name) => name.trim()).filter((name) => name !== '');
    if (names.length > 32) {
        throw new SubmitDependenciesError('ZOLT-INPUT-010', 'validation-env accepts at most 32 variable names.');
    }
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) {
        throw new SubmitDependenciesError(
            'ZOLT-INPUT-010',
            'validation-env must contain one portable environment-variable name per line.',
        );
    }
    const unique = [...new Set(names)].sort();
    if (unique.length !== names.length) {
        throw new SubmitDependenciesError('ZOLT-INPUT-010', 'validation-env contains a duplicate variable name.');
    }
    return unique;
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
