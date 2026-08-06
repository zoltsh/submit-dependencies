export function isZoltManifestPath(value: string): boolean {
    return value !== ''
        && !value.startsWith('/')
        && !value.includes('\\')
        && !value.split('/').includes('..')
        && (value === 'zolt.lock' || value.endsWith('/zolt.lock'));
}
