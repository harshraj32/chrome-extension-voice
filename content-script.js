// Voice Dictation Content Script
// This script handles the actual speech recognition and text insertion

// Check if we've already injected the script
if (window.__voiceDictationInjected) {
  console.log('Voice dictation already injected, skipping');
} else {
  window.__voiceDictationInjected = true;
  
  console.log('Voice dictation content script injected');
  
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
      try {
        // Try to request permissions first directly to handle explicit permission prompt
        await requestMicrophonePermission();
        const started = await startRecognition();
        // Only update the icon state if recording actually started
        updateRecordingState(started);
      } catch (error) {
        console.error('Error in toggle recording:', error);
        updateRecordingState(false);
      }
    }
  }
  
  // Separate function to explicitly request microphone permission
  async function requestMicrophonePermission() {
    try {
      console.log('Explicitly requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Log successful microphone access
      console.log('Microphone access explicitly granted, stopping stream');
      
      // We got permission, stop all tracks
      stream.getTracks().forEach(track => {
        track.stop();
      });
      
      permissionStatus = 'granted';
      return true;
    } catch (error) {
      console.error('Explicit permission request failed:', error);
      
      // Handle different error types
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        permissionStatus = 'denied';
        showNotification('Microphone access denied. Please enable it in your browser settings and try again.', 5000);
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        showNotification('No microphone found. Please connect a microphone and try again.', 5000);
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        showNotification('Your microphone is not accessible or is being used by another application.', 5000);
      } else {
        showNotification('Error accessing microphone: ' + error.message, 5000);
      }
      
      throw error; // Rethrow to be handled by caller
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
  
  // Start speech recognition
  async function startRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
      showNotification('Speech recognition not supported in this browser.');
      return false;
    }
    
    const activeElement = findValidTextInputElement();
    if (!activeElement) {
      if (!hasShownNoTextFieldWarning) {
        showNotification('Please click on a text field first.');
        hasShownNoTextFieldWarning = true;
        setTimeout(() => { hasShownNoTextFieldWarning = false; }, 5000);
      }
      return false;
    }
    
    // Check microphone permission first
    try {
      await requestMicrophonePermission();
    } catch (error) {
      console.error('Failed to get microphone permission:', error);
      return false;
    }
    
    try {
      recognition = new webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      let finalTranscript = '';
      let interimTranscript = '';
      
      recognition.onstart = function() {
        isRecording = true;
        showNotification('Recording started...');
        console.log('Speech recognition started');
      };
      
      recognition.onresult = function(event) {
        interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
            
            // Process the transcript with proper noun correction if needed
            processAndInsertText(finalTranscript);
            finalTranscript = '';
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
      };
      
      recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        
        // Handle different error types
        if (event.error === 'not-allowed') {
          permissionStatus = 'denied';
          showNotification('Microphone access denied. Please enable it in your browser settings and try again.', 5000);
        } else if (event.error === 'audio-capture') {
          showNotification('No microphone found or it is not accessible. Please check your microphone.', 5000);
        } else if (event.error === 'network') {
          showNotification('Network error occurred. Please check your internet connection.', 5000);
        } else if (event.error === 'aborted') {
          showNotification('Speech recognition was aborted.', 3000);
        } else if (event.error === 'no-speech') {
          showNotification('No speech detected. Please try speaking again.', 3000);
        } else {
          showNotification('Error in speech recognition: ' + event.error, 3000);
        }
        
        stopRecognition();
      };
      
      recognition.onend = function() {
        stopRecognition();
      };
      
      recognition.start();
      return true;
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      showNotification('Failed to start speech recognition: ' + error.message, 5000);
      return false;
    }
  }
  
  // Stop speech recognition
  function stopRecognition() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        console.error('Error stopping recognition:', e);
      }
    }
    
    isRecording = false;
    updateRecordingState(false);
    showNotification('Recording stopped.');
    console.log('Speech recognition stopped');
  }
  
  // Process and insert text into the active element
  function processAndInsertText(text) {
    if (!text.trim()) return;
    
    console.log('Processing text in content script:', text);
    
    // Send the text to the background script for processing
    chrome.runtime.sendMessage({
      action: 'processTranscript',
      transcript: text
    }, response => {
      console.log('Received response from background script:', response);
      
      if (response && response.processedText) {
        console.log('Original text:', text);
        console.log('Processed text:', response.processedText);
        insertTextAtCursor(response.processedText);
      } else {
        console.log('No processed text received, using original');
        insertTextAtCursor(text);
      }
    });
  }
  
  // Insert text at the cursor position in the active element
  function insertTextAtCursor(text) {
    const activeElement = findValidTextInputElement();
    if (!activeElement) return;
    
    if (activeElement.isContentEditable) {
      // For contentEditable elements (like Gmail compose)
      document.execCommand('insertText', false, text + ' ');
    } else {
      // For standard input elements
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      const value = activeElement.value;
      
      activeElement.value = value.substring(0, start) + text + ' ' + value.substring(end);
      
      // Move cursor to the end of the inserted text
      activeElement.selectionStart = activeElement.selectionEnd = start + text.length + 1;
      
      // Trigger input event to notify the application of the change
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  
  // Find a valid text input element (input, textarea, or contentEditable)
  function findValidTextInputElement() {
    const activeElement = document.activeElement;
    
    if (isValidTextInputElement(activeElement)) {
      return activeElement;
    }
    
    // If the active element is not valid, try to find a valid one within it
    // (useful for complex editors like Gmail)
    if (activeElement.querySelector) {
      const inputInside = activeElement.querySelector('[contenteditable="true"]');
      if (inputInside) {
        return inputInside;
      }
    }
    
    return null;
  }
  
  // Check if an element is a valid text input
  function isValidTextInputElement(element) {
    if (!element) return false;
    
    // Check for contentEditable elements
    if (element.isContentEditable) return true;
    
    // Check for input and textarea elements
    if ((element.tagName === 'INPUT' && 
         (element.type === 'text' || element.type === 'search' || element.type === 'email')) || 
        element.tagName === 'TEXTAREA') {
      return true;
    }
    
    return false;
  }
  
  // Show notification with optional timeout
  function showNotification(message, timeout = 3000) {
    removeNotification();
    
    const notification = document.createElement('div');
    notification.id = 'voice-dictation-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      max-width: 300px;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    notificationTimeoutId = setTimeout(removeNotification, timeout);
  }
  
  // Remove notification
  function removeNotification() {
    if (notificationTimeoutId) {
      clearTimeout(notificationTimeoutId);
      notificationTimeoutId = null;
    }
    
    const notification = document.getElementById('voice-dictation-notification');
    if (notification) {
      notification.remove();
    }
  }
  
  // Add keyboard shortcut for toggling recording
  document.addEventListener('keydown', function(event) {
    // Check for Alt+R key press (matching the manifest command)
    if (event.altKey && event.key === 'r') {
      // Prevent default behavior
      event.preventDefault();
      // Toggle recording only when the key is pressed, not when it's released
      if (!event.repeat) {
        toggleRecording();
      }
    }
  });
} 