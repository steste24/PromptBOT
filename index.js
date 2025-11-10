const { App } = require('@slack/bolt');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const { MongoClient } = require('mongodb');
require('dotenv').config();


const langdetect = require('langdetect');
const axios = require('axios');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize MongoDB with retry logic
let db;
const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    retryWrites: true,
    retryReads: true
});

async function connectToDatabase() {
    let retries = 3;
    while (retries > 0) {
        try {
            await client.connect();
            db = client.db(process.env.DB_NAME);
            console.log('✅ Connected to MongoDB Atlas');
            return;
        } catch (error) {
            retries--;
            console.error(`❌ MongoDB connection error (${3 - retries}/3):`, error.message);
            if (retries > 0) {
                console.log(`🔄 Retrying MongoDB connection in 3 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                console.error('❌ Failed to connect to MongoDB after 3 attempts');
                // Don't exit - continue with in-memory storage only
            }
        }
    }
}

// Initialize the Slack app with Socket Mode
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: 'warn', // Reduce noise, only show warnings and errors
    socketModeOptions: {
        clientPingTimeout: 30000, // 30 seconds
        serverPingTimeout: 60000, // 60 seconds
        maxReconnectionDelay: 10000, // Max 10 seconds between reconnection attempts
        reconnectionDelayGrowthFactor: 1.3, // Gradual backoff
        maxRetries: 5, // Limit retry attempts
        retryAfter: 5000 // Wait 5 seconds before first retry
    }
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
        en: 'What did you eat for breakfast today? Why did you choose it?',
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
        en: 'What\'s a small mistake or accident that turned out to be a good memory later on?',
        ja: 'ちょっとした失敗が、あとでいい思い出になったことはありますか？'
    },
    {
        category: 'collaboration',
        en: 'Let\'s imagine the perfect student café together! What kind of place would it be?',
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
2. Encourages personal sharing (memories, experiences, opinions)
3. Is appropriate and understandable for a broad proficiency of language learners (roughly CEFR A2-C2 / JLPT N4-N1)
4. Avoids controversial topics (religion, politics, sensitive social issues)
5. Prompts must have the same core meaning in both languages but be localised in the English and Japanese languages so that it sounds natural to native speakers (example: in japanese, avoid あなた pronoun sentences)
6. Prompts must be open-ended, invite reciprocity, and be neutral and inclusive (avoid inside jokes or slang that only one culture knows)
7. Prompts should use everyday vocabulary (food, study, hobbies, dreams, travel, etc.)
8. The follow order of prompt generation should always go: easy warm-up question involving daily life → more creative question involving themes like culture / fun → a longer answer question where storytelling and collaboration answer is encouraged
9. Each prompt should be one or two sentences maximum (preferably under 20 words as per the English language equivalent)
10. Exemplar categories for the rotation of prompts may include: 1. daily life (meals, routines, school, hobbies), 2. opinions and preferences (choices, likes/ dislikes), 3. culture and traditions (holidays, customs, habits), 4. storytelling and memories (funny mistakes, best experiences), 5. imagination and "what if" (dreams, future, fantasy scenarios), 6. collaboration and teamwork (design something together, group preferences), 7. fun and random (animals, superpowers, "would you rather" questions)

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

        // Strip markdown code blocks if present
        let content = completion.choices[0].message.content;
        content = content.replace(/```json\n?|\n?```/g, '').trim();

        const response = JSON.parse(content);

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
            ? `You are a gentle Japanese language tutor helping an English speaker learn Japanese. The output corrections must always follow these rules:
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word, wrongly used kanji character in the context of the prompt and its consequential answer or incorrect grammar structure
3. For the corrected sentence: rewrite the sentence with all errors fixed and after each kanji word include its hiragana writing directly after in parentheses → mark each corrected word and grammar structure with 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear (e.g., "adjective form," "spelling," "missing particle")
5. For the motivational note: always include one differing ✨ motivational sentence (short praise)
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in Japanese → underneath, provide the English translation in parentheses → expansion must be natural, descriptive, and connected as well as complete the learner's attempt, it should also rephrase and restructure the correct sentence to sound more natural
7. Note: users could type the wrong kanji in response to the prompt question asked, based on the context of the prompt and its consequent answer, correct any mistakes and incorrect kanji choice with the correct one
8. For the Slack Formatting: use line breaks \\n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the Japanese language:

Original:
隠(かく)すとカウントするとても 🔴楽しな 🔴ゲム です。

Corrected:
隠(かく)すとカウントするとても 🟢楽(たの)しい 🟢ゲーム です。

「楽しな」 → 「楽しい」 (adjective form)
「ゲム」 → 「ゲーム」 (spelling)

✨ Great! To be more descriptive, you can say:
👉 「一人が数えている間に、ほかの人たちが隠れて、見つかるまで待つゲームです。とても楽しいゲームです！」
(It's a game where one person counts while the others hide and wait until they're found. It's a super fun game!)`

            : `You are a gentle English language tutor helping a Japanese speaker learn English. The output corrections must always follow these rules:
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word
3. For the corrected sentence: rewrite the sentence with all errors fixed → mark each corrected word with a 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear and written in fluent n1 level japanese (e.g., "adjective form," "spelling," "missing particle")
5. For the motivational note: always include one differing ✨ motivational sentence (short praise) in fluent n1 level japanese
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in English → underneath, provide the Japanese translation in parentheses → expansion must be natural, descriptive, and connected to the learner's attempt
7. For the Slack Formatting: use line breaks \\n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the English language:

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
👉 "In my country, children often play a running game where everyone runs around a large tree many times at a very fast pace."
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
            max_tokens: 400
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error generating AI feedback:', error);
        return `Great job practicing ${targetLanguage === 'ja' ? 'Japanese' : 'English'}! Keep up the good work! 🌟`;
    }
}

// Dictionary lookup function (Jisho.org + OpenAI)
async function generateDictionaryEntry(word, wordLanguage, userNativeLanguage) {

    // English-to-Japanese (using OpenAI)
    if (wordLanguage === 'en') {

        const systemPrompt = `You are an expert English-to-Japanese dictionary (英和辞典).
The user will provide an English word.
Your task is to provide a concise, "MacBook-style" dictionary entry.
You MUST respond in the following JSON format:
{
  "word": "The original English word",
  "reading": "The IPA pronunciation, e.g., |prɛzənˈteɪʃ(ə)n|",
  "definitions": [
    {
      "part_of_speech": "e.g., Noun",
      "japanese_meaning": "The primary Japanese translation and definition, e.g., 発表 (はっぴょう), 提示 (ていじ)"
    },
    {
      "part_of_speech": "e.g., Noun (secondary)",
      "japanese_meaning": "A secondary meaning, e.g., 贈呈 (ぞうてい)"
    }
  ]
}
Be accurate and concise. Only provide the JSON.`;

        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4-turbo",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: word }
                ],
                temperature: 0.1,
                max_tokens: 500
            });

            const rawJson = completion.choices[0].message.content;
            const entry = JSON.parse(rawJson);

            // Build the Slack blocks
            const definitionBlocks = [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: `${entry.word} (${entry.reading})`, emoji: true }
                }
            ];

            entry.definitions.slice(0, 3).forEach((def, index) => {
                definitionBlocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${index + 1}.* (${def.part_of_speech})\n${def.japanese_meaning}`
                    }
                });
            });

            definitionBlocks.push({ type: 'divider' });
            definitionBlocks.push({
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `Powered by OpenAI (Weblio Equivalent)`
                    }
                ]
            });

            return { blocks: definitionBlocks };

        } catch (error) {
            console.error('Error generating English->Japanese definition with OpenAI:', error);
            return {
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `❌ Sorry, I had an error looking up *${word}* with OpenAI.` }
                    }
                ]
            };
        }
    }

    // Japanese-to-English (using Jisho)
    try {
        const encodedWord = encodeURIComponent(word);
        const response = await axios.get(`https://jisho.org/api/v1/search/words?keyword=${encodedWord}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
            }
        });
        const data = response.data.data;

        if (!data || data.length === 0) {
            return {
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `😕 Sorry, I couldn't find *${word}* on Jisho.org. Here's a link to a manual search:\n\n<https://jisho.org/search/${encodedWord}|Search for "${word}" on Jisho.org>`
                        }
                    }
                ]
            };
        }

        const entry = data[0];
        const japanese = entry.japanese[0];
        const senses = entry.senses;

        let headerText = japanese.word ? japanese.word : '';
        if (japanese.reading) {
            headerText += ` (${japanese.reading})`;
        }

        // Build the Slack blocks
        const definitionBlocks = [
            {
                type: 'header',
                text: { type: 'plain_text', text: headerText, emoji: true }
            }
        ];

        senses.slice(0, 3).forEach((sense, index) => {
            const partsOfSpeech = sense.parts_of_speech.join(', ');
            const englishDefs = sense.english_definitions.join('; ');

            definitionBlocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${index + 1}.* (${partsOfSpeech})\n${englishDefs}`
                }
            });
        });

        definitionBlocks.push({ type: 'divider' });
        definitionBlocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `<https://jisho.org/search/${encodedWord}|View full entry for "${word}" on Jisho.org>`
                }
            ]
        });

        return { blocks: definitionBlocks };

    } catch (error) {
        console.error('Error fetching from Jisho API:', error);
        return {
            blocks: [
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: `❌ Sorry, I had an error connecting to Jisho.org.` }
                }
            ]
        };
    }
}

