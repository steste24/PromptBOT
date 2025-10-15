const { App } = require('@slack/bolt');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize MongoDB
let db;
const client = new MongoClient(process.env.MONGODB_URI);

async function connectToDatabase() {
    try {
        await client.connect();
        db = client.db(process.env.DB_NAME);
        console.log('✅ Connected to MongoDB Atlas');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
    }
}

// Initialize the Slack app with Socket Mode
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
});

// In-memory storage for development (will replace with MongoDB)
const users = new Map();
const pseudonyms = new Map();
const submissions = new Map();
const points = new Map();
const promptThreads = new Map();
const userPromptMessages = new Map(); // Store user's prompt message timestamps
const userFeedbackMessages = new Map(); // Store user's feedback message timestamps

// MongoDB Collections (will use these once connected)
const getCollections = () => {
    if (!db) return null;
    return {
        users: db.collection('users'),
        pseudonyms: db.collection('pseudonyms'),
        submissions: db.collection('submissions'),
        points: db.collection('points'),
        prompts: db.collection('prompts')
    };
};

// Helper function to sync user data with MongoDB
async function syncUserToDatabase(userId, userData) {
    try {
        const collections = getCollections();
        if (!collections) return;

        await collections.users.updateOne(
            { userId: userId },
            { $set: { ...userData, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error syncing user to database:', error);
    }
}

// Helper function to load existing data from MongoDB on startup
async function loadDataFromDatabase() {
    try {
        const collections = getCollections();
        if (!collections) {
            console.log('⚠️ MongoDB not connected, using in-memory storage only');
            return;
        }

        console.log('💾 Loading existing data from MongoDB...');

        // Load users
        const usersData = await collections.users.find({}).toArray();
        usersData.forEach(userData => {
            users.set(userData.userId, {
                id: userData.userId,
                teamId: userData.teamId,
                targetLanguage: userData.targetLanguage,
                createdAt: userData.createdAt
            });
        });
        console.log(`✅ Loaded ${usersData.length} users`);

        // Load pseudonyms
        const pseudonymsData = await collections.pseudonyms.find({}).toArray();
        pseudonymsData.forEach(pseudonymData => {
            pseudonyms.set(pseudonymData.userId, {
                handle: pseudonymData.handle,
                emoji1: pseudonymData.emoji1,
                emoji2: pseudonymData.emoji2,
                cohortLabel: pseudonymData.cohortLabel
            });
        });
        console.log(`✅ Loaded ${pseudonymsData.length} pseudonyms`);

        // Load points
        const pointsData = await collections.points.find({}).toArray();
        pointsData.forEach(pointData => {
            points.set(pointData.userId, pointData.points);
        });
        console.log(`✅ Loaded ${pointsData.length} point records`);

        console.log('✨ Data loading complete!');
    } catch (error) {
        console.error('❌ Error loading data from database:', error);
        console.log('⚠️ Continuing with fresh in-memory storage');
    }
}

// Helper function to sync pseudonym data with MongoDB
async function syncPseudonymToDatabase(userId, pseudonymData) {
    try {
        const collections = getCollections();
        if (!collections) return;

        await collections.pseudonyms.updateOne(
            { userId: userId },
            { $set: { ...pseudonymData, userId: userId, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error syncing pseudonym to database:', error);
    }
}

// Helper function to sync points data with MongoDB
async function syncPointsToDatabase(userId, pointsValue) {
    try {
        const collections = getCollections();
        if (!collections) return;

        await collections.points.updateOne(
            { userId: userId },
            { $set: { points: pointsValue, userId: userId, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error syncing points to database:', error);
    }
}

// AI-powered prompt bank
const promptTemplates = [
    {
        category: 'daily_life',
        en: 'What did you eat for breakfast today? Describe it in detail and explain why you chose it.',
        ja: '今日の朝食は何を食べましたか？詳しく説明して、なぜそれを選んだのか理由も教えてください。'
    },
    {
        category: 'culture',
        en: 'What is a tradition from your country that you think people from other countries might find interesting?',
        ja: 'あなたの国の伝統で、他の国の人が興味深いと思うものは何ですか？'
    },
    {
        category: 'technology',
        en: 'How has technology changed the way you communicate with friends and family?',
        ja: 'テクノロジーは友人や家族とのコミュニケーション方法をどのように変えましたか？'
    },
    {
        category: 'dreams',
        en: 'If you could have any job in the world, what would it be and why?',
        ja: '世界中のどんな仕事でもできるとしたら、何をしたいですか？そしてその理由は？'
    },
    {
        category: 'travel',
        en: 'Describe a place you would like to visit and what you would do there.',
        ja: '訪れてみたい場所とそこで何をしたいかを説明してください。'
    }
];

// Helper functions
function generatePseudonym() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const animals = ['🐼', '🦊', '🐰', '🦆', '🐸', '🦋', '🐝', '🐧', '🐨', '🦘'];
    const plants = ['🌱', '🌿', '🌸', '🌺', '🌻', '🌲', '🎋', '🌴', '🍀', '🌵'];

    const letter1 = letters[Math.floor(Math.random() * letters.length)];
    const letter2 = letters[Math.floor(Math.random() * letters.length)];
    const number = Math.floor(Math.random() * 99) + 1;
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const plant = plants[Math.floor(Math.random() * plants.length)];

    return `${letter1}${letter2}-${number} ${animal}${plant}`;
}

function getOrCreateUser(userId, teamId) {
    if (!users.has(userId)) {
        const pseudonym = generatePseudonym();
        const userData = {
            id: userId,
            teamId: teamId,
            targetLanguage: null,
            createdAt: new Date()
        };

        users.set(userId, userData);

        const pseudonymData = {
            handle: pseudonym,
            emoji1: pseudonym.split(' ')[1][0],
            emoji2: pseudonym.split(' ')[1][1],
            cohortLabel: null
        };
        pseudonyms.set(userId, pseudonymData);

        points.set(userId, 0);

        // Sync to MongoDB
        syncUserToDatabase(userId, userData);
        syncPseudonymToDatabase(userId, pseudonymData);
        syncPointsToDatabase(userId, 0);
    }

    // Ensure pseudonym exists even for existing users
    if (!pseudonyms.has(userId)) {
        const pseudonym = generatePseudonym();
        const pseudonymData = {
            handle: pseudonym,
            emoji1: pseudonym.split(' ')[1][0],
            emoji2: pseudonym.split(' ')[1][1],
            cohortLabel: null
        };
        pseudonyms.set(userId, pseudonymData);
        syncPseudonymToDatabase(userId, pseudonymData);
    }

    // Ensure points exist
    if (!points.has(userId)) {
        points.set(userId, 0);
        syncPointsToDatabase(userId, 0);
    }

    return users.get(userId);
}

// Enhanced language detection
function detectLanguage(text) {
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    const englishPattern = /^[a-zA-Z\s.,!?'"()-]+$/;

    if (japanesePattern.test(text)) {
        return 'ja';
    } else if (englishPattern.test(text.trim())) {
        return 'en';
    } else if (text.length > 50 && !japanesePattern.test(text)) {
        return 'en';
    }
    return 'unknown';
}

// Generate detailed Japanese reading with furigana
async function generateDetailedJapaneseReading(text) {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a Japanese language assistant. When given Japanese text, rewrite it with hiragana readings in parentheses immediately after EVERY word that contains kanji.

Format: 漢字(かんじ) - Put the full hiragana reading for the entire word immediately after it in parentheses.

Example input: 大学の中で、一番好きな場所はどこですか？
Example output: 大学(だいがく)の中(なか)で、一番(いちばん)好き(すき)な場所(ばしょ)はどこですか？

Only return the text with readings, no explanations.`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            temperature: 0.3,
            max_tokens: 500
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating detailed reading:', error);
        return text + '\n\n(Reading generation temporarily unavailable)';
    }
}

// Generate detailed correction explanation in Japanese
async function generateDetailedCorrection(originalText, targetLanguage) {
    try {
        const systemPrompt = targetLanguage === 'ja'
            ? `You are an English language tutor for Japanese speakers. Analyze the English text and provide detailed corrections in Japanese format:

原文:
[Show original with 🔴 before each error]

修正文:
[Show corrected with 🟢 before each correction]

【詳細な説明】
「error → correction」 → Detailed explanation in Japanese
[Repeat for each error]

✨ Encouraging comment in Japanese
👉 Provide a perfect example sentence in English with Japanese translation in parentheses.

Be thorough but encouraging.`
            : `You are a Japanese language tutor for English speakers. Analyze the Japanese text and provide detailed corrections in English format:

Original:
[Show original with 🔴 before each error]

Corrected:
[Show corrected with 🟢 before each correction]

【Detailed Explanation】
"error → correction" → Detailed explanation in English
[Repeat for each error]

✨ Encouraging comment in English
👉 Provide a perfect example sentence in Japanese with English translation in parentheses.

Be thorough but encouraging.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: `Analyze this ${targetLanguage === 'ja' ? 'English' : 'Japanese'} text and provide detailed corrections: "${originalText}"`
                }
            ],
            temperature: 0.7,
            max_tokens: 800
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error generating detailed correction:', error);
        return '詳細な説明は一時的に利用できません。 / Detailed explanation temporarily unavailable.';
    }
}

// AI Functions
async function generateAIPrompt() {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are creating engaging prompts for intercultural language exchange between English and Japanese speakers. Create a bilingual prompt that:
1. Is culturally sensitive and interesting
2. Encourages personal sharing
3. Is appropriate for language learners
4. Avoids controversial topics
5. Has the same meaning in both languages
6. For Japanese text: Write in natural Japanese using kanji, hiragana, and katakana WITHOUT any furigana readings (DO NOT include readings in parentheses)

Format your response as JSON:
{
  "category": "category_name",
  "en": "English prompt here",
  "ja": "Japanese prompt here in pure Japanese without readings"
}`
                },
                {
                    role: "user",
                    content: "Generate a new intercultural language learning prompt."
                }
            ],
            temperature: 0.8,
            max_tokens: 300
        });

        const response = JSON.parse(completion.choices[0].message.content);

        // Save prompt to MongoDB
        try {
            const collections = getCollections();
            if (collections) {
                await collections.prompts.insertOne({
                    ...response,
                    createdAt: new Date(),
                    isAIGenerated: true
                });
            }
        } catch (dbError) {
            console.error('Error saving prompt to database:', dbError);
        }

        return response;
    } catch (error) {
        console.error('Error generating AI prompt:', error);
        return promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
    }
}

async function generateAIFeedback(text, targetLanguage, userLevel = 'beginner') {
    try {
        const systemPrompt = targetLanguage === 'ja'
            ? `You are a gentle Japanese language tutor helping an English speaker learn Japanese. Provide encouraging concise feedback in English about their Japanese writing. Focus on:
1. What they did well
2. 1-2 gentle corrections if needed
3. A natural alternative phrasing
4. Cultural context if relevant
5. When mentioning Japanese words or corrections, write each kanji followed immediately by its hiragana reading in parentheses (例: 食(た)べ物(もの), 勉(べん)強(きょう))
Keep feedback short, positive, and encouraging. Don't overwhelm beginners.`
            : `You are a gentle English language tutor helping a Japanese speaker learn English. Provide encouraging feedback in Japanese about their English writing. Focus on:
1. What they did well
2. 1-2 gentle corrections if needed
3. A natural alternative phrasing
4. Cultural context if relevant
5. Write feedback in Japanese with kanji readings: kanji(hiragana)
Keep feedback short, positive, and encouraging. Don't overwhelm beginners.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: `Please provide gentle feedback on this ${targetLanguage === 'ja' ? 'Japanese' : 'English'} text: "${text}"`
                }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error generating AI feedback:', error);
        return `Great job practicing ${targetLanguage === 'ja' ? 'Japanese' : 'English'}! Keep up the good work! 🌟`;
    }
}

// Fixed Periodic prompt posting function
async function postPrompt() {
    const channelId = process.env.PROMPT_CHANNEL_ID;
    if (!channelId) {
        console.log('No prompt channel configured');
        return;
    }

    try {
        console.log('Generating new AI prompt...');
        const prompt = await generateAIPrompt();

        // Post @everyone alert in channel
        const result = await app.client.chat.postMessage({
            channel: channelId,
            text: `🚨 <!everyone> New Intercultural Prompt Alert! 📱 Check your DMs for today's ${prompt.category} prompt!`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '🚨 New Prompt Alert!'
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `<!everyone> 📱 **Check your DMs now!**\n\n*Today's Topic:* ${prompt.category.replace('_', ' ').toUpperCase()}\n\n• Your personalized prompt is waiting in your DMs\n• Respond directly to me in DMs\n• I'll post your response here anonymously`
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '🎯 *How it works:*\n1️⃣ Read your prompt in DMs (in your target language)\n2️⃣ Reply to me directly in DMs\n3️⃣ I post your response anonymously in this channel\n4️⃣ Get AI feedback in your DMs'
                    }
                }
            ]
        });

        // Store prompt info for thread tracking
        promptThreads.set(result.ts, {
            prompt: prompt,
            postedAt: new Date(),
            responses: []
        });

        // Send personalized prompts to all channel members
        try {
            const channelMembers = await app.client.conversations.members({
                channel: channelId
            });

            console.log(`Found ${channelMembers.members.length} channel members`);

            for (const memberId of channelMembers.members) {
                try {
                    const userInfo = await app.client.users.info({ user: memberId });
                    if (userInfo.user.is_bot) continue;

                    const user = getOrCreateUser(memberId, 'default');

                    if (user.targetLanguage) {
                        const personalizedPrompt = user.targetLanguage === 'ja'
                            ? prompt.ja : prompt.en;
                        const languageFlag = user.targetLanguage === 'ja' ? '🇯🇵' : '🇺🇸';
                        const languageName = user.targetLanguage === 'ja' ? 'Japanese' : 'English';

                        const promptMessage = await app.client.chat.postMessage({
                            channel: memberId,
                            text: `🎯 Your personalized prompt is ready!`,
                            blocks: [
                                {
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: `*${languageFlag} Today's ${languageName} Prompt:*\n\n${personalizedPrompt}`
                                    }
                                },
                                {
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: `📝 *How to respond:* Simply type your response here in this DM!\n\n💡 _React with ❓ for Japanese reading help!_`
                                    }
                                }
                            ]
                        });

                        // Store message timestamp for reaction handling
                        userPromptMessages.set(memberId, {
                            messageTs: promptMessage.ts,
                            promptText: personalizedPrompt
                        });

                        console.log(`✅ Sent DM to user ${memberId}`);
                    } else {
                        // Send setup message to users without target language
                        await app.client.chat.postMessage({
                            channel: memberId,
                            text: `👋 Hi! You need to set your target language first.\n\n📱 Go to the Home tab to choose Japanese or English as your target language.`
                        });
                        console.log(`✅ Sent setup message to user ${memberId}`);
                    }
                } catch (error) {
                    console.log(`❌ Error with user ${memberId}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error getting channel members:', error);
        }

        console.log(`Posted prompt: ${prompt.category} at ${result.ts}`);
    } catch (error) {
        console.error('Error posting prompt:', error);
    }
}

// Helper function to refresh home tab
async function refreshHomeTab(userId, client) {
    try {
        const user = getOrCreateUser(userId, 'default');
        let userPseudo = pseudonyms.get(userId);

        // If pseudonym doesn't exist, create one
        if (!userPseudo) {
            const pseudonym = generatePseudonym();
            userPseudo = {
                handle: pseudonym,
                emoji1: pseudonym.split(' ')[1][0],
                emoji2: pseudonym.split(' ')[1][1],
                cohortLabel: null
            };
            pseudonyms.set(userId, userPseudo);
            await syncPseudonymToDatabase(userId, userPseudo);
        }

        const userPoints = points.get(userId) || 0;

        await client.views.publish({
            user_id: userId,
            view: {
                type: 'home',
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '🌍 Intercultural Learning Hub'
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `👋 Welcome! Your anonymous identity: *${userPseudo.handle}*`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `🏆 *Points:* ${userPoints} | 🎯 *Target Language:* ${user.targetLanguage ? (user.targetLanguage === 'ja' ? '🇯🇵 Japanese' : '🇺🇸 English') : 'Not set'}`
                        }
                    },
                    {
                        type: 'divider'
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*🎯 Choose Your Target Language:*\nSelect the language you want to practice:'
                        }
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '🇯🇵 Japanese'
                                },
                                value: 'ja',
                                action_id: 'set_target_language_ja',
                                style: user.targetLanguage === 'ja' ? 'primary' : undefined
                            },
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '🇺🇸 English'
                                },
                                value: 'en',
                                action_id: 'set_target_language_en',
                                style: user.targetLanguage === 'en' ? 'primary' : undefined
                            }
                        ]
                    },
                    {
                        type: 'divider'
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*📚 How it works:*\n\n1️⃣ I post prompts Mon/Wed/Fri at 9 AM, 2 PM, and 6 PM\n2️⃣ You receive a DM with a prompt in your target language\n3️⃣ Reply to me in DMs - I post your response anonymously\n4️⃣ Get personalized AI feedback in your DMs\n5️⃣ Earn points for participation!'
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*🔒 Privacy Features:*\n• All responses are posted anonymously\n• Your identity is protected with a pseudonym\n• Only you can see your DM feedback'
                        }
                    },
                    {
                        type: 'divider'
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*🚀 Testing:*\nWant to try it out right now?'
                        }
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '🚀 Generate Test Prompt',
                                    emoji: true
                                },
                                value: 'generate_prompt',
                                action_id: 'generate_test_prompt',
                                style: 'primary'
                            }
                        ]
                    }
                ]
            }
        });
    } catch (error) {
        console.error('Error refreshing home tab:', error);
    }
}

// Event Handlers

// App Home Handler
app.event('app_home_opened', async ({ event, client, logger }) => {
    await refreshHomeTab(event.user, client);
});

// Target Language Selection
app.action('set_target_language_ja', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const selectedLanguage = 'ja';

        const user = getOrCreateUser(userId, body.team.id);
        user.targetLanguage = selectedLanguage;
        users.set(userId, user);

        // Sync to MongoDB
        await syncUserToDatabase(userId, user);

        await client.chat.postMessage({
            channel: userId,
            text: `🎯 Target language set to 🇯🇵 Japanese! You'll receive prompts in this language.`
        });

        // Refresh home tab
        await refreshHomeTab(userId, client);
    } catch (error) {
        logger.error(error);
    }
});

