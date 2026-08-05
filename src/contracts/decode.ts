import { SubmitDependenciesError } from '../errors';

export function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw contractError(`${label} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

export function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw contractError(`${label} must be a JSON array.`);
    return value;
}

export function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value === '' || value !== value.trim() || value.includes('\0')) {
        throw contractError(`${label} must be a nonempty canonical string.`);
    }
    return value;
}

export function integer(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value)) throw contractError(`${label} must be a safe integer.`);
    return value as number;
}

export function boolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw contractError(`${label} must be a boolean.`);
    return value;
}

export function optionalString(value: unknown, label: string): string | undefined {
    return value === undefined ? undefined : string(value, label);
}

export function assertKeys(
    value: Record<string, unknown>,
    label: string,
    required: readonly string[],
    optional: readonly string[] = [],
): void {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw contractError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) throw contractError(`${label} is missing required field ${JSON.stringify(key)}.`);
    }
}

export function sortedUniqueStrings(value: unknown, label: string): string[] {
    const values = array(value, label).map((item, index) => string(item, `${label}[${index.toString()}]`));
    const sorted = [...new Set(values)].sort();
    if (sorted.length !== values.length || sorted.some((item, index) => item !== values[index])) {
        throw contractError(`${label} must be sorted and contain no duplicates.`);
    }
    return values;
}

export function contractError(message: string): SubmitDependenciesError {
    return new SubmitDependenciesError('ZOLT-CONTRACT-001', message);
}
