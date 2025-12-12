const { MongoClient } = require('mongodb');
const { config } = require('../config');

let db;
let client;

/**
 * Connect to MongoDB with retry logic
 */
async function connectToDatabase() {
    let retries = 3;

    client = new MongoClient(config.mongodb.uri, config.mongodb.options);

    while (retries > 0) {
        try {
            await client.connect();
            db = client.db(config.mongodb.dbName);
            console.log('✅ Connected to MongoDB Atlas');
            return db;
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

/**
 * Get MongoDB collections
 */
function getCollections() {
    if (!db) return null;

    return {
        users: db.collection('users'),
        pseudonyms: db.collection('pseudonyms'),
        submissions: db.collection('submissions'),
        points: db.collection('points'),
        prompts: db.collection('prompts')
    };
}

/**
 * Sync user data to MongoDB
 */
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

/**
 * Sync pseudonym data to MongoDB
 */
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

/**
 * Sync points data to MongoDB
 */
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

/**
 * Sync submission to MongoDB
 */
async function syncSubmissionToDatabase(submissionData) {
    try {
        const collections = getCollections();
        if (!collections) return;

        await collections.submissions.insertOne({
            ...submissionData,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Error syncing submission to database:', error);
    }
}

/**
 * Save AI-generated prompt to MongoDB
 */
async function savePromptToDatabase(promptData) {
    try {
        const collections = getCollections();
        if (!collections) return;

        await collections.prompts.insertOne({
            ...promptData,
            createdAt: new Date(),
            isAIGenerated: true
        });
    } catch (error) {
        console.error('Error saving prompt to database:', error);
    }
}

/**
 * Load existing data from MongoDB on startup
 */
async function loadDataFromDatabase(users, pseudonyms, points) {
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

/**
 * Close MongoDB connection
 */
async function closeDatabaseConnection() {
    if (client) {
        await client.close();
        console.log('✅ MongoDB connection closed');
    }
}

module.exports = {
    connectToDatabase,
    getCollections,
    syncUserToDatabase,
    syncPseudonymToDatabase,
    syncPointsToDatabase,
    syncSubmissionToDatabase,
    savePromptToDatabase,
    loadDataFromDatabase,
    closeDatabaseConnection,
    getDatabase: () => db
};
