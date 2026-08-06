import { SubmitDependenciesError } from './errors';

export const MAX_PUBLIC_MESSAGE_CHARACTERS = 4096;

const MAX_PUBLIC_SAMPLE_BYTES = 64 * 1024;
const SENSITIVE_NAME = /(?:ACCESS_KEY|API_KEY|AUTH|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)/iu;
const escapeCharacter = String.fromCodePoint(27);
const bellCharacter = String.fromCodePoint(7);
const ANSI_ESCAPE = new RegExp(
    `${escapeCharacter}(?:\\][^${bellCharacter}]*(?:${bellCharacter}|${escapeCharacter}\\\\)|\\[[0-?]*[ -/]*[@-~])`,
    'gu',
);

export function registeredSecrets(
    environment: NodeJS.ProcessEnv,
    explicit: ReadonlyArray<string | undefined> = [],
): readonly string[] {
    const values: Set<string> = new Set();
    for (const value of explicit) addSecret(values, value);
    for (const [name, value] of Object.entries(environment)) {
        if (SENSITIVE_NAME.test(name)) addSecret(values, value);
    }
    return [...values].sort((left, right) => right.length - left.length);
}

export function publicBufferText(
    value: Buffer,
    secrets: readonly string[],
    limit = MAX_PUBLIC_MESSAGE_CHARACTERS,
): string {
    return publicText(value.subarray(0, MAX_PUBLIC_SAMPLE_BYTES).toString('utf8'), secrets, limit);
}

export function publicErrorMessage(error: unknown, secrets: readonly string[] = []): string {
    const value = error instanceof SubmitDependenciesError
        ? error.message
        : 'ZOLT-UNEXPECTED-001: Unexpected action failure.';
    return publicText(value, secrets);
}

export function publicText(
    value: string,
    secrets: readonly string[] = [],
    limit = MAX_PUBLIC_MESSAGE_CHARACTERS,
): string {
    let safe = value
        .replace(ANSI_ESCAPE, '')
        .split('')
        .map((character) => isControlCharacter(character) ? ' ' : character)
        .join('')
        .replace(/\s+/gu, ' ')
        .trim();
    safe = redactSecrets(safe, secrets)
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu, '$1***:***@')
        .replace(/([?&](?:access_key|api_key|auth|credential|password|secret|token)=)[^&\s]+/giu, '$1***');
    safe = redactSecrets(safe, secrets).replace(/::/gu, ': :');
    if (safe.length <= limit) return safe;
    return `${safe.slice(0, Math.max(0, limit - 1))}…`;
}

function redactSecrets(value: string, secrets: readonly string[]): string {
    let safe = value;
    for (const secret of secrets) {
        if (secret !== '') safe = safe.split(secret).join('***');
    }
    return safe;
}

function addSecret(values: Set<string>, value: string | undefined): void {
    if (value !== undefined && value.length >= 4) values.add(value);
}

function isControlCharacter(value: string): boolean {
    const codePoint = value.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint >= 127 && codePoint <= 159);
}
