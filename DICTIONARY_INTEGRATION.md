# Dictionary Integration Guide

## Overview
The PromptBOT now uses **Weblio web scraping** for English-to-Japanese dictionary lookups and **Jisho.org API** for Japanese-to-English lookups. This document explains how the bot distinguishes between dictionary commands and prompt responses.

---

## How Dictionary Commands Work

### Detection Logic (in `messageHandler.js`)

The bot checks every direct message (DM) for dictionary command patterns **BEFORE** treating it as a prompt response.

#### English-Style Commands
```
define [word]           → Example: "define industry"
look up [word]          → Example: "look up presentation"
what does "[word]" mean? → Example: "what does innovation mean?"
```

#### Japanese-Style Commands (Works for all users)
```
[word] 意味             → Example: "presentation 意味"
[word] とは             → Example: "innovation とは"
```

### Command Flow
```
User sends DM
    ↓
handleDirectMessage()
    ↓
checkDictionaryCommand()
    ↓
    ├─→ Dictionary command found? YES → Process dictionary lookup → Return (stop here)
    └─→ Dictionary command found? NO  → Continue to processPromptResponse()
```

---

## Dictionary Services (in `dictionaryService.js`)

### English → Japanese (Weblio Scraping)
- **URL**: `https://ejje.weblio.jp/content/[word]`
- **Method**: Web scraping with `cheerio` library
- **Extracts**:
  - Word and pronunciation (e.g., "industry |ˈɪndəstri|")
  - Part of speech (Noun, Verb, etc.)
  - Japanese meanings (e.g., "産業 (さんぎょう), 工業 (こうぎょう)")

**Example HTML Parsing**:
```javascript
const $ = cheerio.load(response.data);
const headerWord = $('.midashigo').first().text().trim();
const pronunciation = $('.phoneticEjjeDesc').first().text().trim();
// Extract definitions from .level0 elements
```

### Japanese → English (Jisho API)
- **URL**: `https://jisho.org/api/v1/search/words?keyword=[word]`
- **Method**: REST API call with JSON response
- **Extracts**:
  - Kanji/kana readings (e.g., "大学 (だいがく)")
  - Parts of speech
  - English definitions

---

## Prompt Response Processing

When a message is **NOT** a dictionary command, it's processed as a prompt response:

1. **Language Detection**: Detects if user wrote in Japanese or English
2. **Anti-Cheating Check**: Validates user wrote in their target language
3. **Anonymous Posting**: Posts to channel with pseudonym (e.g., "AB-12 🐼🌱")
4. **AI Feedback**: Generates corrections and encouragement using OpenAI
5. **Points Award**: Awards 1 point for valid submission

### Validation Example
```javascript
// User's target language: Japanese
// User writes: "Hello, how are you?" (English)
// Result: ⚠️ Warning + not posted (anti-cheating)

// User writes: "こんにちは、元気ですか？" (Japanese)
// Result: ✅ Posted anonymously + feedback + points
```

---

## Key Files Modified

### 1. `src/services/dictionaryService.js`
- ✅ Added `cheerio` import for HTML parsing
- ✅ Replaced OpenAI with Weblio scraping for English→Japanese
- ✅ Kept Jisho API for Japanese→English
- ✅ Added comprehensive documentation

### 2. `src/handlers/messageHandler.js`
- ✅ Enhanced documentation explaining dictionary vs prompt flow
- ✅ Verified `checkDictionaryCommand()` returns boolean correctly
- ✅ Ensures dictionary processing stops message from being treated as prompt

### 3. `package.json`
- ✅ Added `cheerio` dependency (v1.0.0)

---

## Testing Dictionary Commands

### Test English → Japanese (Weblio)
Send DM to bot:
```
define presentation
```
Expected: Slack blocks showing pronunciation and Japanese meanings

### Test Japanese → English (Jisho)
Send DM to bot:
```
大学 とは
```
Expected: Slack blocks showing readings and English definitions

### Test Prompt Response (Not Dictionary)
Send DM to bot:
```
今日の朝食は納豆とご飯を食べました。
```
Expected: Posted anonymously to channel + AI feedback + points awarded

---

## Error Handling

### Weblio Scraping Failures
- If scraping fails, bot provides fallback link to manual Weblio search
- Logs error to console for debugging

### Jisho API Failures
- If API call fails, bot provides fallback link to Jisho.org
- Logs error to console for debugging

### Invalid Dictionary Commands
```
User: "define"
Bot: "Please tell me what word you want to define. For example: `define industry`"
```

---

## Architecture Benefits

✅ **Separation of Concerns**: Dictionary logic isolated in `dictionaryService.js`
✅ **Early Detection**: Dictionary commands processed before prompt validation
✅ **No False Positives**: Strict pattern matching prevents accidental dictionary triggers
✅ **Graceful Fallbacks**: Provides manual search links when automated lookup fails
✅ **Bilingual Support**: Handles both English and Japanese input naturally

---

## Future Enhancements

- [ ] Add caching for frequently looked-up words
- [ ] Support phrase lookups (multi-word definitions)
- [ ] Add pronunciation audio links
- [ ] Track dictionary usage statistics
- [ ] Support additional dictionary sources (e.g., Oxford, Cambridge)

---

**Last Updated**: December 12, 2025
**Integration Status**: ✅ Complete and Tested
