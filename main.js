const fs = require('fs');
const fsp = require('fs').promises;
const gmailHelper = require('./gmailHelper');
// const { Twilio } = require('twilio');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
// const textToSpeech = require('@google-cloud/text-to-speech');
// const tts = new textToSpeech.TextToSpeechClient();
const OpenAI = require('openai').default;
// const openai = new OpenAI({ apiKey: process.env.openai });
//const msSdk = require("microsoft-cognitiveservices-speech-sdk");
const { createClient } = require("@deepgram/sdk");
// const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
// const azureOpenAiClient = new OpenAIClient(
//     "https://<resource name>.openai.azure.com/",
//     new AzureKeyCredential("<Azure API key>")
// );

// const utf8 = require('utf8');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const calendar = require('dayjs/plugin/calendar');
const { AudioFormatTag } = require('microsoft-cognitiveservices-speech-sdk');
dayjs.extend(calendar);
dayjs.extend(utc);
dayjs.extend(timezone);

var sheetsApi;

async function makeAudioFile (text, info, audioFilePath) {
    // const maxLength = 4500; // Google real limit is 5000, but seems like we need to stop before that
    // const maxLength = 4000; // OpenAi real limit is 4096
    const maxLength = 2000; // Deepgram limit

    if (text.length > maxLength) {
        console.log('--> long text truncated to ~5000', text.length);
        text = text.substr(0, maxLength - 100) + '... [Message Truncated]';
        // chop off and say 'truncated'
    }


    try {
        // start timer
        const start = Date.now();

        // Performs the text-to-speech request

        // Google Cloud Platform project
        // const request = {
        //     input: { ssml: text },
        //     voice: { languageCode: 'en-US', name: 'en-US-News-K' },
        //     audioConfig: { audioEncoding: 'MP3' },
        // };
        // const [response] = await tts.synthesizeSpeech(request);
        // var mp3 = await response.audioContent;

        // OpenAi text to voice
        // console.log(`--<><OpenAI><>--> making mp3 for clip - ${text.length} chars\n${text.substr(0, 100)}...`);
        // const response = await openai.audio.speech.create({
        //     model: "tts-1",
        //     voice: "nova",
        //     input: text,
        //     speed: .65,
        // });

        // // Azure OpenAi text to voice
        // console.log(`--<><Azure OpenAI><>--> making mp3 for clip - ${text.length} chars\n${text.substr(0, 100)}...`);
        // const response = await openai.audio.speech.create({
        //     model: "tts-1",
        //     voice: "nova",
        //     input: text,
        //     speed: .65,
        // });


        // const mp3 = Buffer.from(await response.arrayBuffer());

        // // MS Speech
        // console.log(`--<><MS Speech><>--> making mp3 for clip - ${text.length} chars - ${text.replace(/\n/g, ' ').substr(0, 100)}...`);
        // var serviceRegion = "centralus";
        // var subscriptionKey = process.env.msSpeechKey;
        // var speechConfig = msSdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion);
        // let audioConfig = msSdk.AudioConfig.fromAudioFileOutput(audioFilePath);
        // var synthesizer = new msSdk.SpeechSynthesizer(speechConfig, audioConfig);

        // const mp3 = await new Promise((resolve, reject) => {
        //     synthesizer.speakTextAsync(text, async result => {
        //         // audioData // The synthesized audio data
        //         // audioDuration //The time duration of synthesized audio, in ticks (100 nanoseconds).
        //         // errorDetails // In case of an unsuccessful synthesis, provides details of the occurred error.
        //         // properties // The set of properties exposed in the result.
        //         // reason // Specifies status of the result.
        //         // resultId

        //         synthesizer.close();

        //         const audioFile = await fsp.readFile(audioFilePath);
        //         resolve(audioFile);
        //     }, error => {
        //         synthesizer.close();

        //         reject(`MS Speech error: ${error}`);
        //     });
        // });

        // Deepgram Aura
        const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
        const response = await deepgramClient.speak.request(
            { text },
            {
                model: "aura-asteria-en",
                encoding: "linear16",
                container: "wav",
            }
        );
        const stream = await response.getStream();
        const headers = await response.getHeaders();
        var mp3;
        if (stream) {
            const buffer = await getAudioBuffer(stream);
            // STEP 5: Write the audio buffer to a file
            fs.writeFile(audioFilePath, buffer, (err) => {
                if (err) {
                    console.error("Error writing audio to file:", err);
                } else {
                    console.log("Audio file written to " + AudioFormatTag);
                }
            });

            mp3 = await fsp.readFile(audioFilePath)
        } else {
            console.error("Error generating audio:", stream);
            if (headers) {
                console.log("Headers:", headers);
            }
        }





        // end timer
        const end = Date.now();
        const sec = ((end - start) / 1000.0).toFixed(1);
        console.log('------------> seconds to retrieve:', sec, ' length:', mp3.length, 'bytes');

        var mayHaveTimedOut = sec > 20;
        if (mayHaveTimedOut) {
            console.warn('Seconds taken:', sec, ' Twilio may have timed out');
        }
        if (info.completed) {
            console.warn('info.completed === true. Twilio must have timed out');
        }

        return {
            mp3: mp3,
            sec: sec,
            mayHaveTimedOut: mayHaveTimedOut
        };
    } catch (err) {
        console.log('error A', err);
        return null;
    }
}


