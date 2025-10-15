# AI-Powered Intercultural PromptBot

An anonymous, gamified Slack bot for intercultural language learning between English and Japanese speakers, now powered by OpenAI for intelligent prompts and personalized feedback.

## 🤖 NEW AI Features (Step 2)

### ✅ AI-Generated Prompts
- **OpenAI Integration**: GPT-4 powered conversation starters
- **Scheduled Posting**: Automated prompts 3x per week (M/W/F at 9 AM, 2 PM, 6 PM)
- **Cultural Sensitivity**: AI ensures prompts are appropriate for intercultural exchange
- **Bilingual Content**: Prompts generated in both English and Japanese

### ✅ � Anonymous Reply System (NEW!)
- **Interactive Conversations**: Reply to anyone's response anonymously
- **Reply Button**: Every response has a "💬 Reply Anonymously" button
- **Modal Interface**: User-friendly reply form with context
- **Threaded Replies**: Conversations organized in threads
- **Mutual Notifications**: Both replier and original poster get notified
- **Language Validation**: Same anti-cheating system applies to replies
- **Points for Engagement**: Earn points for participating in conversations
- **Real Conversations**: Transform solo responses into intercultural dialogue

### ✅ �📖 Hiragana Reading Support
- **Progressive Learning**: Japanese prompts display plain kanji by default
- **On-Demand Readings**: React with ❓ emoji to get hiragana readings
- **Format**: Displays as `漢字(かんじ)` with readings in parentheses
- **Smart Detection**: Works on both public prompts and personalized DMs

### ✅ Enhanced AI Feedback System
- **Personalized Grammar Tips**: AI analyzes target language writing
- **Gentle Corrections**: Encouraging feedback focused on improvement
- **Detailed Corrections**: React with ❓ on feedback for comprehensive explanations
- **Contextual Analysis**: AI references original prompt for better corrections
- **Structured Format**:
  - Original text with error markers (🔴)
  - Corrected version (🟢) with hiragana for Japanese
  - Clear error explanations
  - Motivational notes (✨)
  - Model expansion sentences (👉)
- **Private Delivery**: Feedback sent via DM to avoid embarrassment

### ✅ Thread Conversations
- **Prompt Threads**: Users can reply directly to prompts in threads
- **Anonymous Threads**: Maintain pseudonyms in threaded conversations
- **Auto-Detection**: Bot detects thread replies and awards points
- **Real-time Feedback**: AI feedback triggered by thread participation
- **Interactive Help**: React with ❓ on any prompt or feedback for more details

### ✅ Enhanced Language Detection
- **Improved Algorithm**: Better detection of Japanese vs English
- **Mixed Language Support**: Handles multilingual responses
- **Point Optimization**: Higher points for target language practice

## Core Foundation Features

### ✅ Anonymity & Gamification
- **Anonymous Pseudonyms**: Auto-generated handles like "QK-37 🐼🌱"
- **Language Selection**: Users choose EN or JP as target language
- **Points System**: Gamified participation tracking
- **Weekly Leaderboards**: Sunday night automated rankings
- **Kudos System**: React with ✅ to give points

### ✅ Slack Integration
- **Socket Mode**: No public webhooks required
- **Home Tab**: Personal dashboard with AI features
- **Submission Modal**: Anonymous response collection
- **Thread Support**: Reply to prompts in organized threads
- **Button Actions**: Easy interaction with AI prompts

## 🚀 How to Use

### **For Language Learners:**
1. **Join a channel** with PromptBot
2. **Choose target language** (English or Japanese)
3. **Wait for AI prompts** or click "Generate Prompt" in Home tab
4. **Respond anonymously** using `/submit` or reply in thread
5. **Receive AI feedback** via private DM
6. **Earn points** for participation and target language practice

### **AI Prompt Workflow:**
```
🤖 AI generates bilingual prompt
    ↓
📢 Posted to channel with action buttons
    ↓
👤 Users respond via /submit or thread reply
    ↓
🔍 AI analyzes target language responses
    ↓
💬 Personalized feedback sent via DM
    ↓
🏆 Points awarded based on language match
```

## Configuration

### **Environment Variables:**
```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
PROMPT_CHANNEL_ID=C1234567890

# AI Configuration
OPENAI_API_KEY=sk-your-openai-key

# Scheduling (cron format)
PROMPT_SCHEDULE=0 9,14,18 * * 1,3,5
```

### **Required Slack Scopes:**
- `channels:history`, `chat:write`, `chat:write.customize`
- `channels:read`, `users:read`, `reactions:read`
- `commands`, `app_mentions:read`, `im:write`

### **Required Events:**
- `member_joined_channel`, `app_home_opened`
- `reaction_added`, `message.im`, `message.channels`

### **New: Emoji Reaction Features:**
- React with ❓ (`:question:`) on Japanese prompts to get hiragana readings
- React with ❓ on feedback messages to get detailed corrections
- Bot listens for `reaction_added` events to provide interactive help

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure OpenAI:**
   - Get API key from https://platform.openai.com/
   - Add to `.env` file

3. **Set up Slack App:**
   - Create app at https://api.slack.com/apps
   - Enable Socket Mode, Home Tab, Events
   - Add required scopes and events

4. **Run the bot:**
   ```bash
   npm run dev  # Development with auto-restart
   npm start    # Production
   ```

## AI Prompt Examples

The AI generates culturally appropriate prompts like:

**Daily Life:**
- 🇺🇸 "What did you eat for breakfast today? Describe it in detail."
- 🇯🇵 "今日の朝食は何を食べましたか？詳しく説明してください。"

**Culture:**
- 🇺🇸 "What tradition from your country might interest others?"
- 🇯🇵 "あなたの国の伝統で、他の国の人が興味深いと思うものは？"

## AI Feedback Examples

**For Japanese Learners:**
> "Great job using です/ます form! Your sentence structure is correct. A more natural way to say this might be... In Japanese culture, this topic often comes up during..."

**For English Learners:**
> "Nice use of past tense! Your meaning is clear. You might also say... This reminds me of a common English expression..."

## Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   Slack App     │───▶│  Node.js Bot │───▶│   OpenAI    │
│  (Socket Mode)  │    │  (Enhanced)  │    │   GPT-4     │
└─────────────────┘    └──────────────┘    └─────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   Database   │
                       │ (In-Memory)  │
                       └──────────────┘
```

## Scheduling

- **Prompts**: Mon/Wed/Fri at 9 AM, 2 PM, 6 PM
- **Leaderboard**: Sundays at 11 PM
- **Testing**: Every 30 minutes (commented out)
- **AI Feedback**: 3-second delay after target language detection

## Next Steps

### **Week 3-4 Roadmap:**
- [ ] PostgreSQL database integration
- [ ] Advanced Japanese NLP (MeCab, furigana)
- [ ] Cosmetic rewards system
- [ ] Anti-gaming measures

### **Week 5-8 Roadmap:**
- [ ] Reading assist (kanji→furigana)
- [ ] Grammar explanations with examples
- [ ] Progress tracking and streaks
- [ ] Production deployment

## Development Notes

- Uses OpenAI GPT-4 for prompt generation and feedback
- Fallback to predefined prompts if AI fails
- Enhanced language detection (Japanese character patterns)
- Thread tracking for prompt responses
- Graceful error handling throughout

## Privacy & AI

- AI feedback is private (DM only)
- No user data sent to OpenAI beyond submitted text
- Anonymous participation preserved
- Users notified about AI feedback system during onboarding

---

**Status**: Step 2 Complete ✅ - AI-Powered Features Implemented
**Next**: Database integration and advanced NLP features