# Indian English ASR Web Application Deployment Guide

This guide provides step-by-step instructions for deploying your Indian English ASR (Automatic Speech Recognition) application. The system consists of:

1. A frontend web interface for recording and displaying transcriptions
2. A backend server that processes audio and returns transcriptions

## Prerequisites

- Python 3.8+ installed
- Node.js and npm (optional, for development)
- Your fine-tuned ASR model saved in a directory

## Step 1: Setting Up the Backend Server

### Install Dependencies

```bash
pip install flask flask-cors torch transformers librosa soundfile numpy
```

### Deploy the Model

1. Place your fine-tuned model in a directory named `fine_tuned_model/final`
   - This should include the model weights and tokenizer files

2. Run the Flask server:
   ```bash
   python server.py
   ```

3. For production deployment, use a WSGI server:
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:5000 server:app
   ```

### Alternative Cloud Deployment

You can deploy the backend on cloud platforms:

#### Heroku
```bash
heroku create indian-english-asr
git push heroku main
```

#### Google Cloud Run
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/indian-english-asr
gcloud run deploy --image gcr.io/YOUR_PROJECT_ID/indian-english-asr --platform managed
```

## Step 2: Setting Up the Frontend

### Local Development

1. Create a directory for your website:
   ```bash
   mkdir -p web-asr/public
   ```

2. Place the HTML and JavaScript files in the directory:
   - Save `index.html` in `web-asr/public/`
   - Save `app.js` in `web-asr/public/`

3. Update the API endpoint in `app.js`:
   ```javascript
   const API_ENDPOINT = 'http://your-server-url:5000/transcribe';
   ```

4. Serve the frontend (simple method):
   ```bash
   cd web-asr
   python -m http.server 8080
   ```

### Deployment Options

#### GitHub Pages

1. Create a GitHub repository
2. Push your frontend files to the repository
3. Enable GitHub Pages in the repository settings

#### Netlify

1. Sign up for Netlify
2. Connect your GitHub repository
3. Configure the build settings (none needed for this project)
4. Deploy

#### Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## Step 3: Testing and Troubleshooting

### Testing the Backend

```bash
curl -X POST -F "audio=@test.wav" http://localhost:5000/transcribe
```

### Troubleshooting

1. **CORS Issues**: Ensure the backend has CORS enabled
2. **Model Loading Errors**: Check that the model path is correct
3. **Audio Format Issues**: Make sure audio is saved in a supported format
4. **Memory Issues**: If the model is too large, consider using a smaller model or increasing server memory

## Step 4: Usage Instructions

1. Open the web application in a browser
2. Click "Start Recording" and speak in Indian English
3. Click "Stop Recording" when finished
4. Wait for the transcription to appear

## Additional Configuration

### Securing the API

For production, add authentication to your API:

```python
from flask_httpauth import HTTPTokenAuth

auth = HTTPTokenAuth(scheme='Bearer')
tokens = {
    "your-api-key": "your-user-id"
}

@auth.verify_token
def verify_token(token):
    if token in tokens:
        return tokens[token]
    return None

@app.route('/transcribe', methods=['POST'])
@auth.login_required
def transcribe():
    # Your existing code
```

### Handling Different Audio Formats

Add support for more audio formats:

```python
from pydub import AudioSegment

# Inside your transcribe function
if file.filename.endswith('.mp3'):
    audio = AudioSegment.from_mp3(temp_filename)
    audio.export(temp_filename + '.wav', format="wav")
    temp_filename = temp_filename + '.wav'
```

## Optimization Tips

1. **Batch Processing**: Implement a queue for handling multiple requests
2. **Caching**: Cache frequent transcriptions
3. **Model Quantization**: Use quantized models for faster inference
4. **Web Workers**: Use Web Workers in the frontend for better UI responsiveness