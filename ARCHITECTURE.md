# PromptBOT - Modular Structure

This project has been modularized following industry best practices for maintainability and scalability.

## Project Structure

```
PromptBOT/
├── index.js                 # Main entry point - registers handlers & starts app
├── package.json
├── .env
├── src/
│   ├── config/
│   │   └── index.js        # Configuration & environment variables
│   ├── database/
│   │   └── index.js        # MongoDB connection & database operations
│   ├── services/
│   │   ├── aiService.js    # OpenAI integration for prompts & feedback
│   │   └── dictionaryService.js # Dictionary lookup (Jisho + OpenAI)
│   ├── handlers/
│   │   ├── promptHandler.js    # Prompt posting & distribution
│   │   ├── messageHandler.js   # DM message processing
│   │   ├── homeHandler.js      # Home tab & language selection
│   │   ├── replyHandler.js     # Reply modal & thread responses
│   │   ├── reactionHandler.js  # Emoji reactions (help features)
│   │   └── commandHandler.js   # Slash commands (/stats, /leaderboard)
│   ├── utils/
│   │   ├── userUtils.js        # User management & pseudonyms
│   │   └── languageUtils.js    # Language detection
│   └── models/
│       └── prompts.js          # Prompt templates
```

## Module Descriptions

### Config (`src/config/`)
- Centralized configuration management
- Environment variable validation
- Application settings and constants

### Database (`src/database/`)
- MongoDB connection with retry logic
- Data synchronization functions
- Database operations for users, pseudonyms, points, submissions, and prompts

### Services (`src/services/`)
- **aiService.js**: AI-powered features using OpenAI
  - Prompt generation
  - Feedback generation
  - Japanese reading assistance
  - Detailed corrections
- **dictionaryService.js**: Dictionary lookup functionality
  - English-to-Japanese (OpenAI)
  - Japanese-to-English (Jisho API)

### Handlers (`src/handlers/`)
Each handler module manages specific Slack interactions:
- **promptHandler.js**: Scheduled prompt posting and DM distribution
- **messageHandler.js**: Direct message processing and dictionary commands
- **homeHandler.js**: Home tab UI and language selection
- **replyHandler.js**: Anonymous reply functionality
- **reactionHandler.js**: Emoji reaction-based help features
- **commandHandler.js**: Slash command implementations

### Utils (`src/utils/`)
- **userUtils.js**: User data management, pseudonym generation, points system
- **languageUtils.js**: Language detection utilities

### Models (`src/models/`)
- **prompts.js**: Fallback prompt templates

## Key Benefits of Modularization

1. **Separation of Concerns**: Each module has a single, well-defined responsibility
2. **Maintainability**: Easier to locate and fix bugs
3. **Scalability**: Simple to add new features without affecting existing code
4. **Testability**: Individual modules can be tested in isolation
5. **Reusability**: Functions can be imported and reused across different parts of the app
6. **Team Collaboration**: Multiple developers can work on different modules simultaneously

## How to Add New Features

1. **New AI Feature**: Add to `src/services/aiService.js`
2. **New Slack Interaction**: Create handler in `src/handlers/`
3. **New Database Operation**: Add to `src/database/index.js`
4. **New Configuration**: Update `src/config/index.js`
5. **New Utility Function**: Add to appropriate file in `src/utils/`

## Running the Application

```bash
npm install
npm start
```

## Development

```bash
npm run dev  # Uses nodemon for auto-restart
```

## Environment Variables

See `.env` for required environment variables:
- Slack credentials (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN)
- OpenAI API key
- MongoDB connection string
- Bot configuration (channel IDs, etc.)
