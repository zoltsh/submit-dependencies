import { TextDecoder } from 'node:util';

import { SubmitDependenciesError } from '../errors';
import { BoundedFileError, readBoundedRegularFile } from '../files';
import { MAX_MACHINE_DOCUMENT_BYTES } from './process';

const decoder = new TextDecoder('utf-8', { fatal: true });

export function parseMachineJson(bytes: Uint8Array, label: string): unknown {
    if (bytes.byteLength > MAX_MACHINE_DOCUMENT_BYTES) {
        throw new SubmitDependenciesError('ZOLT-OUTPUT-001', `${label} exceeds the 64 MiB machine-output limit.`);
    }
    let text: string;
    try {
        text = decoder.decode(bytes);
    } catch (error) {
        throw new SubmitDependenciesError('ZOLT-OUTPUT-002', `${label} is not valid UTF-8.`, { cause: error });
    }
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new SubmitDependenciesError('ZOLT-OUTPUT-003', `${label} is not valid JSON.`, { cause: error });
    }
}

export async function readMachineJson(path: string, label: string): Promise<unknown> {
    try {
        return parseMachineJson(await readBoundedRegularFile(path, MAX_MACHINE_DOCUMENT_BYTES), label);
    } catch (error) {
        if (error instanceof BoundedFileError) {
            throw new SubmitDependenciesError('ZOLT-OUTPUT-001', `${label} is not a stable bounded regular file.`, {
                cause: error,
            });
        }
        if (error instanceof SubmitDependenciesError) throw error;
        throw new SubmitDependenciesError('ZOLT-OUTPUT-004', `Could not read ${label} from ${path}.`, { cause: error });
    }
}
