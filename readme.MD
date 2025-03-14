# Voice Dictation Chrome Extension

A Chrome extension that enables voice dictation into any text field with proper noun correction. This extension allows you to speak naturally and have your words transcribed into text fields, with special handling for proper nouns and technical terms.


## Next update 
Upon further digging found this beautiful website forvo which could take care of 70% of proper nouns in major languages. wanted to scrape them all but found an open source alternative to it here: https://lingualibre.org/LanguagesGallery/

what I plan to do tomorrow is get as much data from here then just use a model like whisper then insert these words into sentences as proper nouns and create atleast 5 example sentences and train the model on this data. im sure the base model is strong enough to learn it pretty quickly. Tired today will work on tomorrow.

## Features

- Voice dictation into any text field on any website
- Proper noun recognition and correction
- Optional AI-powered text correction using OpenAI API
- Keyboard shortcuts for quick toggling
- Visual feedback with icon changes
- Works offline (basic functionality) or with enhanced AI correction (with API key)

##Flow 
```
User Action (Icon Click/Keyboard Shortcut)
       ↓
Background Script (background.js)
       ↓
Content Script Injection (content-script.js)
       ↓
Speech Recognition (Web Speech API)
       ↓
Raw Transcript
       ↓
Background Script for Processing
       ↓
Proper Noun Handler (prop-noun-handler.js)
       ↓
Phonetic Matching → LLM Processing (OpenAI API)
       ↓
Corrected Text
       ↓
Content Script
       ↓
Text Insertion into Active Element
```
## Installation

### From Source

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/voice-dictation-extension.git
   ```

2. Set up your API key (optional, for AI correction):
   - Add your OpenAI API key to `.env.js`

3. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the extension directory

4. **Important:** Pin the extension to your toolbar for easier access:
   - Click the puzzle icon in the Chrome toolbar
   - Find "Voice Dictation Tool" in the dropdown
   - Click the pin icon next to it to pin it to your toolbar
## Usage

- Click the extension icon to start/stop voice dictation
(Windows/Linux)
- Speak clearly into your microphone
- Text will be inserted at the cursor position in the active text field

## Project Structure

### Core Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration file that defines permissions, resources, and metadata |
| `background.js` | Background service worker that manages the extension's lifecycle and handles communication |
| `content-script.js` | Injected into web pages to handle speech recognition and text insertion |
| `lib/prop-noun-handler.js` | Handles proper noun recognition, correction, and AI processing |
| `lib/config.js` | Configuration management for the extension |
| `.env.js` | Template for environment variables (API keys, etc.) |

### Directory Structure

- `icons/` - Contains extension icons for different states and sizes
- `lib/` - Contains library files used by the extension
- `legacy/` - Contains older versions of files (for reference only)

## File Descriptions

### manifest.json

The manifest file defines the extension's metadata, permissions, and resources. It specifies:
- Basic information (name, version, description)
- Required permissions (activeTab, scripting, storage)
- Icon paths for different states
- Background script configuration
- Keyboard command shortcuts
- Web accessible resources

### background.js

The background script runs as a service worker and manages the extension's core functionality:
- Loads configuration and environment variables
- Initializes the proper noun handler
- Handles extension icon clicks
- Injects the content script into web pages
- Processes messages from the content script
- Manages the recording state and updates the extension icon
- Routes proper noun processing requests to the handler

### content-script.js

The content script is injected into web pages and handles:
- Speech recognition using the Web Speech API
- Microphone permission requests
- Text insertion into the active text field
- User interface notifications
- Keyboard shortcut handling within the page
- Communication with the background script

### lib/prop-noun-handler.js

This file handles all proper noun processing:
- Maintains a database of known proper nouns and their phonetic representations
- Generates phonetic representations of words for matching
- Corrects transcribed text using phonetic matching
- Processes text with OpenAI API for enhanced correction (if enabled)
- Extracts potential new proper nouns from corrected text
- Manages settings for the correction system

### lib/config.js

The configuration file manages:
- Default settings for the extension
- Loading environment variables from `.env.js`
- OpenAI API configuration
- Feature flags for enabling/disabling functionality

### .env.js

A template for creating your own `.env.js` file with:
- OpenAI API key
- Model selection
- Feature flags

## Configuration

You can configure the extension by editing the `.env.js` file:

```javascript
const ENV_VARS = {
  // Your OpenAI API key for AI-powered correction
  OPENAI_API_KEY: 'your-api-key-here',
  
  // Model to use (default: gpt-4o)
  OPENAI_MODEL: 'gpt-4o',
  
  // Feature flags
  USE_LLM: true,  // Enable/disable AI correction
  AUTO_CORRECT: true  // Enable/disable automatic correction
};
```

## How It Works

1. **Initialization**: When the extension is loaded, the background script initializes the configuration and proper noun handler.

2. **Activation**: When you click the extension icon or use the keyboard shortcut, the background script injects the content script into the current tab.

3. **Speech Recognition**: The content script initializes the Web Speech API and starts listening for speech.

4. **Text Processing**:
   - Speech is converted to text using the browser's speech recognition
   - Text is sent to the background script for proper noun correction
   - If enabled, the text is processed with OpenAI's API for enhanced correction
   - Corrected text is returned to the content script

5. **Text Insertion**: The content script inserts the corrected text into the active text field.

6. **Proper Noun Learning**: The system can identify potential new proper nouns from the corrected text for future recognition.

## Permissions

This extension requires:
- `activeTab`: To access the current tab for injecting the content script
- `scripting`: To execute scripts in the current tab
- `storage`: To save settings and proper noun data
- Microphone access: For voice recognition (requested at runtime)

## Troubleshooting

- **Microphone not working**: Ensure you've granted microphone permissions to the website
- **Extension icon not changing**: Try reloading the extension
- **Text not inserting**: Make sure you've clicked into a text field before speaking
- **AI correction not working**: Check that you've added a valid API key to `.env.js`

## Development

To modify or extend this extension:

1. Make your changes to the relevant files
2. Test locally by loading the unpacked extension
3. For significant changes, consider creating a new branch


## Acknowledgements

- Uses the Web Speech API for speech recognition
- Optional integration with OpenAI API for enhanced text correction

