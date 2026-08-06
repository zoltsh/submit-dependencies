export class SubmitDependenciesError extends Error {
    public readonly code: string;

    constructor(code: string, message: string, options?: ErrorOptions) {
        super(`${code}: ${message}`, options);
        this.code = code;
        this.name = 'SubmitDependenciesError';
    }
}