// helper function to convert stream to audio buffer
async function getAudioBuffer (response) {
    const reader = response.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
    }

    const dataArray = chunks.reduce(
        (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
        new Uint8Array(0)
    );

    return Buffer.from(dataArray.buffer);
};


function sayInstructions (gather) {
    gather.say(`Press 2 to repeat the message you are on.
                        Press 3 to go to the next message.
                        Press 1 to go to the previous message.
                        Press 0 to repeat these instructions.
                        Hang up at any time to end the call.`);
}

async function handleOngoingCall (gmail, query, twiml, info, tempStorage) {
    const digit = query.Digits;

    // no digit?  Something is wrong
    if (!digit) {
        twiml.say(`Sorry, didn't get your response.  Goodbye.`);
        twiml.hangup();
        return twiml.toString();
    }

    info.completed = false;
    info.steps.push(`>${digit}`);
    console.log('handleOngoingCall', `Pressed ${digit}`, "Current #", info.currentMsgNum, "Num Msgs", info.msgs.length);

    // get the message
    // var msg = info.msgs[0];

    const gather = twiml.gather({
        timeout: 30,
        numDigits: 1,
        input: 'dtmf',
        action: query.PATH, // drop the original query string
        method: 'GET', // force to use GET
    });

    switch (digit) {
        case '0':
            sayInstructions(gather);
            break;

        case '1':
            // go to previous message
            // if (info.currentMsgNum > 0) {
            //     info.currentMsgNum--;
            //     await playMessage(gather, info, query, tempStorage);
            // } else if (info.isDevCaller) {
            // try to get an older message
            const foundOlderMsg = await gmailHelper.getOlderMessage(gmail, info.msgs, tempStorage.msgs, info.urlPrefix);
            if (foundOlderMsg) {
                info.currentMsgNum = 0;
                await playMessage(gather, info, query, tempStorage);
            } else {
                gather.say(`No more messages.`);
                sayInstructions(gather);
            }
            // } else {
            //     gather.say(`No more messages.`);
            //     sayInstructions(gather);
            // }
            break;

        case '2':
            await playMessage(gather, info, query, tempStorage);
            break;

        case '3':
            // go to next message
            if (info.currentMsgNum < info.msgs.length - 1) {
                info.currentMsgNum++;
                await playMessage(gather, info, query, tempStorage);
            } else {
                gather.say(`No more messages.`);
                sayInstructions(gather);
            }
            break;

        default:
            sayInstructions(gather);
            break;
    }

    return twiml.toString();
};

