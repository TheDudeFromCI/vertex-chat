import test from 'node:test'
import assert from 'node:assert/strict'
import { default as Database } from 'better-sqlite3'

import { ConversationStore } from '../src/services/ConversationStore.js'
import { generateUuid } from '../src/Utils.js'

test('ConversationStore should create, retrieve, and delete conversations', () => {
    const db = new Database(':memory:')
    const conversationStore = new ConversationStore(db)

    // Create a workspace
    const workspace = conversationStore.createWorkspace('Test Workspace')

    // Create a conversation
    const conversation = conversationStore.createConversation(workspace.id, 'Test Conversation')

    // Retrieve the conversation
    test('Retrieving a conversation should return the correct data', () => {
        const retrievedConversation = conversationStore.getConversation(conversation.id)
        assert.strictEqual(retrievedConversation!.id, conversation.id)
        assert.strictEqual(retrievedConversation!.name, 'Test Conversation')
        assert.deepStrictEqual(retrievedConversation!.participants, [])
    })

    // Delete the conversation
    test('Deleting a conversation should remove it from the store', () => {
        const result = conversationStore.deleteConversation(conversation.id)
        assert.strictEqual(result, true)
    })

    // Attempt to retrieve the deleted conversation
    test('Retrieving a deleted conversation should return null', () => {
        const deletedConversation = conversationStore.getConversation(conversation.id)
        assert.strictEqual(deletedConversation, null)
    })
})

test('Workspaces can contain multiple conversations', () => {
    const db = new Database(':memory:')
    const conversationStore = new ConversationStore(db)

    // Create a workspace
    const workspace = conversationStore.createWorkspace('Test Workspace')

    // Create multiple conversations
    const conversation1 = conversationStore.createConversation(workspace.id, 'Conversation 1')
    const conversation2 = conversationStore.createConversation(workspace.id, 'Conversation 2')

    // Retrieve conversations for the workspace
    const retrievedWorkspace = conversationStore.getWorkspace(workspace.id)
    assert.deepStrictEqual(
        retrievedWorkspace!.conversationEntries.map((c) => [c.conversationId, c.name]),
        [
            [conversation1.id, 'Conversation 1'],
            [conversation2.id, 'Conversation 2'],
        ],
    )
})

test('Deleting a workspace should also delete its conversations and messages', () => {
    const db = new Database(':memory:')
    const conversationStore = new ConversationStore(db)

    // Create a workspace
    const workspace = conversationStore.createWorkspace('Test Workspace')

    // Simulate a known user
    const userId = generateUuid()

    // Create a conversation and add a message
    const conversation = conversationStore.createConversation(workspace.id, 'Test Conversation')
    const message1 = conversationStore.appendMessage(conversation.id, userId, [
        { type: 'text', content: 'Hello, World!' },
    ])
    const message2 = conversationStore.appendMessage(conversation.id, userId, [
        { type: 'text', content: 'Hello, again!' },
    ])

    // Delete the workspace
    const result = conversationStore.deleteWorkspace(workspace.id)
    assert.strictEqual(result, true)

    // Attempt to retrieve the deleted workspace, conversation, and messages
    const deletedWorkspace = conversationStore.getWorkspace(workspace.id)
    assert.strictEqual(deletedWorkspace, null)

    const deletedConversation = conversationStore.getConversation(conversation.id)
    assert.strictEqual(deletedConversation, null)

    const deletedMessage1 = conversationStore.getMessage(message1.id)
    const deletedMessage2 = conversationStore.getMessage(message2.id)
    assert.strictEqual(deletedMessage1, null)
    assert.strictEqual(deletedMessage2, null)
})
