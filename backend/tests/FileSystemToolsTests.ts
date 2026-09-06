import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildFileTools, parseAllowedDirectories, resolveWithinAllowedDirectories } from '../src/tools/FileSystem.js'

test('parseAllowedDirectories should split and trim semicolon-separated paths', () => {
    assert.deepStrictEqual(parseAllowedDirectories('/tmp/one;/tmp/two; ; /tmp/three'), [
        '/tmp/one',
        '/tmp/two',
        '/tmp/three',
    ])
})

test('resolveWithinAllowedDirectories should reject paths outside the allowed root', () => {
    const allowedDir = mkdtempSync(join(tmpdir(), 'vertex-allowed-'))
    const outsideFile = join(tmpdir(), 'vertex-outside.txt')

    assert.throws(() => resolveWithinAllowedDirectories([allowedDir], outsideFile), /outside allowed directory/i)
})

test('read_file should return an image data URL for image files', async () => {
    const allowedDir = mkdtempSync(join(tmpdir(), 'vertex-image-files-'))
    const tools = buildFileTools([allowedDir])
    const filePath = join(allowedDir, 'sample.png')
    const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF', 'base64')

    writeFileSync(filePath, samplePng)

    const readResult = JSON.parse(await tools.readFile.execute({ path: 'sample.png' }))
    assert.strictEqual(readResult.type, 'image')
    assert.strictEqual(readResult.name, 'sample.png')
    assert.match(readResult.content, /^data:image\/png;base64,/)

    rmSync(allowedDir, { recursive: true, force: true })
})

test('file tools should list, create, read, update, and delete files within the allowed directory', async () => {
    const allowedDir = mkdtempSync(join(tmpdir(), 'vertex-files-'))
    const tools = buildFileTools([allowedDir])

    const listResult = JSON.parse(await tools.listDirectory.execute({ path: '.' }))
    assert.deepStrictEqual(listResult.entries, [])

    await tools.createFile.execute({ path: 'notes.txt', content: 'hello world' })

    const filePath = join(allowedDir, 'notes.txt')
    assert.strictEqual(readFileSync(filePath, 'utf8'), 'hello world')

    const readResult = JSON.parse(await tools.readFile.execute({ path: 'notes.txt' }))
    assert.deepStrictEqual(readResult, {
        path: filePath,
        content: 'hello world',
    })

    await tools.updateFile.execute({ path: 'notes.txt', content: 'hello again' })
    assert.strictEqual(readFileSync(filePath, 'utf8'), 'hello again')

    const listAfterWrite = JSON.parse(await tools.listDirectory.execute({ path: '.' }))
    assert.deepStrictEqual(listAfterWrite.entries, ['notes.txt'])

    await tools.deleteFile.execute({ path: 'notes.txt' })
    assert.strictEqual(existsSync(filePath), false)

    rmSync(allowedDir, { recursive: true, force: true })
})
