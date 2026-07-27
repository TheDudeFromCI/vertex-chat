const clientIdKey = 'vertex.clientId';

export function getOrCreateClientId(): string {
    const stored = window.localStorage.getItem(clientIdKey);
    if (stored) {
        return stored;
    }

    const generated = window.crypto.randomUUID();
    window.localStorage.setItem(clientIdKey, generated);
    return generated;
}

export function shortClientId(value: string): string {
    return `client:${value.slice(0, 8)}`;
}

export function newRequestId(): string {
    return window.crypto.randomUUID();
}

export function newMessageId(): string {
    return window.crypto.randomUUID();
}
