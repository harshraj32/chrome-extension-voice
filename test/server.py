from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
import librosa
import soundfile as sf
import os
import tempfile
import numpy as np
import subprocess
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Set device
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
logger.info(f"Using device: {device}")

# Path to your fine-tuned model - update this to the actual path
MODEL_PATH = "fine_tuned_model/final"

# Load model and processor
logger.info("Loading ASR model...")
try:
    processor = Wav2Vec2Processor.from_pretrained(MODEL_PATH)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL_PATH).to(device)
    model.eval()
    logger.info("Model loaded successfully")
except Exception as e:
    logger.error(f"Error loading model: {e}")
    # Fallback to base model if fine-tuned model isn't available
    processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
    model = Wav2Vec2ForCTC.from_pretrained("facebook/wav2vec2-base-960h").to(device)
    model.eval()
    logger.info("Using fallback model")

def convert_to_wav(input_file, output_file):
    """Convert audio file to proper WAV format using ffmpeg"""
    try:
        # Use ffmpeg to convert the file
        command = [
            "ffmpeg", 
            "-i", input_file,  # Input file
            "-ar", "16000",    # Sample rate
            "-ac", "1",        # Mono channel
            "-c:a", "pcm_s16le",  # 16-bit PCM encoding
            "-y",              # Overwrite output file
            output_file        # Output file
        ]
        
        # Execute the command
        result = subprocess.run(command, 
                               stdout=subprocess.PIPE, 
                               stderr=subprocess.PIPE, 
                               text=True)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg conversion error: {result.stderr}")
            return False
        
        logger.info(f"Successfully converted audio file to {output_file}")
        return True
    
    except Exception as e:
        logger.error(f"Error in audio conversion: {e}")
        return False

@app.route('/transcribe', methods=['POST'])
def transcribe():
    try:
        # Check if the POST request has the audio file
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        file = request.files['audio']
        logger.info(f"Received audio file: {file.filename}, mimetype: {file.mimetype}, size: {request.content_length} bytes")
        
        # Create temporary files
        temp_original = tempfile.NamedTemporaryFile(delete=False, suffix='.webm').name
        temp_wav = tempfile.NamedTemporaryFile(delete=False, suffix='.wav').name
        
        try:
            # Save the uploaded file
            file.save(temp_original)
            logger.info(f"Saved original file to {temp_original}")
            
            # Convert the file to proper WAV format
            conversion_success = convert_to_wav(temp_original, temp_wav)
            
            if not conversion_success:
                return jsonify({'error': 'Failed to convert audio file'}), 500
            
            # Load audio using soundfile which is more reliable for proper WAV files
            try:
                audio, sampling_rate = sf.read(temp_wav)
                logger.info(f"Audio loaded with soundfile: shape={audio.shape}, sr={sampling_rate}")
            except Exception as sf_error:
                logger.warning(f"Soundfile failed: {sf_error}. Trying librosa instead.")
                # Fallback to librosa if soundfile fails
                audio, sampling_rate = librosa.load(temp_wav, sr=16000)
                logger.info(f"Audio loaded with librosa: shape={audio.shape}, sr={sampling_rate}")
            
            # Make sure audio is float32 for the model
            if audio.dtype != np.float32:
                audio = audio.astype(np.float32)
            
            # Check if audio is not empty
            if len(audio) < 100:  # Arbitrary small threshold
                return jsonify({'transcription': 'Audio too short or empty'}), 200
            
            # Normalize audio if it's not in the range [-1, 1]
            if np.max(np.abs(audio)) > 1.0:
                audio = audio / np.max(np.abs(audio))
            
            # Process audio
            logger.info("Processing audio through model")
            inputs = processor(audio, sampling_rate=16000, return_tensors="pt").to(device)
            
            # Get predictions
            with torch.no_grad():
                logits = model(inputs.input_values, attention_mask=inputs.attention_mask).logits
            
            # Decode
            predicted_ids = torch.argmax(logits, dim=-1)
            transcription = processor.batch_decode(predicted_ids)[0]
            logger.info(f"Raw transcription: {transcription}")
            
            # Apply post-processing for Indian English
            transcription = post_process_indian_english(transcription)
            logger.info(f"Processed transcription: {transcription}")
            
            return jsonify({'transcription': transcription})
            
        except Exception as e:
            logger.error(f"Error processing audio: {e}")
            return jsonify({'error': str(e)}), 500
            
        finally:
            # Clean up temp files
            for temp_file in [temp_original, temp_wav]:
                if os.path.exists(temp_file):
                    os.unlink(temp_file)
                    logger.info(f"Removed temporary file: {temp_file}")
            
    except Exception as e:
        logger.error(f"Server error: {e}")
        return jsonify({'error': str(e)}), 500

def post_process_indian_english(text):
    """Apply additional post-processing for Indian English transcriptions"""
    # Common Indian English pronunciation corrections
    corrections = {
        r'\bbang\s*lor\b': 'bangalore',
        r'\bmum\s*bai\b': 'mumbai',
        r'\bbom\s*bay\b': 'mumbai',
        r'\bdel\s*hi\b': 'delhi',
        r'\bhi\s*dra\s*bad\b': 'hyderabad',
        r'\bchen\s*nai\b': 'chennai',
        r'\bkol\s*kata\b': 'kolkata',
        r'\bcal\s*cutta\b': 'kolkata',
        r'\bvery\b': 'very',  # Correct pronunciation of 'wery'
        r'\btink\b': 'think',  # Correct 't' for 'th'
        r'\btank\s*you\b': 'thank you',
        r'\bvat\b': 'what',  # Common V/W confusion
    }
    
    # Apply corrections
    processed_text = text.lower()
    for pattern, replacement in corrections.items():
        import re
        processed_text = re.sub(pattern, replacement, processed_text)
    
    # Capitalize first letter of sentences
    processed_text = '. '.join(s.strip().capitalize() for s in processed_text.split('.'))
    
    # Capitalize proper nouns
    proper_nouns = ['india', 'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad']
    for noun in proper_nouns:
        processed_text = processed_text.replace(f' {noun} ', f' {noun.capitalize()} ')
        # Check for start of sentence
        processed_text = processed_text.replace(f'{noun} ', f'{noun.capitalize()} ')
    
    return processed_text

if __name__ == '__main__':
    # Run the Flask app - for production use a proper WSGI server like gunicorn
    app.run(host='0.0.0.0', port=5005, debug=False)