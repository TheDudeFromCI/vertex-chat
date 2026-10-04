import { ROOT_FILE_NAMES, isRootFile, type CoreFileStore } from '../services/CoreFileStore.js'
import type { Tool } from '../services/LLMService.js'

const NO_AGENT = 'Error: No agent is associated with this request.'

const fileParam = {
    name: 'file',
    type: 'string',
    description: 'The core file name.',
    required: true,
}

const contentParam = {
    name: 'content',
    type: 'string',
    description: 'The text content.',
    required: true,
}

export function buildCoreFileTools(coreFileStore: CoreFileStore) {
    const listCoreFiles: Tool = {
        name: 'list_core_files',
        description: 'Lists your core files.',
        params: [],
        needsPermission: false,
        execute: async (_, { agentId }) => {
            if (!agentId) return NO_AGENT
            const files = coreFileStore.listFiles(agentId)
            const allFiles = {
                rootFiles: ROOT_FILE_NAMES,
                standardFiles: files.filter((name) => !isRootFile(name)),
            }

            return JSON.stringify(allFiles, null, 2)
        },
    }

    const readCoreFile: Tool = {
        name: 'read_core_file',
        description: 'Reads one of your core files.',
        params: [fileParam],
        needsPermission: false,
        execute: async ({ file }, { agentId }) => {
            if (!agentId) return NO_AGENT
            if (typeof file !== 'string') return 'Error: file must be a string.'

            return coreFileStore.getFile(agentId, file) || '(empty)'
        },
    }

    const writeCoreFile: Tool = {
        name: 'write_core_file',
        description:
            'Creates or replaces the content of one of your core files. Changes to certain root files will update your prompt.',
        params: [fileParam, contentParam],
        needsPermission: false,
        execute: async ({ file, content }, { agentId }) => {
            if (!agentId) return NO_AGENT
            if (typeof file !== 'string') return 'Error: file must be a string.'
            if (typeof content !== 'string') return 'Error: content must be a string.'

            return coreFileStore.setFile(agentId, file, content) ? `Updated: ${file}.` : 'Error: Agent not found.'
        },
    }

    const appendCoreFile: Tool = {
        name: 'append_core_file',
        description: 'Appends text to one of your core files. Changes to certain root files will update your prompt.',
        params: [fileParam, contentParam],
        needsPermission: false,
        execute: async ({ file, content }, { agentId }) => {
            if (!agentId) return NO_AGENT
            if (typeof file !== 'string') return 'Error: file must be a string.'
            if (typeof content !== 'string') return 'Error: content must be a string.'

            return coreFileStore.appendFile(agentId, file, content)
                ? `Appended to: ${file}.`
                : 'Error: Agent not found.'
        },
    }

    const deleteCoreFile: Tool = {
        name: 'delete_core_file',
        description: 'Deletes one of your standard core files. Cannot delete root files.',
        params: [fileParam],
        needsPermission: false,
        execute: async ({ file }, { agentId }) => {
            if (!agentId) return NO_AGENT
            if (typeof file !== 'string') return 'Error: file must be a string.'
            if (isRootFile(file)) return `Error: Cannot delete root file: ${file}.`

            return coreFileStore.setFile(agentId, file, '') ? `Deleted file: ${file}.` : 'Error: Agent not found.'
        },
    }

    return { listCoreFiles, readCoreFile, writeCoreFile, appendCoreFile, deleteCoreFile }
}
