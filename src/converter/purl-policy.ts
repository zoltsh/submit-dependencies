import { PackageURL } from 'packageurl-js';

import { parseMavenPurl } from './identity';

export interface PurlPolicy {
    readonly omitDefaultJarType: boolean;
}

export const PRESERVE_ZOLT_PURLS: PurlPolicy = { omitDefaultJarType: false };

export function normalizeForGitHub(value: string, policy: PurlPolicy): string {
    const parsed = parseMavenPurl(value, `PURL ${value}`);
    const qualifiers = { ...parsed.packageUrl.qualifiers ?? {} };
    if (policy.omitDefaultJarType && qualifiers.type === 'jar') delete qualifiers.type;
    return new PackageURL(
        'maven',
        parsed.packageUrl.namespace,
        parsed.packageUrl.name,
        parsed.packageUrl.version,
        Object.keys(qualifiers).length === 0 ? undefined : qualifiers,
    ).toString();
}
