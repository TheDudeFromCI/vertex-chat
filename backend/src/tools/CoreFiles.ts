import { CORE_FILE_NAMES, isCoreFileName, type CoreFileName, type CoreFileStore } from '../services/CoreFileStore.js'
import type { Tool } from '../services/LLMService.js'

const NO_AGENT = 'Error: No agent is associated with this request.'

const fileParam = {
    name: 'file',
    type: 'string',
    description: `The core file name. One of: ${CORE_FILE_NAMES.join(', ')}.`,
    required: true,
}

const contentParam = {
    name: 'content',
    type: 'string',
    description: 'The text content.',
    required: true,
}

function parseFile(value: unknown): CoreFileName | null {
    return typeof value === 'string' && isCoreFileName(value) ? value : null
}

const invalidFile = `Error: Invalid file. Must be one of: ${CORE_FILE_NAMES.join(', ')}.`

export function buildCoreFileTools(coreFileStore: CoreFileStore) {
    const listCoreFiles: Tool = {
        name: 'list_core_files',
        description: 'Lists your core files and their sizes in characters.',
        params: [],
        needsPermission: false,
        execute: async (_, { agentId }) => {
            if (!agentId) return NO_AGENT
            const files = coreFileStore.listFiles(agentId)
            return CORE_FILE_NAMES.map((name) => `${name}: ${files[name].length} characters`).join('\n')
        },
    }

    const readCoreFile: Tool = {
        name: 'read_core_file',
        description: 'Reads one of your core files.',
        params: [fileParam],
        needsPermission: false,
        execute: async ({ file }, { agentId }) => {
            if (!agentId) return NO_AGENT
            const name = parseFile(file)
            if (!name) return invalidFile
            return coreFileStore.getFile(agentId, name) || '(empty)'
        },
    }

    const writeCoreFile: Tool = {
        name: 'write_core_file',
        description:
            'Replaces the entire content of one of your core files. Changes to all files except Subconcious will update your prompt.',
        params: [fileParam, contentParam],
        needsPermission: false,
        execute: async ({ file, content }, { agentId }) => {
            if (!agentId) return NO_AGENT
            const name = parseFile(file)
            if (!name) return invalidFile
            if (typeof content !== 'string') return 'Error: content must be a string.'
            return coreFileStore.setFile(agentId, name, content) ? `Updated ${name}.` : 'Error: Agent not found.'
        },
    }

    const appendCoreFile: Tool = {
        name: 'append_core_file',
        description:
            'Appends text to one of your core files. Changes to all files except Subconcious will update your prompt.',
        params: [fileParam, contentParam],
        needsPermission: false,
        execute: async ({ file, content }, { agentId }) => {
            if (!agentId) return NO_AGENT
            const name = parseFile(file)
            if (!name) return invalidFile
            if (typeof content !== 'string') return 'Error: content must be a string.'
            return coreFileStore.appendFile(agentId, name, content) ? `Appended to ${name}.` : 'Error: Agent not found.'
        },
    }

    return { listCoreFiles, readCoreFile, writeCoreFile, appendCoreFile }
}
