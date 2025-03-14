// Track recording state
let isRecording = false;
// Uncomment this if you're using a service worker background:
importScripts('lia-phon-handler.js');
// Import LIA PHON handler if using as a service worker
// Uncomment this if you're using a service worker background:
// importScripts('lia-phon-handler.js');

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Skip chrome:// and edge:// pages which don't allow content scripts
  if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
    try {
      // Inject the content script if it's not already there
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: injectContentScript
      });
      
      // Send message to the content script to toggle recording
      chrome.tabs.sendMessage(tab.id, { 
        action: 'toggleRecording'
      }).catch(error => {
        console.error('Error sending message:', error);
        // Don't update icon here - let the content script report success first
      });
    } catch (error) {
      console.error('Error injecting content script:', error);
      // Don't update the icon state since the injection failed
    }
  }
});

// Only set up command listener if the commands API is available
if (chrome.commands) {
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
                function: injectContentScript
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

// Listen for updates from content script and LIA PHON processing requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateRecordingState') {
    isRecording = message.isRecording;
    
    // Update icon based on recording state from content script
    const iconState = isRecording ? 'active' : 'inactive';
    chrome.action.setIcon({
      path: {
        "16": `icons/icon16_${iconState}.png`,
        "48": `icons/icon48_${iconState}.png`,
        "128": `icons/icon128_${iconState}.png`
      },
      tabId: sender.tab.id
    });
    
    sendResponse({success: true});
  }
  
  // Process speech with LIA PHON
  if (message.action === 'processSpeechWithLIAPhon') {
    liaPhonHandler.processTranscript(message.transcript)
      .then(correctedTranscript => {
        sendResponse({
          success: true, 
          correctedTranscript: correctedTranscript
        });
      })
      .catch(error => {
        console.error('Error processing with LIA PHON:', error);
        sendResponse({
          success: false, 
          correctedTranscript: message.transcript
        });
      });
    return true; // Keep the message channel open for async response
  }
  
  // Handle LIA PHON related requests
  if (message.action === 'addProperNoun') {
    liaPhonHandler.addProperNoun(message.term, message.category)
      .then(sendResponse);
    return true;
  }
  
  if (message.action === 'removeProperNoun') {
    liaPhonHandler.removeProperNoun(message.term)
      .then(sendResponse);
    return true;
  }
  
  if (message.action === 'getAllProperNouns') {
    liaPhonHandler.getAllProperNouns()
      .then(sendResponse);
    return true;
  }
  
  if (message.action === 'updateSettings') {
    liaPhonHandler.updateSettings(message.settings)
      .then(sendResponse);
    return true;
  }
  
  if (message.action === 'extractPotentialProperNouns') {
    liaPhonHandler.extractPotentialProperNouns(message.text)
      .then(sendResponse);
    return true;
  }
  
  return true; // Keep the message channel open for async response
});

