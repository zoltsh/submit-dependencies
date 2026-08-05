import { array, assertKeys, integer, object, optionalString, string } from './decode';
import { artifactKey, type ArtifactIdentity, parseMavenPurl } from '../converter/identity';
import { SubmitDependenciesError } from '../errors';

export interface BomComponent {
    readonly artifact?: ArtifactIdentity;
    readonly artifactKey?: string;
    readonly purl?: string;
    readonly ref: string;
}

export interface BomDocument {
    readonly components: ReadonlyMap<string, BomComponent>;
    readonly dependencies: ReadonlyMap<string, readonly string[]>;
    readonly root: BomComponent;
}

export function decodeCycloneDx(value: unknown): BomDocument {
    const rootObject = object(value, 'bom');
    assertKeys(rootObject, 'bom',
        ['bomFormat', 'specVersion', 'serialNumber', 'version', 'metadata', 'components', 'dependencies']);
    requireLiteral(rootObject.bomFormat, 'CycloneDX', 'bom.bomFormat');
    requireLiteral(rootObject.specVersion, '1.5', 'bom.specVersion');
    string(rootObject.serialNumber, 'bom.serialNumber');
    if (integer(rootObject.version, 'bom.version') !== 1) throw contract('bom.version must equal 1.');

    const metadata = object(rootObject.metadata, 'bom.metadata');
    assertKeys(metadata, 'bom.metadata', ['tools', 'component'], ['timestamp']);
    optionalString(metadata.timestamp, 'bom.metadata.timestamp');
    decodeTools(metadata.tools);
    const root = decodeComponent(metadata.component, 'bom.metadata.component', false);
    const components: Map<string, BomComponent> = new Map();
    for (const [index, value] of array(rootObject.components, 'bom.components').entries()) {
        const component = decodeComponent(value, `bom.components[${index.toString()}]`, true);
        if (component.ref === root.ref || components.has(component.ref)) {
            throw contract(`CycloneDX bom-ref ${component.ref} is duplicated.`);
        }
        components.set(component.ref, component);
    }

    const knownRefs = new Set([root.ref, ...components.keys()]);
    const dependencies: Map<string, readonly string[]> = new Map();
    for (const [index, value] of array(rootObject.dependencies, 'bom.dependencies').entries()) {
        const label = `bom.dependencies[${index.toString()}]`;
        const dependency = object(value, label);
        assertKeys(dependency, label, ['ref', 'dependsOn']);
        const ref = string(dependency.ref, `${label}.ref`);
        if (!knownRefs.has(ref)) throw contract(`${label}.ref targets an unknown bom-ref.`);
        if (dependencies.has(ref)) throw contract(`${label}.ref is duplicated.`);
        const dependsOn = array(dependency.dependsOn, `${label}.dependsOn`)
            .map((target, targetIndex) => string(target, `${label}.dependsOn[${targetIndex.toString()}]`));
        const sorted = [...new Set(dependsOn)].sort();
        if (sorted.length !== dependsOn.length || sorted.some((target, targetIndex) => target !== dependsOn[targetIndex])) {
            throw contract(`${label}.dependsOn must be sorted and contain no duplicates.`);
        }
        for (const target of dependsOn) {
            if (!knownRefs.has(target)) throw contract(`${label} targets unknown bom-ref ${target}.`);
        }
        dependencies.set(ref, dependsOn);
    }
    for (const ref of knownRefs) {
        if (!dependencies.has(ref)) throw contract(`CycloneDX dependency graph is missing a record for ${ref}.`);
    }
    return { components, dependencies, root };
}

function decodeComponent(value: unknown, label: string, includeScope: boolean): BomComponent {
    const component = object(value, label);
    assertKeys(
        component,
        label,
        includeScope ? ['type', 'bom-ref', 'name', 'scope'] : ['type', 'bom-ref', 'name'],
        ['group', 'version', 'purl', 'hashes', 'licenses'],
    );
    const type = string(component.type, `${label}.type`);
    if (type !== 'application' && type !== 'library') throw contract(`${label}.type is unsupported.`);
    const ref = string(component['bom-ref'], `${label}.bom-ref`);
    const group = optionalString(component.group, `${label}.group`);
    const name = string(component.name, `${label}.name`);
    const version = optionalString(component.version, `${label}.version`);
    const purl = optionalString(component.purl, `${label}.purl`);
    if (includeScope) {
        const scope = string(component.scope, `${label}.scope`);
        if (scope !== 'required' && scope !== 'optional') throw contract(`${label}.scope is unsupported.`);
    }
    if (component.hashes !== undefined) array(component.hashes, `${label}.hashes`);
    if (component.licenses !== undefined) array(component.licenses, `${label}.licenses`);
    if (purl === undefined) {
        if (group !== undefined || version !== undefined) throw contract(`${label} has partial Maven identity without a PURL.`);
        return { ref };
    }
    const parsed = parseMavenPurl(purl, `${label}.purl`);
    if (group !== parsed.artifact.group || name !== parsed.artifact.artifact || version !== parsed.artifact.version) {
        throw contract(`${label} identity fields disagree with its PURL.`);
    }
    return { artifact: parsed.artifact, artifactKey: artifactKey(parsed.artifact), purl, ref };
}

function decodeTools(value: unknown): void {
    for (const [index, item] of array(value, 'bom.metadata.tools').entries()) {
        const label = `bom.metadata.tools[${index.toString()}]`;
        const tool = object(item, label);
        assertKeys(tool, label, ['name', 'version']);
        string(tool.name, `${label}.name`);
        string(tool.version, `${label}.version`);
    }
}

function requireLiteral(value: unknown, expected: string, label: string): void {
    if (string(value, label) !== expected) throw contract(`${label} must equal ${JSON.stringify(expected)}.`);
}

function contract(message: string): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-CONTRACT-002', message);
}
