// Voice Dictation Extension - Background Script

// Try to load environment variables if available
let envVarsLoaded = false;
try {
  importScripts('.env.js');
  if (typeof ENV_VARS !== 'undefined') {
    console.log('Environment variables loaded successfully');
    envVarsLoaded = true;
  } else {
    console.warn('ENV_VARS object not found in .env.js');
  }
} catch (e) {
  console.warn('No .env.js file found or error loading it:', e);
}

// Load configuration
let configLoaded = false;
try {
  importScripts('lib/config.js');
  if (typeof self.config !== 'undefined') {
    console.log('Configuration loaded successfully');
    configLoaded = true;
    
    // Verify config has been populated with env vars
    if (envVarsLoaded && self.config.features) {
      console.log('LLM usage is:', self.config.features.useLLM ? 'ENABLED' : 'DISABLED');
      console.log('Using model:', self.config.openai.defaultModel);
      console.log('API key status:', self.config.openai.apiKey ? 'PROVIDED' : 'MISSING');
    }
  } else {
    console.warn('Config object not found after loading lib/config.js');
  }
} catch (e) {
  console.error('Error loading config:', e);
}

// Load proper noun handler
try {
  importScripts('lib/prop-noun-handler.js');
  console.log('Proper noun handler loaded');
  
  // Initialize the proper noun handler
  if (typeof propNounHandler !== 'undefined' && propNounHandler.initialize) {
    propNounHandler.initialize().then(success => {
      if (success) {
        console.log('Proper noun handler initialized successfully');
        const settings = propNounHandler.getSettings();
        console.log('Proper noun handler settings:', settings);
      } else {
        console.warn('Proper noun handler initialization failed');
      }
    });
  } else {
    console.warn('Proper noun handler object not found or missing initialize method');
  }
} catch (e) {
  console.error('Error loading proper noun handler:', e);
}

// Track recording state
let isRecording = false;

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Skip chrome:// and edge:// pages which don't allow content scripts
  if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
    try {
      // Inject the content script if it's not already there
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js']
      });
      
      // Send message to the content script to toggle recording
      chrome.tabs.sendMessage(tab.id, { 
        action: 'toggleRecording'
      }).catch(error => {
        console.error('Error sending message:', error);
      });
    } catch (error) {
      console.error('Error injecting content script:', error);
    }
  }
});

// Only set up command listener if the commands API is available
if (typeof chrome.commands !== 'undefined') {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-recording") {
      // Get the active tab
      chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
        if (tabs.length > 0) {
          const tab = tabs[0];
          
          // Skip chrome:// and edge:// pages
          if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
            try {
              // Inject the content script if it's not already there
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-script.js']
              });
              
              // Send message to toggle recording
              chrome.tabs.sendMessage(tab.id, { 
                action: 'toggleRecording'
              }).catch(error => {
                console.error('Error sending toggle command:', error);
              });
            } catch (error) {
              console.error('Error injecting content script for keyboard command:', error);
            }
          }
        }
      });
    }
  });
}

// Listen for updates from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateRecordingState') {
    isRecording = message.isRecording;
    
    // Update icon based on recording state from content script
    const iconState = isRecording ? 'active' : 'inactive';
    try {
      chrome.action.setIcon({
        path: {
          "16": `icons/icon16_${iconState}.png`,
          "48": `icons/icon48_${iconState}.png`,
          "128": `icons/icon128_${iconState}.png`
        },
        tabId: sender.tab?.id
      });
    } catch (error) {
      console.error('Error updating icon:', error);
    }
    
    sendResponse({success: true});
    return true;
  }
  
  // Process transcript with proper noun handler
  if (message.action === 'processTranscript') {
    try {
      if (typeof propNounHandler !== 'undefined' && propNounHandler.processTranscript) {
        console.log('Processing transcript with proper noun handler:', message.transcript);
        propNounHandler.processTranscript(message.transcript)
          .then(correctedTranscript => {
            console.log('Transcript processed successfully');
            console.log('Original:', message.transcript);
            console.log('Corrected:', correctedTranscript);
            sendResponse({
              success: true, 
              processedText: correctedTranscript
            });
          })
          .catch(error => {
            console.error('Error processing transcript:', error);
            sendResponse({
              success: false, 
              processedText: message.transcript
            });
          });
      } else {
        console.warn('Proper noun handler not available, returning original transcript');
        sendResponse({
          success: false, 
          processedText: message.transcript
        });
      }
    } catch (error) {
      console.error('Error in processTranscript handler:', error);
      sendResponse({
        success: false, 
        processedText: message.transcript
      });
    }
    return true; // Keep the message channel open for async response
  }
  
  // Process speech with proper noun handler (legacy method)
  if (message.action === 'processSpeechWithPropNoun') {
    try {
      if (typeof propNounHandler !== 'undefined' && propNounHandler.processTranscript) {
        propNounHandler.processTranscript(message.transcript)
          .then(correctedTranscript => {
            sendResponse({
              success: true, 
              correctedTranscript: correctedTranscript
            });
          })
          .catch(error => {
            console.error('Error processing with proper noun handler:', error);
            sendResponse({
              success: false, 
              correctedTranscript: message.transcript
            });
          });
      } else {
        console.warn('Proper noun handler not available, returning original transcript');
        sendResponse({
          success: false, 
          correctedTranscript: message.transcript
        });
      }
    } catch (error) {
      console.error('Error in processSpeechWithPropNoun handler:', error);
      sendResponse({
        success: false, 
        correctedTranscript: message.transcript
      });
    }
    return true; // Keep the message channel open for async response
  }
  
  // Handle proper noun related requests
  if (message.action === 'addProperNoun' && typeof propNounHandler !== 'undefined') {
    propNounHandler.addProperNoun(message.term, message.category)
      .then(sendResponse)
      .catch(error => {
        console.error('Error in addProperNoun:', error);
        sendResponse({success: false, error: error.message});
      });
    return true;
  }
  
  if (message.action === 'removeProperNoun' && typeof propNounHandler !== 'undefined') {
    propNounHandler.removeProperNoun(message.term)
      .then(sendResponse)
      .catch(error => {
        console.error('Error in removeProperNoun:', error);
        sendResponse({success: false, error: error.message});
      });
    return true;
  }
  
  if (message.action === 'getAllProperNouns' && typeof propNounHandler !== 'undefined') {
    propNounHandler.getAllProperNouns()
      .then(sendResponse)
      .catch(error => {
        console.error('Error in getAllProperNouns:', error);
        sendResponse([]);
      });
    return true;
  }
  
  if (message.action === 'updateSettings' && typeof propNounHandler !== 'undefined') {
    propNounHandler.updateSettings(message.settings)
      .then(sendResponse)
      .catch(error => {
        console.error('Error in updateSettings:', error);
        sendResponse({success: false, error: error.message});
      });
    return true;
  }
  
  if (message.action === 'extractPotentialProperNouns' && typeof propNounHandler !== 'undefined') {
    propNounHandler.extractPotentialProperNouns(message.text)
      .then(sendResponse)
      .catch(error => {
        console.error('Error in extractPotentialProperNouns:', error);
        sendResponse([]);
      });
    return true;
  }
  
  return true; // Keep the message channel open for async response
});