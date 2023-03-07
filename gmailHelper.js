const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const calendar = require('dayjs/plugin/calendar');
dayjs.extend(calendar);
dayjs.extend(utc);
dayjs.extend(timezone);

async function getMessages (gmail) {
    const res = await gmail.users.messages.list({
        userId: 'me',
    });
    const messages = res.data.messages || [];

    // console.log(`Found ${messages.length} message(s).`);

    if (!messages.length) {
        return [];
    }

    const result = [];
    var msgList = await Promise.all(messages.map(async (msgIds) => {
        var id = msgIds.id;
        var payload = (await gmail.users.messages.get({
            auth: gmail.auth,
            userId: "me",
            id: id,
        })).data.payload;

        // console.log('payload', JSON.stringify(payload))
        var subject = payload.headers.find(h => h.name === 'Subject')?.value;
        var to = payload.headers.find(h => h.name === 'To')?.value;
        var simpleTo = to?.replace(/<.*>/, '').trim();

        var from = payload.headers.find(h => h.name === 'From')?.value;
        var simpleFrom = from?.replace(/<.*>/, '').trim();

        var dateStr = payload.headers.find(h => h.name === 'Date')?.value;
        //convert dateStr to date using dayjs
        const date = dayjs(dateStr);
        const dateAge = date.tz('America/Edmonton').calendar();

        payload.parts.forEach(p => {
            console.log(p.mimeType, p.body?.data?.length);
        })
        var part = payload.parts.find(p => p.mimeType === 'text/plain');
        var body = part?.body?.data;
        if (body) {
            body = Buffer.from(body, 'base64').toString();

            // convert body to spoken text in mp3 format
            // var mp3 = await textToSpeech(body);
        }

        return {
            subject: subject,
            date: date,
            dateAge: dateAge,
            dateSort: date.toDate(),
            from: from,
            simpleFrom: simpleFrom,
            to: to,
            simpleTo: simpleTo,
            id: id,
            body: body,
        };
    }));

    // sort msgList by dateSort with oldest first
    msgList = msgList.sort((a, b) => {
        return a.dateSort - b.dateSort;
    });

    return msgList;
}

module.exports = {
    getMessages: getMessages
};

