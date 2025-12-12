const OpenAI = require('openai');
const { config } = require('../config');
const { savePromptToDatabase } = require('../database');
const { promptTemplates } = require('../models/prompts');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});

// Track recent prompts to avoid repetition
const recentPrompts = [];
const MAX_RECENT_PROMPTS = 10;

// Define all available categories for rotation
const ALL_CATEGORIES = [
    'daily_life',
    'opinions_and_preferences',
    'culture_and_traditions',
    'storytelling_and_memories',
    'imagination_and_what_if',
    'collaboration_and_teamwork',
    'fun_and_random',
    'hobbies_and_interests',
    'travel_and_places',
    'future_and_goals'
];

/**
 * Get a random category that hasn't been used recently
 */
function getRandomUnusedCategory() {
    // Get categories used in last 5 prompts
    const recentCategories = recentPrompts.slice(-5).map(p => p.category);

    // Filter out recently used categories
    const availableCategories = ALL_CATEGORIES.filter(cat => !recentCategories.includes(cat));

    // If all categories have been used recently, use all categories
    const categoriesToChooseFrom = availableCategories.length > 0 ? availableCategories : ALL_CATEGORIES;

    // Return random category
    return categoriesToChooseFrom[Math.floor(Math.random() * categoriesToChooseFrom.length)];
}

/**
 * Generate AI-powered prompt for language learning
 */
