const { config } = require('../config');
const { points, pseudonyms, users, submissions } = require('../utils/userUtils');

/**
 * Handle /stats command
 */
async function handleStatsCommand(command, ack, respond) {
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
}

/**
 * Handle /leaderboard command
 */
async function handleLeaderboardCommand(command, ack, respond) {
    await ack();

    try {
        const topUsers = Array.from(points.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, config.app.leaderboardLimit)
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
}

/**
 * Handle /testprompt command (for admins/testing)
 */
async function handleTestPromptCommand(command, ack, respond, postPromptFunction) {
    await ack();

    try {
        console.log(`🧪 /testprompt triggered by user ${command.user_id}`);

        await respond({
            response_type: 'ephemeral',
            text: '🚀 Triggering test prompt... Check the logs and channel!'
        });

        // Trigger the prompt posting
        await postPromptFunction();

        console.log('✅ /testprompt completed');
    } catch (error) {
        console.error('❌ Error in /testprompt:', error);
        await respond({
            response_type: 'ephemeral',
            text: `❌ Error posting test prompt: ${error.message}`
        });
    }
}

module.exports = {
    handleStatsCommand,
    handleLeaderboardCommand,
    handleTestPromptCommand
};
