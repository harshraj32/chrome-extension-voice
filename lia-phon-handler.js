// lia-phon-handler.js - Proper Noun Correction for Voice Dictation

// Global state for proper noun identification
const liaPhonState = {
    properNouns: {},
    phonetics: {},
    isInitialized: false,
    settings: {
      apiKey: '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',
      useLLM: true,
      autoCorrect: true,
      model: 'gpt-3.5-turbo'
    }
  };
  
  // Initialize the proper noun database
  const initializeLiaPhon = async () => {
    try {
      // Load stored proper nouns and their phonetic representations
      const storedData = await chrome.storage.local.get(['properNouns', 'phonetics', 'settings']);
      
      if (storedData.properNouns) {
        liaPhonState.properNouns = storedData.properNouns;
      } else {
        // Initialize with empty categories
        liaPhonState.properNouns = {
          people: [],
          places: [],
          organizations: [],
          technical: [],
          other: []
        };
      }
      
      if (storedData.phonetics) {
        liaPhonState.phonetics = storedData.phonetics;
      } else {
        liaPhonState.phonetics = {};
      }
      
      if (storedData.settings) {
        liaPhonState.settings = { ...liaPhonState.settings, ...storedData.settings };
      }
      
      liaPhonState.isInitialized = true;
      console.log('LIA PHON system initialized', liaPhonState);
      return true;
    } catch (error) {
      console.error('Failed to initialize LIA PHON system:', error);
      return false;
    }
  };
  
  // Generate phonetic representation using LIA PHON algorithm
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
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
    if (!liaPhonState.properNouns[category].includes(term)) {
      // Add to proper nouns list
      liaPhonState.properNouns[category].push(term);
      
      // Generate and store phonetic representation
      const phonetic = generatePhonetic(term);
      liaPhonState.phonetics[phonetic] = term;
      
      // Save to storage
      await chrome.storage.local.set({
        properNouns: liaPhonState.properNouns,
        phonetics: liaPhonState.phonetics
      });
      
      return { success: true, term, phonetic };
    }
    
    return { success: false, message: 'Term already exists' };
  };
  
  // Remove a proper noun
  const removeProperNoun = async (term) => {
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
    let found = false;
    
    // Find and remove from proper nouns
    for (const category in liaPhonState.properNouns) {
      const index = liaPhonState.properNouns[category].indexOf(term);
      if (index !== -1) {
        liaPhonState.properNouns[category].splice(index, 1);
        found = true;
        break;
      }
    }
    
    if (found) {
      // Remove phonetic mapping
      const phonetic = generatePhonetic(term);
      delete liaPhonState.phonetics[phonetic];
      
      // Save to storage
      await chrome.storage.local.set({
        properNouns: liaPhonState.properNouns,
        phonetics: liaPhonState.phonetics
      });
      
      return { success: true };
    }
    
    return { success: false, message: 'Term not found' };
  };
  
  // Get all proper nouns as a flat array
  const getAllProperNouns = async () => {
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
    const allNouns = [];
    for (const category in liaPhonState.properNouns) {
      allNouns.push(...liaPhonState.properNouns[category]);
    }
    
    return allNouns;
  };
  
  // Correct transcript using phonetic matching
  const correctTranscriptWithPhonetics = async (transcript) => {
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
    // Split transcript into words
    const words = transcript.split(/\s+/);
    let corrected = [];
    
    // Process each word
    for (const word of words) {
      // Generate phonetic representation of the word
      const wordPhonetic = generatePhonetic(word);
      
      // Check if this phonetic representation matches any of our stored proper nouns
      if (liaPhonState.phonetics[wordPhonetic]) {
        // Replace with the correct proper noun
        corrected.push(liaPhonState.phonetics[wordPhonetic]);
      } else {
        // Keep original word
        corrected.push(word);
      }
    }
    
    return corrected.join(' ');
  };
  
  // Process transcript with LLM (if API key is provided)
  const processWithLLM = async (transcript, apiKey, model = 'gpt-3.5-turbo') => {
    if (!apiKey) {
      return { success: false, message: 'API key not provided' };
    }
    
    try {
      // Get all proper nouns for context
      const allNouns = await getAllProperNouns();
      const contextPrompt = allNouns.length > 0 
        ? `When correcting the transcription, be aware that these proper nouns might appear: ${allNouns.join(', ')}. Prefer these terms over similar-sounding words when it makes sense in context.`
        : '';
      
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
              content: `You are an AI assistant that corrects speech-to-text transcription errors, particularly for proper nouns, technical terms, and domain-specific vocabulary. 
              ${contextPrompt}
              
              Your task is to correct any transcription errors in the provided text, focusing on fixing:
              1. Proper nouns (names, places, organizations)
              2. Technical terms and jargon
              3. Grammatical errors introduced by speech recognition
              
              Return only the corrected text without explanations or notes. If the transcription seems correct as is, return it unchanged.`
            },
            {
              role: 'user',
              content: `Please correct this voice transcription: "${transcript}"`
            }
          ],
          temperature: 0.3
        })
      });
      
      const data = await response.json();
      
      if (data.choices && data.choices[0]) {
        return {
          success: true,
          correctedTranscript: data.choices[0].message.content.trim()
        };
      } else {
        throw new Error('Invalid API response');
      }
    } catch (error) {
      console.error('Error processing with LLM:', error);
      return {
        success: false,
        message: error.message,
        correctedTranscript: transcript
      };
    }
  };
  
  // Extract potential new proper nouns from corrected text
  const extractPotentialProperNouns = async (text) => {
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
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
          !allNouns.includes(word) &&
          (i > 0 || !words[i-1].match(/[.!?]$/))) {
        
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
  
  // Process transcript with LIA PHON
  const processTranscript = async (transcript) => {
    if (!transcript.trim()) return transcript;
    
    // First, correct with phonetics
    let correctedText = await correctTranscriptWithPhonetics(transcript);
    
    // If LLM is enabled and API key is available, process with LLM
    if (liaPhonState.settings.useLLM && liaPhonState.settings.apiKey) {
      const llmResult = await processWithLLM(
        correctedText,
        liaPhonState.settings.apiKey,
        liaPhonState.settings.model
      );
      
      if (llmResult.success) {
        correctedText = llmResult.correctedTranscript;
        
        // Extract potential new proper nouns for future use
        const newNouns = await extractPotentialProperNouns(correctedText);
        
        // Could optionally add these automatically or suggest them to the user
        console.log('Detected potential new proper nouns:', newNouns);
      }
    }
    
    return correctedText;
  };
  
  // Update settings
  const updateSettings = async (newSettings) => {
    if (!liaPhonState.isInitialized) await initializeLiaPhon();
    
    liaPhonState.settings = { ...liaPhonState.settings, ...newSettings };
    
    await chrome.storage.local.set({ settings: liaPhonState.settings });
    
    return { success: true, settings: liaPhonState.settings };
  };
  
  // Export these functions for use in background.js or other scripts
  const liaPhonHandler = {
    initialize: initializeLiaPhon,
    addProperNoun,
    removeProperNoun,
    getAllProperNouns,
    correctTranscriptWithPhonetics,
    processWithLLM,
    extractPotentialProperNouns,
    processTranscript,
    updateSettings,
    getSettings: () => liaPhonState.settings,
    getProperNouns: () => liaPhonState.properNouns
  };
  
  // Initialize on load
  initializeLiaPhon();