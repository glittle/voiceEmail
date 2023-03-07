const { Twilio } = require('twilio');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
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
        var info = tempStorage[callSid];


        switch (callStatus) {
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
            activeMsg: null,
            steps: [],
            msgs: []
        };
        tempStorage[callSid] = info;

        // record current time into the 5th column - Call Start
        saveToSheetCell("E", rowNum, now);

        // get messages
        const msgs = await gmailHelper.getMessages(gmail);

        console.log('-->', info.name, 'msgs:', msgs.length);

        // load them into tempStorage
        info.msgs = msgs;
        info.steps.push('Msgs ' + msgs.length)

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

            var msg = msgs[0];
            gather.say(`${msg.dateAge} From "${msg.simpleFrom}" with subject "${msg.subject}"`);

            gather.say(`Press 1 to listen, 2 to go to the next.`);

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

function handleOngoingCall (query, twiml, info) {
    const digit = query.Digits;

    // no digit?  Something is wrong
    if (!digit) {
        twiml.say(`Sorry, didn't get your response.  Goodbye.`);
        twiml.hangup();
        return twiml.toString();
    }

    // get the message
    var msg = info.msgs[0];

    // if we're already playing a message, handle the response
    if (info.activeMsg) {
        switch (digit) {
            case '1':
                // play message again
                twiml.say(info.activeMsg.body);
                twiml.play({ digits: 'ww' }); // pause for a second
                twiml.say(`Press 1 to listen again, 2 to go to the next.`);
                break;

            case '2':
                // go to next message
                info.msgs.shift();
                info.activeMsg = null;

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
    } else {
        switch (digit) {
            case '1':
                // play message
                info.activeMsg = msg;
                // twiml.play(msg.mediaUrl);
                twiml.say(msg.body);
                twiml.play({ digits: 'ww' }); // pause for a second
                twiml.say(`Press 1 to listen again, 2 to go to the next.`);
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
    }

    return twiml.toString();
};

async function saveToSheetCell (col, rowNum, val) {
    // convert to col notation to excel column name
    var colName = String.fromCharCode(64 + rowNum);

    await sheetsApi.spreadsheets.values.update({
        spreadsheetId: process.env.sheetId,
        range: colName + rowNum,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [[val]]
        }
    });
}

async function addToLog (info) {
    var line = [info.start, info.callerNum, info.name, info.callSid, info.steps?.join()];

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