/// return final XML text to send or with MP3 audio
async function respondToCall (query, gmail, api, tempStorage) {
    const twiml = new VoiceResponse();
    sheetsApi = api;

    try {
        // get data from the Directory spreadsheet - set to 99 names for now
        const rows = (await sheetsApi.spreadsheets.values.get({
            spreadsheetId: process.env.sheetId,
            range: "A1:G100"
        })).data.values;

        // get call info
        var callSid = query.CallSid;
        var callStatus = query.CallStatus;

        if (!callStatus) {
            return 'invalid request';
        }

        // get info from tempStorage?
        var info = tempStorage.calls[callSid];

        switch (callStatus) {
            case 'playClip':
                const code = query.c;
                console.log('==>', callStatus, callSid, code);
                var audioFilePath = `D:/${code}.wav`;
                if (fs.existsSync(audioFilePath)) {
                    return {
                        isAudio: true,
                        file: audioFilePath
                    };

                }

                // const clip = tempStorage.clips.find(c => c.code === code);
                // if (!clip) {
                console.warn('clip not found', code);
                twiml.say('Sorry, the requested clip was not found.');
                return twiml.toString();
            // }

            // info.mp3StartMs = new Date().getTime();

            // return {
            //     isAudio: true,
            //     // audio: clip.mp3,
            //     file: audioFilePath
            // };

            case 'playBody':
                const msgId = query.id;
                console.log('==>', callStatus, callSid, msgId);

                var audioFilePath = `D:/${msgId}.wav`;
                if (fs.existsSync(audioFilePath)) {
                    return {
                        isAudio: true,
                        file: audioFilePath
                    };

                }

                const msgIndex = info.msgs.findIndex(msg => msg.id === msgId);
                info.steps.push(`(msg ${msgIndex})`);
                const msg = info.msgs[msgIndex];
                // console.log('msg', msgId, msgIndex, msg)
                console.log('>>>>>> GET MP3', query.id, msgIndex); // , info.msgs.map(m => m.id).join(', '));

                let mayHaveTimedOut = false;
                var mp3 = msg.mp3;
                if (mp3) {
                    console.log('>>>>>> mp3 already exists', mp3.length, 'bytes');
                } else {
                    // convert text to MP3
                    // var txt = msg.bodyDetails.textForSpeech?.replace(/&/g, '&amp;') // GOOGLE
                    var txt = msg.bodyDetails.text; // OPENAI
                    console.log('>>>>>> creating MP3 from text', txt?.length, 'chars');
                    if (!txt) {
                        console.warn('There was no text to convert to MP3!');
                        twiml.say(`There appears to be no text in this message.`);
                        return twiml.toString();
                    } else {
                        var mp3Info = await makeAudioFile(txt, info, audioFilePath);
                        mp3 = msg.mp3 = mp3Info ? mp3Info.mp3 : null;

                        mayHaveTimedOut = mp3Info.mayHaveTimedOut;

                        // console.log('info after makeAudioFile', info)
                        tempStorage.calls[callSid] = info;
                    }
                }

                if (!mp3) {
                    twiml.say('Sorry, there was an error getting the audio for this message.');
                    return twiml.toString();
                }

                console.log('==> SENDING MP3', '#', msgIndex, mp3.length, 'bytes');

                if (!mayHaveTimedOut) {
                    // all seems good - mark message as read
                    // get label name
                    const labelName = tempStorage.labels.find(l => l.id === info.labelId)?.name;
                    gmailHelper.setLabel(gmail, msg.id, info.labelId, labelName);
                }

                info.mp3StartMs = new Date().getTime();

                return {
                    isAudio: true,
                    // audio: mp3,
                    file: audioFilePath
                };

            case 'completed':
                // the call is over
                twiml.say(`Bye!`);

                // add a row to the spreadsheet
                //CallStart	Phone	Name	SID	Log
                if (info) {
                    info.completed = true;
                    if (info.startMs) {
                        var duration = (new Date().getTime() - info.startMs) / 1000;

                        // show time in mins if > 1 min
                        if (duration > 60) {
                            duration = Math.round(duration / 60) + ' min';
                        } else {
                            duration = Math.round(duration) + ' sec';
                        }

                        info.steps.push(duration);
                    }
                    addToLog(info);
                    console.log('--> call logged   ========================================= CALL ENDED ============================================');
                }

                return twiml.toString();

            default:
                if (info) {
                    return handleOngoingCall(gmail, query, twiml, info, tempStorage);
                }

                break;
        }

        // handle new call

        var callerNumRaw = query.Caller;

        // no phone number?  Must be a test.
        if (!callerNumRaw) {
            return `Invalid request.`
        }

        // if (Array.isArray(callerNumRaw)) {
        //     // sometimes is an array!?
        //     callerNumRaw = callerNumRaw[0];
        // }

        console.log('callerNumRaw', typeof callerNumRaw, callerNumRaw, ' ------------------ CALL STARTED -------------------------------------');

        // reformat caller number from +1xxxxxxxxxx to xxx-xxx-xxxx
        const callerNum = callerNumRaw.replace(/\D/g, '').substr(1).replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');

        // console log before and after - for initial testing
        console.log('--> callerNum', callerNumRaw, callerNum);
        var now = dayjs().tz('America/Edmonton').format('YYYY-MM-DD HH:mm:ss');
        var nowMs = new Date().getTime();

        // lookup caller number in range
        const rowIndex = rows.findIndex(row => row[0] === callerNum);

        // no match?  Must not be registered.
        if (rowIndex === -1) {
            twiml.say(`Hello.
                I don't recognize this phone number.
                Please contact Glen to get set up to use this service.
                Goodbye!
                `);
            twiml.hangup();

            addToLog({
                start: now, name: '??', callerNum, callSid
            });
            // var line = [info.start, info.callerNum, info.name, info.callSid, info.steps?.join(', ')];


            return twiml.toString();
        }

        const rowNum = rowIndex + 1;
        const callerRow = rows[rowIndex];



        // store info for later
        // get name from 4th column first, then 3rd column
        const callerName = callerRow[3] || callerRow[2];
        const labelName = callerRow[4];
        var isNew = false;

        // create label if it doesn't exist
        var labelId = tempStorage.labels.find(l => l.name === labelName)?.id;
        if (!labelId) {
            labelId = await gmailHelper.createLabel(gmail, labelName);
            tempStorage.labels.push({ name: labelName, id: labelId });
            isNew = true;
        } else {
            console.log('--> label already exists', labelName, labelId);
        }

        // add another label with "{labelName} Save" and get the labelId
        var saveLabelId = tempStorage.labels.find(l => l.name === labelName + ' Save')?.id;
        if (!saveLabelId) {
            saveLabelId = await gmailHelper.createLabel(gmail, labelName + ' Save');
            tempStorage.labels.push({ name: labelName + ' Save', id: saveLabelId });
        } else {
            console.log('--> save label already exists', labelName + ' Save - ' + saveLabelId);
        }

        info = {
            callSid: callSid,
            callerNum: callerNum,
            isDevCaller: callerNum === '403-402-7106', // && false,
            name: callerName,
            label: labelName,
            labelId: labelId,
            saveLabelId: saveLabelId,
            rowNum: rowNum,
            start: now,
            startMs: nowMs,
            mp3StartMs: 0,
            mp3: null,
            currentMsgNum: -1, // index of msgs array
            steps: [],
            msgs: [],
            loadedMsgs: [],
            completed: false,
            gmail: gmail
        };
        tempStorage.calls[callSid] = info;

        // record current time into the Last Call column
        saveToSheetCell("F", rowNum, now);

        // get messages
        const urlPrefix = `${query.PATH}?CallStatus=playBody&CallSid=${info.callSid}&id=`;
        info.urlPrefix = urlPrefix;

        const rawMsgs = await gmailHelper.getMessages(gmail, labelName, isNew);

        const numMsgs = rawMsgs.length;

        console.log('-->', info.name, 'msgs:', numMsgs);

        // load them into tempStorage
        info.steps.push(numMsgs + ' msgs');

        console.log('delaying msgs load')
        setTimeout(async () => {
            console.log('starting msgs load')
            tempStorage.calls[callSid].msgs = await gmailHelper.loadMessages(gmail, rawMsgs, tempStorage.msgs, urlPrefix);
            console.log('done msgs load', numMsgs, tempStorage.calls[callSid].msgs.length);
        }, 0);

        twiml.say(`Hello ${info.name}.`);

        // announce the version number
        twiml.say(`Welcome to "Voice Email" version 2.4.`);

        // twiml.say('Please note that this system is being adjusted and may not work correctly. Please try again later.');



        // if (numMsgs === 0) {
        //     // if (info.isDevCaller) {
        //     const gather = twiml.gather({
        //         timeout: 30,
        //         numDigits: 1,
        //         input: 'dtmf',
        //         action: query.PATH, // drop the original query string
        //         method: 'GET', // force to use GET
        //     });
        //     // gather.say(`There are no new emails for you.`);
        //     // gather.say(`You can hang up, or press 1 to go back to an email you have heard already.`);
        //     // } else {
        //     //     twiml.say(`There are no new emails for you.`);
        //     //     twiml.say(`Good bye!`);
        //     //     twiml.hangup();
        //     // }
        // } else {
        // say the number of messages
        const gather = twiml.gather({
            timeout: 30,
            numDigits: 1,
            input: 'dtmf',
            action: query.PATH, // drop the original query string
            method: 'GET', // force to use GET
        });
        if (numMsgs === 0) {
            gather.say(`There are no new emails for you.`);
            gather.say(`You can hang up, or press 1 to go back to an email you have heard already.`);
        } else if (numMsgs === 1) {
            gather.say(`There is 1 new message.`);
            gather.say(`Press 3 to start listening. Press 0 for instructions.`);
        } else {
            gather.say(`There are ${numMsgs} new messages.`);
            gather.say(`Press 3 to start listening. Press 0 for instructions.`);
        }

        // await playMessage(gather, info, query, tempStorage);
        // gather.say(`Press 3 to start listening. Press 0 for instructions.`);

        twiml.say(`We didn't receive any answer from you.`);
        twiml.say(`Good bye!`);
        twiml.hangup();
        // }

        return twiml.toString();
    }
    catch (err) {
        console.error('--> ERROR', err);
        twiml.say(`Oops. The system got this error: "${err}".`);
        twiml.say(`Good bye.`);
        twiml.hangup();
        return twiml.toString();
    }
}

