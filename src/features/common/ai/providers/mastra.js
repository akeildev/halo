const path = require('path');
const os = require('os');

let teachingAssistantAgent = null;
let mastraModules = null;
let mcpClient = null;
let currentApiKey = null;

// Dynamically import Mastra modules to handle ES Module issues
async function loadMastraModules() {
    if (mastraModules) return mastraModules;
    
    try {
        const [
            { openai },
            { Agent },
            { MCPClient },
            { Memory },
            { LibSQLStore, LibSQLVector }
        ] = await Promise.all([
            import('@ai-sdk/openai'),
            import('@mastra/core/agent'),
            import('@mastra/mcp'),
            import('@mastra/memory'),
            import('@mastra/libsql')
        ]);
        
        mastraModules = {
            openai,
            Agent,
            MCPClient,
            Memory,
            LibSQLStore,
            LibSQLVector
        };
        
        console.log('[Mastra] All modules loaded successfully');
        return mastraModules;
    } catch (error) {
        console.error('[Mastra] Failed to load modules:', error);
        throw error;
    }
}

/**
 * Initialize the Teaching Assistant agent with MCP integration and memory
 */
async function initializeTeachingAssistant(apiKey) {
    console.log(`[Mastra] initializeTeachingAssistant called with API key: ${apiKey ? apiKey.substring(0, 7) + '...' : 'null'}`);
    
    // Reset agent if API key has changed
    if (teachingAssistantAgent && currentApiKey !== apiKey) {
        console.log('[Mastra] API key changed, reinitializing Teaching Assistant agent');
        teachingAssistantAgent = null;
        currentApiKey = null;
    }
    
    if (teachingAssistantAgent && currentApiKey === apiKey) {
        console.log('[Mastra] Reusing existing agent with same API key');
        return teachingAssistantAgent;
    }

    try {
        // Set OpenAI API key as environment variable for Mastra to access
        process.env.OPENAI_API_KEY = apiKey;
        
        // Load Mastra modules dynamically
        const { openai, Agent, MCPClient, Memory, LibSQLStore, LibSQLVector } = await loadMastraModules();

        // Create or reuse MCP client to connect to the basics-courses server
        if (!mcpClient) {
            mcpClient = new MCPClient({
                id: 'halo-teaching-assistant', // Unique ID to prevent duplicate initialization
                servers: {
                    'basics-courses': {
                        command: 'npx',
                        args: ['-y', '@basicsu/courses-mcp@latest']
                    }
                },
            });
        }

        // Get the course tools from the MCP server
        let courseTools = [];
        try {
            courseTools = await mcpClient.getTools();
            console.log('[Mastra] Successfully connected to MCP course server');
        } catch (mcpError) {
            console.warn('[Mastra] Failed to connect to MCP server, continuing without course tools:', mcpError.message);
        }

        // Create memory database path in a temp directory to avoid permission issues
        const fs = require('fs');
        const tempDir = os.tmpdir();
        const userDataPath = path.join(tempDir, 'halo-mastra');
        
        // Ensure directory exists
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        
        const memoryDbPath = path.join(userDataPath, 'teaching-assistant-memory.db');
        console.log('[Mastra] Using memory database at:', memoryDbPath);

        // Create memory instance for remembering student progress and information
        const memory = new Memory({
            storage: new LibSQLStore({
                url: `file:${memoryDbPath}`,
            }),
            vector: new LibSQLVector({
                connectionUrl: `file:${memoryDbPath}`,
            }),
            embedder: openai.embedding('text-embedding-3-small', { apiKey }),
            options: {
                // Enable working memory to remember student information
                workingMemory: {
                    enabled: true,
                    scope: 'resource', // Remember across all conversations with the same student
                    template: `# Student Profile

## Personal Info
- Name:
- Email:
- Learning Goals:
- Experience Level:

## Current Course Progress
- Active Course:
- Current Lesson/Step:
- Completed Lessons:
- Areas of Difficulty:

## Learning Preferences
- Preferred Learning Style:
- Topics of Interest:
- Questions Asked:

## Session Notes
- Last Topic Discussed:
- Outstanding Issues:
- Next Steps:
`,
                },
                // Enable semantic recall to remember past learning content
                semanticRecall: {
                    topK: 5, // Retrieve 5 most relevant past messages
                    messageRange: 3, // Include context around each retrieved message
                    scope: 'resource', // Search across all conversations with this student
                },
                // Keep recent conversation history
                lastMessages: 15,
            },
        });

        console.log(`[Mastra] Creating agent with OpenAI model using API key: ${apiKey ? apiKey.substring(0, 7) + '...' : 'null'}`);
        
        teachingAssistantAgent = new Agent({
            name: 'Teaching Assistant',
            instructions: `You are a Teaching Assistant integrated into Halo, a desktop application that automatically captures and provides you with screenshots of the user's screen.

IMPORTANT: You automatically receive screenshots with every user message - you do NOT need to ask for them!

CORE CAPABILITIES:
1. **Screen Analysis**: You AUTOMATICALLY receive screenshots of the user's screen with every message - analyze the visual content directly
2. **Interactive Courses**: Use MCP course tools when available to provide structured learning
3. **Memory & Progress**: Remember student information, progress, and learning preferences
4. **Context-Aware Help**: Provide assistance based on what's currently visible on the user's screen

CRITICAL INSTRUCTIONS FOR MCP COURSES:
- When course tools are available and a user requests learning content:
  1. IMMEDIATELY use the available MCP course tools
  2. FOLLOW the course instructions EXACTLY as provided by the MCP tools
  3. Do NOT add your own interpretation or additional content to course material
  4. Present the course content EXACTLY as returned by the MCP tools
  5. If the MCP tool provides specific steps or actions, follow them precisely

MEMORY USAGE:
- Always update working memory with student information (name, progress, preferences)
- Reference past conversations and learning progress when relevant
- Track course completion and areas where students need help
- Remember student questions and learning patterns

SCREEN INTERACTION:
- You automatically receive a screenshot with every message - analyze it directly
- Describe what you see on the screen when asked
- Provide context-aware assistance based on the current screen content
- Help users understand what they're seeing or how to accomplish tasks
- Connect screen content to learning opportunities when appropriate
- NEVER ask users to provide screenshots - you already have them!

RESPONSE STYLE:
- Be helpful, friendly, and encouraging
- Provide clear, actionable guidance
- Ask clarifying questions when needed
- Adapt explanations to the user's experience level
- Reference previous conversations and learning progress when relevant

You are both a visual assistant for the current screen and a persistent learning companion. Remember: you automatically receive screenshots, so analyze them directly without asking!`,
            
            model: openai('gpt-4o', { apiKey }),
            tools: courseTools,
            memory,
        });

        // Store the API key so we know when it changes
        currentApiKey = apiKey;
        console.log('[Mastra] Teaching Assistant agent initialized successfully');
        return teachingAssistantAgent;

    } catch (error) {
        console.error('[Mastra] Failed to initialize Teaching Assistant agent:', error);
        throw error;
    }
}

