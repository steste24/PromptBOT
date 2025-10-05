const { App } = require('@slack/bolt');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
require('dotenv').config();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the Slack app with Socket Mode
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
});

// In-memory storage for development (replace with PostgreSQL later)
const users = new Map(); // slack_user_id -> user data
const pseudonyms = new Map(); // slack_user_id -> pseudonym data
const submissions = new Map(); // submission_id -> submission data
const points = new Map(); // slack_user_id -> total points
const promptThreads = new Map(); // message_ts -> prompt data

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
        users.set(userId, {
            id: userId,
            teamId: teamId,
            targetLanguage: null,
            createdAt: new Date()
        });

        pseudonyms.set(userId, {
            handle: pseudonym,
            emoji1: pseudonym.split(' ')[1][0],
            emoji2: pseudonym.split(' ')[1][1],
            cohortLabel: null
        });

        points.set(userId, 0);
    }
    return users.get(userId);
}

// Enhanced language detection
function detectLanguage(text) {
    // Simple heuristic - in production, use fastText or similar
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    const englishPattern = /^[a-zA-Z\s.,!?'"()-]+$/;

    if (japanesePattern.test(text)) {
        return 'ja';
    } else if (englishPattern.test(text.trim())) {
        return 'en';
    } else if (text.length > 50 && !japanesePattern.test(text)) {
        return 'en'; // Assume longer non-Japanese text is English
    }
    return 'unknown';
}

// AI Functions
async function generateAIPrompt() {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: `You are creating engaging prompts for intercultural language exchange between English and Japanese speakers. Create a bilingual prompt that:
1. Is culturally sensitive and interesting
2. Encourages personal sharing
3. Is appropriate for language learners
4. Avoids controversial topics
5. Has the same meaning in both languages
6. For Japanese text: Write each kanji followed immediately by its hiragana reading in parentheses (例: 日(に)本(ほん)語(ご), 食(た)べ物(もの))

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
        return response;
    } catch (error) {
        console.error('Error generating AI prompt:', error);
        // Fallback to predefined prompts
        return promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
    }
}

async function generateAIFeedback(text, targetLanguage, userLevel = 'beginner') {
    try {
        const systemPrompt = targetLanguage === 'ja'
            ? `You are a gentle Japanese language tutor helping an English speaker learn Japanese. Provide encouraging feedback in English about their Japanese writing. Focus on:
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
            model: "gpt-4",
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

// Periodic prompt posting
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

        // Send personalized prompts to all users based on their target language
        // Get all channel members and send DMs
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
                                        text: `📝 *How to respond:* Simply type your response here!`
                                    }
                                }
                            ]
                        });
                        console.log(`✅ Sent DM to user ${memberId}`);
                    }
                } catch (error) {
                    console.log(`❌ Error with user ${memberId}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error getting channel members:', error);
        }
            if (user.targetLanguage) {
                const personalizedPrompt = user.targetLanguage === 'ja'
                    ? prompt.ja  // Japanese learners see Japanese prompt
                    : prompt.en; // English learners see English prompt

                const languageFlag = user.targetLanguage === 'ja' ? '🇯🇵' : '🇺🇸';
                const languageName = user.targetLanguage === 'ja' ? 'Japanese' : 'English';

                try {
                    await app.client.chat.postMessage({
                        channel: userId,
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
                                    text: `*Topic:* ${prompt.category.replace('_', ' ').toUpperCase()}\n\n_Respond in ${languageName} to practice your target language!_`
                                }
                            },
                            {
                                type: 'actions',
                                elements: [
                                    {
                                        type: 'button',
                                        text: {
                                            type: 'plain_text',
                                            text: '� Submit Response'
                                        },
                                        action_id: 'open_submit_modal',
                                        style: 'primary'
                                    }
                                ]
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

// Event handlers

// Handle new member joining channel
app.event('member_joined_channel', async ({ event, client, logger }) => {
    try {
        const user = getOrCreateUser(event.user, event.team);

        // Send welcome DM
        await client.chat.postMessage({
            channel: event.user,
            text: `🌍 Welcome to PromptBot! You're ${pseudonyms.get(event.user).handle}`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '🌍 Welcome to PromptBot!'
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hello! I'm PromptBot, your AI-powered intercultural language learning companion. Here's how I work:\n\n• 🎭 *Anonymous participation* - You'll be known as *${pseudonyms.get(event.user).handle}*\n• 🌐 *Bilingual prompts* - Practice English ↔ Japanese with AI-generated topics\n• 🎯 *Gamified learning* - Earn points and see your progress\n• 📝 *AI feedback* - Get personalized grammar tips via DM\n• 🤝 *Peer learning* - Help others and get helped`
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*Privacy note:* Your messages are posted anonymously, but organization owners may be able to export messages. By participating, you consent to this.'
                    }
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'Choose Target Language'
                            },
                            action_id: 'choose_language',
                            style: 'primary'
                        }
                    ]
                }
            ]
        });

        logger.info(`Welcomed new user ${event.user} with pseudonym ${pseudonyms.get(event.user).handle}`);
    } catch (error) {
        logger.error('Error welcoming new user:', error);
    }
});

