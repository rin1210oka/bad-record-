export type ClientBackend = <T>(url: string, method: string, body?: unknown) => Promise<T>;
let backend: ClientBackend | undefined;
export function installClientBackend(value: ClientBackend) { backend = value; }
export function getClientBackend() { return backend; }
