const { App } = require('@slack/bolt');
const cron = require('node-cron');

// Configuration
const { config, validateConfig } = require('./src/config');

// Database
const {
    connectToDatabase,
    loadDataFromDatabase,
    closeDatabaseConnection
} = require('./src/database');

// Handlers
const { postPrompt } = require('./src/handlers/promptHandler');
const { handleDirectMessage } = require('./src/handlers/messageHandler');
const {
    handleAppHomeOpened,
    handleSetLanguageJapanese,
    handleSetLanguageEnglish,
    handleGenerateTestPrompt
} = require('./src/handlers/homeHandler');
const {
    handleReplyToResponse,
    handleReplyModalSubmission
} = require('./src/handlers/replyHandler');
const { handleReactionAdded } = require('./src/handlers/reactionHandler');
const {
    handleStatsCommand,
    handleLeaderboardCommand,
    handleTestPromptCommand
} = require('./src/handlers/commandHandler');

// User storage and utilities
const {
    users,
    pseudonyms,
    points
} = require('./src/utils/userUtils');

// Initialize the Slack app with Socket Mode
const app = new App({
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    appToken: config.slack.appToken,
    socketMode: true,
    logLevel: config.slack.logLevel,
    socketModeOptions: config.socketMode
});

// Event Handlers

// App Home Handler
app.event('app_home_opened', async ({ event, client }) => {
    await handleAppHomeOpened(event, client);
});

// Target Language Selection
app.action('set_target_language_ja', async ({ ack, body, client }) => {
    await handleSetLanguageJapanese(ack, body, client);
});

app.action('set_target_language_en', async ({ ack, body, client }) => {
    await handleSetLanguageEnglish(ack, body, client);
});

// Generate Test Prompt Button Handler
app.action('generate_test_prompt', async ({ ack, body, client }) => {
    await handleGenerateTestPrompt(ack, body, client);
});

// Reply to Response Button Handler
app.action(/^reply_to_response_/, async ({ ack, body, client }) => {
    await handleReplyToResponse(ack, body, client);
});

// Reply Modal Submission Handler
app.view('reply_modal', async ({ ack, body, view, client }) => {
    await handleReplyModalSubmission(ack, body, view, client);
});

// DM Response Handler
app.message(async ({ message, client, logger }) => {
    await handleDirectMessage(message, client, logger);
});

// Emoji Reaction Handler
app.event('reaction_added', async ({ event, client }) => {
    await handleReactionAdded(event, client);
});

// Slash Commands
app.command('/stats', async ({ command, ack, respond }) => {
    await handleStatsCommand(command, ack, respond);
});

app.command('/leaderboard', async ({ command, ack, respond }) => {
    await handleLeaderboardCommand(command, ack, respond);
});

app.command('/testprompt', async ({ command, ack, respond }) => {
    await handleTestPromptCommand(command, ack, respond, () => postPrompt(app));
});

// Cron Jobs for Automated Prompts (Monday, Wednesday, Friday at 9 AM, 2 PM, 6 PM)
cron.schedule(config.cron.schedule, () => {
    console.log('⏰ Posting scheduled prompt...');
    postPrompt(app);
}, {
    timezone: config.cron.timezone
});

// Error handling with better logging and recovery
app.error(async (error) => {
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        console.log('⚠️  Socket Mode connection interrupted - will auto-reconnect');
        // Don't exit, let Slack handle the reconnection automatically
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.error('🔌 Network connectivity issue:', error.message);
        console.log('   Will retry connection automatically...');
    } else {
        console.error('❌ Slack app error:', error);
    }
});

// Monitor connection health
let connectionHealthy = false;
let lastConnectionCheck = Date.now();

// Check connection health every 30 seconds
setInterval(() => {
    const now = Date.now();
    if (now - lastConnectionCheck > 90000) { // More than 90 seconds since last activity
        console.log('⚡ Connection health check - no recent activity');
    }
    lastConnectionCheck = now;
}, 30000);

// Start the app
(async () => {
    try {
        // Verify required environment variables
        console.log('🔍 Checking environment variables...');
        validateConfig();
        console.log('✅ All required environment variables present');

        console.log('🔄 Connecting to MongoDB...');
        await connectToDatabase();

        console.log('🔄 Loading data from database...');
        await loadDataFromDatabase(users, pseudonyms, points);

        console.log('🔄 Starting Slack Socket Mode connection...');
        console.log('   (This may take 10-30 seconds on first connection)');

        // Start the app and wait for ready signal
        await app.start();

        // Give Socket Mode a moment to fully initialize
        await new Promise(resolve => setTimeout(resolve, 3000));

        connectionHealthy = true;
        lastConnectionCheck = Date.now();

        console.log('\n✅ ========================================');
        console.log('⚡️ PromptBot is running!');
        console.log('🔌 Slack Socket Mode: Connected ✅');
        console.log('📅 Scheduled prompts: Mon/Wed/Fri at 9 AM, 2 PM, 6 PM');
        console.log('========================================\n');

        // Check if PROMPT_CHANNEL_ID is configured
        if (!config.slack.promptChannelId) {
            console.log('⚠️  PROMPT_CHANNEL_ID not configured in .env - prompts will not be posted');
        } else {
            console.log(`📢 Prompt channel configured: ${config.slack.promptChannelId}`);

            // Send connection confirmation to channel
            try {
                await app.client.chat.postMessage({
                    channel: config.slack.promptChannelId,
                    text: "🤖 PromptBot connected successfully! Ready for intercultural learning. 🌍✨"
                });
                console.log('✅ Connection confirmed to prompt channel');
            } catch (error) {
                console.log('⚠️  Could not send confirmation to channel:', error.message);
            }

            // Send a test prompt immediately on startup for testing
            console.log('🚀 Sending test prompt on startup in 5 seconds...');
            setTimeout(async () => {
                try {
                    await postPrompt(app);
                    console.log('✅ Test prompt posting completed');
                } catch (error) {
                    console.error('❌ Test prompt failed:', error);
                }
            }, 5000); // Wait 5 seconds for Socket Mode to fully connect
        }

    } catch (error) {
        console.error('❌ Failed to start the app:', error);
        process.exit(1);
    }
})();

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);
    connectionHealthy = false;

    try {
        // Close MongoDB connection
        await closeDatabaseConnection();

        // Give Slack client time to clean up
        setTimeout(() => {
            console.log('✅ Shutdown complete');
            process.exit(0);
        }, 2000);

    } catch (error) {
        console.error('❌ Error during shutdown:', error.message);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.log('🔄 App will continue running...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🔄 App will continue running...');
});

module.exports = app;