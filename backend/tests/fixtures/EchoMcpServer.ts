import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo', version: '1.0.0' })

server.registerTool(
    'echo',
    {
        description: 'Echoes the given message back.',
        inputSchema: { message: z.string().describe('Text to echo'), tags: z.array(z.string()).optional() },
    },
    async ({ message, tags }) => ({
        content: [{ type: 'text', text: tags?.length ? `${message} [${tags.join(',')}]` : message }],
    }),
)

server.registerTool('fail', { description: 'Always returns an error result.' }, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'boom' }],
}))

await server.connect(new StdioServerTransport())
