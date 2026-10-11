import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { closeMcpClients, loadMcpTools } from '../src/services/McpService.js'

after(() => closeMcpClients())

const ECHO_SERVER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'EchoMcpServer.ts')
const ctx = {} as any

async function withConfig<T>(config: unknown, fn: (path: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-'))
    const path = join(dir, 'mcp.json')
    await writeFile(path, typeof config === 'string' ? config : JSON.stringify(config))
    try {
        return await fn(path)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

const echoConfig = {
    mcpServers: { echo: { command: process.execPath, args: ['--import', 'tsx', ECHO_SERVER] } },
}

test('loadMcpTools does nothing without a path', async () => {
    assert.deepEqual(await loadMcpTools(undefined), [])
    assert.deepEqual(await loadMcpTools(''), [])
})

test('loadMcpTools returns nothing for a missing or invalid file', async () => {
    assert.deepEqual(await loadMcpTools('/nonexistent/mcp.json'), [])
    await withConfig('not json', async (path) => assert.deepEqual(await loadMcpTools(path), []))
})

test('loadMcpTools returns nothing when mcpServers is absent', async () => {
    await withConfig({}, async (path) => assert.deepEqual(await loadMcpTools(path), []))
})

test('loadMcpTools skips servers that fail to start', async () => {
    await withConfig({ mcpServers: { bad: { command: '/nonexistent/binary' }, empty: {} } }, async (path) =>
        assert.deepEqual(await loadMcpTools(path), []),
    )
})

test('loadMcpTools imports tools from the echo server', async () => {
    await withConfig(echoConfig, async (path) => {
        const tools = await loadMcpTools(path)
        const echo = tools.find((t) => t.name === 'echo__echo')!
        assert.ok(echo)
        assert.ok(tools.some((t) => t.name === 'echo__fail'))
        assert.equal(echo.description, 'Echoes the given message back.')
        assert.equal(echo.needsPermission, true)

        const message = echo.params.find((p) => p.name === 'message')!
        assert.equal(message.type, 'string')
        assert.equal(message.required, true)
        const tags = echo.params.find((p) => p.name === 'tags')!
        assert.equal(tags.required, false)
        assert.equal((tags.schema as any).type, 'array')

        assert.equal(await echo.execute({ message: 'hello' }, ctx), 'hello')
        assert.equal(await echo.execute({ message: 'hi', tags: ['a', 'b'] }, ctx), 'hi [a,b]')

        const fail = tools.find((t) => t.name === 'echo__fail')!
        assert.equal(await fail.execute({}, ctx), 'Error: boom')
    })
})

test('loadMcpTools keeps working servers when another fails', async () => {
    const config = { mcpServers: { ...echoConfig.mcpServers, bad: { command: '/nonexistent/binary' } } }
    await withConfig(config, async (path) => {
        const tools = await loadMcpTools(path)
        assert.ok(tools.length >= 2)
        assert.ok(tools.every((t) => t.name.startsWith('echo__')))
    })
})
