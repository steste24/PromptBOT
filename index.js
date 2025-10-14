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
let client;

async function connectToDatabase() {
    try {
        // Check if required environment variables are set
        if (!process.env.MONGODB_URI) {
            console.log('⚠️ MONGODB_URI not set, using in-memory storage only');
            return;
        }
        
        if (!process.env.DB_NAME) {
            console.log('⚠️ DB_NAME not set, using in-memory storage only');
            return;
        }

        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db(process.env.DB_NAME);
        console.log('✅ Connected to MongoDB Atlas');
        
        // Test the connection
        await db.admin().ping();
        console.log('✅ MongoDB connection verified');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        console.log('💡 Common fixes:');
        console.log('   1. Check your MONGODB_URI in .env file');
        console.log('   2. Ensure your IP is whitelisted in MongoDB Atlas');
        console.log('   3. Verify your MongoDB credentials');
        console.log('   4. Check your internet connection');
        console.log('⚠️ Continuing with in-memory storage only');
        db = null;
        client = null;
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
        en: 'What did you eat for breakfast today? Why did you choose it',
        ja: '今日の朝食は何を食べましたか？詳しく説明して、なぜそれを選んだのか理由も教えてください。'
    },
    {
        category: 'culture',
        en: 'Is there a tradition or custom from your home country that you want more people to know about?',
        ja: '母国で、「これは知ってほしい！」と思う伝統や文化はありますか？'
    },
    {
        category: 'opinions',
        en: 'Do you prefer studying in the morning or at night? Which works better for you?',
        ja: '勉強するなら、朝と夜どちらのほうが集中できますか？'
    },
    {
        category: 'storytelling',
        en: 'Whats a small mistake or accident that turned out to be a good memory later on?',
        ja: 'ちょっとした失敗が、あとでいい思い出になったことはありますか？'
    },
    {
        category: 'collaboration',
        en: 'Lets imagine the perfect student café together! What kind of place would it be?',
        ja: '一緒に理想の学生カフェを考えてみましょう！どんなお店だったら行きたくなりますか？'
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
2. Encourages personal sharing (memories, experiences, opinions)
3. Is appropriate and understandable for a broad proficiency of language learners (roughly CEFR A2-C2 / JLPT N4-N1)
4. Avoids controversial topics (religion, politics, sensitive social issues)
5. Prompts must have the same core meaning in both languages but be localised in the English and Japanese languages so that it sounds natural to native speakers (example: in japanese, avoid あなた pronoun sentences)
6. Prompts must be open-ended, invite reciprocity, and be neutral and inclusive (avoid inside jokes or slang that only one culture knows)
7. Prompts should use everyday vocabulary (food, study, hobbies, dreams, travel, etc.)
8. The follow order o prompt generation should always go: easy warm-up question involving daily life → more creative question involving themes like culture / fun → a longer answer question where storytelling and collaboration answer is encouraged
9. Each prompt should be one or two sentences maximum (preferably under 20 words as per the English language equivalent)
10. Exemplar categories for the rotation of prompts may include: 1. daily life (meals, routines, school, hobbies), 2. opinions and preferences (choices, likes/ dislikes), 3. culture and traditions (holidays, customs, habits), 4. storytelling and memories (funny mistakes, best experiences), 5. imagination and “what if” (dreams, future, fantasy scenarios), 6. collaboration and teamwork (design something together, group preferences), 7. fun and random (animals, superpowers, “would you rather” questions)

Format your response as JSON:
{
  "category": "category_name",
  "en": "English prompt here",
  "ja": "Japanese prompt here"
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
            ? `You are a gentle Japanese language tutor helping a English speaker learn Japanese. The output corrections must always follow these rules:
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word, wrongly used kanji character in the context of the prompt and its consequential answer or incorrect grammar structure
3. For the corrected sentence: rewrite the sentence with all errors fixed and after each kanji word include its hiragana writing directly after in parentheses → mark each corrected word with and grammar structure with 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear (e.g., “adjective form,” “spelling,” “missing particle”)
5. For the motivational note: always include one differing ✨ motivational sentence (short praise)
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in Japanese → underneath, provide the English translation in parentheses → expansion must be natural, descriptive, and connected as well as complete the learners attempt, it should also rephrase and restructure the correct sentence to sound more natural
7. Note: users could type the wrong kanji in response to the prompt question asked, based on the context of the prompt and its consequent answer, correct any mistakes and incorrect kanji choice with the correct one
8. For the Slack Formatting: use line breaks \n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the Japanese language:

Original:
隠(かく)すとカウントするとても 🔴楽しな 🔴ゲム です。

Corrected:
隠(かく)すとカウントするとても 🟢楽(たの)しい 🟢ゲーム です。

「楽しな」 → 「楽しい」 (adjective form)
「ゲム」 → 「ゲーム」 (spelling)

✨ Great! To be more descriptive, you can say:
👉 「一人が数えている間に、ほかの人たちが隠れて、見つかるまで待つゲームです。とても楽しいゲームです！」
(Its a game where one person counts while the others hide and wait until theyre found. Its a super fun game!)`

            : `You are a gentle English language tutor helping a Japanese speaker learn English. The output corrections must always follow these rules:
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word 
3. For the corrected sentence: rewrite the sentence with all errors fixed → mark each corrected word with a 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear and written in fluent n1 level japanese (e.g., “adjective form,” “spelling,” “missing particle”)
5. For the motivational note: always include one differing ✨ motivational sentence (short praise) in fluent n1 level japanese 
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in English → underneath, provide the Japanese translation in parentheses → expansion must be natural, descriptive, and connected to the learners attempt
7. For the Slack Formatting: use line breaks \n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the Japanese language:

原文:
We 🔴playing 🔴run game, we 🔴run many time 🔴about tree, 🔴very fast pace.

修正文:
We 🟢played 🟢a running game. We 🟢ran many times 🟢around the tree 🟢at a very fast pace.

「playing」 → 「played」 (動詞の時制) 
「run game」 → 「a running game」 (冠詞＋名詞表現) 
「run many time」 → 「ran many times」 (動詞形＋複数形) 
「about tree」 → 「around the tree」 (前置詞の誤用)  
「very fast pace」 → 「at a very fast pace」 (前置詞不足)

✨ とても良い挑戦です！あと少しで自然な表現になりました。  
👉 “In my country, children often play a running game where everyone runs around a large tree many times at a very fast pace.”  
（私の国では、子供たちはよく大きな木の周りを何度も走るゲームをします。とても速いペースなので、とてもワクワクします。）`;

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

                        await app.client.chat.postMessage({
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
                                        text: `📝 *How to respond:* Simply type your response here in this DM!`
                                    }
                                }
                            ]
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

        await client.chat.postMessage({
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
                        text: `*🤖 AI Feedback:*\n${feedback}`
                    }
                }
            ]
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
    console.log('🛑 Shutting down gracefully...');
    try {
        if (client) {
            await client.close();
            console.log('✅ MongoDB connection closed');
        }
    } catch (error) {
        console.error('❌ Error closing MongoDB connection:', error.message);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    try {
        if (client) {
            await client.close();
            console.log('✅ MongoDB connection closed');
        }
    } catch (error) {
        console.error('❌ Error closing MongoDB connection:', error.message);
    }
    process.exit(0);
});

module.exports = app;