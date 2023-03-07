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

        // get info from tempStorage?
        var info = tempStorage[callSid];
        console.log('==>', callStatus, callSid, query.PATH); //, info || 'No Info', tempStorage);

        if (info) {
            // must be a returning call
            console.log('--> returning call');//, info);
        } else {
            console.log('--> new call');
        }

        switch (callStatus) {
            case 'ringing':
                break;
            case 'in-progress':
                break;
            case 'completed':
                // the call is over
                twiml.say(`Bye!`);

                // add a row to the spreadsheet
                //CallStart	Phone	Name	SID	Log
                if (info) {
                    addToLog([info.start, info.callerNum, info.name, info.callSid, info.steps?.join()]);
                    console.log('--> call logged');
                }

                return twiml.toString();
        }


        const callerNumRaw = query.Caller;

        // no phone number?  Must be a test.
        if (!callerNumRaw) {
            return `Invalid request.`
        }

        // reformat caller number from +1xxxxxxxxxx to xxx-xxx-xxxx
        const callerNum = callerNumRaw.replace(/\D/g, '').substr(1).replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');

        // console log before and after
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
            //         return `${xml}
            // <Response>
            //   <Say voice="man" language="en-us">
            //     Hello.
            //     I don't recognize this phone number.
            //     Please contact Glen to get set up to use this service.
            //     Goodbye!
            //   </Say>
            //   <Hangup/>
            // </Response>`;
        }

        const rowNum = rowIndex + 1;
        const callerRow = rows[rowIndex];

        // get name from 4th column first, then 3rd column
        const callerName = callerRow[3] || callerRow[2];

        // record current time into the 5th column
        saveToSheetCell("E", rowNum, new Date());

        // store info for later
        if (!info) {
            info = {
                callSid: callSid,
                callerNum: callerNum,
                name: callerName,
                rowNum: rowNum,
                start: dayjs().tz('America/Edmonton').format('YYYY-MM-DD HH:mm:ss'),
                steps: [],
                msgs: []
            };
            tempStorage[callSid] = info;
        }

        // get messages
        const msgs = await gmailHelper.getMessages(gmail);

        console.log('-->', callerName, 'msgs:', msgs.length);

        // load them into tempStorage
        info.msgs = msgs;

        twiml.say(`Hello ${callerName}.`);

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

        // say the first message

        // twiml.say(`Press 3 to delete the message.`);
        // twiml.say(`Press 4 to mark the message as read.`);
        // twiml.say(`Press 5 to mark the message as unread.`);
        // twiml.say(`Press 6 to archive the message.`);
        // twiml.say(`Press 7 to unarchive the message.`);
        // twiml.say(`Press 8 to move the message to the trash.`);
        // twiml.say(`Press 9 to move the message out of the trash.`);
        // twiml.say(`Press 0 to skip to the next message.`);
        // twiml.say(`Press # to end the call.`);
        // twiml.gather({});
        // twiml.say(`We didn't receive any answer from you. Bye!`);
        // twiml.hangup();


        //     const result = `${xml}
        // <Response>
        //   ${lines.join('')}
        //   <Gather timeout="15" numDigits="1" input="speech dtmf">
        //     <Say voice="man" language="en-us">Press 1 to listen to the next message.</Say>
        //   </Gather>
        //   <Say voice="man" language="en-us">We didn't receive any answer from you. Bye!</Say>
        //   <Hangup/>
        // </Response>`;

        // return result;
        return twiml.toString();
    }
    catch (err) {
        console.log('--> ERROR', err);
        twiml.say(`There was an error.  Please try again later.`);
        twiml.hangup();
        return twiml.toString();
    }
}


// async function getLabels (gmail) {
//     const res = await gmail.users.labels.list({
//         userId: 'me',
//     });
//     const labels = res.data.labels;
//     if (!labels || labels.length === 0) {
//         console.log('No labels found.');
//         return 'None found';
//     }
//     const result = [];
//     labels.forEach((label) => {
//         result.push(`${label.name}`);
//     });

//     return 'Labels: ' + result.join(', ');
// }

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

async function addToLog (columnsArray) {
    await sheetsApi.spreadsheets.values.append({
        spreadsheetId: process.env.sheetId,
        valueInputOption: "USER_ENTERED",
        range: "'Call Log'!A1",
        requestBody: {
            values: [columnsArray]
        }
    });
}




module.exports = {
    respondToCall: respondToCall
}