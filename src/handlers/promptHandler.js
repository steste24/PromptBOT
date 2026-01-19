const { config } = require('../config');
const { generateAIPrompt } = require('../services/aiService');
const {
    users,
    pseudonyms,
    promptThreads,
    userPromptMessages,
    getOrCreateUser
} = require('../utils/userUtils');

/**
 * Post prompt to channel and send personalized DMs to users
 */
async function postPrompt(app) {
    const channelId = config.slack.promptChannelId;
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

// Prepare the dynamic category name for reuse
const categoryName = prompt.category.replace('_', ' ').toUpperCase();

const result = await app.client.chat.postMessage({
    channel: channelId,
    // Bilingual fallback text for push notifications
    text: `🚨 <!everyone> New Prompt Alert! / 新しいプロンプト通知: ${categoryName}`,
    blocks: [
        // --- HEADER (Bilingual) ---
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '🚨 New Prompt Alert! / 新しいプロンプト通知'
            }
        },
        
        // --- ENGLISH SECTION ---
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `<!everyone> 📱 **Check your DMs now!**\n\n*Today's Topic:* ${categoryName}\n\n• Your personalized prompt is waiting in your DMs\n• Respond directly to me in DMs\n• I'll post your response here anonymously`
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '🎯 *How it works:*\n1️⃣ Read your prompt in DMs\n2️⃣ Reply to me directly in DMs\n3️⃣ I post your response anonymously in this channel\n4️⃣ Get AI feedback in your DMs'
            }
        },

        // --- VISUAL DIVIDER ---
        {
            type: 'divider'
        },

        // --- JAPANESE SECTION ---
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `<!everyone> 📱 **今すぐDMを確認してください！**\n\n*今日のトピック:* ${categoryName}\n\n• あなた専用のプロンプトがDMに届いています\n• DMで直接ボットに返信してください\n• 回答は匿名でこのチャンネルに投稿されます`
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '🎯 *使い方:*\n1️⃣ DMでプロンプトを確認する\n2️⃣ DMで直接返信する\n3️⃣ 回答が匿名でチャンネルに共有されます\n4️⃣ DMでAIのフィードバックを受け取る'
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
        await sendPromptsToDMs(app, channelId, prompt);

        console.log(`✅ Prompt posting finished: ${prompt.category} at ${result.ts}`);
    } catch (error) {
        console.error('❌ Error in postPrompt():', error);
        console.error('Stack trace:', error.stack);
    }
}

/**
 * Send personalized prompts to channel members via DM
 */
async function sendPromptsToDMs(app, channelId, prompt) {
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
}

module.exports = {
    postPrompt,
    sendPromptsToDMs
};
