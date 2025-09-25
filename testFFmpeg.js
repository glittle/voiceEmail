// C:\Dev\voiceEmail\testFFmpeg.js
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('C:\\Dev\\ffmpeg\\bin\\ffmpeg.exe');
ffmpeg('D:\\test_pcm.raw')
  .inputFormat('s16le')
  .inputOptions('-ar 24000')
  .inputOptions('-ac 1')
  .audioCodec('mp3')
  .outputOptions('-ab 128k')
  .save('D:\\test_ffmpeg.mp3')
  .on('end', () => console.log('Conversion successful'))
  .on('error', (err) => console.error('FFmpeg error:', err.message));