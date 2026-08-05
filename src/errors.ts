export class SubmitDependenciesError extends Error {
    public readonly code: string;

    constructor(code: string, message: string, options?: ErrorOptions) {
        super(`${code}: ${message}`, options);
        this.code = code;
        this.name = 'SubmitDependenciesError';
    }
}

export function errorMessage(error: unknown, debug = false): string {
    if (!(error instanceof Error)) return String(error);
    if (debug && error.stack !== undefined) return error.stack;
    const messages: string[] = [];
    const seen: Set<Error> = new Set();
    let current: unknown = error;
    while (current instanceof Error && messages.length < 3 && !seen.has(current)) {
        seen.add(current);
        const message = current.message || current.name;
        if (!messages.includes(message)) messages.push(message);
        current = current.cause;
    }
    return messages.join(': ');
}
