import test from 'node:test'
import assert from 'node:assert/strict'
import type { Uuid } from 'vertex-common'

import { generateUuid } from '../src/Utils.js'

test('generateUuid should return a valid UUID', () => {
    const uuid: Uuid = generateUuid()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    assert.match(uuid, uuidRegex, 'Generated UUID is not valid')
})

test('Uuid to string and back should be equal', () => {
    const originalUuid: Uuid = generateUuid()
    const uuidString: string = originalUuid as string
    const convertedUuid: Uuid = uuidString as Uuid

    assert.strictEqual(originalUuid, convertedUuid, 'Converted UUID does not match the original')
})
