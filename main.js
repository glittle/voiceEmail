const { Twilio } = require('twilio');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const textToSpeech = require('@google-cloud/text-to-speech');
const gmailHelper = require('./gmailHelper');

const utf8 = require('utf8');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const calendar = require('dayjs/plugin/calendar');
dayjs.extend(calendar);
dayjs.extend(utc);
dayjs.extend(timezone);

var sheetsApi;
const tts = new textToSpeech.TextToSpeechClient();

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

    info.steps.push(`>${digit}`);
    console.log('handleOngoingCall', `Pressed ${digit}`, "Current #", info.currentMsgNum, "Num Msgs", info.msgs.length);

    // get the message
    // var msg = info.msgs[0];

    const gather = twiml.gather({
        timeout: 15,
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
        console.log('==>', callStatus, callSid);

        if (!callStatus) {
            return 'invalid request';
        }

        // get info from tempStorage?
        var info = tempStorage.calls[callSid];

        switch (callStatus) {
            case 'playClip':
                const code = query.c;
                const clip = tempStorage.clips.find(c => c.code === code);
                if (!clip) {
                    console.warn('clip not found', code);
                    twiml.say('Sorry, there was an error on the server.');
                    return twiml.toString();
                }
                // console.log('clip', clip);

                info.mp3StartMs = new Date().getTime();

                return {
                    isAudio: true,
                    audio: clip.mp3
                };

            case 'playBody':
                const msgId = query.id;
                const msgIndex = info.msgs.findIndex(msg => msg.id === msgId);
                info.steps.push(`(msg ${msgIndex})`);
                const msg = info.msgs[msgIndex];
                // console.log('msg', msgId, msgIndex, msg)
                // console.log('--> GET MP3', query.id, msgIndex, msg.mp3?.length, info.msgs.map(m => m.id).join(', '));

                var mp3 = msg.mp3;
                if (!mp3) {
                    // convert text to MP3
                    var txt = msg.bodyDetails.textForSpeech?.replace(/&/g, '&amp;')
                    if (!txt) {
                        console.warn('There was no text to convert to MP3!');
                        twiml.say(`There appears to be no text in this message.`);
                        return twiml.toString();
                    } else {
                        mp3 = msg.mp3 = await makeMp3(txt);
                    }
                }

                if (!mp3) {
                    twiml.say('Sorry, there was an error getting the audio for this message.');
                    return twiml.toString();
                }

                console.log('==> SENDING MP3', '#', msgIndex, mp3.length, 'bytes');

                // all seems good - mark message as read
                // get label name
                const labelName = tempStorage.labels.find(l => l.id === info.labelId)?.name;
                gmailHelper.setLabel(gmail, msg.id, info.labelId, labelName);

                info.mp3StartMs = new Date().getTime();

                return {
                    isAudio: true,
                    audio: mp3
                };

            case 'completed':
                // the call is over
                twiml.say(`Bye!`);

                // add a row to the spreadsheet
                //CallStart	Phone	Name	SID	Log
                if (info) {
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
                    console.log('--> call logged');
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

        console.log('callerNumRaw', typeof callerNumRaw, callerNumRaw);

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
            console.log('--> label already exists', labelName);
        }

        // add another label with "{labelName} Save" and get the labelId
        var saveLabelId = tempStorage.labels.find(l => l.name === labelName + ' Save')?.id;
        if (!saveLabelId) {
            saveLabelId = await gmailHelper.createLabel(gmail, labelName + ' Save');
            tempStorage.labels.push({ name: labelName + ' Save', id: saveLabelId });
        } else {
            console.log('--> save label already exists', labelName + ' Save');
        }

        info = {
            callSid: callSid,
            callerNum: callerNum,
            isDevCaller: callerNum === '403-402-7106', // && false,
            name: callerName,
            label: labelName,
            labelId: labelId,
            rowNum: rowNum,
            start: now,
            startMs: nowMs,
            mp3StartMs: 0,
            currentMsgNum: -1, // index of msgs array
            steps: [],
            msgs: [],
            loadedMsgs: [],
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


        if (numMsgs === 0) {
            if (info.isDevCaller) {
                const gather = twiml.gather({
                    timeout: 15,
                    numDigits: 1,
                    input: 'dtmf',
                    action: query.PATH, // drop the original query string
                    method: 'GET', // force to use GET
                });
                gather.say(`There are no new emails for you.`);
                gather.say(`You can hang up, or press 1 to go back to an email you have heard already.`);
            } else {
                twiml.say(`There are no new emails for you.`);
                twiml.say(`Good bye!`);
                twiml.hangup();
            }
        } else {
            // say the number of messages
            const gather = twiml.gather({
                timeout: 15,
                numDigits: 1,
                input: 'dtmf',
                action: query.PATH, // drop the original query string
                method: 'GET', // force to use GET
            });
            if (numMsgs === 1) {
                gather.say(`There is 1 new message.`);
            } else {
                gather.say(`There are ${numMsgs} new messages.`);
            }

            // await playMessage(gather, info, query, tempStorage);
            gather.say(`Press 3 to start listening. Press 0 for instructions.`);

            twiml.say(`We didn't receive any answer from you.`);
            twiml.say(`Good bye!`);
            twiml.hangup();
        }

        return twiml.toString();
    }
    catch (err) {
        console.log('--> ERROR', err);
        twiml.say(`There was an error.  Please try again later.`);
        twiml.hangup();
        return twiml.toString();
    }
}

async function makeMp3 (text) {
    const maxLength = 4500; // real limit is 5000, but seems like we need to stop before that

    if (text.length > maxLength) {
        console.log('--> long text truncated to ~5000', text.length);
        // chop off and say 'truncated'
        text = text.substr(0, maxLength - 100) + '... [Message Truncated]';
    }


    const request = {
        input: { ssml: text },
        voice: { languageCode: 'en-US', name: 'en-US-News-K' },
        audioConfig: { audioEncoding: 'MP3' },
    };

    console.log(`--> making mp3 for clip - ${text.length} chars - ${text.substr(0, 100)}...`);
    try {
        // start timer
        const start = Date.now();

        // Performs the text-to-speech request
        const [response] = await tts.synthesizeSpeech(request);
        mp3 = await response.audioContent;

        // end timer
        const end = Date.now();
        // console.log('--> seconds to retrieve:', ((end - start) / 1000.0).toFixed(1));

        return mp3;
    } catch (err) {
        console.log('error A', err);
        return null;
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

    await sayPlay(`From: `, msg.simpleFrom, urlPrefix, gather, tempStorage);
    await sayPlay(`With Subject: `, msg.subject, urlPrefix, gather, tempStorage);

    // var numPdfs = msg.bodyDetails.numPdfs;
    // if (numPdfs) {
    //     gather.say(`With ${numPdfs} PDF file${numPdfs === 1 ? '' : 's'}.`);
    // }

    // count words and round to nearest 100
    var wordCount = msg.bodyDetails.textForSpeech.split(' ').length + 1;

    // if less than 100, round to nearest 10
    if (wordCount < 100) {
        wordCount = Math.round(wordCount / 10) * 10;
    }
    // if > 100, round to nearest 100
    else {
        wordCount = Math.round(wordCount / 100) * 100;
    }

    gather.say(`About ${wordCount} words long`);

    if (msg.numAttachments) {
        gather.say(`with ${msg.numAttachments} attachment${(msg.numAttachments === 1 ? '' : 's')}.`);
    }

    // gather.say(msg.bodyText);

    gather.play(msg.bodyUrl);
    gather.play({ digits: 'ww' }); // pause for a second

    var isLast = info.currentMsgNum === info.msgs.length - 1;
    if (isLast) {
        gather.say(`That was the last message. Press 2 to listen again, 0 for instructions, or hang up if you are done.`);
    } else {
        gather.say(`Press 2 to listen again, 3 to go to the next message, 0 for instructions.`);
    }
}

async function sayPlay (prefix, text, urlPrefix, gather, tempStorage) {
    if (!text) {
        return;
    }

    var clip = tempStorage.clips.find(c => c.text === text);

    if (!clip) {
        var mp3 = await makeMp3(text);
        if (mp3) {

            // make short random code to avoid collisions
            var code = Math.random().toString(36).substring(2);

            // make clip
            clip = {
                mp3: mp3,
                text: text,
                code: code,
                url: urlPrefix + code
            };
            tempStorage.clips.push(clip);
        }
    }

    if (clip) {
        console.log('==> play -', prefix, text, clip.url)
        gather.say(prefix);
        gather.play(clip.url);
    } else {
        console.log('==> say -', prefix, text)
        gather.say(`${prefix} "${text}"`);
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