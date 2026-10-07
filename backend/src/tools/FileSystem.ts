import { mkdir, readdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, normalize } from 'node:path'
import { Jimp } from 'jimp'

import type { Tool } from '../services/LLMService.js'

export function parseAllowedDirectories(rawDirectories: string | undefined): string[] {
    if (!rawDirectories) {
        return []
    }

    return Array.from(
        new Set(
            rawDirectories
                .split(';')
                .map((directory) => directory.trim())
                .filter(Boolean)
                .map((directory) => resolve(directory)),
        ),
    )
}

export function resolveWithinAllowedDirectories(allowedDirectories: string[], requestedPath: string): string {
    const resolvedPath = resolve(requestedPath)
    const normalizedAllowedDirectories = allowedDirectories.map((directory) => resolve(directory))

    const isInsideAllowedDirectory = normalizedAllowedDirectories.some((directory) => {
        const relativePath = normalize(relative(directory, resolvedPath))
        return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
    })

    if (!isInsideAllowedDirectory) {
        throw new Error(`Path "${requestedPath}" is outside allowed directory.`)
    }

    return resolvedPath
}

function resolveRequestedPath(allowedDirectories: string[], requestedPath: string): string {
    if (allowedDirectories.length === 0) {
        throw new Error('No directories are configured for file access.')
    }

    const trimmedPath = requestedPath.trim()
    if (!trimmedPath || trimmedPath === '.') {
        return resolve(allowedDirectories[0]!)
    }

    if (isAbsolute(trimmedPath)) {
        return resolveWithinAllowedDirectories(allowedDirectories, trimmedPath)
    }

    for (const directory of allowedDirectories) {
        const candidate = resolve(directory, trimmedPath)
        try {
            return resolveWithinAllowedDirectories(allowedDirectories, candidate)
        } catch {
            // Try the next allowed root before failing.
        }
    }

    return resolveWithinAllowedDirectories(allowedDirectories, resolve(trimmedPath))
}

interface DirectoryEntry {
    name: string
    contents: DirectoryEntry[]
}

async function listDirectoryContents(
    directoryPath: string,
    recursive: boolean,
    includeHidden: boolean,
    filter?: RegExp,
): Promise<DirectoryEntry> {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    const result: DirectoryEntry = {
        name: `${basename(directoryPath)}/`,
        contents: (
            await Promise.all(
                entries
                    .filter((file) => includeHidden || !file.name.startsWith('.'))
                    .map(async (file): Promise<DirectoryEntry | null> => {
                        if (file.isDirectory() && recursive) {
                            return await listDirectoryContents(
                                resolve(directoryPath, file.name),
                                recursive,
                                includeHidden,
                                filter,
                            )
                        }
                        if (!filter || filter.test(file.name)) {
                            return { name: file.name, contents: [] }
                        }
                        return null
                    }),
            )
        )
            .filter((entry): entry is DirectoryEntry => entry !== null)
            .sort((a, b) => a.name.localeCompare(b.name)),
    }

    return result
}