app.action('set_target_language_en', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const selectedLanguage = 'en';

        const user = getOrCreateUser(userId, body.team.id);
        user.targetLanguage = selectedLanguage;
        users.set(userId, user);

        // Sync to MongoDB
        await syncUserToDatabase(userId, user);

        await client.chat.postMessage({
            channel: userId,
            text: `🎯 Target language set to 🇺🇸 English! You'll receive prompts in this language.`
        });

        // Refresh home tab
        await refreshHomeTab(userId, client);
    } catch (error) {
        logger.error(error);
    }
});

// Generate Test Prompt Button Handler
app.action('generate_test_prompt', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const user = getOrCreateUser(userId, body.team.id);

        if (!user.targetLanguage) {
            await client.chat.postMessage({
                channel: userId,
                text: "⚠️ Please set your target language first! Go to the Home tab and choose Japanese or English."
            });
            return;
        }

        // Generate a prompt
        const prompt = await generateAIPrompt();
        const personalizedPrompt = user.targetLanguage === 'ja' ? prompt.ja : prompt.en;
        const languageFlag = user.targetLanguage === 'ja' ? '🇯🇵' : '🇺🇸';
        const languageName = user.targetLanguage === 'ja' ? 'Japanese' : 'English';

        const promptMessage = await client.chat.postMessage({
            channel: userId,
            text: `🚀 Test prompt generated!`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${languageFlag} Test ${languageName} Prompt:*\n\n${personalizedPrompt}`
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `📝 *How to respond:* Simply type your response here in this DM!\n\n💡 _React with ❓ for Japanese reading help!_`
                    }
                }
            ]
        });

        // Store message timestamp for reaction handling
        userPromptMessages.set(userId, {
            messageTs: promptMessage.ts,
            promptText: personalizedPrompt
        });

        console.log(`✅ Test prompt sent to user ${userId}`);
    } catch (error) {
        logger.error('Error generating test prompt:', error);
        await client.chat.postMessage({
            channel: body.user.id,
            text: "❌ Sorry, there was an error generating a test prompt. Please try again later."
        });
    }
});

// DM Response Handler (Anti-cheating pipeline)
app.message(async ({ message, client, logger }) => {
    try {
        // Only handle DMs (not channel messages)
        if (message.channel_type !== 'im') return;
        if (message.user === process.env.SLACK_BOT_USER_ID) return;

        const userId = message.user;
        const responseText = message.text;

        if (!responseText || responseText.trim().length === 0) return;

        const user = getOrCreateUser(userId, 'default');

        if (!user.targetLanguage) {
            await client.chat.postMessage({
                channel: userId,
                text: "👋 Please set your target language first! Go to the Home tab and choose Japanese or English."
            });
            return;
        }

        // Detect the language of the response
        const detectedLanguage = detectLanguage(responseText);
        const expectedLanguage = user.targetLanguage;

        console.log(`User ${userId} responded: "${responseText}" | Detected: ${detectedLanguage} | Expected: ${expectedLanguage}`);

        // Anti-cheating validation
        let warningMessage = '';
        let shouldPost = true;

        if (detectedLanguage === 'unknown') {
            warningMessage = '⚠️ I couldn\'t detect the language clearly. Please try writing in your target language.';
            shouldPost = false;
        } else if (detectedLanguage !== expectedLanguage) {
            if (expectedLanguage === 'ja' && detectedLanguage === 'en') {
                warningMessage = '🇯🇵 Please respond in Japanese! Your target language is set to Japanese.';
            } else if (expectedLanguage === 'en' && detectedLanguage === 'ja') {
                warningMessage = '🇺🇸 Please respond in English! Your target language is set to English.';
            }
            shouldPost = false;
        }

        if (!shouldPost) {
            await client.chat.postMessage({
                channel: userId,
                text: warningMessage + '\n\n💡 Tip: You can change your target language in the Home tab if needed.'
            });
            return;
        }

        // Response is valid - post anonymously
        const pseudonym = pseudonyms.get(userId);
        const channelId = process.env.PROMPT_CHANNEL_ID;

        if (!channelId) {
            await client.chat.postMessage({
                channel: userId,
                text: "❌ No prompt channel configured. Please contact an admin."
            });
            return;
        }

        // Post anonymous response
        const anonymousPost = await client.chat.postMessage({
            channel: channelId,
            text: `💬 Anonymous Response from ${pseudonym.handle}`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${pseudonym.handle}* responded:\n\n${responseText}`
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `${expectedLanguage === 'ja' ? '🇯🇵 Japanese' : '🇺🇸 English'} • ${new Date().toLocaleTimeString()}`
                        }
                    ]
                }
            ]
        });

        // Generate and send AI feedback
        const feedback = await generateAIFeedback(responseText, expectedLanguage);

        const feedbackMessage = await client.chat.postMessage({
            channel: userId,
            text: `✅ Your response has been posted anonymously as ${pseudonym.handle}!`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `✅ *Posted successfully!* Your response is now live in the channel as *${pseudonym.handle}*`
                    }
                },
                {
                    type: 'divider'
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*🤖 AI Feedback:*\n${feedback}\n\n💡 _React with ❓ for detailed explanations!_`
                    }
                }
            ]
        });

        // Store feedback message timestamp for reaction handling
        userFeedbackMessages.set(userId, {
            messageTs: feedbackMessage.ts,
            feedbackText: feedback,
            originalText: responseText
        });

        // Award points
        const currentPoints = points.get(userId) || 0;
        const newPoints = currentPoints + 1;
        points.set(userId, newPoints);

        // Store submission for analytics
        const submissionId = uuidv4();
        submissions.set(submissionId, {
            userId: userId,
            pseudonym: pseudonym.handle,
            text: responseText,
            language: detectedLanguage,
            targetLanguage: expectedLanguage,
            timestamp: new Date(),
            feedback: feedback,
            channelPostTs: anonymousPost.ts
        });

        // Sync points to MongoDB
        await syncPointsToDatabase(userId, newPoints);

        // Sync submission to MongoDB
        try {
            const collections = getCollections();
            if (collections) {
                await collections.submissions.insertOne({
                    submissionId: submissionId,
                    userId: userId,
                    pseudonym: pseudonym.handle,
                    text: responseText,
                    language: detectedLanguage,
                    targetLanguage: expectedLanguage,
                    timestamp: new Date(),
                    feedback: feedback,
                    channelPostTs: anonymousPost.ts
                });
            }
        } catch (dbError) {
            console.error('Error syncing submission to database:', dbError);
        }

        console.log(`✅ Processed valid response from ${userId} (${pseudonym.handle})`);

    } catch (error) {
        console.error('Error handling DM response:', error);
        await client.chat.postMessage({
            channel: message.user,
            text: "❌ Sorry, there was an error processing your response. Please try again."
        });
    }
});

// Emoji Reaction Handler - Japanese Reading Help
app.event('reaction_added', async ({ event, client }) => {
    try {
        // Only handle ❓ emoji reactions
        if (event.reaction !== 'question' && event.reaction !== 'grey_question') {
            return;
        }

        const userId = event.user;
        const messageTs = event.item.ts;

        // Check if this is a prompt message
        const promptData = userPromptMessages.get(userId);
        if (promptData && promptData.messageTs === messageTs) {
            console.log(`📖 Generating detailed Japanese reading for ${userId}`);

            const user = users.get(userId);
            if (!user || user.targetLanguage !== 'ja') {
                // Only provide Japanese readings if user is learning Japanese
                await client.chat.postMessage({
                    channel: userId,
                    text: '💡 Reading help is only available for Japanese learners. Change your target language to Japanese in the Home tab!'
                });
                return;
            }

            // Generate detailed reading
            const detailedReading = await generateDetailedJapaneseReading(promptData.promptText);

            await client.chat.postMessage({
                channel: userId,
                text: `📖 *Japanese Reading Help*\n\n${detailedReading}\n\n_React with ❓ on any Japanese prompt to see readings!_`
            });
            return;
        }

        // Check if this is a feedback message
        const feedbackData = userFeedbackMessages.get(userId);
        if (feedbackData && feedbackData.messageTs === messageTs) {
            console.log(`📝 Generating detailed correction explanation for ${userId}`);

            const user = users.get(userId);
            if (!user || !user.targetLanguage) {
                await client.chat.postMessage({
                    channel: userId,
                    text: '💡 Please set your target language in the Home tab first!'
                });
                return;
            }

            // Generate detailed correction explanation
            const detailedCorrection = await generateDetailedCorrection(
                feedbackData.originalText,
                user.targetLanguage
            );

            await client.chat.postMessage({
                channel: userId,
                text: `📝 *Detailed Correction Explanation*\n\n${detailedCorrection}\n\n_React with ❓ on feedback to see detailed explanations!_`
            });
            return;
        }

        // If we get here, the message isn't tracked (not a prompt or feedback)
        console.log(`❓ Reaction on untracked message from ${userId}`);

    } catch (error) {
        console.error('Error handling reaction:', error);
    }
});

// Slash Commands
app.command('/stats', async ({ command, ack, respond, client }) => {
    await ack();

    try {
        const userId = command.user_id;
        const userPoints = points.get(userId) || 0;
        const pseudonym = pseudonyms.get(userId);
        const user = users.get(userId);

        const userSubmissions = Array.from(submissions.values())
            .filter(sub => sub.userId === userId)
            .length;

        await respond({
            response_type: 'ephemeral',
            text: `📊 Your Stats`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '📊 Your Learning Stats'
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Anonymous Identity:* ${pseudonym ? pseudonym.handle : 'Not set'}\n*Target Language:* ${user?.targetLanguage ? (user.targetLanguage === 'ja' ? '🇯🇵 Japanese' : '🇺🇸 English') : 'Not set'}\n*Total Points:* ${userPoints}\n*Responses Submitted:* ${userSubmissions}`
                    }
                }
            ]
        });
    } catch (error) {
        console.error('Error showing stats:', error);
        await respond({
            response_type: 'ephemeral',
            text: '❌ Error retrieving your stats. Please try again.'
        });
    }
});

