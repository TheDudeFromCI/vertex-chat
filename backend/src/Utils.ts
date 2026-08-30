import crypto from 'crypto'
import type { Uuid } from 'vertex-common'

/**
 * Generates a new UUID (Universally Unique Identifier) using the crypto
 * module's randomUUID function.
 *
 * @returns A new UUID as a string.
 */
export function generateUuid(): Uuid {
    return crypto.randomUUID() as Uuid
}