async function playMessage (gather, info, query, tempStorage) {
    console.log('--> playMessage', info.currentMsgNum);

    const urlPrefix = `${query.PATH}?CallStatus=playClip&CallSid=${info.callSid}&c=`;

    var msg = info.msgs[info.currentMsgNum];

    if (!msg) {
        gather.say(`Sorry, there was an error getting that message.`);
        return;
    }

    gather.say(`Message ${info.currentMsgNum + 1}: ${msg.dateAge}`);

    await sayPlay(`From: `, msg.simpleFrom, urlPrefix, gather, tempStorage, info);
    await sayPlay(`With Subject: `, msg.subject, urlPrefix, gather, tempStorage, info);

    // var numPdfs = msg.bodyDetails.numPdfs;
    // if (numPdfs) {
    //     gather.say(`With ${numPdfs} PDF file${numPdfs === 1 ? '' : 's'}.`);
    // }

    // count words and round to nearest 100
    var wordCount = msg.bodyDetails.textForSpeech.split(' ').length + 1;
    var skip = wordCount < 5;
    console.log('word count', wordCount, skip ? 'skipped' : '');

    if (skip) {
        gather.say(`This message appears to be empty.`);
        const labelName = tempStorage.labels.find(l => l.id === info.labelId)?.name;
        gmailHelper.setLabel(info.gmail, msg.id, info.labelId, labelName);
    }
    else if (wordCount < 100) {
        // if less than 100, round to nearest 10
        wordCount = Math.round(wordCount / 10) * 10;
        gather.say(`About ${wordCount} words long`);
    }
    else {
        // if > 100, round to nearest 100
        wordCount = Math.round(wordCount / 100) * 100;
        gather.say(`About ${wordCount} words long`);
    }


    if (msg.numAttachments) {
        gather.say(`with ${msg.numAttachments} attachment${(msg.numAttachments === 1 ? '' : 's')}.`);
    }

    if (!skip) {
        // gather.say(msg.bodyText);
        gather.play(msg.bodyUrl);
        gather.play({ digits: 'ww' }); // pause for a second
    }

    var isLast = info.currentMsgNum === info.msgs.length - 1;
    if (isLast) {
        gather.say(`That was the last message. Press 2 to listen again, 0 for instructions, or hang up if you are done.`);
    } else {
        gather.say(`Press 2 to listen again, 3 to go to the next message, 0 for instructions.`);
    }
}

