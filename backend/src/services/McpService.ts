import { readFile } from 'fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { Tool, ToolParam } from './LLMService.js'

interface McpServerConfig {
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
    type?: string
    headers?: Record<string, string>
}

const clients: Client[] = []

const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')

function createTransport(config: McpServerConfig): Transport {
    if (config.command) {
        return new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: { ...(process.env as Record<string, string>), ...config.env },
            cwd: config.cwd,
        })
    }
    if (config.url) {
        const url = new URL(config.url)
        const requestInit = config.headers ? { headers: config.headers } : undefined
        if (config.type === 'sse') {
            return new SSEClientTransport(url, { requestInit })
        }
        return new StreamableHTTPClientTransport(url, { requestInit })
    }
    throw new Error('Server config needs either "command" or "url".')
}

function renderResult(result: any): string {
    const parts: string[] = []
    for (const item of result?.content ?? []) {
        if (item.type === 'text') parts.push(item.text)
        else parts.push(JSON.stringify(item))
    }
    if (parts.length === 0 && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent))
    const text = parts.join('\n')
    return result?.isError ? `Error: ${text}` : text
}

async function loadServerTools(serverName: string, config: McpServerConfig): Promise<Tool[]> {
    const client = new Client({ name: 'vertex', version: '0.1.0' })
    await client.connect(createTransport(config))
    clients.push(client)

    const tools: Tool[] = []
    let cursor: string | undefined
    do {
        const page = await client.listTools({ cursor })
        for (const mcpTool of page.tools) {
            const properties = (mcpTool.inputSchema.properties ?? {}) as Record<string, any>
            const required = new Set<string>(mcpTool.inputSchema.required ?? [])
            const params: ToolParam[] = Object.entries(properties).map(([name, schema]) => ({
                name,
                type: typeof schema?.type === 'string' ? schema.type : 'string',
                description: schema?.description ?? '',
                required: required.has(name),
                schema,
            }))

            tools.push({
                name: sanitize(`${serverName}__${mcpTool.name}`).slice(0, 64),
                description: mcpTool.description ?? mcpTool.name,
                params,
                needsPermission: true,
                execute: async (args) => renderResult(await client.callTool({ name: mcpTool.name, arguments: args })),
            })
        }
        cursor = page.nextCursor
    } while (cursor)
    return tools
}

/** Disconnects all MCP clients and stops their server processes. */
export async function closeMcpClients(): Promise<void> {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()))
}

/** Loads tools from a Claude-desktop style `mcpServers` JSON file. Returns nothing if no path is given. */
export async function loadMcpTools(path: string | undefined): Promise<Tool[]> {
    if (!path) return []

    let servers: Record<string, McpServerConfig>
    try {
        servers = JSON.parse(await readFile(path, 'utf-8'))?.mcpServers ?? {}
    } catch (error) {
        console.error(`Failed to read MCP servers file "${path}":`, error)
        return []
    }

    const results = await Promise.all(
        Object.entries(servers).map(async ([name, config]) => {
            try {
                const tools = await loadServerTools(name, config)
                console.log(`MCP server "${name}" loaded ${tools.length} tool(s).`)
                return tools
            } catch (error) {
                console.error(`Failed to load MCP server "${name}":`, error)
                return []
            }
        }),
    )
    return results.flat()
}
