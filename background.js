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

// Listen for keyboard commands - change this in manifest.json to "Command+;"
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

// Listen for updates from content script
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
  
  return true; // Keep the message channel open for async response
});

// Function to inject into page
function injectContentScript() {
  // Check if we've already injected the script
  if (window.__voiceDictationInjected) return;
  window.__voiceDictationInjected = true;
  
  console.log('Voice dictation content script injected');
  
  // Global variables
  let recognition = null;
  let isRecording = false;
  let permissionStatus = 'unknown';
  let notificationTimeoutId = null;
  let textFieldCheckTimeoutId = null; // Changed from interval to timeout
  let hasShownNoTextFieldWarning = false;
  let lastNotificationTime = 0; // Track when the last notification was shown
  const MIN_NOTIFICATION_INTERVAL = 5000; // Minimum time between similar notifications (5 seconds)
  
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
      // Try to request permissions first directly to handle explicit permission prompt
      try {
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
      
      return true;
    } catch (error) {
      console.error('Explicit permission request failed:', error);
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
  
  // Always check microphone permission before starting
  async function checkMicrophonePermission() {
    // If we already know permission is granted, return true
    if (permissionStatus === 'granted') {
      console.log('Permission already granted, skipping check');
      return true;
    }
    
    try {
      console.log('Checking for available media devices...');
      
      // Make sure we have the mediaDevices API
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.error('mediaDevices API not available in this browser');
        showNotification('Your browser does not support microphone access. Please try a different browser.', 'error');
        return false;
      }
      
      // First check if we already have permission by enumerating devices
      // without requesting permission (to avoid double permission dialog)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // If we can see device labels, we likely already have permission
        const hasLabels = devices.some(device => device.label && device.label.length > 0);
        
        if (hasLabels) {
          console.log('Device labels available, permission likely granted');
          
          // Count audio devices
          const audioDevices = devices.filter(device => device.kind === 'audioinput');
          console.log('Available audio devices:', audioDevices);
          
          if (audioDevices.length > 0) {
            console.log('Audio devices found with labels, assuming permission granted');
            permissionStatus = 'granted';
            return true;
          } else {
            console.error('No audio input devices found');
            showNotification('No microphone detected on your device. Please connect a microphone and try again.', 'error');
            permissionStatus = 'no-device';
            return false;
          }
        } else {
          console.log('No device labels, need to request permission');
        }
      } catch (error) {
        console.error('Error checking initial devices:', error);
      }
      
      // Request permission explicitly - use the simplest possible constraints
      console.log('Requesting audio permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true  // Use simplest possible constraint
      });
      
      // Log successful microphone access
      console.log('Microphone access granted:', stream);
      
      // Now that we have permission, enumerate devices again to check for microphones
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices.filter(device => device.kind === 'audioinput');
      console.log('Audio devices after permission:', audioDevices);
      
      // We got permission, stop all tracks
      stream.getTracks().forEach(track => {
        console.log('Stopping track:', track);
        track.stop();
      });
      
      if (audioDevices.length === 0) {
        console.error('No audio input devices found even after permission granted');
        showNotification('Permission granted but no microphone detected. Please connect a microphone and try again.', 'error');
        permissionStatus = 'no-device';
        return false;
      }
      
      permissionStatus = 'granted';
      return true;
    } catch (error) {
      console.error('Microphone permission error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
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
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        showNotification('Cannot access microphone. It may be in use by another application.', 'error');
        permissionStatus = 'in-use';
      } else if (error.name === 'SecurityError') {
        showNotification('Security error accessing microphone. Try using HTTPS or checking browser permissions.', 'error');
        permissionStatus = 'security';
      } else if (error.name === 'AbortError') {
        showNotification('Microphone access request was aborted. Please try again.', 'error');
        permissionStatus = 'aborted';
      } else {
        showNotification(`Microphone error: ${error.name} - ${error.message}`, 'error');
        permissionStatus = 'error';
      }
      
      return false;
    }
  }
  
  // Create and show notification with improved UI and rate limiting
  function showNotification(message, type, duration = 5000) {
    const now = Date.now();
    
    // Rate limiting for notifications - prevent spam
    if (now - lastNotificationTime < MIN_NOTIFICATION_INTERVAL && 
        document.getElementById('voice-dictation-notification')) {
      // Don't show if a similar notification was recently shown
      return;
    }
    
    lastNotificationTime = now;
    
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
    
    // Special case for Google search input
    if (window.location.hostname.includes('google') && 
        ((element.tagName === 'INPUT' && element.name === 'q') || 
         (element.tagName === 'TEXTAREA' && element.name === 'q'))) {
      return true;
    }
    
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
    
    // Check if element has zero height or width (might be hidden)
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
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
      (element.role === 'textbox') ||
      (element.getAttribute('role') === 'textbox') ||
      (element.tagName === 'INPUT' && 
       ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(element.type))
    );
  }
  
  // Find a valid text input element on the page
  function findValidTextInputElement() {
    // First, check for Google search input as a priority
    if (window.location.hostname.includes('google')) {
      const googleSearchInput = document.querySelector('input[name="q"]') || 
                              document.querySelector('textarea[name="q"]');
      if (googleSearchInput && isValidTextInputElement(googleSearchInput)) {
        return googleSearchInput;
      }
    }
    
    // Next, check for any visible input field
    const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], textarea, [contenteditable="true"], [role="textbox"]');
    
    // First try to find inputs that are currently visible in the viewport
    const viewportHeight = window.innerHeight;
    let visibleInputs = [];
    
    for (const input of inputs) {
      if (isValidTextInputElement(input)) {
        const rect = input.getBoundingClientRect();
        // Check if the element is in the viewport
        if (rect.top >= 0 && rect.bottom <= viewportHeight) {
          visibleInputs.push(input);
        }
      }
    }
    
    // If we found visible inputs, return the first one
    if (visibleInputs.length > 0) {
      return visibleInputs[0];
    }
    
    // If no visible inputs, fall back to the first valid input
    for (const input of inputs) {
      if (isValidTextInputElement(input)) {
        return input;
      }
    }
    
    return null;
  }
  
  // Check if there is a valid text field selected
  function hasValidTextFieldSelected() {
    const activeElement = document.activeElement;
    return isValidTextInputElement(activeElement);
  }
  
  // Check if there's a valid text field on the page
  function hasValidTextField() {
    return !!findValidTextInputElement();
  }
  
  // Check text field status once with a delay
  function checkTextFieldStatus() {
    // Only show notification if still recording
    if (!isRecording) return;
    
    if (!hasValidTextFieldSelected()) {
      // Only show notification if we haven't already shown one
      if (!hasShownNoTextFieldWarning) {
        // Check if there's any text field on the page
        if (hasValidTextField()) {
          showNotification('Please click into a text field to dictate text.', 'warning', 5000);
        } else {
          showNotification('No text fields found on this page. Voice dictation may not work here.', 'error', 5000);
        }
        hasShownNoTextFieldWarning = true;
      }
    } else {
      // There is a text field selected now, so we can clear the warning flag
      hasShownNoTextFieldWarning = false;
    }
  }
  
  // Add keyboard shortcut for toggling recording with Command+;
  document.addEventListener('keydown', function(event) {
    // Check for Command(Meta)+; (semicolon) key press
    if ((event.metaKey || event.ctrlKey) && event.key === ';') {
      // Prevent default behavior (like opening browser shortcut menu)
      event.preventDefault();
      // Toggle recording only when the key is pressed, not when it's released
      if (!event.repeat) {
        toggleRecording();
      }
    }
  });
  
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
    
    // Create recognition instance before checking permission (some browsers need this order)
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    // Always check microphone permission before proceeding
    const permissionGranted = await checkMicrophonePermission();
    if (!permissionGranted) {
      // Clear the recognition object if permission failed
      recognition = null;
      return false;
    }
    
    // Set up recognition events
    recognition.onstart = function() {
      isRecording = true;
      showNotification('Voice dictation active. Speaking will enter text into your selected field.', 'success', 3000);
      
      // Reset warning flag at the start of each recording session
      hasShownNoTextFieldWarning = false;
      
      // Schedule a single check for text field after a delay
      if (textFieldCheckTimeoutId) {
        clearTimeout(textFieldCheckTimeoutId);
      }
      
      // Wait 2 seconds before checking for text field status
      textFieldCheckTimeoutId = setTimeout(() => {
        checkTextFieldStatus();
        textFieldCheckTimeoutId = null;
      }, 2000);
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
        const textInserted = insertTextAtCursor(finalTranscript + ' ');
        
        // If text insertion failed and we haven't shown a warning yet
        if (!textInserted && !hasShownNoTextFieldWarning) {
          // Schedule a single check after a short delay
          if (textFieldCheckTimeoutId) {
            clearTimeout(textFieldCheckTimeoutId);
          }
          
          // Check text field status after a short delay to prevent multiple notifications
          textFieldCheckTimeoutId = setTimeout(() => {
            checkTextFieldStatus();
            textFieldCheckTimeoutId = null;
          }, 500);
        }
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
          
          // Clear the timeout if it exists
          if (textFieldCheckTimeoutId) {
            clearTimeout(textFieldCheckTimeoutId);
            textFieldCheckTimeoutId = null;
          }
          
          showNotification('Speech recognition stopped unexpectedly.', 'error');
        }
      } else {
        // Clear the timeout if it exists
        if (textFieldCheckTimeoutId) {
          clearTimeout(textFieldCheckTimeoutId);
          textFieldCheckTimeoutId = null;
        }
        
        showNotification('Voice dictation stopped.', 'info', 2000);
      }
    };
    
    return true;
  }
  
  // Start speech recognition
  async function startRecognition() {
    // Reset the warning flag at the start of each recording session
    hasShownNoTextFieldWarning = false;
    
    // Clear any existing timeout
    if (textFieldCheckTimeoutId) {
      clearTimeout(textFieldCheckTimeoutId);
      textFieldCheckTimeoutId = null;
    }
    
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
    // Clear the text field check timeout
    if (textFieldCheckTimeoutId) {
      clearTimeout(textFieldCheckTimeoutId);
      textFieldCheckTimeoutId = null;
    }
    
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
  
  // Insert text at the current cursor position
  function insertTextAtCursor(text) {
    const activeElement = document.activeElement;
    
    // Check if there's a valid text input selected
    if (!isValidTextInputElement(activeElement)) {
      // Try to find and focus a valid input
      const textInput = findValidTextInputElement();
      if (textInput) {
        textInput.focus();
      } else {
        // No valid text input found
        return false;
      }
    }
    
    // Now get the newly focused element
    const el = document.activeElement;
    
    // Handle different types of inputs
    if (el.isContentEditable) {
      // For contentEditable elements (rich text editors)
      
      // Create a text node with the transcribed text
      const textNode = document.createTextNode(text);
      
      // Get the current selection
      const selection = window.getSelection();
      
      if (selection.rangeCount > 0) {
        // Get the current range
        const range = selection.getRangeAt(0);
        
        // Delete any selected content
        range.deleteContents();
        
        // Insert the new text
        range.insertNode(textNode);
        
        // Move cursor to the end of the inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Dispatch an input event to trigger any listeners
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      
      return false;
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      // For standard input fields and textareas
      
      // Check for special Google search case
      const isGoogleSearch = window.location.hostname.includes('google') && 
                          (el.name === 'q' || el.id === 'search');
      
      // Get current cursor position
      const startPos = el.selectionStart;
      const endPos = el.selectionEnd;
      
      // Join the parts: text before cursor + new text + text after cursor
      const newValue = el.value.substring(0, startPos) + text + el.value.substring(endPos);
      
      // Set the updated value
      el.value = newValue;
      
      // Move cursor to after the inserted text
      el.selectionStart = el.selectionEnd = startPos + text.length;
      
      // Dispatch events to trigger any listeners (especially important for Google Search)
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Special handling for Google search
      if (isGoogleSearch) {
        // Additional input event simulation for Google search
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      }
      
      return true;
    }
    
    return false;
  }
}