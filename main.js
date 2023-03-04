const xml = '<?xml version="1.0" encoding="UTF-8"?>';

async function respondToCall (query, gmail, sheetsApi, tempStorage) {

    console.log('|');
    console.log('|');
    console.log('|');
    console.log(query, tempStorage);

    const range = (await sheetsApi.spreadsheets.values.get({
        spreadsheetId: process.env.sheetId,
        range: "A1:F100"
    })).data;

    // const log = [JSON.stringify(query), JSON.stringify(tempStorage)];
    var rows = range.values;

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
        return `${xml}
<Response>
  <Say voice="man" language="en-us">
    Hello.
    I don't recognize this phone number.
    Please contact Glen to get set up to use this service.
    Goodbye!
  </Say>
  <Hangup/>
</Response>`;
    }

    const rowNum = rowIndex + 1;
    const callerRow = rows[rowIndex];

    // get name from 4th column first, then 3rd column
    const callerName = callerRow[3] || callerRow[2];

    // record current time into the 5th column
    (await sheetsApi.spreadsheets.values.update({
        spreadsheetId: process.env.sheetId,
        range: "E" + rowNum,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [[new Date()]]
        }
    })).data;

    // store info for later
    var info = {
        callSid: query.CallSid,
        callerNum: callerNumRaw,
        name: callerName,
        rowNum: rowIndex,
    };
    tempStorage[query.CallSid] = info;

    // build response
    const lines = [
        `<Say>Hello ${callerName}.</Say>`
    ];

    const msgs = await getMessages(gmail, tempStorage);

    console.log('-->', callerName, 'msgs:', msgs.length);

    // say how many msgs
    if (msgs.length === 0) {
        lines.push(`<Say>No new messages have been received.</Say>`);
    } else {
        lines.push(`<Say>There are ${msgs.length} new messages for you.</Say>`);
    }

    const result = `${xml}
<Response>
  ${lines.join('')}
  <Gather timeout="15" numDigits="1" input="speech dtmf">
    <Say voice="man" language="en-us">Press 1 to listen to the next message.</Say>
  </Gather>
  <Say voice="man" language="en-us">We didn't receive any answer from you. Bye !</Say>
  <Hangup/>
</Response>`;

    return result;
}

async function getMessages (gmail, tempStorage) {
    const res = await gmail.users.messages.list({
        userId: 'me',
    });
    const messages = res.data.messages || [];

    // console.log(`Found ${messages.length} message(s).`);

    if (!messages.length) {
        return [];
    }

    const result = [];
    return messages.map(async (msgIds) => {
        var id = msgIds.id;
        var payload = (await gmail.users.messages.get({
            auth: gmail.auth,
            userId: "me",
            id: id,
        })).data.payload;

        // console.log(payload.headers)
        var subject = payload.headers.find(h => h.name === 'Subject')?.value;
        var to = payload.headers.find(h => h.name === 'To')?.value;
        var from = payload.headers.find(h => h.name === 'From')?.value;
        return {
            subject: subject,
            from: from,
            to: to,
            id: id,
            body: payload.body.data,
        };
    });
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



module.exports = {
    respondToCall: respondToCall
}