app.command('/leaderboard', async ({ command, ack, respond }) => {
    await ack();

    try {
        const topUsers = Array.from(points.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, userPoints], index) => {
                const pseudonym = pseudonyms.get(userId);
                return `${index + 1}. ${pseudonym ? pseudonym.handle : 'Unknown'} - ${userPoints} points`;
            });

        const leaderboardText = topUsers.length > 0
            ? topUsers.join('\n')
            : 'No participants yet!';

        await respond({
            response_type: 'in_channel',
            text: `🏆 Leaderboard`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '🏆 Top Learners'
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: leaderboardText
                    }
                }
            ]
        });
    } catch (error) {
        console.error('Error showing leaderboard:', error);
        await respond({
            response_type: 'ephemeral',
            text: '❌ Error retrieving leaderboard. Please try again.'
        });
    }
});

// Cron Jobs for Automated Prompts (Monday, Wednesday, Friday at 9 AM, 2 PM, 6 PM)
cron.schedule('0 9,14,18 * * 1,3,5', () => {
    console.log('Posting scheduled prompt...');
    postPrompt();
}, {
    timezone: "America/New_York"
});

// Error handling
app.error((error) => {
    console.error('Slack app error:', error);
});

// Start the app
(async () => {
    try {
        await connectToDatabase();
        await loadDataFromDatabase(); // Load existing data from MongoDB
        await app.start();
        console.log('⚡️ PromptBot is running!');
        console.log('🔗 MongoDB connection:', db ? 'Connected' : 'Failed');
        console.log('📅 Scheduled prompts: Mon/Wed/Fri at 9 AM, 2 PM, 6 PM');

        // Send a test prompt immediately on startup for testing
        console.log('🚀 Sending test prompt on startup...');
        setTimeout(() => {
            postPrompt();
        }, 2000); // Wait 2 seconds for everything to initialize

    } catch (error) {
        console.error('Failed to start the app:', error);
    }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await client.close();
    process.exit(0);
});

module.exports = app;