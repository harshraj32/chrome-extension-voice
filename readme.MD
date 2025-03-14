# Voice Dictation Chrome Extension with Proper Noun Correction

A powerful Chrome extension that enables voice dictation with advanced proper noun correction using the LIA PHON system.
# Voice Dictation Chrome Extension

## Component Overview

### Background Script (background.js)

The background script serves as the main controller for the Voice Dictation Chrome extension. It:

- Manages the extension's icon state (active/inactive)
- Handles user interactions like toolbar icon clicks and keyboard shortcuts
- Injects the content script into web pages when needed
- Processes messages between the content script and the LIA PHON handler
- Coordinates the overall extension functionality and state

It acts as the bridge between user actions, the browser's context, and the specialized voice dictation functionality.

### LIA PHON Handler (lia-phon-handler.js)

The LIA PHON handler is the specialized module for improving speech recognition accuracy, particularly for proper nouns. It:

- Maintains a database of proper nouns and their phonetic representations
- Converts recognized speech into phonetic patterns for matching
- Corrects misrecognized words based on phonetic similarity
- Optionally processes text through an LLM (like ChatGPT) for further correction
- Identifies and learns new proper nouns to improve future recognition

It essentially works as the "intelligence" layer that enhances the browser's built-in speech recognition with specialized capabilities for handling names, technical terms, and other frequently misrecognized words.


## Overview

This extension allows users to dictate text into any input field on any webpage, with special handling for proper nouns and technical terms that are often misrecognized by traditional speech recognition systems.

## Features

- **Easy Voice Dictation**: Click the extension icon or use keyboard shortcuts
- **Smart Text Insertion**: Automatically finds and focuses the proper text field
- **Proper Noun Correction**: Uses phonetic matching and optional LLM processing for better accuracy
- **Learning System**: Identifies potential new proper nouns to improve future recognition
- **Elegant UI**: Clean notifications with appropriate status indicators
- **Accessibility Aware**: Handles aria-hidden properly and respects web page structure

## Technical Implementation

### Architecture

The extension consists of:

1. **Background Script**: Manages the extension state and handles LIA PHON processing
2. **Content Script**: Injected into web pages to handle speech recognition and text insertion
3. **LIA PHON Handler**: Dedicated module for proper noun identification and correction

### Speech Recognition Pipeline

```
Speech Input → Web Speech API → Raw Transcript → LIA PHON Processing → Corrected Text → Insertion
```

### Keyboard Shortcut Implementation

We implemented two approaches for keyboard shortcuts:

1. **Chrome Commands API**: Added `Alt+R` shortcut in manifest.json
   ```json
   "commands": {
     "toggle-recording": {
       "suggested_key": {
         "default": "Alt+R"
       },
       "description": "Toggle voice dictation recording"
     }
   }
   ```

2. **Direct KeyDown Listener**: Added Shift key support through DOM events
   ```javascript
   document.addEventListener('keydown', function(event) {
     if (event.key === 'Shift' && !event.repeat) {
       toggleRecording();
     }
   });
   ```

**Known Issues with Keyboard Implementation**:
- The Shift key implementation can interfere with normal typing
- Chrome's Commands API has limitations with certain key combinations
- attempted to use `Shift+R` but Chrome rejected this in the manifest, showing:
  ```
  Error: Invalid value for 'commands[1].default': Shift+R.
  Could not load manifest.
  ```
- Different operating systems have different keyboard shortcut restrictions

### Proper Noun Correction Techniques

The extension employs a multi-layered approach to proper noun correction:

#### 1. Phonetic Matching (Current Implementation)
- Generates simplified phonetic representations of words
- Compares phonetic signatures to known proper nouns
- Maps similar-sounding words to their correct forms

**Current Limitations**:
- Relies on exact phonetic matching which is brittle
- Cannot handle contextual understanding
- Requires manual addition of proper nouns to the database
- Cannot distinguish between homonyms (words that sound the same but have different meanings)

#### 2. Optional LLM Enhancement
- Uses ChatGPT (via API) to perform advanced linguistic correction
- Leverages contextual understanding of sentences
- Can fix grammatical issues alongside proper noun recognition

**Current Limitations**:
- Requires API key and internet connection
- Adds latency to the dictation process
- May incorrectly "fix" some specialized terms

#### 3. Proper Noun Learning
- Extracts potential new proper nouns from processed text
- Identifies capitalized words not at the beginning of sentences
- Detects multi-word proper noun sequences

**Current Limitations**:
- False positive detection of non-proper nouns
- No verification mechanism for newly detected terms
- No categorization of detected proper nouns

## Known Issues and Limitations

### Proper Noun Recognition Challenges

The current implementation faces several challenges:

1. **Recognition Accuracy**: The phonetic algorithm is too simplistic for many proper nouns, especially those with unusual pronunciations.

2. **Context Awareness**: The system doesn't use surrounding words to determine if a word is a proper noun.

3. **Domain Specificity**: Technical terms in specialized fields (medical, legal, scientific) are poorly handled.

4. **Homophone Confusion**: Cannot differentiate between words that sound the same but have different meanings (e.g., "there" vs. "their").

5. **Dialect and Accent Handling**: Does not account for variations in pronunciation across different English dialects.

### Technical Issues

1. **Recursive Function Calls**: Some older code had stack overflow risks due to recursion.

2. **Error Handling**: Not all edge cases are properly handled.

3. **Accessibility Integration**: May conflict with some screen readers or accessibility tools.

4. **Performance**: The LLM integration adds significant latency.

## Future Improvements

### Planned Enhancements

1. **Enhanced Phonetic Algorithm**: Implement a more sophisticated phonetic matching system like Double Metaphone or Beider-Morse.

2. **Context-Aware Correction**: Use the surrounding words to improve proper noun detection.

3. **Domain-Specific Libraries**: Add specialized vocabularies for different professional domains.

4. **User Dictionary Management**: Create a UI for users to view and manage their proper noun dictionary.

5. **Offline Processing**: Implement local ML models to reduce dependence on cloud APIs.

## Installation

### From Chrome Web Store

1. Visit the [Chrome Web Store](https://chrome.google.com/webstore)
2. Search for "Voice Dictation with Proper Noun Correction"
3. Click "Add to Chrome"

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the downloaded folder

## Usage

1. Click the extension icon in your toolbar
2. When prompted, allow microphone access
3. Click into any text field where you want to dictate
4. Start speaking - your words will appear in the text field
5. Click the icon again (or press Alt+R) to stop dictation


## Acknowledgments

- Web Speech API
- The ISIP Phonetic Algorithm
- OpenAI for ChatGPT API integration