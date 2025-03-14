// prop-noun-handler.js - Proper Noun Correction for Voice Dictation

// Access config without redeclaring it
let propNounConfig;
try {
  // In a service worker context, config should already be loaded by background.js
  propNounConfig = self.config || {};
  
  if (!propNounConfig.openai) {
    // Fallback config if not loaded properly
    propNounConfig = {
      openai: {
        apiKey: '',
        defaultModel: 'gpt-4o'
      },
      features: {
        useLLM: false,
        autoCorrect: true
      }
    };
    console.warn('Using fallback config in prop-noun-handler.js');
  } else {
    console.log('Successfully accessed config in prop-noun-handler.js');
    console.log('LLM usage from config:', propNounConfig.features.useLLM);
    console.log('API key status:', propNounConfig.openai.apiKey ? 'PROVIDED' : 'MISSING');
  }
} catch (e) {
  console.error('Failed to access config:', e);
  // Fallback config
  propNounConfig = {
    openai: {
      apiKey: '',
      defaultModel: 'gpt-4o'
    },
    features: {
      useLLM: false,
      autoCorrect: true
    }
  };
  console.warn('Using fallback config due to error');
}

// Global state for proper noun identification
const propNounState = {
  properNouns: {},
  phonetics: {},
  isInitialized: false,
  settings: {
    apiKey: propNounConfig.openai?.apiKey || '',
    useLLM: propNounConfig.features?.useLLM ?? false,
    autoCorrect: propNounConfig.features?.autoCorrect ?? true,
    model: propNounConfig.openai?.defaultModel || 'gpt-4o'
  }
};

// Initialize the proper noun database
const initializePropNoun = async () => {
  try {
    // Load stored proper nouns and their phonetic representations
    const storedData = await chrome.storage.local.get(['properNouns', 'phonetics', 'settings']);
    
    if (storedData.properNouns) {
      propNounState.properNouns = storedData.properNouns;
    } else {
      // Initialize with empty categories
      propNounState.properNouns = {
        people: [],
        places: [],
        organizations: [],
        technical: [],
        other: []
      };
    }
    
    if (storedData.phonetics) {
      propNounState.phonetics = storedData.phonetics;
    } else {
      propNounState.phonetics = {};
    }
    
    if (storedData.settings) {
      // Merge stored settings with defaults
      const mergedSettings = { ...propNounState.settings, ...storedData.settings };
      
      // If we have an API key in config, use that instead of stored one
      if (propNounConfig.openai?.apiKey) {
        mergedSettings.apiKey = propNounConfig.openai.apiKey;
      }
      
      propNounState.settings = mergedSettings;
    }
    
    propNounState.isInitialized = true;
    console.log('Proper Noun system initialized with settings:', propNounState.settings);
    return true;
  } catch (error) {
    console.error('Failed to initialize Proper Noun system:', error);
    return false;
  }
};

// Generate phonetic representation using algorithm
const generatePhonetic = (text) => {
  if (!text) return '';
  
  // Convert to lowercase
  let phonetic = text.toLowerCase();
  
  // Basic phonetic transformations
  phonetic = phonetic
    // Remove duplicate consecutive letters
    .replace(/([a-z])\1+/g, '$1')
    // Replace common phonetic patterns
    .replace(/ph/g, 'f')
    .replace(/[ck]h/g, 'k')
    .replace(/sh/g, 's')
    .replace(/th/g, 't')
    .replace(/wh/g, 'w')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/y/g, 'i')
    .replace(/z/g, 's')
    // Remove vowels except at beginning of words
    .replace(/(?!^)[aeiou]/g, '');
  
  return phonetic;
};

// Add a new proper noun with its phonetic representation
const addProperNoun = async (term, category = 'other') => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  if (!propNounState.properNouns[category].includes(term)) {
    // Add to proper nouns list
    propNounState.properNouns[category].push(term);
    
    // Generate and store phonetic representation
    const phonetic = generatePhonetic(term);
    propNounState.phonetics[phonetic] = term;
    
    // Save to storage
    await chrome.storage.local.set({
      properNouns: propNounState.properNouns,
      phonetics: propNounState.phonetics
    });
    
    return { success: true, term, phonetic };
  }
  
  return { success: false, message: 'Term already exists' };
};

// Remove a proper noun
const removeProperNoun = async (term) => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  let found = false;
  
  // Find and remove from proper nouns
  for (const category in propNounState.properNouns) {
    const index = propNounState.properNouns[category].indexOf(term);
    if (index !== -1) {
      propNounState.properNouns[category].splice(index, 1);
      found = true;
      break;
    }
  }
  
  if (found) {
    // Remove phonetic mapping
    const phonetic = generatePhonetic(term);
    delete propNounState.phonetics[phonetic];
    
    // Save to storage
    await chrome.storage.local.set({
      properNouns: propNounState.properNouns,
      phonetics: propNounState.phonetics
    });
    
    return { success: true };
  }
  
  return { success: false, message: 'Term not found' };
};

