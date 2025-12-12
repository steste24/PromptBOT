const { config } = require('../config');
const { syncUserToDatabase } = require('../database');
const { generateAIPrompt } = require('../services/aiService');
const {
    users,
    pseudonyms,
    points,
    userPromptMessages,
    getOrCreateUser,
    generatePseudonym
} = require('../utils/userUtils');

/**
 * Refresh the Home tab view for a user
 */
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

/**
 * Handle app home opened event
 */
async function handleAppHomeOpened(event, client) {
    await refreshHomeTab(event.user, client);
}

/**
 * Handle target language selection - Japanese
 */
async function handleSetLanguageJapanese(ack, body, client) {
    await ack();

    try {
        const userId = body.user.id;
        const selectedLanguage = 'ja';

        const user = getOrCreateUser(userId, body.team.id);
        user.targetLanguage = selectedLanguage;
        users.set(userId, user);

        await syncUserToDatabase(userId, user);

        await client.chat.postMessage({
            channel: userId,
            text: `🎯 Target language set to 🇯🇵 Japanese! You'll receive prompts in this language.`
        });

        await refreshHomeTab(userId, client);
    } catch (error) {
        console.error('Error setting language to Japanese:', error);
    }
}

/**
 * Handle target language selection - English
 */
async function handleSetLanguageEnglish(ack, body, client) {
    await ack();

    try {
        const userId = body.user.id;
        const selectedLanguage = 'en';

        const user = getOrCreateUser(userId, body.team.id);
        user.targetLanguage = selectedLanguage;
        users.set(userId, user);

        await syncUserToDatabase(userId, user);

        await client.chat.postMessage({
            channel: userId,
            text: `🎯 Target language set to 🇺🇸 English! You'll receive prompts in this language.`
        });

        await refreshHomeTab(userId, client);
    } catch (error) {
        console.error('Error setting language to English:', error);
    }
}

/**
 * Handle generate test prompt button
 * Generates ONE prompt and sends it to ALL channel members in their target language
 */
async function handleGenerateTestPrompt(ack, body, client) {
    await ack();

    try {
        const userId = body.user.id;
        const channelId = config.slack.promptChannelId;

        if (!channelId) {
            await client.chat.postMessage({
                channel: userId,
                text: "❌ No prompt channel configured. Please contact an admin."
            });
            return;
        }

        // Generate ONE prompt
        const prompt = await generateAIPrompt();
        console.log(`🧪 Test prompt generated by ${userId} - Category: ${prompt.category}`);

        // Get channel members
        const channelMembers = await client.conversations.members({
            channel: channelId
        });

        let sentCount = 0;

        // Send to ALL channel members in their target language
        for (const memberId of channelMembers.members) {
            try {
                const userInfo = await client.users.info({ user: memberId });
                if (userInfo.user.is_bot) continue;

                const user = getOrCreateUser(memberId, 'default');

                if (user.targetLanguage) {
                    const personalizedPrompt = user.targetLanguage === 'ja' ? prompt.ja : prompt.en;
                    const languageFlag = user.targetLanguage === 'ja' ? '🇯🇵' : '🇺🇸';
                    const languageName = user.targetLanguage === 'ja' ? 'Japanese' : 'English';

                    const promptMessage = await client.chat.postMessage({
                        channel: memberId,
                        text: `🧪 Test ${languageName} Prompt!`,
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

                    sentCount++;
                    console.log(`  ✅ Sent to ${memberId} (${languageName})`);
                }
            } catch (memberError) {
                console.error(`  ⚠️ Failed to send to ${memberId}:`, memberError.message);
            }
        }

        // Confirm to the admin who triggered it
        await client.chat.postMessage({
            channel: userId,
            text: `✅ Test prompt sent to ${sentCount} users!\n\n*Category:* ${prompt.category}\n*EN:* ${prompt.en}\n*JA:* ${prompt.ja}`
        });

        console.log(`✅ Test prompt sent to ${sentCount} users`);
    } catch (error) {
        console.error('Error generating test prompt:', error);
        await client.chat.postMessage({
            channel: body.user.id,
            text: "❌ Sorry, there was an error generating a test prompt. Please try again later."
        });
    }
}

module.exports = {
    refreshHomeTab,
    handleAppHomeOpened,
    handleSetLanguageJapanese,
    handleSetLanguageEnglish,
    handleGenerateTestPrompt
};