// Handle App Home opened
app.event('app_home_opened', async ({ event, client, logger }) => {
    try {
        const user = getOrCreateUser(event.user, event.team);
        const userPseudonym = pseudonyms.get(event.user);
        const userPoints = points.get(event.user) || 0;

        await client.views.publish({
            user_id: event.user,
            view: {
                type: 'home',
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '🏠 PromptBot Home'
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Your Identity:* ${userPseudonym.handle}\n*Points:* ${userPoints}\n*Target Language:* ${user.targetLanguage || 'Not set'}`
                        }
                    },
                    {
                        type: 'divider'
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*AI-Powered Features:*\n• 🤖 AI-generated prompts 3x per week\n• 📝 Personalized feedback on your writing\n• 🌍 Intercultural conversation starters'
                        }
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '� Check My DMs'
                                },
                                action_id: 'check_dms',
                                style: 'primary'
                            },
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '🎲 Generate Prompt'
                                },
                                action_id: 'generate_prompt_now'
                            },
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: '🏆 Leaderboard'
                                },
                                action_id: 'show_leaderboard'
                            }
                        ]
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*Settings:*'
                        }
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: user.targetLanguage ? `🌐 Change Language (${user.targetLanguage === 'ja' ? 'Japanese' : 'English'})` : '🌐 Set Target Language'
                                },
                                action_id: 'choose_language'
                            }
                        ]
                    }
                ]
            }
        });

        logger.info(`Published Home tab for user ${event.user}`);
    } catch (error) {
        logger.error('Error publishing Home tab:', error);
    }
});

// Handle DM messages for prompt responses
app.event('message', async ({ event, client, logger }) => {
    // Skip bot messages
    if (event.bot_id) return;

    // Handle DM responses to prompts
    if (event.channel_type === 'im') {
        try {
            const userId = event.user;
            const user = getOrCreateUser(userId, event.team || 'default');
            const text = event.text;

            if (!text || text.trim().length === 0) return;

            // Check if user has a target language set
            if (!user.targetLanguage) {
                await client.chat.postMessage({
                    channel: userId,
                    text: '❗ Please set your target language first! Use `/home` to access your settings.'
                });
                return;
            }

            // Check if there's a current prompt available
            if (!global.currentPrompt) {
                await client.chat.postMessage({
                    channel: userId,
                    text: '❗ No active prompt right now. Wait for the next prompt announcement!'
                });
                return;
            }

            // Detect language and validate it matches their target language
            const detectedLang = detectLanguage(text);
            let pointsAwarded = 2; // Base points for participation

            if (detectedLang === user.targetLanguage) {
                pointsAwarded = 5; // Bonus for correct target language
            } else if (detectedLang !== 'unknown') {
                pointsAwarded = 3; // Some points for any language practice
            }

            points.set(userId, (points.get(userId) || 0) + pointsAwarded);

            // Get user's pseudonym
            const userPseudonym = pseudonyms.get(userId);
            if (!userPseudonym) {
                await client.chat.postMessage({
                    channel: userId,
                    text: '❗ Error: No pseudonym found. Please contact admin.'
                });
                return;
            }

            // Post response anonymously to the channel
            const channelId = process.env.PROMPT_CHANNEL_ID;
            try {
                await client.chat.postMessage({
                    channel: channelId,
                    text: `${text}`,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `*${userPseudonym.handle}* (${userPseudonym.cohortLabel})\n\n${text}`
                            }
                        },
                        {
                            type: 'context',
                            elements: [
                                {
                                    type: 'mrkdwn',
                                    text: `Language: ${detectedLang === 'ja' ? 'Japanese 🇯🇵' : detectedLang === 'en' ? 'English 🇺🇸' : 'Mixed'} | React with ✅ to give kudos!`
                                }
                            ]
                        }
                    ]
                });

                // Confirm submission to user
                await client.chat.postMessage({
                    channel: userId,
                    text: `✅ Response posted anonymously in the channel!\n\n*Points awarded:* +${pointsAwarded}\n*Total points:* ${points.get(userId)}\n\n_Generating AI feedback..._`
                });

                // Generate AI feedback
                if (user.targetLanguage && detectedLang === user.targetLanguage) {
                    setTimeout(async () => {
                        try {
                            const feedback = await generateAIFeedback(text, user.targetLanguage);
                            await client.chat.postMessage({
                                channel: userId,
                                text: `🤖 *AI Feedback:*\n\n${feedback}`
                            });
                        } catch (error) {
                            console.error('Error generating AI feedback:', error);
                            await client.chat.postMessage({
                                channel: userId,
                                text: '❗ Sorry, there was an error generating your AI feedback. Please try again later.'
                            });
                        }
                    }, 2000);
                }

            } catch (error) {
                console.error('Error posting to channel:', error);
                await client.chat.postMessage({
                    channel: userId,
                    text: '❗ Sorry, there was an error posting your response. Please try again.'
                });
            }

        } catch (error) {
            logger.error('Error handling DM response:', error);
        }
        return;
    }

    // Handle thread messages for prompts (keep existing functionality)
    if (event.thread_ts && promptThreads.has(event.thread_ts)) {
        try {
            const userId = event.user;
            const user = getOrCreateUser(userId, event.team || 'default');
            const text = event.text;

            if (!text || text.trim().length === 0) return;

            // Detect language and award points
            const detectedLang = detectLanguage(text);
            let pointsAwarded = 1;

            if (detectedLang === user.targetLanguage) {
                pointsAwarded = 3; // Bonus for target language
            } else if (detectedLang !== 'unknown') {
                pointsAwarded = 2; // Practice in any language
            }

            points.set(userId, (points.get(userId) || 0) + pointsAwarded);

            // Generate AI feedback asynchronously
            if (user.targetLanguage && detectedLang === user.targetLanguage) {
                setTimeout(async () => {
                    try {
                        const feedback = await generateAIFeedback(text, user.targetLanguage);

                        await client.chat.postMessage({
                            channel: userId,
                            text: `🤖 AI Feedback: ${feedback}`,
                            blocks: [
                                {
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: `🤖 *AI Language Feedback*\n\n${feedback}`
                                    }
                                },
                                {
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: `*Your message:* "${text}"\n*Points earned:* +${pointsAwarded}`
                                    }
                                }
                            ]
                        });

                        logger.info(`Sent AI feedback to user ${userId}`);
                    } catch (error) {
                        logger.error('Error sending AI feedback:', error);
                    }
                }, 2000); // Small delay to not overwhelm
            }

            logger.info(`User ${userId} replied to prompt thread, awarded ${pointsAwarded} points`);
        } catch (error) {
            logger.error('Error handling thread message:', error);
        }
    }
});

// Handle language choice button
app.action('choose_language', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'language_selection',
                title: {
                    type: 'plain_text',
                    text: 'Choose Target Language'
                },
                submit: {
                    type: 'plain_text',
                    text: 'Save'
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
                            text: 'Which language would you like to practice? The AI will provide personalized feedback for your target language.'
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'target_language',
                        element: {
                            type: 'radio_buttons',
                            action_id: 'language_choice',
                            options: [
                                {
                                    text: {
                                        type: 'plain_text',
                                        text: '🇯🇵 Japanese (日(に)本(ほん)語(ご)を学(がく)習(しゅう)中(ちゅう))'
                                    },
                                    value: 'ja'
                                },
                                {
                                    text: {
                                        type: 'plain_text',
                                        text: '🇺🇸 English (Learning English)'
                                    },
                                    value: 'en'
                                }
                            ]
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Target Language'
                        }
                    }
                ]
            }
        });
    } catch (error) {
        logger.error('Error opening language selection modal:', error);
    }
});

// Handle prompt action buttons
app.action('prompt_submit_anonymous', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'submit_response',
                title: {
                    type: 'plain_text',
                    text: 'Submit Anonymous Response'
                },
                submit: {
                    type: 'plain_text',
                    text: 'Submit'
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
                            text: 'Write your response in your target language. The AI will provide feedback!'
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'response_text',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'response_input',
                            multiline: true,
                            placeholder: {
                                type: 'plain_text',
                                text: 'Type your response here...'
                            }
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Your Response'
                        }
                    }
                ]
            }
        });
    } catch (error) {
        logger.error('Error opening submit modal:', error);
    }
});

// Handle view home tab button
app.action('view_home_tab', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.views.publish({
            user_id: body.user.id,
            view: buildHomeView(body.user.id)
        });

        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: 'Home tab updated! Check your sidebar for your personalized prompt and settings. 🏠'
        });
    } catch (error) {
        logger.error('Error updating home tab:', error);
    }
});

app.action('prompt_reply_thread', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: 'Click "Reply in thread" on the prompt message above to start a conversation! The AI will give you feedback on your target language practice. 🤖'
        });
    } catch (error) {
        logger.error('Error posting ephemeral message:', error);
    }
});

// Handle check DMs button
app.action('check_dms', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.chat.postEphemeral({
            channel: body.channel?.id || body.user.id,
            user: body.user.id,
            text: '💬 Check your direct messages with me! If you have a target language set, I\'ll send you personalized prompts there. Simply respond to me in DMs and I\'ll post your response anonymously in the channel.'
        });
    } catch (error) {
        logger.error('Error handling check DMs:', error);
    }
});

app.action('generate_prompt_now', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await postPrompt();

        await client.chat.postEphemeral({
            channel: process.env.PROMPT_CHANNEL_ID,
            user: body.user.id,
            text: '🎲 Generated a new AI prompt! Check the channel for the latest conversation starter.'
        });
    } catch (error) {
        logger.error('Error generating prompt:', error);
    }
});

// Handle language selection submission
app.view('language_selection', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const teamId = body.team.id;
        const selectedLanguage = body.view.state.values.target_language.language_choice.selected_option.value;

        // Update user data
        const user = getOrCreateUser(userId, teamId);
        user.targetLanguage = selectedLanguage;

        // Update pseudonym cohort label
        const pseudonym = pseudonyms.get(userId);
        pseudonym.cohortLabel = selectedLanguage === 'ja' ? 'JP-learner' : 'EN-learner';

        // Send confirmation
        await client.chat.postMessage({
            channel: userId,
            text: `Great! You're now set to practice ${selectedLanguage === 'ja' ? 'Japanese 🇯🇵' : 'English 🇺🇸'}. Your anonymous identity is *${pseudonym.handle}* (${pseudonym.cohortLabel}). The AI will provide personalized feedback when you practice your target language!`
        });

        logger.info(`User ${userId} selected target language: ${selectedLanguage}`);
    } catch (error) {
        logger.error('Error handling language selection:', error);
    }
});

// Slash command: /submit
app.command('/submit', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'submit_response',
                title: {
                    type: 'plain_text',
                    text: 'Submit Response'
                },
                submit: {
                    type: 'plain_text',
                    text: 'Submit'
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
                            text: 'Write your response in your target language. The AI will detect the language and give you personalized feedback!'
                        }
                    },
                    {
                        type: 'input',
                        block_id: 'response_text',
                        element: {
                            type: 'plain_text_input',
                            action_id: 'response_input',
                            multiline: true,
                            placeholder: {
                                type: 'plain_text',
                                text: 'Type your response here...'
                            }
                        },
                        label: {
                            type: 'plain_text',
                            text: 'Your Response'
                        }
                    }
                ]
            }
        });
    } catch (error) {
        logger.error('Error opening submit modal:', error);
    }
});

