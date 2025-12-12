const { config } = require('../config');
const { generateAIFeedback } = require('../services/aiService');
const { detectLanguage } = require('../utils/languageUtils');
const { syncSubmissionToDatabase } = require('../database');
const {
    users,
    pseudonyms,
    submissions,
    userFeedbackMessages,
    getOrCreateUser,
    awardPoints
} = require('../utils/userUtils');
const { v4: uuidv4 } = require('uuid');

/**
 * Handle reply to response button click
 */
async function handleReplyToResponse(ack, body, client) {
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
        console.error('Error opening reply modal:', error);
    }
}

/**
 * Handle reply modal submission
 */
async function handleReplyModalSubmission(ack, body, view, client) {
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
        await awardPoints(userId, config.app.pointsPerResponse);

        console.log(`✅ Reply posted by ${userId} (${pseudonym.handle})`);
    } catch (error) {
        console.error('Error handling reply submission:', error);
        await client.chat.postMessage({
            channel: body.user.id,
            text: "❌ Sorry, there was an error posting your reply. Please try again."
        });
    }
}

module.exports = {
    handleReplyToResponse,
    handleReplyModalSubmission
};