export function buildFileTools(allowedDirectories: string[]) {
    const baseDirectories: Tool = {
        name: 'base_directories',
        description: 'List the base directories that are allowed for file access.',
        params: [],
        needsPermission: false,
        execute: async () => {
            return JSON.stringify({ allowedDirectories })
        },
    }

    const listDirectoryTool: Tool = {
        name: 'list_directory',
        description:
            'List files and folders within an allowed directory. Relative paths resolve against the allowed directories.',
        params: [
            {
                name: 'path',
                type: 'string',
                description:
                    'Relative or absolute path to the directory to list. Use "." for the first allowed directory.',
                required: true,
            },
            {
                name: 'recursive',
                type: 'boolean',
                description: 'Whether to list directory contents recursively. Defaults to false.',
                required: false,
            },
            {
                name: 'includeHidden',
                type: 'boolean',
                description: 'Whether to include hidden files in the listing. Defaults to false.',
                required: false,
            },
            {
                name: 'filter',
                type: 'string',
                description: 'Regex filter for files in the directory listing.',
                required: false,
            },
        ],
        needsPermission: false,
        execute: async ({ path, recursive, includeHidden, filter }) => {
            if (typeof path !== 'string') return "'path' must be a string."
            if (recursive !== undefined && typeof recursive !== 'boolean') return "'recursive' must be a boolean."
            if (includeHidden !== undefined && typeof includeHidden !== 'boolean')
                return "'includeHidden' must be a boolean."
            if (filter !== undefined && typeof filter !== 'string') return "'filter' must be a string."

            let filterRegex: RegExp | undefined
            try {
                filterRegex = filter ? new RegExp(filter) : undefined
            } catch (error) {
                return "'filter' must be a valid regular expression."
            }

            const directoryPath = resolveRequestedPath(allowedDirectories, String(path ?? '.'))
            let entries = await listDirectoryContents(
                directoryPath,
                recursive ?? false,
                includeHidden ?? false,
                filterRegex,
            )
            return JSON.stringify(entries)
        },
    }

    const readFileTool: Tool = {
        name: 'read_file',
        description:
            'Read the contents of a file within an allowed directory. Image files are returned as PNG data URLs.',
        params: [
            {
                name: 'path',
                type: 'string',
                description: 'Relative or absolute path to the file.',
                required: true,
            },
        ],
        needsPermission: false,
        execute: async ({ path }) => {
            const filePath = resolveRequestedPath(allowedDirectories, String(path ?? ''))
            const extension = extname(filePath).toLowerCase()
            const imageMimeTypes = new Map<string, string>([
                ['.png', 'image/png'],
                ['.jpg', 'image/jpeg'],
                ['.jpeg', 'image/jpeg'],
                ['.gif', 'image/gif'],
                ['.webp', 'image/webp'],
                ['.bmp', 'image/bmp'],
            ])

            const mimeType = imageMimeTypes.get(extension)
            const fileBuffer = await readFile(filePath)
            if (mimeType) {
                try {
                    const image = await Jimp.read(fileBuffer)
                    const pngBuffer = await image.getBuffer('image/png')
                    return JSON.stringify({
                        type: 'image',
                        path: filePath,
                        name: basename(filePath),
                        content: `data:image/png;base64,${pngBuffer.toString('base64')}`,
                    })
                } catch {
                    return JSON.stringify({
                        type: 'image',
                        path: filePath,
                        name: basename(filePath),
                        content: `data:image/png;base64,${fileBuffer.toString('base64')}`,
                    })
                }
            }

            return JSON.stringify({
                type: ['.md', '.markdown'].includes(extension) ? 'markdown' : 'text',
                path: filePath,
                name: basename(filePath),
                content: fileBuffer.toString('utf8'),
            })
        },
    }

    const createFileTool: Tool = {
        name: 'create_file',
        description: 'Create a new file within an allowed directory.',
        params: [
            {
                name: 'path',
                type: 'string',
                description: 'Relative or absolute path to the file to create.',
                required: true,
            },
            {
                name: 'content',
                type: 'string',
                description: 'Text content to write into the file.',
                required: true,
            },
        ],
        needsPermission: true,
        execute: async ({ path, content }) => {
            const filePath = resolveRequestedPath(allowedDirectories, String(path ?? ''))
            await mkdir(dirname(filePath), { recursive: true })
            await writeFile(filePath, String(content ?? ''), 'utf8')
            return JSON.stringify({ path: filePath, created: true })
        },
    }

    const createFolderTool: Tool = {
        name: 'create_folder',
        description: 'Create a new folder (recursively) within an allowed directory.',
        params: [
            {
                name: 'path',
                type: 'string',
                description: 'Relative or absolute path to the folder to create.',
                required: true,
            },
        ],
        needsPermission: true,
        execute: async ({ path }) => {
            const folderPath = resolveRequestedPath(allowedDirectories, String(path ?? ''))
            await mkdir(folderPath, { recursive: true })
            return JSON.stringify({ path: folderPath, created: true })
        },
    }

    const updateFileTool: Tool = {
        name: 'update_file',
        description: 'Overwrite the contents of an existing file within an allowed directory.',
        params: [
            {
                name: 'path',
                type: 'string',
                description: 'Relative or absolute path to the file to overwrite.',
                required: true,
            },
            {
                name: 'content',
                type: 'string',
                description: 'New text content to write into the file.',
                required: true,
            },
        ],
        needsPermission: true,
        execute: async ({ path, content }) => {
            const filePath = resolveRequestedPath(allowedDirectories, String(path ?? ''))
            await mkdir(dirname(filePath), { recursive: true })
            await writeFile(filePath, String(content ?? ''), 'utf8')
            return JSON.stringify({ path: filePath, updated: true })
        },
    }

    const deleteFileTool: Tool = {
        name: 'delete_file',
        description: 'Delete a file or folder within an allowed directory.',
        params: [
            {
                name: 'path',
                type: 'string',
                description: 'Relative or absolute path to the file to delete.',
                required: true,
            },
        ],
        needsPermission: true,
        execute: async ({ path }) => {
            const filePath = resolveRequestedPath(allowedDirectories, String(path ?? ''))
            await rm(filePath, { recursive: true, force: false })
            return JSON.stringify({ path: filePath, deleted: true })
        },
    }

    const renameFileTool: Tool = {
        name: 'rename_file',
        description: 'Rename a file or folder within an allowed directory.',
        params: [
            {
                name: 'oldPath',
                type: 'string',
                description: 'Relative or absolute path to the file to rename.',
                required: true,
            },
            {
                name: 'newPath',
                type: 'string',
                description: 'Relative or absolute path to the new file name.',
                required: true,
            },
        ],
        needsPermission: true,
        execute: async ({ oldPath, newPath }) => {
            const oldFilePath = resolveRequestedPath(allowedDirectories, String(oldPath ?? ''))
            const newFilePath = resolveRequestedPath(allowedDirectories, String(newPath ?? ''))
            await mkdir(dirname(newFilePath), { recursive: true })
            await rename(oldFilePath, newFilePath)
            return JSON.stringify({ oldPath: oldFilePath, newPath: newFilePath, renamed: true })
        },
    }

    return {
        baseDirectories: baseDirectories,
        listDirectory: listDirectoryTool,
        readFile: readFileTool,
        createFile: createFileTool,
        updateFile: updateFileTool,
        deleteFile: deleteFileTool,
        createFolder: createFolderTool,
        renameFile: renameFileTool,
    }
}
