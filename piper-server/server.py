"""
Piper TTS Server - REST API for local text-to-speech
"""

import io
import os
import wave
from flask import Flask, request, jsonify, send_file
from piper import PiperVoice

app = Flask(__name__)

# Model paths
MODELS_DIR = "/app/models"
VOICES = {
    "amy": f"{MODELS_DIR}/en_US-amy-medium.onnx",
    "lessac": f"{MODELS_DIR}/en_US-lessac-medium.onnx",
    "ryan": f"{MODELS_DIR}/en_US-ryan-high.onnx",
}

# Cache loaded voices for performance
voice_cache = {}

def get_voice(voice_name):
    """Get or load a voice model."""
    if voice_name not in voice_cache:
        model_path = VOICES.get(voice_name, VOICES["amy"])
        voice_cache[voice_name] = PiperVoice.load(model_path)
    return voice_cache[voice_name]

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "voices": list(VOICES.keys())})

@app.route("/voices", methods=["GET"])
def list_voices():
    return jsonify({
        "voices": [
            {"id": "amy", "name": "Amy", "description": "Female, medium quality", "gender": "female"},
            {"id": "lessac", "name": "Lessac", "description": "Male, medium quality", "gender": "male"},
            {"id": "ryan", "name": "Ryan", "description": "Male, high quality", "gender": "male"},
        ]
    })

@app.route("/synthesize", methods=["POST"])
def synthesize():
    """Synthesize text to speech and return WAV audio."""
    data = request.json
    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = data["text"]
    voice_name = data.get("voice", "amy")

    if not text.strip():
        return jsonify({"error": "Empty text"}), 400

    try:
        voice = get_voice(voice_name)

        # Generate audio - collect all chunks
        audio_bytes = b''
        for chunk in voice.synthesize(text):
            audio_bytes += chunk.audio_int16_bytes

        # Create WAV file
        audio_buffer = io.BytesIO()
        with wave.open(audio_buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(voice.config.sample_rate)
            wav_file.writeframes(audio_bytes)

        audio_buffer.seek(0)

        return send_file(
            audio_buffer,
            mimetype="audio/wav",
            as_attachment=True,
            download_name="speech.wav"
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/synthesize/stream", methods=["POST"])
def synthesize_stream():
    """Stream synthesized audio (for long text)."""
    data = request.json
    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = data["text"]
    voice_name = data.get("voice", "amy")

    try:
        voice = get_voice(voice_name)

        def generate():
            for chunk in voice.synthesize(text):
                yield chunk.audio_int16_bytes

        return app.response_class(generate(), mimetype="audio/raw")

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Preload default voice on startup
@app.before_request
def preload():
    if not voice_cache:
        print("Preloading Amy voice...")
        get_voice("amy")
        print("Voice loaded!")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
