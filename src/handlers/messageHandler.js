/**
 * MESSAGE HANDLER MODULE
 *
 * This module handles all direct messages (DMs) sent to the bot.
 * It distinguishes between two types of user input:
 *
 * 1. DICTIONARY COMMANDS - User wants to look up a word definition
 *    Detection patterns:
 *    - English-style: "define [word]", "look up [word]", "what does [word] mean?"
 *    - Japanese-style: "[word] 意味", "[word] とは" (works for all users)
 *
 *    When detected: checkDictionaryCommand() processes the request and returns true.
 *    This prevents the message from being treated as a prompt response.
 *
 * 2. PROMPT RESPONSES - User is responding to a language learning prompt
 *    When dictionary command is NOT detected: processPromptResponse() handles it.
 *    This includes:
 *    - Language validation (must match user's target language)
 *    - Anti-cheating checks (detects if user wrote in wrong language)
 *    - Anonymous posting to the channel
 *    - AI feedback generation
 *    - Points awarding
 *
 * FLOW:
 * handleDirectMessage() → checkDictionaryCommand() → if true: return (dictionary handled)
 *                                                   → if false: processPromptResponse()
 */

const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');
const { generateAIFeedback } = require('../services/aiService');
const { generateDictionaryEntry } = require('../services/dictionaryService');
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

/**
 * Handle direct messages from users
 */
async function handleDirectMessage(message, client, logger) {
    try {
        // Only handle DMs (not channel messages)
        if (message.channel_type !== 'im') return;
        if (message.user === config.slack.botUserId) return;

        const userId = message.user;
        const responseText = message.text;

        if (!responseText || responseText.trim().length === 0) return;

        // Get user profile
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

        // Check if message is a dictionary command
        const dictionaryResult = await checkDictionaryCommand(responseText, userNativeLanguage, userId, client, logger);
        if (dictionaryResult) return; // Dictionary command was processed

        // Process as normal prompt response
        await processPromptResponse(userId, responseText, client);

    } catch (error) {
        console.error('Error handling DM response:', error);
        await client.chat.postMessage({
            channel: message.user,
            text: "❌ Sorry, there was an error processing your response. Please try again."
        });
    }
}

/**
 * Check if message is a dictionary command and process it
 */
async function checkDictionaryCommand(responseText, userNativeLanguage, userId, client, logger) {
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
    // Japanese-style commands (work for all users)
    else if (lowerCaseText.endsWith(' 意味')) {
        wordToDefine = responseText.substring(0, responseText.length - 2).trim();
        commandFound = true;
    } else if (lowerCaseText.endsWith(' とは')) {
        wordToDefine = responseText.substring(0, responseText.length - 2).trim();
        commandFound = true;
    }

    if (!commandFound) return false;

    if (wordToDefine.length === 0) {
        await client.chat.postMessage({
            channel: userId,
            text: "Please tell me what word you want to define. For example: `define industry` or `presentation 意味`"
        });
        return true;
    }

    logger.info(`📖 User ${userId} (Native: ${userNativeLanguage}) requested dictionary definition for: "${wordToDefine}"`);

    const wordLang = detectLanguage(wordToDefine);

    if (wordLang !== 'en' && wordLang !== 'ja') {
        await client.chat.postMessage({
            channel: userId,
            text: `😕 Sorry, I can only define English or Japanese words. I couldn't understand "${wordToDefine}".`
        });
        return true;
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

    return true;
}

/**
 * Process user's prompt response
 */
async function processPromptResponse(userId, responseText, client) {
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
    const channelId = config.slack.promptChannelId;

    if (!channelId) {
        await client.chat.postMessage({
            channel: userId,
            text: "❌ No prompt channel configured. Please contact an admin."
        });
        return;
    }

    // Post anonymous response
    const anonymousPost = await postAnonymousResponse(client, channelId, pseudonym, responseText, expectedLanguage);

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
    await awardPoints(userId, config.app.pointsPerResponse);

    // Store submission for analytics
    const submissionId = uuidv4();
    const submissionData = {
        submissionId: submissionId,
        userId: userId,
        pseudonym: pseudonym.handle,
        text: responseText,
        language: detectedLanguage,
        targetLanguage: expectedLanguage,
        timestamp: new Date(),
        feedback: feedback,
        channelPostTs: anonymousPost.ts
    };

    submissions.set(submissionId, submissionData);
    await syncSubmissionToDatabase(submissionData);

    console.log(`✅ Processed valid response from ${userId} (${pseudonym.handle})`);
}

/**
 * Post anonymous response to channel with reply button
 */
async function postAnonymousResponse(client, channelId, pseudonym, responseText, expectedLanguage) {
    // Post anonymous response first
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

    return anonymousPost;
}

module.exports = {
    handleDirectMessage
};