/**
 * Create a streaming response from the Teaching Assistant agent
 */
async function createMastraStream(messages, options = {}) {
    try {
        if (!teachingAssistantAgent) {
            throw new Error('Teaching Assistant agent not initialized');
        }
        
        console.log(`[Mastra] Current API key stored: ${currentApiKey ? 'present' : 'missing'}`);
        console.log(`[Mastra] Agent initialized: ${teachingAssistantAgent ? 'yes' : 'no'}`);

        // Extract the user message and image content
        const userMessage = messages[messages.length - 1];
        let prompt = '';
        let hasImage = false;

        if (userMessage.content) {
            if (Array.isArray(userMessage.content)) {
                // Handle multimodal content (text + image)
                for (const content of userMessage.content) {
                    if (content.type === 'text') {
                        prompt += content.text + ' ';
                    } else if (content.type === 'image_url') {
                        hasImage = true;
                        prompt += '[Screenshot provided] ';
                    }
                }
            } else {
                // Handle simple text content
                prompt = userMessage.content;
            }
        }

        // Generate a unique resource ID based on user session or use provided one
        const resourceId = options.resourceId || 'halo_user_default';
        const threadId = options.threadId || `session_${Date.now()}`;

        console.log(`[Mastra] Processing request with ${hasImage ? 'screenshot' : 'text only'}`);

        // Generate response using the agent with memory
        // Make sure we have the API key available for generation
        if (!currentApiKey) {
            throw new Error('No API key available for Mastra agent generation');
        }
        
        const response = await teachingAssistantAgent.generate(
            messages, // Pass full messages array to maintain multimodal support
            {
                maxSteps: options.maxSteps || 10,
                resourceId,
                threadId,
                // Pass API key in case the agent needs it for this generation
                apiKey: currentApiKey,
            }
        );

        // Convert Mastra response to streaming format compatible with existing code
        return createStreamFromMastraResponse(response);

    } catch (error) {
        console.error('[Mastra] Error in createMastraStream:', error);
        throw error;
    }
}

