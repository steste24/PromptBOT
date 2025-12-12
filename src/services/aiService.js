const OpenAI = require('openai');
const { config } = require('../config');
const { savePromptToDatabase } = require('../database');
const { promptTemplates } = require('../models/prompts');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});

/**
 * Generate AI-powered prompt for language learning
 */
async function generateAIPrompt() {
    try {
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
7. Prompts should use everyday vocabulary (food, study, hobbies, dreams, travel, etc.)
8. The follow order of prompt generation should always go: easy warm-up question involving daily life → more creative question involving themes like culture / fun → a longer answer question where storytelling and collaboration answer is encouraged
9. Each prompt should be one or two sentences maximum (preferably under 20 words as per the English language equivalent)
10. Exemplar categories for the rotation of prompts may include: 1. daily life (meals, routines, school, hobbies), 2. opinions and preferences (choices, likes/ dislikes), 3. culture and traditions (holidays, customs, habits), 4. storytelling and memories (funny mistakes, best experiences), 5. imagination and "what if" (dreams, future, fantasy scenarios), 6. collaboration and teamwork (design something together, group preferences), 7. fun and random (animals, superpowers, "would you rather" questions)

Format your response as JSON:
{
  "category": "category_name",
  "en": "English prompt here",
  "ja": "Japanese prompt here in pure Japanese without readings"
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

        // Strip markdown code blocks if present
        let content = completion.choices[0].message.content;
        content = content.replace(/```json\n?|\n?```/g, '').trim();

        const response = JSON.parse(content);

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
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word, wrongly used kanji character in the context of the prompt and its consequential answer or incorrect grammar structure
3. For the corrected sentence: rewrite the sentence with all errors fixed and after each kanji word include its hiragana writing directly after in parentheses → mark each corrected word and grammar structure with 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear (e.g., "adjective form," "spelling," "missing particle")
5. For the motivational note: always include one differing ✨ motivational sentence (short praise)
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in Japanese → underneath, provide the English translation in parentheses → expansion must be natural, descriptive, and connected as well as complete the learner's attempt, it should also rephrase and restructure the correct sentence to sound more natural
7. Note: users could type the wrong kanji in response to the prompt question asked, based on the context of the prompt and its consequent answer, correct any mistakes and incorrect kanji choice with the correct one
8. For the Slack Formatting: use line breaks \\n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the Japanese language:

Original:
隠(かく)すとカウントするとても 🔴楽しな 🔴ゲム です。

Corrected:
隠(かく)すとカウントするとても 🟢楽(たの)しい 🟢ゲーム です。

「楽しな」 → 「楽しい」 (adjective form)
「ゲム」 → 「ゲーム」 (spelling)

✨ Great! To be more descriptive, you can say:
👉 「一人が数えている間に、ほかの人たちが隠れて、見つかるまで待つゲームです。とても楽しいゲームです！」
(It's a game where one person counts while the others hide and wait until they're found. It's a super fun game!)`

            : `You are a gentle English language tutor helping a Japanese speaker learn English. The output corrections must always follow these rules:
1. The correction must follow the structure of: original sentence → corrected sentence → error explanation → motivational note + expansion suggestion
2. For the original sentence: show the learner's original text → mark errors with a 🔴 directly before the incorrect word
3. For the corrected sentence: rewrite the sentence with all errors fixed → mark each corrected word with a 🟢 directly before it
4. For Error Explanations: list each mistake on a new line → format: 「wrong」 → 「correct」 (short reason) → explanations must be short and clear and written in fluent n1 level japanese (e.g., "adjective form," "spelling," "missing particle")
5. For the motivational note: always include one differing ✨ motivational sentence (short praise) in fluent n1 level japanese
6. For the Expansion Suggestion: always provide one 👉 model expansion sentence in English → underneath, provide the Japanese translation in parentheses → expansion must be natural, descriptive, and connected to the learner's attempt
7. For the Slack Formatting: use line breaks \\n to separate sections cleanly → use emojis (🔴🟢✨👉) exactly as shown → keep messages short enough for Slack readability

Here is the exact example breakdown of the correction format I would like for you to follow for the English language:

原文:
We 🔴playing 🔴run game, we 🔴run many time 🔴about tree, 🔴very fast pace.

修正文:
We 🟢played 🟢a running game. We 🟢ran many times 🟢around the tree 🟢at a very fast pace.

「playing」 → 「played」 (動詞の時制)
「run game」 → 「a running game」 (冠詞＋名詞表現)
「run many time」 → 「ran many times」 (動詞形＋複数形)
「about tree」 → 「around the tree」 (前置詞の誤用)
「very fast pace」 → 「at a very fast pace」 (前置詞不足)

✨ とても良い挑戦です！あと少しで自然な表現になりました。
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