// Handle response submission
app.view('submit_response', async ({ ack, body, client, logger }) => {
    await ack();

    try {
        const userId = body.user.id;
        const teamId = body.team.id;
        const responseText = body.view.state.values.response_text.response_input.value;

        if (!responseText || responseText.trim().length === 0) {
            return;
        }

        const user = getOrCreateUser(userId, teamId);
        const pseudonym = pseudonyms.get(userId);

        // Enhanced language detection
        const detectedLang = detectLanguage(responseText);

        // Award points based on language match
        let pointsAwarded = 1; // base points
        if (detectedLang === user.targetLanguage) {
            pointsAwarded = 3; // target language bonus
        } else if (detectedLang !== 'unknown') {
            pointsAwarded = 2; // any detected language
        }

        points.set(userId, (points.get(userId) || 0) + pointsAwarded);

        // Store submission
        const submissionId = uuidv4();
        submissions.set(submissionId, {
            id: submissionId,
            userId: userId,
            text: responseText,
            detectedLang: detectedLang,
            pointsAwarded: pointsAwarded,
            createdAt: new Date()
        });

        // Send confirmation DM
        await client.chat.postMessage({
            channel: userId,
            text: `✅ Response submitted! +${pointsAwarded} points. Total: ${points.get(userId)}`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `✅ *Response submitted!*\n\n*Detected language:* ${detectedLang === 'ja' ? 'Japanese 🇯🇵' : detectedLang === 'en' ? 'English 🇺🇸' : 'Unknown'}\n*Points awarded:* +${pointsAwarded}\n*Total points:* ${points.get(userId)}`
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `I'll post your response anonymously as *${pseudonym.handle}* and the AI will provide feedback!`
                    }
                }
            ]
        });

        // Post anonymously to the channel
        const channelId = process.env.PROMPT_CHANNEL_ID || body.view.root_view_id;

        try {
            await client.chat.postMessage({
                channel: channelId,
                text: `${pseudonym.handle}: ${responseText}`,
                username: pseudonym.handle,
                icon_emoji: ':robot_face:',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*${pseudonym.handle}* (${pseudonym.cohortLabel || 'learner'}):`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: responseText
                        }
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: `Language: ${detectedLang === 'ja' ? 'Japanese 🇯🇵' : detectedLang === 'en' ? 'English 🇺🇸' : 'Mixed'} | React with ✅ to give kudos!`
                            }
                        ]
                    }
                ]
            });
        } catch (channelError) {
            logger.warn('Could not post to channel, but submission was recorded:', channelError);
        }

        // Generate AI feedback if target language detected
        console.log(`DEBUG: User ${userId} - Target: ${user.targetLanguage}, Detected: ${detectedLang}`);
        if (user.targetLanguage && detectedLang === user.targetLanguage) {
            console.log(`DEBUG: AI feedback triggered for user ${userId}`);
            setTimeout(async () => {
                try {
                    console.log(`DEBUG: Generating AI feedback for: "${responseText}"`);
                    const feedback = await generateAIFeedback(responseText, user.targetLanguage);
                    console.log(`DEBUG: AI feedback generated: "${feedback}"`);

                    await client.chat.postMessage({
                        channel: userId,
                        text: `🤖 AI Feedback: ${feedback}`,
                        blocks: [
                            {
                                type: 'section',
                                text: {
                                    type: 'mrkdwn',
                                    text: `🤖 *Personalized AI Feedback*\n\n${feedback}`
                                }
                            },
                            {
                                type: 'context',
                                elements: [
                                    {
                                        type: 'mrkdwn',
                                        text: `Analyzing your ${user.targetLanguage === 'ja' ? 'Japanese' : 'English'} writing...`
                                    }
                                ]
                            }
                        ]
                    });

                    logger.info(`Sent AI feedback to user ${userId}`);
                } catch (error) {
                    logger.error('Error sending AI feedback:', error);
                }
            }, 3000); // 3 second delay
        } else {
            console.log(`DEBUG: AI feedback NOT triggered - Target: ${user.targetLanguage}, Detected: ${detectedLang}`);
        }

        logger.info(`User ${userId} submitted response, awarded ${pointsAwarded} points`);
    } catch (error) {
        logger.error('Error handling response submission:', error);
    }
});

// Handle reaction events for awarding kudos points
app.event('reaction_added', async ({ event, client, logger }) => {
    try {
        // Only award points for specific reactions
        if (!['white_check_mark', 'star', 'star2', 'clap'].includes(event.reaction)) {
            return;
        }

        const reactorId = event.user;
        const currentPoints = points.get(reactorId) || 0;

        // Award 1 kudos point (with weekly cap - simplified for now)
        points.set(reactorId, currentPoints + 1);

        logger.info(`User ${reactorId} gave kudos, awarded 1 point`);
    } catch (error) {
        logger.error('Error handling reaction:', error);
    }
});

// Schedule AI-generated prompts
const schedulePattern = process.env.PROMPT_SCHEDULE || '0 9,14,18 * * 1,3,5';
cron.schedule(schedulePattern, postPrompt);

// Manual prompt generation for testing
cron.schedule('*/30 * * * *', () => {
    console.log('Prompt scheduler is running... (every 30 minutes for testing)');
    // Uncomment the line below to post prompts every 30 minutes for testing
    // postPrompt();
});

// Schedule weekly leaderboard (every Sunday at 11 PM)
cron.schedule('0 23 * * 0', async () => {
    console.log('Publishing weekly leaderboard...');

    try {
        const sortedUsers = Array.from(points.entries())
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);

        const leaderboardBlocks = [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '🏆 Weekly AI-Powered Language Learning Leaderboard'
                }
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: 'Top intercultural language learners this week:'
                }
            }
        ];

        sortedUsers.forEach(([userId, userPoints], index) => {
            const pseudonym = pseudonyms.get(userId);
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;

            leaderboardBlocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${medal} *${pseudonym?.handle || 'Anonymous'}* - ${userPoints} points`
                }
            });
        });

        const channelId = process.env.PROMPT_CHANNEL_ID;
        if (channelId) {
            await app.client.chat.postMessage({
                channel: channelId,
                text: '🏆 Weekly Leaderboard',
                blocks: leaderboardBlocks
            });
        }

        console.log('Weekly leaderboard published');
    } catch (error) {
        console.error('Error publishing leaderboard:', error);
    }
});

// Error handling
app.error(async (error) => {
    console.error('App error:', error);
});

// Start the app
(async () => {
    try {
        await app.start(process.env.PORT || 3000);
        console.log('⚡️ AI-Powered Intercultural PromptBot is running!');
        console.log('Features enabled:');
        console.log('  ✅ Socket Mode connection');
        console.log('  ✅ Anonymous pseudonyms');
        console.log('  ✅ Language selection');
        console.log('  ✅ Submission modal');
        console.log('  ✅ Points system');
        console.log('  ✅ Home tab');
        console.log('  ✅ Weekly leaderboard');
        console.log('  ✅ Kudos reactions');
        console.log('  🤖 AI-generated prompts');
        console.log('  🤖 AI-powered feedback');
        console.log('  🤖 Thread conversation support');
        console.log('  📅 Scheduled prompts:', schedulePattern);

        // Post a startup prompt for testing
        if (process.env.PROMPT_CHANNEL_ID) {
            setTimeout(postPrompt, 5000); // Wait 5 seconds then post initial prompt
        }
    } catch (error) {
        console.error('Failed to start app:', error);
    }
})();