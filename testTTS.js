require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('C:\\dev\\ffmpeg\\bin\\ffmpeg.exe'); // Adjust to your FFmpeg pat
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const fsp = require('fs').promises;
const wav = require('wav');

async function testTTS () {
  const text = 'For Soheil! Contact 403-555-0123 at 123 Main St, Calgary.';
  const audioFilePath = 'D:/test.mp3';
  let processedText = text;
  processedText = processedText.replace(/(\d{3})-(\d{3})-(\d{4})/g, '<say-as interpret-as="telephone">$1-$2-$3</say-as>');
  processedText = processedText.replace(/(at \d+ [^,]+, [^,]+, [^,]+)/gi, '<emphasis level="strong">$1</emphasis>');
  processedText = processedText.replace(/(\.)\s+/g, '$1 <break time="500ms"/> ');
  const ssmlText = `<speak><prosody rate="75%">${processedText}</prosody></speak>`;
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro-preview-tts' });
  const prompt = ssmlText;

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