// Function to inject into page
function injectContentScript() {
  // Check if we've already injected the script
  if (window.__voiceDictationInjected) return;
  window.__voiceDictationInjected = true;
  
  // Global variables
  let recognition = null;
  let isRecording = false;
  let permissionStatus = 'unknown';
  let notificationTimeoutId = null;
  let hasShownNoTextFieldWarning = false;
  
  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);
    
    if (message.action === 'toggleRecording') {
      toggleRecording();
      sendResponse({success: true});
    }
    
    return true; // Keep the message channel open for async response
  });
  
  // Toggle recording state
  async function toggleRecording() {
    if (isRecording) {
      stopRecognition();
    } else {
      const started = await startRecognition();
      // Only update the icon state if recording actually started
      updateRecordingState(started);
    }
  }
  
  // Update the extension icon in the toolbar
  function updateRecordingState(recordingState) {
    chrome.runtime.sendMessage({
      action: 'updateRecordingState',
      isRecording: recordingState
    }).catch(error => {
      console.error('Error updating recording state:', error);
    });
  }
  
  // Always check microphone permission before starting
  async function checkMicrophonePermission() {
    // If we already know permission is granted, return true
    if (permissionStatus === 'granted') {
      return true;
    }
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices.filter(device => device.kind === 'audioinput');
      
      if (audioDevices.length === 0) {
        showNotification('No microphone detected on your device.', 'error');
        permissionStatus = 'no-device';
        return false;
      }
      
      // Request permission explicitly
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // We got permission, stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      permissionStatus = 'granted';
      return true;
    } catch (error) {
      console.error('Microphone permission error:', error);
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        showNotification(
          'Microphone access denied. Please allow microphone access in your browser settings to use voice dictation.',
          'error',
          0 // Don't auto-dismiss
        );
        permissionStatus = 'denied';
      } else if (error.name === 'NotFoundError') {
        showNotification('No microphone found. Please connect a microphone and try again.', 'error');
        permissionStatus = 'no-device';
      } else {
        showNotification(`Microphone error: ${error.message}`, 'error');
        permissionStatus = 'error';
      }
      
      return false;
    }
  }
  
  // Process transcript with LIA PHON
  async function processWithLIAPhon(transcript) {
    let correctedText = transcript;
    
    try {
      // Send message to background script for processing
      const response = await chrome.runtime.sendMessage({
        action: 'processSpeechWithLIAPhon',
        transcript: transcript
      });
      
      if (response && response.success) {
        correctedText = response.correctedTranscript;
      }
    } catch (error) {
      console.error('Error processing with LIA PHON:', error);
    }
    
    return correctedText;
  }
  
  // Create and show notification with improved UI
  function showNotification(message, type, duration = 5000) {
    // Clear any existing notification timeout
    if (notificationTimeoutId) {
      clearTimeout(notificationTimeoutId);
      notificationTimeoutId = null;
    }
    
    // Remove any existing notification
    removeNotification();
    
    // Create notification container
    const notificationEl = document.createElement('div');
    notificationEl.id = 'voice-dictation-notification';
    
    // Set styles for the notification
    Object.assign(notificationEl.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '9999999',
      maxWidth: '320px',
      padding: '16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      lineHeight: '1.5',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      animation: 'voiceDictationFadeIn 0.3s ease-out',
      transition: 'all 0.3s ease'
    });
    
    // Set type-specific styles
    if (type === 'error') {
      Object.assign(notificationEl.style, {
        backgroundColor: '#FFF5F5',
        color: '#E53E3E',
        border: '1px solid #FEB2B2'
      });
    } else if (type === 'warning') {
      Object.assign(notificationEl.style, {
        backgroundColor: '#FFFAF0',
        color: '#DD6B20',
        border: '1px solid #FBD38D'
      });
    } else if (type === 'info') {
      Object.assign(notificationEl.style, {
        backgroundColor: '#EBF8FF',
        color: '#3182CE',
        border: '1px solid #BEE3F8'
      });
    } else if (type === 'success') {
      Object.assign(notificationEl.style, {
        backgroundColor: '#F0FFF4',
        color: '#38A169',
        border: '1px solid #C6F6D5'
      });
    }
    
    // Create message container
    const messageContainer = document.createElement('div');
    messageContainer.style.flexGrow = '1';
    messageContainer.style.marginRight = '10px';
    
    // Create icon based on notification type
    const iconContainer = document.createElement('div');
    iconContainer.style.marginRight = '12px';
    iconContainer.style.display = 'inline-flex';
    
    // Add appropriate icon based on type
    let iconSvg = '';
    if (type === 'error') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (type === 'info') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    } else if (type === 'success') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    }
    
    iconContainer.innerHTML = iconSvg;
    
    // Create title based on type
    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = 'bold';
    titleEl.style.marginBottom = '4px';
    
    if (type === 'error') titleEl.textContent = 'Error';
    else if (type === 'warning') titleEl.textContent = 'Warning';
    else if (type === 'info') titleEl.textContent = 'Info';
    else if (type === 'success') titleEl.textContent = 'Success';
    
    // Create message text
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    
    // Add title and message to container
    messageContainer.appendChild(titleEl);
    messageContainer.appendChild(messageEl);
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      fontSize: '22px',
      color: 'inherit',
      cursor: 'pointer',
      marginLeft: '8px',
      marginRight: '0px',
      padding: '0',
      lineHeight: '1',
      opacity: '0.7',
      alignSelf: 'flex-start'
    });
    
    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.opacity = '1';
    });
    
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.opacity = '0.7';
    });
    
    closeBtn.onclick = removeNotification;
    
    // Assemble notification
    notificationEl.appendChild(iconContainer);
    notificationEl.appendChild(messageContainer);
    notificationEl.appendChild(closeBtn);
    
    // Create and append style for animation if it doesn't exist
    if (!document.getElementById('voice-dictation-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'voice-dictation-styles';
      styleEl.textContent = `
        @keyframes voiceDictationFadeIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes voiceDictationFadeOut {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-20px); }
        }
        #voice-dictation-notification.hiding {
          animation: voiceDictationFadeOut 0.3s ease-out forwards;
        }
      `;
      document.head.appendChild(styleEl);
    }
    
    // Add to document
    document.body.appendChild(notificationEl);
    
    // Set timeout to remove notification after duration (if not 0)
    if (duration > 0) {
      notificationTimeoutId = setTimeout(() => {
        removeNotification();
      }, duration);
    }
    
    return notificationEl;
  }
  
  // Remove notification with animation
  function removeNotification() {
    const notificationEl = document.getElementById('voice-dictation-notification');
    if (notificationEl) {
      notificationEl.classList.add('hiding');
      setTimeout(() => {
        if (notificationEl.parentNode) {
          notificationEl.parentNode.removeChild(notificationEl);
        }
      }, 300); // Match animation duration
    }
    
    if (notificationTimeoutId) {
      clearTimeout(notificationTimeoutId);
      notificationTimeoutId = null;
    }
  }
  
  // Helper function to check if an element is a valid text input element
  function isValidTextInputElement(element) {
    if (!element) return false;
    
    // Check if element is hidden
    if (element.offsetParent === null && 
        !(element.tagName === 'BODY') && // Body is a special case
        getComputedStyle(element).display !== 'contents') {
      return false;
    }
    
    // Check if element is disabled or readonly
    if (element.disabled || element.readOnly) {
      return false;
    }
    
    // Check if element or any parent has aria-hidden="true"
    let parent = element;
    while (parent) {
      if (parent.getAttribute && parent.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      parent = parent.parentElement;
    }
    
    // Check for valid input types
    return (
      element.isContentEditable ||
      (element.tagName === 'TEXTAREA') ||
      (element.tagName === 'INPUT' && 
       ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(element.type))
    );
  }
  
  // Find a valid text input element on the page
  function findValidTextInputElement() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], textarea, [contenteditable="true"]');
    
    for (const input of inputs) {
      if (isValidTextInputElement(input)) {
        return input;
      }
    }
    
    return null;
  }
  
  // Check if there is a valid text field selected (called once at start of recording)
  function hasValidTextFieldSelected() {
    const activeElement = document.activeElement;
    return isValidTextInputElement(activeElement);
  }
  
  // Check if there's a valid text field on the page
  function hasValidTextField() {
    return !!findValidTextInputElement();
  }
  
  // Initialize speech recognition
  async function initializeSpeechRecognition() {
    // Check if already initialized
    if (recognition) {
      return true;
    }
    
    // Check browser support for speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showNotification('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.', 'error');
      return false;
    }
    
    // Always check microphone permission before proceeding
    const permissionGranted = await checkMicrophonePermission();
    if (!permissionGranted) {
      return false;
    }
    
    // Create recognition instance
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    // Set up recognition events
    recognition.onstart = function() {
      isRecording = true;
      showNotification('Voice dictation active. Speaking will enter text into your selected field.', 'success', 3000);
      
      // Check for valid text field once at start, and show warning if needed
      if (!hasValidTextFieldSelected()) {
        if (hasValidTextField()) {
          showNotification('Please click into a text field to dictate text.', 'warning', 5000);
          hasShownNoTextFieldWarning = true;
        } else {
          showNotification('No text fields found on this page. Voice dictation may not work here.', 'error', 5000);
          hasShownNoTextFieldWarning = true;
        }
      }
    };
    
    recognition.onresult = function(event) {
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        }
      }
      
      // Insert text if we have a final result
      if (finalTranscript) {
        // Process transcript with LIA PHON for proper noun correction
        processWithLIAPhon(finalTranscript).then(correctedTranscript => {
          // After correction, insert the text
          const textInserted = insertTextAtCursor(correctedTranscript + ' ');
          
          // Extract potential new proper nouns for learning
          chrome.runtime.sendMessage({
            action: 'extractPotentialProperNouns',
            text: correctedTranscript
          }).catch(error => {
            console.error('Error extracting proper nouns:', error);
          });
          
          // Only show a warning if text insertion failed AND we haven't already shown a warning
          if (!textInserted && !hasShownNoTextFieldWarning) {
            showNotification('Please click into a text field to dictate text.', 'warning', 5000);
            hasShownNoTextFieldWarning = true;
          }
        });
      }
    };
    
    recognition.onerror = function(event) {
      console.error('Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        permissionStatus = 'denied';
        showNotification('Microphone access denied. Please allow microphone access in your browser settings.', 'error', 0);
        stopRecognition();
      } else if (event.error === 'no-speech') {
        // This is a common error and not critical, just show a gentle reminder
        showNotification('No speech detected. Please speak clearly.', 'info', 3000);
        // Don't stop recognition on no-speech error
      } else if (event.error === 'audio-capture') {
        showNotification('No microphone detected. Please connect a microphone and try again.', 'error');
        permissionStatus = 'no-device';
        stopRecognition();
      } else if (event.error === 'network') {
        showNotification('Network error occurred. Please check your connection.', 'error');
        stopRecognition();
      } else if (event.error === 'aborted') {
        // This is usually when the user stops recording, so we don't need to show an error
        console.log('Speech recognition aborted');
      } else {
        showNotification(`Speech recognition error: ${event.error}. Please try again.`, 'error');
        stopRecognition();
      }
    };
    
    recognition.onend = function() {
      if (isRecording) {
        // Restart if it ended unexpectedly but should be recording
        try {
          recognition.start();
          console.log('Restarted speech recognition');
        } catch (e) {
          console.error('Error restarting recognition:', e);
          isRecording = false;
          updateRecordingState(false);
          
          showNotification('Speech recognition stopped unexpectedly.', 'error');
        }
      } else {
        showNotification('Voice dictation stopped.', 'info', 2000);
      }
    };
    
    return true;
  }
  
  // Start speech recognition
  async function startRecognition() {
    // Reset the warning flag at the start of each recording session
    hasShownNoTextFieldWarning = false;
    
    const initialized = await initializeSpeechRecognition();
    if (!initialized || !recognition) {
      updateRecordingState(false);
      return false;
    }
    
    try {
      recognition.start();
      isRecording = true;
      return true;
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      showNotification(`Could not start speech recognition: ${error.message}`, 'error');
      updateRecordingState(false);
      return false;
    }
  }
  
  // Stop speech recognition
  function stopRecognition() {
    if (recognition) {
      try {
        recognition.stop();
        console.log('Speech recognition stopped');
      } catch (error) {
        console.error('Error stopping speech recognition:', error);
      }
    }
    
    isRecording = false;
    updateRecordingState(false);
  }
  
  // Insert text at cursor position
  function insertTextAtCursor(text) {
    console.log('Attempting to insert text:', text);
    
    // Get the active element
    const activeElement = document.activeElement;
    console.log('Active element:', activeElement.tagName, activeElement);
    
    // Check if the active element is a valid text input element
    if (!isValidTextInputElement(activeElement)) {
      console.log('No suitable active element found for text insertion');
      
      // Find a valid text input element on the page
      const inputElement = findValidTextInputElement();
      
      if (inputElement) {
        // Don't try a recursive approach
        try {
          // Focus the element
          inputElement.focus();
          console.log('Focused element:', inputElement);
          
          // Try to insert the text directly based on the element type
          if (inputElement.isContentEditable) {
            // For contentEditable elements, use selection API if available
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(text));
              
              // Move cursor to end of inserted text
              range.setStartAfter(range.endContainer);
              range.setEndAfter(range.endContainer);
              selection.removeAllRanges();
              selection.addRange(range);
              return true;
            } else {
              // Fallback if selection API is not working
              inputElement.textContent += text;
              return true;
            }
          } else if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
            // For input and textarea elements, append to the end
            inputElement.value += text;
            // Fire input event to trigger any listeners
            const inputEvent = new Event('input', { bubbles: true });
            inputElement.dispatchEvent(inputEvent);
            return true;
          }
        } catch (error) {
          console.error('Error focusing or inserting text:', error);
          return false;
        }
      } else {
        // Don't show notification here, let the caller decide
        return false;
      }
    }
    
    try {
      if (activeElement.isContentEditable) {
        // For contentEditable elements (like rich text editors)
        console.log('Inserting into contentEditable element');
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          
          // Move cursor to end of inserted text
          range.setStartAfter(range.endContainer);
          range.setEndAfter(range.endContainer);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        } else {
          // No selection range, just append text
          activeElement.textContent += text;
          return true;
        }
      } else if (activeElement.tagName === 'TEXTAREA' || 
                (activeElement.tagName === 'INPUT' && 
                ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(activeElement.type))) {
        // For input and textarea elements
        console.log('Inserting into input/textarea element');
        const start = activeElement.selectionStart;
        const end = activeElement.selectionEnd;
        const value = activeElement.value;
        
        // Insert text at cursor position
        activeElement.value = value.substring(0, start) + text + value.substring(end);
        
        // Move cursor to end of inserted text
        activeElement.selectionStart = activeElement.selectionEnd = start + text.length;
        
        // Fire input event to trigger any listeners
        const inputEvent = new Event('input', { bubbles: true });
        activeElement.dispatchEvent(inputEvent);
        return true;
      }
    } catch (error) {
      console.error('Error inserting text:', error);
      return false;
    }
    
    return false;
  }
  
  // Listen for focus events to reset warnings when a user clicks into a text field
  document.addEventListener('focusin', function(e) {
    if (isRecording && isValidTextInputElement(e.target)) {
      // User focused a valid text field, remove any warnings
      hasShownNoTextFieldWarning = false;
      removeNotification();
    }
  });
  
  // Add keyboard listener for Shift key within the document
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Shift' && !event.repeat) {
      toggleRecording();
    }
  });
}