/**
 * Convert Mastra response to streaming format
 */
function createStreamFromMastraResponse(response) {
    const chunks = [];
    
    // Split response text into chunks for streaming effect
    if (response.text) {
        const text = response.text;
        const chunkSize = 50;
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push({
                choices: [{
                    delta: {
                        content: text.slice(i, i + chunkSize)
                    }
                }]
            });
        }
    }

    // Add tool results if any (only if there are actual meaningful results)
    if (response.steps && response.steps.length > 0) {
        let hasValidToolResults = false;
        let toolResults = '\n\n**Learning Tools Used:**\n';
        
        for (const step of response.steps) {
            if (step.toolCalls) {
                for (const toolCall of step.toolCalls) {
                    // Only add tool results if they have meaningful content
                    if (toolCall.name && toolCall.result && toolCall.result !== undefined) {
                        toolResults += `\n- ${toolCall.name}: ${JSON.stringify(toolCall.result, null, 2)}\n`;
                        hasValidToolResults = true;
                    }
                }
            }
        }
        
        // Only add tool results chunk if there are actual valid results
        if (hasValidToolResults) {
            chunks.push({
                choices: [{
                    delta: {
                        content: toolResults
                    }
                }]
            });
        }
    }

    // Add final chunk
    chunks.push({
        choices: [{
            delta: {
                content: ''
            }
        }]
    });

    let chunkIndex = 0;

    // Create a ReadableStream that mimics the OpenAI streaming format
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            
            const sendChunk = () => {
                if (chunkIndex < chunks.length) {
                    const chunk = chunks[chunkIndex++];
                    const data = `data: ${JSON.stringify(chunk)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                    
                    // Send next chunk after a small delay to simulate streaming
                    setTimeout(sendChunk, 50);
                } else {
                    // Send final done message
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            };
            
            sendChunk();
        }
    });

    return { body: stream };
}

/**
 * MastraProvider class to match the expected provider pattern (same as OpenAI)
 */
class MastraProvider {
    static async validateApiKey(apiKey) {
        // Since Mastra uses OpenAI under the hood, validate it as an OpenAI key
        if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
            return { success: false, error: 'Invalid OpenAI API key format.' };
        }

        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (response.ok) {
                console.log('[Mastra] API key validation successful');
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.error?.message || `Validation failed with status: ${response.status}`;
                return { success: false, error: message };
            }
        } catch (error) {
            console.error('[Mastra] Network error during key validation:', error);
            return { success: false, error: 'A network error occurred during validation.' };
        }
    }
}

/**
 * Create a Mastra streaming LLM instance (matches OpenAI provider pattern)
 */
function createStreamingLLM({ apiKey, model, temperature = 0.7, maxTokens = 2048, resourceId, threadId, maxSteps, ...config }) {
    return {
        streamChat: async (messages) => {
            // Initialize the Teaching Assistant if not already done
            if (!teachingAssistantAgent) {
                await initializeTeachingAssistant(apiKey);
            }
            
            // Use the Mastra streaming function
            return createMastraStream(messages, {
                resourceId,
                threadId,
                maxSteps
            });
        }
    };
}

module.exports = {
    initializeTeachingAssistant,
    createMastraStream,
    createStreamingLLM,
    MastraProvider,
};