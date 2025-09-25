require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('C:\\dev\\ffmpeg\\bin\\ffmpeg.exe'); // Adjust to your FFmpeg pat
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const fsp = require('fs').promises;
const wav = require('wav');

async function testTTS() {
  const text = 'For Soheil! Contact 403-555-0123 at 123 Main St, Calgary.';
  const audioFilePath = 'D:/test.mp3';
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-tts' });
  const prompt = `Read this text aloud slowly and clearly at 75% speed, pausing after sentences. Say phone numbers digit by digit (e.g., "four zero three five five five zero one two three" for 403-555-0123). Emphasize addresses (e.g., "one two three Main Street, Calgary, Alberta"). Text: "${text}"`;

  const result = await model.generateContent({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
      }
    }
  });

  console.log('Gemini API response:', JSON.stringify(result, null, 2));

  const base64Audio = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error('No audio data');
  const pcmBuffer = Buffer.from(base64Audio, 'base64');
  const wavPath = audioFilePath.replace('.mp3', '.wav');
  const writer = new wav.FileWriter(wavPath, { channels: 1, sampleRate: 24000, bitDepth: 16 });
  writer.write(pcmBuffer);
  writer.end();
  await new Promise((resolve) => writer.on('finish', resolve));
  console.log('Audio saved to', wavPath);
}

testTTS().catch(console.error);