/**
 * Detect language from text
 */
function detectLanguage(text) {
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    const englishPattern = /^[a-zA-Z\s.,!?'"()-]+$/;

    if (japanesePattern.test(text)) {
        return 'ja';
    } else if (englishPattern.test(text.trim())) {
        return 'en';
    } else if (text.length > 50 && !japanesePattern.test(text)) {
        return 'en';
    }
    return 'unknown';
}

module.exports = {
    detectLanguage
};
