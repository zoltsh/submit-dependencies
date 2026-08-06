import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SubmitDependenciesError } from '../errors';
import { minimalZoltEnvironment } from '../zolt/process';

const run = promisify(execFile);

export async function verifyZoltVersion(
    binary: string,
    expectedVersion: string,
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    try {
        const result = await run(binary, ['--version'], {
            encoding: 'utf8',
            env: minimalZoltEnvironment(environment),
            maxBuffer: 1024 * 1024,
            timeout: 10_000,
            windowsHide: true,
        });
        if (result.stderr !== '' || result.stdout !== expectedVersion && result.stdout !== `${expectedVersion}\n`) {
            throw new SubmitDependenciesError(
                'ZOLT-INSTALL-011',
                `Installed Zolt failed exact version verification; expected ${expectedVersion}. No project command was run.`,
            );
        }
    } catch (error) {
        if (error instanceof SubmitDependenciesError) throw error;
        throw new SubmitDependenciesError('ZOLT-INSTALL-012', 'Could not execute the verified Zolt binary.', { cause: error });
    }
}
