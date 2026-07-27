export function requiredElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Missing element: ${selector}`);
    }

    return element;
}

export function requiredElementIn<T extends Element>(parent: Element, selector: string): T {
    const element = parent.querySelector<T>(selector);
    if (!element) {
        throw new Error(`Missing element: ${selector}`);
    }

    return element;
}

export type SessionSnapshotLike = {
    connectionCount: number;
    messageCount: number;
    lastSeenAt: number;
};

