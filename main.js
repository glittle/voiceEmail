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

/// return final XML text to send or with MP3 audio
async function respondToCall (query, gmail, api, tempStorage) {
    const twiml = new VoiceResponse();
    sheetsApi = api;

    try {
        // get data from the Directory spreadsheet - set to 99 names for now
        const rows = (await sheetsApi.spreadsheets.values.get({
            spreadsheetId: process.env.sheetId,
            range: "A1:F100"
        })).data.values;

        // get call info
        const callSid = query.CallSid;
        const callStatus = query.CallStatus;

        console.log('==>', callStatus, callSid);

        // get info from tempStorage?
        var info = tempStorage.calls[callSid];

        switch (callStatus) {
            case 'playAudio':
                const msgId = query.id;
                const msgNum = info.msgs.findIndex(msg => msg.id === msgId);
                info.steps.push(`(msg ${msgNum})`);
                const msg = info.msgs[msgNum];

                var mp3 = msg.mp3;
                if (!mp3) {
                    // convert text to MP3
                    const tts = new textToSpeech.TextToSpeechClient();
                    const request = {
                        input: { text: msg.bodyDetails.textForSpeech },
                        // Select the language and SSML voice gender (optional)
                        voice: { languageCode: 'en-US', name: 'en-US-Neural2-E' },
                        // select the type of audio encoding
                        audioConfig: { audioEncoding: 'MP3' },
                    };
                    console.log('--> getting audio from google speech to text');
                    try {
                        const [response] = await tts.synthesizeSpeech(request);
                        mp3 = response.audioContent;
                        msg.mp3 = mp3;
                    } catch (err) {
                        console.log('error A', err);
                    }
                }

                if (!mp3) {
                    twiml.say('Sorry, there was an error getting the audio for this message.');
                    return twiml.toString();
                }

                console.log('--> SENDING MP3', msgNum, mp3.length);

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
                    addToLog(info);
                    console.log('--> call logged');
                }

                return twiml.toString();

            default:
                if (info) {
                    return handleOngoingCall(query, twiml, info);
                }
                break;
        }

        // handle new call

        const callerNumRaw = query.Caller;

        // no phone number?  Must be a test.
        if (!callerNumRaw) {
            return `Invalid request.`
        }

        // reformat caller number from +1xxxxxxxxxx to xxx-xxx-xxxx
        const callerNum = callerNumRaw.replace(/\D/g, '').substr(1).replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');

        // console log before and after - for initial testing
        console.log('--> callerNum', callerNumRaw, callerNum);

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
            return twiml.toString();
        }

        const rowNum = rowIndex + 1;
        const callerRow = rows[rowIndex];

        var now = dayjs().tz('America/Edmonton').format('YYYY-MM-DD HH:mm:ss');


        // store info for later
        // get name from 4th column first, then 3rd column
        const callerName = callerRow[3] || callerRow[2];

        info = {
            callSid: callSid,
            callerNum: callerNum,
            name: callerName,
            rowNum: rowNum,
            start: now,
            msgNum: 0, // index of msgs array
            steps: [],
            msgs: []
        };
        tempStorage.calls[callSid] = info;

        // record current time into the 5th column - Call Start
        saveToSheetCell("E", rowNum, now);

        // get messages
        const urlPrefix = `${query.PATH}?CallSid=${info.callSid}&CallStatus=playAudio&id=`;

        const msgs = await gmailHelper.getMessages(gmail, tempStorage.msgs, urlPrefix);

        console.log('-->', info.name, 'msgs:', msgs.length);

        // load them into tempStorage
        info.msgs = msgs;
        info.steps.push(msgs.length + ' msgs');
        // console.log('Msgs', msgs, msgs[0].bodyDetails.audioPromise);

        twiml.say(`Hello ${info.name}.`);

        if (msgs.length === 0) {
            twiml.say(`No new messages have been received.`);
            twiml.say(`Goodbye.`);
            twiml.hangup();
        } else {
            const gather = twiml.gather({
                timeout: 15,
                numDigits: 1,
                input: 'dtmf',
                action: query.PATH, // drop the original query string
                method: 'GET', // force to use GET
            });

            gather.say(`There are ${msgs.length} new messages for you.`);

            playMessage(gather, info);

            twiml.say(`We didn't receive any answer from you. Bye!`);
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

async function playMessage (gather, info) {
    console.log('--> playMessage', info.msgNum);

    var msg = info.msgs[info.msgNum];

    if (!msg) {
        return;
    }

    gather.say(`Message ${info.msgNum + 1}: ${msg.dateAge} From "${msg.simpleFrom}" with subject "${msg.subject}"`);
    // gather.say(msg.bodyText);
    gather.play(msg.bodyUrl);
    gather.play({ digits: 'ww' }); // pause for a second

    gather.say(`Press 1 to listen again, 2 to go to the next, 0 for instructions.`);
}

function handleOngoingCall (query, twiml, info) {
    const digit = query.Digits;

    // no digit?  Something is wrong
    if (!digit) {
        twiml.say(`Sorry, didn't get your response.  Goodbye.`);
        twiml.hangup();
        return twiml.toString();
    }

    info.steps.push(`>${digit}`);

    // get the message
    var msg = info.msgs[0];

    const gather = twiml.gather({
        timeout: 15,
        numDigits: 1,
        input: 'dtmf',
        action: query.PATH, // drop the original query string
        method: 'GET', // force to use GET
    });


    switch (digit) {
        case '0':
            // provide instructions
            gather.say(`Press 1 to listen to the first message or repeat the message you are on.
                        Press 2 to go to the next message.
                        Press 3 to go to the previous message.
                        Press 0 to repeat these instructions.
                        Hang up at any time to end the call.`);
            return twiml.toString();

        case '1':
            playMessage(gather, info);
            break;

        case '2':
            // go to next message
            if (info.msgNum < info.msgs.length - 1) {
                info.msgNum++;
                playMessage(gather, info);
            } else {
                gather.say(`No more messages.`);
            }
            break;

        case '3':
            // go to previous message
            if (info.msgNum > 0) {
                info.msgNum--;
                playMessage(gather, info);
            } else {
                gather.say(`No previous messages.`);
            }

            break;

        default:
            twiml.say(`We didn't receive any answer from you. Bye!`);
            twiml.hangup();
            break;
    }

    switch (digit) {
        case '1':

            break;

        case '2':
            // go to next message
            info.msgs.shift();
            if (info.msgs.length === 0) {
                twiml.say(`No more messages.`);
                twiml.say(`Goodbye.`);
                twiml.hangup();
            } else {
                msg = info.msgs[0];
                twiml.say(`${msg.dateAge} From "${msg.simpleFrom}" with subject "${msg.subject}"`);
                twiml.say(`Press 1 to listen, 2 to go to the next.`);
            }
            break;

        default:
            twiml.say(`We didn't receive any answer from you. Bye!`);
            twiml.hangup();
            break;
    }

    return twiml.toString();
};

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