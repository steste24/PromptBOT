require('dotenv').config();

// Environment configuration
const config = {
    // Slack configuration
    slack: {
        botToken: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        appToken: process.env.SLACK_APP_TOKEN,
        botUserId: process.env.SLACK_BOT_USER_ID,
        promptChannelId: process.env.PROMPT_CHANNEL_ID,
        logLevel: 'warn'
    },

    // OpenAI configuration
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini',
        turboModel: 'gpt-4-turbo'
    },

    // MongoDB configuration
    mongodb: {
        uri: process.env.MONGODB_URI,
        dbName: process.env.DB_NAME,
        options: {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true
        }
    },

    // Socket Mode configuration
    socketMode: {
        clientPingTimeout: 30000,
        serverPingTimeout: 60000,
        maxReconnectionDelay: 10000,
        reconnectionDelayGrowthFactor: 1.3,
        maxRetries: 5,
        retryAfter: 5000
    },

    // Cron schedule for prompts
    cron: {
        schedule: '0 9,14,18 * * 1,3,5', // Mon/Wed/Fri at 9 AM, 2 PM, 6 PM
        timezone: 'America/New_York'
    },

    // Application settings
    app: {
        defaultPoints: 0,
        pointsPerResponse: 1,
        leaderboardLimit: 10
    }
};

// Validate required environment variables
function validateConfig() {
    const requiredVars = [
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN',
        'OPENAI_API_KEY',
        'MONGODB_URI'
    ];

    const missing = requiredVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

module.exports = { config, validateConfig };
