// app.js with improved audio recording
document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const startRecordingButton = document.getElementById('start-recording');
    const stopRecordingButton = document.getElementById('stop-recording');
    const recordingIndicator = document.getElementById('recording-indicator');
    const statusText = document.getElementById('status-text');
    const transcriptionArea = document.getElementById('transcription');
    const processingStatus = document.getElementById('processing-status');
    const audioVisualizer = document.getElementById('audio-visualizer');
    
    // Visualizer context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const canvasCtx = audioVisualizer.getContext('2d');
    let animationId;
    
    // Media recorder variables
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    
    // Server URL - replace with your actual API endpoint
    const API_ENDPOINT = 'http://10.0.0.234:5005/transcribe';
    
    // Draw audio visualizer
    function drawVisualizer() {
        const width = audioVisualizer.width;
        const height = audioVisualizer.height;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        analyser.getByteTimeDomainData(dataArray);
        
        canvasCtx.clearRect(0, 0, width, height);
        canvasCtx.fillStyle = '#f8f9fa';
        canvasCtx.fillRect(0, 0, width, height);
        
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = isRecording ? '#dc3545' : '#4527a0';
        
        canvasCtx.beginPath();
        
        const sliceWidth = width / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height / 2;
            
            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        canvasCtx.lineTo(width, height / 2);
        canvasCtx.stroke();
        
        if (isRecording) {
            animationId = requestAnimationFrame(drawVisualizer);
        }
    }
    
    // Initialize canvas
    function setupCanvas() {
        audioVisualizer.width = audioVisualizer.offsetWidth;
        audioVisualizer.height = audioVisualizer.offsetHeight;
        
        canvasCtx.fillStyle = '#f8f9fa';
        canvasCtx.fillRect(0, 0, audioVisualizer.width, audioVisualizer.height);
        
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = '#4527a0';
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, audioVisualizer.height / 2);
        canvasCtx.lineTo(audioVisualizer.width, audioVisualizer.height / 2);
        canvasCtx.stroke();
    }
    
    // Setup canvas initially
    setupCanvas();
    
    // Start recording
    async function startRecording() {
        try {
            audioChunks = [];
            // Request high-quality audio
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,        // Mono recording
                    sampleRate: 16000,      // 16 kHz sample rate to match server expectations
                    echoCancellation: true, // Enable echo cancellation
                    noiseSuppression: true  // Enable noise suppression
                } 
            });
            
            // Connect to visualizer
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            
            // Setup and start media recorder with WAV format
            const options = { 
                mimeType: 'audio/webm',  // Using webm which is widely supported
                audioBitsPerSecond: 128000  // 128 kbps for good quality audio
            };
            
            // If webm not supported, try other formats
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.log('audio/webm not supported, trying audio/ogg');
                options.mimeType = 'audio/ogg';
                
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    console.log('audio/ogg not supported, trying default');
                    options.mimeType = '';
                }
            }
            
            mediaRecorder = new MediaRecorder(stream, options);
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                    console.log(`Recorded chunk of size ${event.data.size} bytes`);
                }
            };
            
            mediaRecorder.onstop = () => {
                processAudio();
            };
            
            // Request data at regular intervals to prevent large chunks
            mediaRecorder.start(1000); // Collect data every second
            console.log(`Started recording with mime type: ${mediaRecorder.mimeType}`);
            isRecording = true;
            
            // Update UI
            recordingIndicator.classList.add('active');
            statusText.textContent = 'Recording...';
            startRecordingButton.disabled = true;
            stopRecordingButton.disabled = false;
            
            // Start visualizer
            drawVisualizer();
            
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Could not access microphone. Please ensure you have granted permission.');
        }
    }
    
    // Stop recording
    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            
            // Update UI
            isRecording = false;
            recordingIndicator.classList.remove('active');
            statusText.textContent = 'Processing...';
            startRecordingButton.disabled = true;
            stopRecordingButton.disabled = true;
            
            // Stop visualizer animation
            cancelAnimationFrame(animationId);
            setupCanvas();
        }
    }
    
    // Process the recorded audio
    async function processAudio() {
        if (audioChunks.length === 0) {
            console.error('No audio data recorded');
            processingStatus.textContent = 'Error: No audio recorded. Please try again.';
            transcriptionArea.innerHTML = '<p class="text-danger">No audio data captured. Please check your microphone and try again.</p>';
            startRecordingButton.disabled = false;
            return;
        }
        
        console.log(`Processing ${audioChunks.length} audio chunks`);
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        console.log(`Audio blob created, size: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
        
        processingStatus.textContent = 'Transcribing audio...';
        
        try {
            // Send to server API
            await sendToServer(audioBlob);
        } catch (error) {
            console.error('Error processing audio:', error);
            processingStatus.textContent = 'Error processing audio. Please try again.';
            transcriptionArea.innerHTML = '<p class="text-danger">Failed to transcribe audio. Please try again.</p>';
            startRecordingButton.disabled = false;
        }
    }
    
    // Send audio to server for processing
    async function sendToServer(audioBlob) {
        // Create form data for the API request
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        // Create download link for audio
        createDownloadLink(audioBlob);
        
        // Create an audio element to test the recording
        createAudioPlayer(audioBlob);
        
        try {
            processingStatus.textContent = 'Sending to server...';
            
            // Option 1: Use actual server API
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            
            const result = await response.json();
            
            // Display transcription
            transcriptionArea.innerHTML = ''; // Clear existing content
            const transcriptionText = document.createElement('p');
            transcriptionText.textContent = result.transcription || 'No transcription returned from server.';
            transcriptionArea.appendChild(transcriptionText);
            
            processingStatus.textContent = 'Transcription complete!';
            
        } catch (error) {
            console.error('Server error:', error);
            processingStatus.textContent = 'Server error. Using fallback...';
            
            // Fallback to simulation for demo purposes
            simulateTranscription();
        }
        
        // Re-enable recording button
        startRecordingButton.disabled = false;
        statusText.textContent = 'Ready to record';
    }
    
    // Create download link for the recorded audio
    function createDownloadLink(audioBlob) {
        // Check if there's already a download button and remove it
        const existingDownloadBtn = document.getElementById('download-audio');
        if (existingDownloadBtn) {
            existingDownloadBtn.remove();
        }
        
        // Create audio URL
        const audioURL = URL.createObjectURL(audioBlob);
        
        // Create download button
        const downloadBtn = document.createElement('button');
        downloadBtn.id = 'download-audio';
        downloadBtn.className = 'btn btn-success mt-3';
        downloadBtn.innerHTML = '<i class="bi bi-download"></i> Download Recording';
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = audioURL;
            // Use appropriate extension based on MIME type
            const extension = audioBlob.type.includes('webm') ? 'webm' : 
                             audioBlob.type.includes('ogg') ? 'ogg' : 'wav';
            a.download = `recording.${extension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
        
        // Add button to the page
        const controlsDiv = document.querySelector('.controls');
        controlsDiv.parentNode.insertBefore(downloadBtn, controlsDiv.nextSibling);
    }
    
    // Create an audio player to test the recording
    function createAudioPlayer(audioBlob) {
        // Check if there's already an audio player and remove it
        const existingPlayer = document.getElementById('audio-player-container');
        if (existingPlayer) {
            existingPlayer.remove();
        }
        
        // Create container
        const playerContainer = document.createElement('div');
        playerContainer.id = 'audio-player-container';
        playerContainer.className = 'mt-3 mb-3';
        
        // Create label
        const label = document.createElement('p');
        label.className = 'mb-2';
        label.textContent = 'Preview recording:';
        playerContainer.appendChild(label);
        
        // Create audio element
        const audioPlayer = document.createElement('audio');
        audioPlayer.controls = true;
        audioPlayer.src = URL.createObjectURL(audioBlob);
        audioPlayer.className = 'w-100';
        playerContainer.appendChild(audioPlayer);
        
        // Add player to the page
        const downloadBtn = document.getElementById('download-audio');
        if (downloadBtn) {
            downloadBtn.parentNode.insertBefore(playerContainer, downloadBtn.nextSibling);
        } else {
            const controlsDiv = document.querySelector('.controls');
            controlsDiv.parentNode.insertBefore(playerContainer, controlsDiv.nextSibling);
        }
    }
    
    // Mock transcription (for testing without server)
    function simulateTranscription() {
        const mockResponses = [
            "Hello, my name is Rajesh and I am from Bangalore.",
            "Today we will discuss the project details for Mumbai office.",
            "Please send the report by tomorrow morning.",
            "The weather in Chennai is very hot today.",
            "I'm planning to visit Delhi next month for the conference."
        ];
        
        const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        // Create a mock audio blob for download in simulation mode
        if (audioChunks.length === 0) {
            // If no real audio was recorded, create a small dummy blob
            const dummyData = new Uint8Array([0, 1, 2, 3, 4]);
            const dummyBlob = new Blob([dummyData], { type: 'audio/webm' });
            createDownloadLink(dummyBlob);
        } else {
            // Use the actual recorded audio
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder ? mediaRecorder.mimeType : 'audio/webm' });
            createDownloadLink(audioBlob);
            createAudioPlayer(audioBlob);
        }
        
        setTimeout(() => {
            // Clear existing content and create new paragraph element
            transcriptionArea.innerHTML = '';
            const transcriptionText = document.createElement('p');
            transcriptionText.textContent = randomResponse;
            transcriptionArea.appendChild(transcriptionText);
            
            processingStatus.textContent = 'Transcription complete! (simulation)';
            startRecordingButton.disabled = false;
        }, 1500);
    }
    
    // Event listeners
    startRecordingButton.addEventListener('click', startRecording);
    stopRecordingButton.addEventListener('click', stopRecording);
    
    // Handle window resize for canvas
    window.addEventListener('resize', () => {
        setupCanvas();
    });
});