// Get all proper nouns as a flat array
const getAllProperNouns = async () => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  const allNouns = [];
  for (const category in propNounState.properNouns) {
    allNouns.push(...propNounState.properNouns[category]);
  }
  
  return allNouns;
};

// Correct transcript using phonetic matching
const correctTranscriptWithPhonetics = async (transcript) => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  // Split transcript into words
  const words = transcript.split(/\s+/);
  let corrected = [];
  
  // Process each word
  for (const word of words) {
    // Generate phonetic representation of the word
    const wordPhonetic = generatePhonetic(word);
    
    // Check if this phonetic representation matches any of our stored proper nouns
    if (propNounState.phonetics[wordPhonetic]) {
      // Replace with the correct proper noun
      corrected.push(propNounState.phonetics[wordPhonetic]);
    } else {
      // Keep original word
      corrected.push(word);
    }
  }
  
  return corrected.join(' ');
};

// Process transcript with LLM (if API key is provided)
const processWithLLM = async (transcript, apiKey, model = 'gpt-4o') => {
  if (!apiKey) {
    console.log('No API key provided, skipping LLM processing');
    return { 
      success: false, 
      message: 'API key not provided',
      correctedTranscript: transcript 
    };
  }
  
  try {
    // Get all proper nouns for context
    const allNouns = await getAllProperNouns();
    const contextPrompt = allNouns.length > 0 
      ? `When correcting the transcription, be aware that these proper nouns might appear: ${allNouns.join(', ')}. Prefer these terms over similar-sounding words when it makes sense in context.`
      : '';
    
    console.log('Calling OpenAI API with model:', model);
    
    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant specialized in correcting speech-to-text transcription errors, particularly for proper nouns, technical terms, and domain-specific vocabulary. 
            ${contextPrompt}
            
            Your task is to review the entire provided text and make corrections by:
            1. Identifying and correcting any errors in proper nouns, including names of people, places, organizations, and specific terms that may have been transcribed incorrectly as separate words (e.g., "Saint Motel" being split into "Sam" and "Motel").
            2. Correcting any technical terms or jargon that may have been transcribed incorrectly.
            3. Addressing grammatical errors that could have been introduced during transcription.
            
            Be sure to analyze the entire sentence and context to recognize combinations of words that should be proper nouns or specific terms. Return the corrected text only, without any explanations, notes, or quotation marks. If the transcription seems correct as is, return it unchanged.`
          },
          {
            role: 'user',
            content: `Please correct this voice transcription: "${transcript}"`
          }
        ],
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    console.log('OpenAI API response:', data);
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return {
        success: true,
        correctedTranscript: data.choices[0].message.content.trim()
      };
    } else {
      console.error('Invalid API response structure:', data);
      throw new Error('Invalid API response structure');
    }
  } catch (error) {
    console.error('Error processing with LLM:', error);
    // Return the original transcript as fallback
    return {
      success: false,
      message: error.message,
      correctedTranscript: transcript
    };
  }
};

// Extract potential new proper nouns from corrected text
const extractPotentialProperNouns = async (text) => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  const allNouns = await getAllProperNouns();
  const words = text.split(/\s+/);
  
  // Find words starting with capital letters that aren't at the beginning of sentences
  const potentialNouns = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[.,!?;:'"()]/g, ''); // Remove punctuation
    
    // Check if it starts with a capital letter and isn't at the start of a sentence
    if (word.length > 1 && 
        word[0] === word[0].toUpperCase() && 
        word[0] !== word[0].toLowerCase() &&
        !allNouns.includes(word)) {
      
      potentialNouns.push(word);
    }
  }
  
  // Check for multi-word proper nouns (simplified approach)
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 1 && 
        words[i][0] === words[i][0].toUpperCase() && 
        words[i][0] !== words[i][0].toLowerCase() &&
        words[i+1].length > 1 && 
        words[i+1][0] === words[i+1][0].toUpperCase() && 
        words[i+1][0] !== words[i+1][0].toLowerCase()) {
      
      const multiWord = `${words[i].replace(/[.,!?;:'"()]/g, '')} ${words[i+1].replace(/[.,!?;:'"()]/g, '')}`;
      if (!allNouns.includes(multiWord)) {
        potentialNouns.push(multiWord);
      }
    }
  }
  
  return [...new Set(potentialNouns)]; // Return unique values
};

// Process transcript with proper noun correction and email formatting
const processTranscript = async (transcript) => {
  if (!transcript.trim()) return transcript;
  
  console.log('Processing transcript:', transcript);
  console.log('Current settings:', propNounState.settings);
  
  // First, correct with phonetics
  let correctedText = await correctTranscriptWithPhonetics(transcript);
  console.log('After phonetic correction:', correctedText);
  
  // If LLM is enabled and API key is available, process with LLM
  if (propNounState.settings.useLLM && propNounState.settings.apiKey) {
    console.log('LLM processing is enabled and API key is available');
    try {
      console.log('Attempting LLM processing with model:', propNounState.settings.model);
      
      // Use a more specific prompt for email formatting
      const llmResult = await processWithEmailFormatting(
        correctedText,
        propNounState.settings.apiKey,
        propNounState.settings.model
      );
      
      if (llmResult.success) {
        console.log('LLM processing successful');
        console.log('Before LLM:', correctedText);
        correctedText = llmResult.correctedTranscript;
        console.log('After LLM:', correctedText);
        
        // Extract potential new proper nouns for future use
        const newNouns = await extractPotentialProperNouns(correctedText);
        
        // Could optionally add these automatically or suggest them to the user
        console.log('Detected potential new proper nouns:', newNouns);
      } else {
        console.log('LLM processing failed, using phonetic correction only:', llmResult.message);
      }
    } catch (error) {
      console.error('Error in LLM processing:', error);
      // Continue with phonetic correction only
    }
  } else {
    if (!propNounState.settings.useLLM) {
      console.log('LLM processing is disabled in settings');
    } else {
      console.log('LLM processing is enabled but API key is missing');
    }
  }
  
  return correctedText;
};

// Process transcript with LLM for email formatting (if API key is provided)
const processWithEmailFormatting = async (transcript, apiKey, model = 'gpt-4o') => {
  if (!apiKey) {
    console.log('No API key provided, skipping LLM processing');
    return { 
      success: false, 
      message: 'API key not provided',
      correctedTranscript: transcript 
    };
  }
  
  try {
    // Get all proper nouns for context
    const allNouns = await getAllProperNouns();
    const contextPrompt = allNouns.length > 0 
      ? `When correcting the transcription, be aware that these proper nouns might appear: ${allNouns.join(', ')}. Prefer these terms over similar-sounding words when it makes sense in context.`
      : '';
    
    console.log('Calling OpenAI API with model:', model);
    
    // Call OpenAI API with email formatting instructions
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant specialized in correcting speech-to-text transcription errors and formatting text as professional emails or messages. 
            ${contextPrompt}
            
            Your task is to:
            1. Correct any errors in proper nouns, technical terms, and domain-specific vocabulary.
            2. Format the text with proper punctuation, capitalization, and paragraph breaks.
            3. Structure the text like a professional email or message when appropriate:
               - Add a greeting if it seems like the start of a message
               - Organize content into logical paragraphs
               - Add a closing if it seems like the end of a message
               - Fix run-on sentences and improve overall readability
            
            If the text is clearly not meant to be an email (e.g., it's a short command or query), just correct errors and improve formatting without adding email structure.
            
            Return the corrected and formatted text only, without any explanations, notes, or quotation marks.`
          },
          {
            role: 'user',
            content: `Please correct and format this voice transcription: "${transcript}"`
          }
        ],
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`API returned status ${response.status}: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    console.log('OpenAI API response:', data);
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return {
        success: true,
        correctedTranscript: data.choices[0].message.content.trim()
      };
    } else {
      console.error('Invalid API response structure:', data);
      throw new Error('Invalid API response structure');
    }
  } catch (error) {
    console.error('Error processing with LLM:', error);
    // Return the original transcript as fallback
    return {
      success: false,
      message: error.message,
      correctedTranscript: transcript
    };
  }
};

// Update settings
const updateSettings = async (newSettings) => {
  if (!propNounState.isInitialized) await initializePropNoun();
  
  propNounState.settings = { ...propNounState.settings, ...newSettings };
  
  await chrome.storage.local.set({ settings: propNounState.settings });
  
  return { success: true, settings: propNounState.settings };
};

// Export these functions for use in background.js or other scripts
const propNounHandler = {
  initialize: initializePropNoun,
  addProperNoun,
  removeProperNoun,
  getAllProperNouns,
  correctTranscriptWithPhonetics,
  processWithLLM,
  processWithEmailFormatting,
  extractPotentialProperNouns,
  processTranscript,
  updateSettings,
  getSettings: () => propNounState.settings,
  getProperNouns: () => propNounState.properNouns
};

// Initialize on load
initializePropNoun(); 