import { format } from 'date-fns'

import type { Tool } from '../services/LLMService.js'

const timeTool: Tool = {
    name: 'time',
    description: 'Returns the current date and time in ISO 8601 format.',
    params: [],
    execute: async () => {
        const date = new Date()
        return format(date, 'yyyy-MM-dd HH:mm:ss')
    },
}

export default timeTool
