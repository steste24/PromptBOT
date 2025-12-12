/**
 * DICTIONARY SERVICE MODULE
 *
 * Provides bilingual dictionary lookup functionality:
 *
 * 1. ENGLISH → JAPANESE (Using Weblio Web Scraping)
 *    - Scrapes https://ejje.weblio.jp/content/[word]
 *    - Uses cheerio to parse HTML and extract:
 *      * Word and pronunciation
 *      * Part of speech
 *      * Japanese meanings/definitions
 *    - Returns formatted Slack blocks for display
 *
 * 2. JAPANESE → ENGLISH (Using Jisho.org API)
 *    - Calls https://jisho.org/api/v1/search/words?keyword=[word]
 *    - Parses JSON response for:
 *      * Kanji/kana readings
 *      * Parts of speech
 *      * English definitions
 *    - Returns formatted Slack blocks for display
 *
 * Both methods return Slack block format for consistent UI presentation.
 */

const OpenAI = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const { config } = require('../config');
const { detectLanguage } = require('../utils/languageUtils');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});

/**
 * Generate dictionary entry for a word
 * Uses Weblio scraping for English-to-Japanese, Jisho API for Japanese-to-English
 */
async function generateDictionaryEntry(word, wordLanguage, userNativeLanguage) {
    // English-to-Japanese (using Weblio scraping)
    if (wordLanguage === 'en') {
        try {
            const encodedWord = encodeURIComponent(word);
            const url = `https://ejje.weblio.jp/content/${encodedWord}`;

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);

            // Extract main Japanese meaning using Weblio's structure
            const meaning = $('#summary .content-explanation').first().text().trim() ||
                           $('#summary .summary-content').first().text().trim();

            // If no meaning found, return error
            if (!meaning) {
                return {
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `😕 Sorry — Weblio does not have an entry for *${word}*.`
                            }
                        }
                    ]
                };
            }

            // Extract part of speech
            const pos = $('#summary > div.summary-description').first().text().trim();

            // Build Slack Blocks
            const definitionBlocks = [
                { type: 'header', text: { type: 'plain_text', text: `${word} (英和)`, emoji: true } },
                { type: 'section', text: { type: 'mrkdwn', text: `*${pos || 'Meaning'}*\n${meaning}` } },
                { type: 'divider' },
                { type: 'context', elements: [{ type: 'mrkdwn', text: `Source: Weblio 英和辞典` }] }
            ];

            return { blocks: definitionBlocks };

        } catch (error) {
            console.error('Error scraping Weblio for English->Japanese definition:', error);

            // Fallback: try to provide a helpful error message
            const encodedWord = encodeURIComponent(word);
            const url = `https://ejje.weblio.jp/content/${encodedWord}`;

            return {
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `❌ Sorry, I had an error connecting to Weblio. Please try searching manually:\n\n<${url}|Search for "${word}" on Weblio>`
                        }
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
