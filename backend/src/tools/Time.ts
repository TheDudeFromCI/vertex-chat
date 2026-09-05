import { format } from 'date-fns'

import type { Tool } from '../services/LLMService.js'

const timeTool: Tool = {
    name: 'time',
    description: 'Returns the current date and time in ISO 8601 format.',
    params: [],
    needsPermission: false,
    execute: async () => {
        const date = new Date()
        return format(date, 'cccc, yyyy-MM-dd HH:mm:ss OOO')
    },
}

export default timeTool
