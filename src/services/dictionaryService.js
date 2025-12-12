const OpenAI = require('openai');
const axios = require('axios');
const { config } = require('../config');
const { detectLanguage } = require('../utils/languageUtils');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});

/**
 * Generate dictionary entry for a word
 * Uses OpenAI for English-to-Japanese, Jisho for Japanese-to-English
 */
async function generateDictionaryEntry(word, wordLanguage, userNativeLanguage) {
    // English-to-Japanese (using OpenAI)
    if (wordLanguage === 'en') {
        const systemPrompt = `You are an expert English-to-Japanese dictionary (英和辞典).
The user will provide an English word.
Your task is to provide a concise, "MacBook-style" dictionary entry.
You MUST respond in the following JSON format:
{
  "word": "The original English word",
  "reading": "The IPA pronunciation, e.g., |prɛzənˈteɪʃ(ə)n|",
  "definitions": [
    {
      "part_of_speech": "e.g., Noun",
      "japanese_meaning": "The primary Japanese translation and definition, e.g., 発表 (はっぴょう), 提示 (ていじ)"
    },
    {
      "part_of_speech": "e.g., Noun (secondary)",
      "japanese_meaning": "A secondary meaning, e.g., 贈呈 (ぞうてい)"
    }
  ]
}
Be accurate and concise. Only provide the JSON.`;

        try {
            const completion = await openai.chat.completions.create({
                model: config.openai.turboModel,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: word }
                ],
                temperature: 0.1,
                max_tokens: 500
            });

            const rawJson = completion.choices[0].message.content;
            const entry = JSON.parse(rawJson);

            // Build the Slack blocks
            const definitionBlocks = [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: `${entry.word} (${entry.reading})`, emoji: true }
                }
            ];

            entry.definitions.slice(0, 3).forEach((def, index) => {
                definitionBlocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${index + 1}.* (${def.part_of_speech})\n${def.japanese_meaning}`
                    }
                });
            });

            definitionBlocks.push({ type: 'divider' });
            definitionBlocks.push({
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `Powered by OpenAI (Weblio Equivalent)`
                    }
                ]
            });

            return { blocks: definitionBlocks };

        } catch (error) {
            console.error('Error generating English->Japanese definition with OpenAI:', error);
            return {
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `❌ Sorry, I had an error looking up *${word}* with OpenAI.` }
                    }
                ]
            };
        }
    }

    // Japanese-to-English (using Jisho)
    try {
        const encodedWord = encodeURIComponent(word);
        const response = await axios.get(`https://jisho.org/api/v1/search/words?keyword=${encodedWord}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
            }
        });
        const data = response.data.data;

        if (!data || data.length === 0) {
            return {
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `😕 Sorry, I couldn't find *${word}* on Jisho.org. Here's a link to a manual search:\n\n<https://jisho.org/search/${encodedWord}|Search for "${word}" on Jisho.org>`
                        }
                    }
                ]
            };
        }

        const entry = data[0];
        const japanese = entry.japanese[0];
        const senses = entry.senses;

        let headerText = japanese.word ? japanese.word : '';
        if (japanese.reading) {
            headerText += ` (${japanese.reading})`;
        }

        // Build the Slack blocks
        const definitionBlocks = [
            {
                type: 'header',
                text: { type: 'plain_text', text: headerText, emoji: true }
            }
        ];

        senses.slice(0, 3).forEach((sense, index) => {
            const partsOfSpeech = sense.parts_of_speech.join(', ');
            const englishDefs = sense.english_definitions.join('; ');

            definitionBlocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${index + 1}.* (${partsOfSpeech})\n${englishDefs}`
                }
            });
        });

        definitionBlocks.push({ type: 'divider' });
        definitionBlocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `<https://jisho.org/search/${encodedWord}|View full entry for "${word}" on Jisho.org>`
                }
            ]
        });

        return { blocks: definitionBlocks };

    } catch (error) {
        console.error('Error fetching from Jisho API:', error);
        return {
            blocks: [
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: `❌ Sorry, I had an error connecting to Jisho.org.` }
                }
            ]
        };
    }
}

module.exports = {
    generateDictionaryEntry
};