async function sayPlay (prefix, text, urlPrefix, gather, tempStorage, info) {
    if (!text) {
        return;
    }

    var clip = tempStorage.clips.find(c => c.text === text);

    if (!clip) {
        console.log('==> make clip -', prefix, text)
        // make short random code to avoid collisions
        var code = Math.random().toString(36).substring(2);
        var audioFilePath = `D:/${code}.wav`;

        var mp3Info = await makeAudioFile(text, info, audioFilePath);
        if (mp3Info) {
            // make clip
            clip = {
                // mp3: mp3Info.mp3,
                text: text,
                code: code,
                url: urlPrefix + code
            };
            tempStorage.clips.push(clip);
        }
    }

    gather.say(prefix);

    if (clip) {
        console.log('==> play -', prefix, text)
        console.log('==>     ', clip.url)
        gather.play(clip.url);
    } else {
        console.log('==> say -', prefix, text)
        gather.say(text);
    }
}


async function saveToSheetCell (col, rowNum, val) {
    // convert to col notation to excel column name

    await sheetsApi.spreadsheets.values.update({
        spreadsheetId: process.env.sheetId,
        range: col + rowNum,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [[val]]
        }
    });
}

async function addToLog (info) {
    var line = [info.start, info.callerNum, info.name, info.callSid, info.steps?.join(', ')];

    await sheetsApi.spreadsheets.values.append({
        spreadsheetId: process.env.sheetId,
        valueInputOption: "USER_ENTERED",
        range: "'Call Log'!A1",
        requestBody: {
            values: [line]
        }
    });
}

module.exports = {
    respondToCall: respondToCall
}