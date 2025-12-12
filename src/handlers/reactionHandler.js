const { generateDetailedJapaneseReading, generateDetailedCorrection } = require('../services/aiService');
const { users, userPromptMessages, userFeedbackMessages } = require('../utils/userUtils');

/**
 * Handle emoji reactions (for reading help and detailed feedback)
 */
async function handleReactionAdded(event, client) {
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
            await handlePromptReactionHelp(userId, promptData, client);
            return;
        }

        // Check if this is a feedback message
        const feedbackData = userFeedbackMessages.get(userId);
        if (feedbackData && feedbackData.messageTs === messageTs) {
            await handleFeedbackReactionHelp(userId, feedbackData, client);
            return;
        }

        // If we get here, the message isn't tracked
        console.log(`❓ Reaction on untracked message from ${userId}`);

    } catch (error) {
        console.error('Error handling reaction:', error);
    }
}

/**
 * Handle reaction help for prompt messages (Japanese reading help)
 */
async function handlePromptReactionHelp(userId, promptData, client) {
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
}

/**
 * Handle reaction help for feedback messages (detailed corrections)
 */
async function handleFeedbackReactionHelp(userId, feedbackData, client) {
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
}

module.exports = {
    handleReactionAdded
};
