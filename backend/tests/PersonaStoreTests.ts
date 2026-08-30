import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

import { PersonaStore } from '../src/services/PersonaStore.js'
import { generateUuid } from '../src/Utils.js'

const SAMPLE_BASE64_IMAGE =
    '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'

test('PersonaStore should create and list personas', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('Narrator', 'You narrate noir detective stories.')

    assert.strictEqual(created.name, 'Narrator')
    assert.strictEqual(created.prompt, 'You narrate noir detective stories.')

    const personas = personaStore.listPersonas()
    assert.strictEqual(personas.length, 1)
    assert.strictEqual(personas[0]!.id, created.id)
})

test('PersonaStore should default profilePicture to null', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('No Avatar', 'No image set')
    const avatar = personaStore.getProfilePicture(created.id)
    assert.strictEqual(avatar, null)
})

test('PersonaStore getPersona should return null for missing IDs', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const missing = personaStore.getPersona(generateUuid())
    assert.strictEqual(missing, null)
})

test('PersonaStore should update an existing persona', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('Guide', 'Original prompt')
    const updated = personaStore.updatePersona(created.id, 'Guide v2', 'Updated prompt')

    assert.notStrictEqual(updated, null)
    assert.strictEqual(updated!.id, created.id)
    assert.strictEqual(updated!.name, 'Guide v2')
    assert.strictEqual(updated!.prompt, 'Updated prompt')
    const avatar = personaStore.getProfilePicture(updated!.id)
    assert.strictEqual(avatar, null)
    assert.strictEqual(updated!.created, created.created)
    assert.ok(updated!.updated >= created.updated)
})

test('PersonaStore updatePersona should return null for missing IDs', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const updated = personaStore.updatePersona(generateUuid(), 'Ghost', 'No record')
    assert.strictEqual(updated, null)
})

test('PersonaStore should persist and retrieve profile pictures from SQLite blobs', async () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('Avatar Persona', 'Has a local avatar')

    const saved = await personaStore.setProfilePicture(created.id, SAMPLE_BASE64_IMAGE)
    assert.strictEqual(saved, true)

    const picture = personaStore.getProfilePicture(created.id)
    assert.notStrictEqual(picture, null)
    assert.strictEqual(picture!.mimeType, 'image/png')
    assert.strictEqual(picture!.data.length > 0, true)

    personaStore.removeProfilePicture(created.id)
    const avatar = personaStore.getProfilePicture(created.id)
    assert.strictEqual(avatar, null)
})

test('PersonaStore should remove profile picture blobs', async () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('Avatar Persona', 'Has a local avatar')
    const saved = await personaStore.setProfilePicture(created.id, SAMPLE_BASE64_IMAGE)
    assert.strictEqual(saved, true)

    const removed = personaStore.removeProfilePicture(created.id)
    assert.strictEqual(removed, true)

    const picture = personaStore.getProfilePicture(created.id)
    assert.strictEqual(picture, null)
})

test('PersonaStore should delete an existing persona', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const created = personaStore.createPersona('Editor', 'Tighten prose')
    const deleted = personaStore.deletePersona(created.id)
    const missingAfterDelete = personaStore.getPersona(created.id)

    assert.strictEqual(deleted, true)
    assert.strictEqual(missingAfterDelete, null)
})

test('PersonaStore deletePersona should return false for missing IDs', () => {
    const db = new Database(':memory:')
    const personaStore = new PersonaStore(db)

    const deleted = personaStore.deletePersona(generateUuid())
    assert.strictEqual(deleted, false)
})