async function generateAIPrompt() {
    try {
        // Get a fresh category to use
        const targetCategory = getRandomUnusedCategory();

        // Build list of recent topics to avoid (both languages)
        const recentTopicsList = recentPrompts.slice(-5).map(p => `EN: "${p.en}" / JA: "${p.ja}"`);
        const recentTopics = recentTopicsList.join('\n');
        const avoidanceNote = recentTopics
            ? `\n\nIMPORTANT: DO NOT generate prompts about these recent topics:\n${recentTopics}\nMake sure your prompt is completely different from these in BOTH languages.`
            : '';

        const completion = await openai.chat.completions.create({
            model: config.openai.model,
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
7. Prompts should use everyday vocabulary across DIVERSE topics (study, hobbies, dreams, travel, technology, seasons, entertainment, sports, art, music, nature, childhood, friends, learning, etc.)
8. Each prompt should be one or two sentences maximum (preferably under 20 words as per the English language equivalent)
9. CRITICAL: Vary the topics significantly - avoid repeating similar themes (meals, breakfast, food, cooking) multiple times

Available categories (use diverse range):
- daily_life (routines, school, commute, weekend activities - NOT just food)
- opinions_and_preferences (favorites, choices, comparisons)
- culture_and_traditions (holidays, customs, habits, celebrations)
- storytelling_and_memories (funny mistakes, childhood, best experiences)
- imagination_and_what_if (dreams, future, fantasy scenarios, superpowers)
- collaboration_and_teamwork (design together, group preferences, ideal scenarios)
- fun_and_random (animals, seasons, weather, "would you rather", quirky questions)
- hobbies_and_interests (sports, music, art, reading, gaming, crafts)
- travel_and_places (dream destinations, local spots, geography)
- future_and_goals (aspirations, career, learning, self-improvement)${avoidanceNote}

Format your response as JSON:
{
  "category": "${targetCategory}",
  "en": "English prompt here",
  "ja": "Japanese prompt here in pure Japanese without readings"
}`
                },
                {
                    role: "user",
                    content: `Generate a new intercultural language learning prompt in the "${targetCategory}" category. Make it creative and different from typical prompts.`
                }
            ],
            temperature: 1.0,
            max_tokens: 300
        });

        // Strip markdown code blocks if present
        let content = completion.choices[0].message.content;
        content = content.replace(/```json\n?|\n?```/g, '').trim();

        const response = JSON.parse(content);

        // Track this prompt to avoid repetition
        recentPrompts.push({
            category: response.category,
            en: response.en,
            ja: response.ja,
            timestamp: Date.now()
        });

        // Keep only last MAX_RECENT_PROMPTS entries
        if (recentPrompts.length > MAX_RECENT_PROMPTS) {
            recentPrompts.shift();
        }

        console.log(`✅ Generated prompt - Category: ${response.category}`);
        console.log(`📊 Recent categories: ${recentPrompts.map(p => p.category).join(', ')}`);

        // Save prompt to MongoDB
        await savePromptToDatabase(response);

        return response;
    } catch (error) {
        console.error('Error generating AI prompt:', error);
        return promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
    }
}

/**
 * Generate AI feedback for user's language learning response
 */
async function generateAIFeedback(text, targetLanguage, userLevel = 'beginner') {
    try {
        const systemPrompt = targetLanguage === 'ja'
            ? `You are a gentle Japanese language tutor helping an English speaker learn Japanese. The output corrections must always follow these rules:

1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion.

2. For the original sentence: show the learner's original text. 
   * Mark specific errors with a 🔴 directly before the incorrect word or kanji.
   * **CRITICAL EXCEPTION:** If the sentence structure is completely broken (e.g., direct translation from English with wrong word order), place a single 🔴 at the start of the whole phrase. Do not try to mark individual words if the whole logic is backwards.
   * Do NOT correct missing punctuation (periods/commas).

3. For the corrected sentence: rewrite the sentence with errors fixed. Mark each corrected word and grammar structure with 🟢 directly before it.
   * Do NOT add hiragana/furigana readings. Keep the text natural.

4. For Error Explanations: list each mistake on a new line.
   * Format: 「wrong」 → 「correct」 (short reason in English).
   * **For Structural Errors:** Instead of single words, show the full phrase change: 「[Original Phrase]」 → 「[Correct Natural Phrase]」. Explain the logic change (e.g., "Japanese uses Modifier + Noun structure here").
   * Example reasons: "Incorrect particle," "Subject usually omitted," "Verb must come last."

5. For the motivational note: always include one differing ✨ motivational sentence (short praise).

6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in Japanese.
   * Underneath, provide the English translation in parentheses.
   * The expansion must use the **corrected grammar structure** from the lesson to reinforce the fix.

7. Context Awareness: If the user types the wrong kanji based on the conversation context (phonetic typing errors), correct the kanji choice.

8. Formatting: Use line breaks \\n to separate sections cleanly. Use emojis (🔴🟢✨👉) exactly as shown. Keep messages concise.

Here is the exact example breakdown of the correction format:

Original:
隠すとカウントするとても 🔴楽しな 🔴ゲム です

Corrected:
隠すとカウントするとても 🟢楽しい 🟢ゲーム です

「楽しな」 → 「楽しい」 (i-adjective conjugation error)
「ゲム」 → 「ゲーム」 (Katakana long vowel missing)

✨ Great attempt! You conveyed the meaning well.
👉 「一人が数えている間に、ほかの人たちが隠れて、見つかるまで待つゲームです。とても楽しいゲームです！」
(It's a game where one person counts while the others hide and wait until they're found. It's a super fun game!)`

            : `You are a gentle English language tutor helping a Japanese speaker learn English. The output corrections must always follow these rules:

1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion.

2. For the original sentence: show the learner's original text. Mark errors with a 🔴 directly before the incorrect word.
   * **CRITICAL:** Do NOT correct missing periods or conversational punctuation unless it destroys the meaning.

3. For the corrected sentence: rewrite the sentence with all errors fixed. Mark each corrected word with a 🟢 directly before it.

4. For Error Explanations: list each mistake on a new line.
   * Format: 「wrong」 → 「correct」 (short reason).
   * **Language:** Explanations must be short, clear, and written in **Fluent N1 Level Japanese**.
   * Focus on: Articles (a/the), pluralization, preposition nuances, and natural phrasing.

5. For the motivational note: always include one differing ✨ motivational sentence (short praise) in fluent N1 level Japanese.

6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in English.
   * Underneath, provide the Japanese translation in parentheses.
   * Expansion must be natural, descriptive, and connected to the learner's attempt.

7. Formatting: Use line breaks \n to separate sections cleanly. Use emojis (🔴🟢✨👉) exactly as shown. Keep messages concise for Slack.

Here is the exact example breakdown of the correction format:

原文:
We 🔴playing 🔴run game, we 🔴run many time 🔴about tree, 🔴very fast pace

修正文:
We 🟢played 🟢a running game. We 🟢ran many times 🟢around the tree 🟢at a very fast pace

「playing」 → 「played」 (動詞の時制の不一致)
「run game」 → 「a running game」 (冠詞と名詞の形)
「run many time」 → 「ran many times」 (複数形のs不足)
「about tree」 → 「around the tree」 (前置詞の使い分け-aboutは「について」、aroundは「周り」)
「very fast pace」 → 「at a very fast pace」 (前置詞「at」の欠落)

✨ とても良い挑戦です！意味はしっかり伝わっていますよ。
👉 "In my country, children often play a running game where everyone runs around a large tree many times at a very fast pace."
（私の国では、子供たちはよく大きな木の周りを何度も走るゲームをします。とても速いペースなので、とてもワクワクします。）`;

        const completion = await openai.chat.completions.create({
            model: config.openai.model,
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

/**
 * Generate detailed Japanese reading with furigana
 */
async function generateDetailedJapaneseReading(text) {
    try {
        const completion = await openai.chat.completions.create({
            model: config.openai.model,
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

/**
 * Generate detailed correction explanation
 */
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
            model: config.openai.model,
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

module.exports = {
    generateAIPrompt,
    generateAIFeedback,
    generateDetailedJapaneseReading,
    generateDetailedCorrection
};
