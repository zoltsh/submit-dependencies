import { posix } from 'node:path';

export function parseZoltManifestPath(value: string): string | undefined {
    if (
        value === ''
        || posix.isAbsolute(value)
        || value.includes('\\')
        || containsControlCharacter(value)
        || posix.normalize(value) !== value
    ) return undefined;
    const segments = value.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
    return value === 'zolt.lock' || value.endsWith('/zolt.lock') ? value : undefined;
}

function containsControlCharacter(value: string): boolean {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && (codePoint <= 31 || codePoint >= 127 && codePoint <= 159)) return true;
    }
    return false;
}