// Fixed Periodic prompt posting function
async function postPrompt() {
    const channelId = process.env.PROMPT_CHANNEL_ID;
    if (!channelId) {
        console.log('❌ No prompt channel configured - set PROMPT_CHANNEL_ID in .env');
        return;
    }

    try {
        console.log('📝 Generating new AI prompt...');
        const prompt = await generateAIPrompt();
        console.log(`✅ Generated prompt - Category: ${prompt.category}`);

        // Post @everyone alert in channel
        console.log(`📤 Posting alert to channel: ${channelId}`);
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

        console.log(`✅ Channel alert posted successfully (ts: ${result.ts})`);

        // Store prompt info for thread tracking
        promptThreads.set(result.ts, {
            prompt: prompt,
            postedAt: new Date(),
            responses: []
        });

        // Send personalized prompts to all channel members
        try {
            console.log(`👥 Fetching channel members from ${channelId}...`);
            const channelMembers = await app.client.conversations.members({
                channel: channelId
            });

            console.log(`✅ Found ${channelMembers.members.length} channel members`);

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

            console.log(`🎉 Prompt distribution complete!`);
        } catch (error) {
            console.error('❌ Error getting channel members:', error);
        }

        console.log(`✅ Prompt posting finished: ${prompt.category} at ${result.ts}`);
    } catch (error) {
        console.error('❌ Error in postPrompt():', error);
        console.error('Stack trace:', error.stack);
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

// Reply to Response Button Handler
app.action(/^reply_to_response_/, async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const actionId = body.actions[0].action_id;
        const value = JSON.parse(body.actions[0].value);
        const { originalPoster, originalText, messageTs } = value;

        const userId = body.user.id;
        const user = getOrCreateUser(userId, body.team.id);

        if (!user.targetLanguage) {
            await client.chat.postMessage({
                channel: userId,
                text: "⚠️ Please set your target language first! Go to the Home tab and choose Japanese or English."
            });
            return;
        }

        // Open reply modal
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'reply_modal',
                private_metadata: JSON.stringify({
                    originalPoster,
                    originalText,
                    messageTs,
                    channelId: body.channel.id
                }),
                title: {
                    type: 'plain_text',
                    text: '💬 Reply Anonymously'
                },
                submit: {
                    type: 'plain_text',
                    text: 'Send Reply'
                },
                close: {
                    type: 'plain_text',
                    text: 'Cancel'
                },
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Replying to ${originalPoster}:*\n\n> ${originalText}`
                        }
                    },
                    {
                        type: 'divider'
                    },
                    {
                        type: 'input',
                        block_id: 'reply_text',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'reply_input',
                            multiline: true,
                            placeholder: {
                                type: 'plain_text',
                                text: `Write your reply in ${user.targetLanguage === 'ja' ? 'Japanese' : 'English'}...`
                            }
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Your Reply'
                        }
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: `⚠️ Please write in *${user.targetLanguage === 'ja' ? 'Japanese 🇯🇵' : 'English 🇺🇸'}* (your target language)`
                            }
                        ]
                    }
                ]
            }
        });
    } catch (error) {
        logger.error('Error opening reply modal:', error);
    }
});

// Reply Modal Submission Handler
app.view('reply_modal', async ({ ack, body, view, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const metadata = JSON.parse(view.private_metadata);
        const { originalPoster, originalText, messageTs, channelId } = metadata;

        const replyText = view.state.values.reply_text.reply_input.value;

        if (!replyText || replyText.trim().length === 0) {
            return;
        }

        const user = getOrCreateUser(userId, body.team.id);
        const pseudonym = pseudonyms.get(userId);

        // Detect language and validate
        const detectedLanguage = detectLanguage(replyText);
        const expectedLanguage = user.targetLanguage;

        if (detectedLanguage === 'unknown' || detectedLanguage !== expectedLanguage) {
            await client.chat.postMessage({
                channel: userId,
                text: expectedLanguage === 'ja'
                    ? '⚠️ Please write your reply in Japanese! 🇯🇵'
                    : '⚠️ Please write your reply in English! 🇺🇸'
            });
            return;
        }

        // Post reply as thread
        const replyPost = await client.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `💬 Reply from ${pseudonym.handle}`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${pseudonym.handle}* replied:\n\n${replyText}`
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

        // Generate AI feedback for the replier
        const feedback = await generateAIFeedback(replyText, expectedLanguage);

        const feedbackMessage = await client.chat.postMessage({
            channel: userId,
            text: `✅ Your reply has been posted!`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `✅ *Reply posted!* Your reply to ${originalPoster} is now live in the thread.`
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

        // Store feedback message for reaction handling
        userFeedbackMessages.set(userId, {
            messageTs: feedbackMessage.ts,
            feedbackText: feedback,
            originalText: replyText
        });

        // Award points
        const currentPoints = points.get(userId) || 0;
        const newPoints = currentPoints + 1;
        points.set(userId, newPoints);
        await syncPointsToDatabase(userId, newPoints);

        console.log(`✅ Reply posted by ${userId} (${pseudonym.handle})`);
    } catch (error) {
        logger.error('Error handling reply submission:', error);
        await client.chat.postMessage({
            channel: body.user.id,
            text: "❌ Sorry, there was an error posting your reply. Please try again."
        });
    }
});

// DM Response Handler (Anti-cheating pipeline)
app.message(async ({ message, client, logger }) => {
    // Update connection health tracker
    lastConnectionCheck = Date.now();
    connectionHealthy = true;

    try {
        // Only handle DMs (not channel messages)
        if (message.channel_type !== 'im') return;
        if (message.user === process.env.SLACK_BOT_USER_ID) return;

        const userId = message.user;
        const responseText = message.text;

        if (!responseText || responseText.trim().length === 0) return;

        // Get user profile first to check language settings
        const userForDictionary = getOrCreateUser(userId, 'default');

        // Check if user has set their language
        if (!userForDictionary.targetLanguage) {
            await client.chat.postMessage({
                channel: userId,
                text: "👋 Please set your target language first! Go to the Home tab and choose Japanese or English."
            });
            return;
        }

        const userNativeLanguage = userForDictionary.targetLanguage === 'ja' ? 'en' : 'ja';

        // --- DICTIONARY GATE: Check if message is a dictionary command ---
        const lowerCaseText = responseText.toLowerCase();
        let wordToDefine = '';
        let commandFound = false;

        // English-style commands
        if (lowerCaseText.startsWith('define ')) {
            wordToDefine = responseText.substring(7).trim();
            commandFound = true;
        } else if (lowerCaseText.startsWith('look up ')) {
            wordToDefine = responseText.substring(8).trim();
            commandFound = true;
        } else if (lowerCaseText.startsWith('what does "') && lowerCaseText.endsWith('" mean?')) {
            wordToDefine = responseText.substring(11, responseText.length - 7).trim();
            commandFound = true;
        }

        // Japanese-style commands (only trigger if user's native language is Japanese)
        else if (userNativeLanguage === 'ja') {
            if (lowerCaseText.endsWith(' 意味')) {
                wordToDefine = responseText.substring(0, responseText.length - 2).trim();
                commandFound = true;
            } else if (lowerCaseText.endsWith(' とは')) {
                wordToDefine = responseText.substring(0, responseText.length - 2).trim();
                commandFound = true;
            }
        }

        // Execute dictionary lookup if command was found
        if (commandFound) {
            if (wordToDefine.length === 0) {
                await client.chat.postMessage({
                    channel: userId,
                    text: "Please tell me what word you want to define. For example: `define industry` or `presentation 意味`"
                });
                return;
            }

            logger.info(`📖 User ${userId} (Native: ${userNativeLanguage}) requested dictionary definition for: "${wordToDefine}"`);

            const wordLang = detectLanguage(wordToDefine);

            if (wordLang !== 'en' && wordLang !== 'ja') {
                await client.chat.postMessage({
                    channel: userId,
                    text: `😕 Sorry, I can only define English or Japanese words. I couldn't understand "${wordToDefine}".`
                });
                return;
            }

            // Post a "thinking" message
            const thinkingMessage = await client.chat.postMessage({
                channel: userId,
                text: `One moment, searching for "${wordToDefine}"... 📖`
            });

            // Call the dictionary function
            const result = await generateDictionaryEntry(wordToDefine, wordLang, userNativeLanguage);

            // Delete the "thinking" message
            try {
                await client.chat.delete({
                    channel: userId,
                    ts: thinkingMessage.ts
                });
            } catch (e) {
                logger.warn("Couldn't delete 'thinking' message, but proceeding anyway.");
            }

            // Post the dictionary results
            await client.chat.postMessage({
                channel: userId,
                text: `📖 Definition for "${wordToDefine}"`,
                blocks: result.blocks
            });

            // Stop processing - this was a dictionary command, not a prompt response
            return;
        }
        // --- END OF DICTIONARY GATE ---

        const user = getOrCreateUser(userId, 'default');

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

        // Post anonymous response first (without button to get timestamp)
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

        // Update the message with reply button using real timestamp
        await client.chat.update({
            channel: channelId,
            ts: anonymousPost.ts,
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
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '💬 Reply Anonymously',
                                emoji: true
                            },
                            action_id: `reply_to_response_${anonymousPost.ts}`,
                            value: JSON.stringify({
                                originalPoster: pseudonym.handle,
                                originalText: responseText,
                                messageTs: anonymousPost.ts
                            })
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

// Manual test prompt command (for admins/testing)
app.command('/testprompt', async ({ command, ack, respond }) => {
    await ack();

    try {
        console.log(`🧪 /testprompt triggered by user ${command.user_id}`);

        await respond({
            response_type: 'ephemeral',
            text: '🚀 Triggering test prompt... Check the logs and channel!'
        });

        // Trigger the prompt posting
        await postPrompt();

        console.log('✅ /testprompt completed');
    } catch (error) {
        console.error('❌ Error in /testprompt:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ Error posting test prompt: ${error.message}`
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
        const requiredEnvVars = [
            'SLACK_BOT_TOKEN',
            'SLACK_SIGNING_SECRET',
            'SLACK_APP_TOKEN',
            'OPENAI_API_KEY',
            'MONGODB_URI'
        ];

        const missing = requiredEnvVars.filter(key => !process.env[key]);
        if (missing.length > 0) {
            console.error('❌ Missing required environment variables:', missing.join(', '));
            process.exit(1);
        }
        console.log('✅ All required environment variables present');

        console.log('🔄 Connecting to MongoDB...');
        await connectToDatabase();

        console.log('🔄 Loading data from database...');
        await loadDataFromDatabase(); // Load existing data from MongoDB

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
        console.log('🔗 MongoDB connection:', db ? 'Connected ✅' : 'In-memory mode ⚠️');
        console.log('🔌 Slack Socket Mode: Connected ✅');
        console.log('📅 Scheduled prompts: Mon/Wed/Fri at 9 AM, 2 PM, 6 PM');
        console.log('========================================\n');

        // Check if PROMPT_CHANNEL_ID is configured
        if (!process.env.PROMPT_CHANNEL_ID) {
            console.log('⚠️  PROMPT_CHANNEL_ID not configured in .env - prompts will not be posted');
        } else {
            console.log(`📢 Prompt channel configured: ${process.env.PROMPT_CHANNEL_ID}`);

            // Send connection confirmation to channel
            try {
                await app.client.chat.postMessage({
                    channel: process.env.PROMPT_CHANNEL_ID,
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
                    await postPrompt();
                    console.log('✅ Test prompt posting completed');
                } catch (error) {
                    console.error('❌ Test prompt failed:', error);
                }
            }, 5000); // Wait 5 seconds for Socket Mode to fully connect
        }

    } catch (error) {
        console.error('❌ Failed to start the app:', error);
    }
})();

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);
    connectionHealthy = false;

    try {
        // Close MongoDB connection
        if (client) {
            await client.close();
            console.log('✅ MongoDB connection closed');
        }

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