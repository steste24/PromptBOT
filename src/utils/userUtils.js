const { config } = require('../config');
const {
    syncUserToDatabase,
    syncPseudonymToDatabase,
    syncPointsToDatabase
} = require('../database');

// In-memory storage
const users = new Map();
const pseudonyms = new Map();
const points = new Map();
const submissions = new Map();
const promptThreads = new Map();
const userPromptMessages = new Map();
const userFeedbackMessages = new Map();

/**
 * Generate a random pseudonym for anonymous interaction
 */
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

/**
 * Get or create a user with pseudonym
 */
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

        points.set(userId, config.app.defaultPoints);

        // Sync to MongoDB
        syncUserToDatabase(userId, userData);
        syncPseudonymToDatabase(userId, pseudonymData);
        syncPointsToDatabase(userId, config.app.defaultPoints);
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
        points.set(userId, config.app.defaultPoints);
        syncPointsToDatabase(userId, config.app.defaultPoints);
    }

    return users.get(userId);
}

/**
 * Award points to a user
 */
async function awardPoints(userId, pointsToAdd = 1) {
    const currentPoints = points.get(userId) || 0;
    const newPoints = currentPoints + pointsToAdd;
    points.set(userId, newPoints);
    await syncPointsToDatabase(userId, newPoints);
    return newPoints;
}

module.exports = {
    // Storage maps
    users,
    pseudonyms,
    points,
    submissions,
    promptThreads,
    userPromptMessages,
    userFeedbackMessages,

    // Functions
    generatePseudonym,
    getOrCreateUser,
    awardPoints
};
