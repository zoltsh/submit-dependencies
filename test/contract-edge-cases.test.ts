import { describe, expect, it } from 'vitest';

import { decodeCycloneDx } from '../src/contracts/cyclonedx';
import { array, assertKeys, boolean, integer, object, optionalString, sortedUniqueStrings, string } from '../src/contracts/decode';
import { decodeTree } from '../src/contracts/tree';
import { parseMavenPurl, parsePackageId, parseVariant, variantKey } from '../src/converter/identity';
import { component, projectBom, projectTree, purl, workspaceTree } from './converter-fixtures';

describe('strict contract primitives', () => {
    it('accepts each primitive and optional shape', () => {
        expect(object({ value: 1 }, 'object')).toEqual({ value: 1 });
        expect(array(['a'], 'array')).toEqual(['a']);
        expect(string('value', 'string')).toBe('value');
        expect(integer(1, 'integer')).toBe(1);
        expect(boolean(false, 'boolean')).toBe(false);
        expect(optionalString(undefined, 'optional')).toBeUndefined();
        expect(optionalString('value', 'optional')).toBe('value');
        expect(sortedUniqueStrings(['a', 'b'], 'values')).toEqual(['a', 'b']);
        expect(() => {
            assertKeys({ a: 1, b: 2 }, 'keys', ['a'], ['b']);
        }).not.toThrow();
    });

    it.each([
        ['object', () => object([], 'object')],
        ['array', () => array({}, 'array')],
        ['string type', () => string(1, 'string')],
        ['empty string', () => string('', 'string')],
        ['padded string', () => string(' value ', 'string')],
        ['NUL string', () => string('a\0b', 'string')],
        ['integer', () => integer(1.5, 'integer')],
        ['boolean', () => boolean('false', 'boolean')],
        ['unknown key', () => {
            assertKeys({ a: 1, b: 2 }, 'keys', ['a']);
        }],
        ['missing key', () => {
            assertKeys({}, 'keys', ['a']);
        }],
        ['duplicate strings', () => sortedUniqueStrings(['a', 'a'], 'values')],
        ['unsorted strings', () => sortedUniqueStrings(['b', 'a'], 'values')],
    ])('rejects invalid %s', (_label, operation) => {
        expect(operation).toThrow('ZOLT-CONTRACT-001');
    });
});

describe('artifact identity parsing', () => {
    it('parses default and classified Maven identities', () => {
        expect(parsePackageId('org.example:demo', 'id')).toEqual({ artifact: 'demo', group: 'org.example' });
        expect(parseVariant(undefined, 'variant')).toEqual({ type: 'jar' });
        expect(parseVariant('zip', 'variant')).toEqual({ type: 'zip' });
        expect(parseVariant('jar|tests', 'variant')).toEqual({ classifier: 'tests', type: 'jar' });
        expect(variantKey({ classifier: 'tests', type: 'jar' })).toBe('jar|tests');
        expect(parseMavenPurl('pkg:maven/org.example/demo@1.0.0', 'purl').artifact).toEqual({
            artifact: 'demo', group: 'org.example', type: 'jar', version: '1.0.0',
        });
    });

    it.each([
        ['bad package id', () => parsePackageId('org.example', 'id'), 'ZOLT-GRAPH-001'],
        ['bad variant', () => parseVariant('jar|tests|extra', 'variant'), 'ZOLT-GRAPH-002'],
        ['invalid PURL', () => parseMavenPurl('not-a-purl', 'purl'), 'ZOLT-GRAPH-003'],
        ['non-Maven PURL', () => parseMavenPurl('pkg:npm/demo@1.0.0', 'purl'), 'ZOLT-GRAPH-004'],
        ['Maven subpath', () => parseMavenPurl('pkg:maven/org.example/demo@1.0.0#src', 'purl'), 'ZOLT-GRAPH-004'],
        ['unsupported qualifier', () => parseMavenPurl('pkg:maven/org.example/demo@1.0.0?repository_url=central', 'purl'), 'ZOLT-GRAPH-004'],
    ])('rejects %s', (_label, operation, code) => {
        expect(operation).toThrow(code);
    });
});

describe('tree contract edge cases', () => {
    it.each([
        ['unsupported field', (value: Record<string, unknown>) => {
            value.extra = true;
        }],
        ['missing field', (value: Record<string, unknown>) => {
            delete value.command;
        }],
        ['wrong command', (value: Record<string, unknown>) => {
            value.command = 'graph';
        }],
        ['bad project coordinate', (value: Record<string, unknown>) => {
            (value.project as Record<string, unknown>).coordinate = 'wrong';
        }],
        ['explicit default variant', (value: Record<string, unknown>) => {
            const pkg = (value.packages as Array<Record<string, unknown>>)[0];
            if (pkg !== undefined) pkg.variant = 'jar';
        }],
        ['bad roots', (value: Record<string, unknown>) => {
            value.roots = [];
        }],
    ])('rejects project tree with %s', (_label, mutate) => {
        const value = projectTree([{ id: 'org.example:a', version: '1', scope: 'compile', direct: true }]);
        mutate(value);
        expect(() => decodeTree(value)).toThrow('ZOLT-CONTRACT-001');
    });

    it('rejects workspace lock versions and unknown member references', () => {
        const badVersion = workspaceTree([]);
        badVersion.lockVersion = 4;
        expect(() => decodeTree(badVersion)).toThrow('expected 5');

        const badMember = workspaceTree([{ id: 'org.example:a', version: '1', scope: 'compile', direct: true,
            members: ['unknown'] }]);
        expect(() => decodeTree(badMember)).toThrow('unknown workspace member');
    });

    it('rejects duplicate tree node identities', () => {
        const value = projectTree([
            { id: 'org.example:a', version: '1', scope: 'compile', direct: true },
            { id: 'org.example:a', version: '1', scope: 'compile', direct: false },
        ]);
        expect(() => decodeTree(value)).toThrow('duplicates a tree-node identity');
    });
});

describe('CycloneDX contract edge cases', () => {
    it('accepts optional timestamp, hashes, and licenses', () => {
        const value = projectBom([component(purl('org.example', 'a', '1'))], {});
        (value.metadata as Record<string, unknown>).timestamp = '2026-08-05T00:00:00Z';
        const first = (value.components as Array<Record<string, unknown>>)[0];
        if (first === undefined) throw new Error('fixture has no component');
        first.hashes = [];
        first.licenses = [];
        expect(decodeCycloneDx(value).components.size).toBe(1);
    });

    it.each([
        ['format', (value: Record<string, unknown>) => {
            value.bomFormat = 'SPDX';
        }],
        ['spec', (value: Record<string, unknown>) => {
            value.specVersion = '1.6';
        }],
        ['version', (value: Record<string, unknown>) => {
            value.version = 2;
        }],
        ['duplicate component', (value: Record<string, unknown>) => {
            const components = value.components as unknown[];
            components.push(structuredClone(components[0]));
        }],
        ['unknown dependency ref', (value: Record<string, unknown>) => {
            (value.dependencies as Array<Record<string, unknown>>)[0] = { ref: 'missing', dependsOn: [] };
        }],
    ])('rejects invalid CycloneDX %s', (_label, mutate) => {
        const value = projectBom([component(purl('org.example', 'a', '1'))], {});
        mutate(value);
        expect(() => decodeCycloneDx(value)).toThrow('ZOLT-CONTRACT-002');
    });
});
