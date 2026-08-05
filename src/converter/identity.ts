import { PackageURL } from 'packageurl-js';

import { SubmitDependenciesError } from '../errors';

export interface ArtifactIdentity {
    readonly artifact: string;
    readonly classifier?: string;
    readonly group: string;
    readonly type: string;
    readonly version: string;
}

export interface ArtifactVariant {
    readonly classifier?: string;
    readonly type: string;
}

export interface ParsedMavenPurl {
    readonly artifact: ArtifactIdentity;
    readonly packageUrl: PackageURL;
}

export function parsePackageId(value: string, label: string): { readonly artifact: string; readonly group: string } {
    const parts = value.split(':');
    if (parts.length !== 2 || parts.some((part) => !validSegment(part))) {
        throw graphError('ZOLT-GRAPH-001', `${label} must be a canonical group:artifact package ID.`);
    }
    const group = parts.at(0);
    const artifact = parts.at(1);
    if (group === undefined || artifact === undefined) {
        throw graphError('ZOLT-GRAPH-001', `${label} must be a canonical group:artifact package ID.`);
    }
    return { artifact, group };
}

export function parseVariant(value: string | undefined, label: string): ArtifactVariant {
    if (value === undefined) return { type: 'jar' };
    const parts = value.split('|');
    if (parts.length > 2 || parts.some((part) => !validSegment(part))) {
        throw graphError('ZOLT-GRAPH-002', `${label} must be type or type|classifier.`);
    }
    const type = parts.at(0);
    if (type === undefined) throw graphError('ZOLT-GRAPH-002', `${label} is missing an artifact type.`);
    const classifier = parts[1];
    return classifier === undefined ? { type } : { classifier, type };
}

export function variantKey(variant: ArtifactVariant): string {
    return variant.classifier === undefined ? variant.type : `${variant.type}|${variant.classifier}`;
}

export function artifactKey(artifact: ArtifactIdentity): string {
    return JSON.stringify([
        artifact.group,
        artifact.artifact,
        artifact.version,
        artifact.type,
        artifact.classifier ?? '',
    ]);
}

export function treeNodeKey(artifact: ArtifactIdentity, scope: string): string {
    return `${artifactKey(artifact)}#${scope}`;
}

export function parseMavenPurl(value: string, label: string): ParsedMavenPurl {
    let packageUrl: PackageURL;
    try {
        packageUrl = PackageURL.fromString(value);
    } catch (error) {
        throw graphError('ZOLT-GRAPH-003', `${label} is not a valid package URL.`, error);
    }
    if (packageUrl.toString() !== value) {
        throw graphError('ZOLT-GRAPH-003', `${label} is not a canonical package URL.`);
    }
    if (
        packageUrl.type !== 'maven'
        || packageUrl.namespace === undefined
        || packageUrl.version === undefined
        || packageUrl.subpath !== undefined
    ) {
        throw graphError('ZOLT-GRAPH-004', `${label} must be a versioned Maven package URL without a subpath.`);
    }
    const qualifiers = packageUrl.qualifiers ?? {};
    for (const key of Object.keys(qualifiers)) {
        if (key !== 'type' && key !== 'classifier') {
            throw graphError('ZOLT-GRAPH-004', `${label} contains unsupported Maven qualifier ${JSON.stringify(key)}.`);
        }
    }
    const type = qualifiers.type ?? 'jar';
    const classifier = qualifiers.classifier;
    for (const [name, segment] of [
        ['namespace', packageUrl.namespace],
        ['name', packageUrl.name],
        ['version', packageUrl.version],
        ['type', type],
        ['classifier', classifier],
    ] as const) {
        if (segment !== undefined && !validSegment(segment)) {
            throw graphError('ZOLT-GRAPH-004', `${label} contains an invalid Maven ${name}.`);
        }
    }
    const artifact: ArtifactIdentity = classifier === undefined
        ? { artifact: packageUrl.name, group: packageUrl.namespace, type, version: packageUrl.version }
        : { artifact: packageUrl.name, classifier, group: packageUrl.namespace, type, version: packageUrl.version };
    return { artifact, packageUrl };
}

export function graphError(code: string, message: string, cause?: unknown): SubmitDependenciesError {
    return new SubmitDependenciesError(code, message, cause === undefined ? undefined : { cause });
}

function validSegment(value: string): boolean {
    return value !== '' && value === value.trim() && !/[\0:|/\\]/u.test(value);
}
