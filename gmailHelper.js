// const textToSpeech = require('@google-cloud/text-to-speech');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const calendar = require('dayjs/plugin/calendar');
const relativeTime = require('dayjs/plugin/relativeTime');
dayjs.extend(calendar);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

/*

Note: the gmail account being used must have the following settings:

- Conversation mode is OFF

*/

async function createLabel (gmail, labelName) {
    // catch if this crashes
    try {
        const res = await gmail.users.labels.create({
            // auth: gmail.auth,
            userId: 'me',
            resource: {
                name: labelName,
            }
        });
        const label = res.data;
        console.log('created label', labelName, label.id);
        return label.id;
    } catch (e) {
        console.log('label already created');
    }
}

async function getMessages (gmail, labelName, msgsCache, urlPrefix) {
    const start1 = new Date().getTime();
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: `in:inbox NOT label:${labelName}`,
    });
    const messages = res.data.messages || [];

    console.log(`Found ${messages.length} message(s) in`, new Date().getTime() - start1, 'ms');

    if (!messages.length) {
        return [];
    }

    // const tts = new textToSpeech.TextToSpeechClient();

    const result = [];
    var msgList = await Promise.all(messages.map(async (msgIds) => {

        var id = msgIds.id;

        var cached = msgsCache[id];
        if (cached) {
            cached.dateAge = cached.date.tz('America/Edmonton').fromNow();
            console.log('got email from cache', id, cached.dateAge, cached.subject);
            return cached;
        }

        console.log('get email', id);
        var startTime = new Date().getTime();
        var payload = (await gmail.users.messages.get({
            auth: gmail.auth,
            userId: "me",
            id: id,
        })).data.payload;
        // console.log('get email', id, 'took', new Date().getTime() - startTime, 'ms');

        // console.log('payload', JSON.stringify(payload))
        var subject = payload.headers.find(h => h.name === 'Subject')?.value;
        console.log('get email Subject:', subject);

        var to = payload.headers.find(h => h.name === 'To')?.value;
        var simpleTo = to?.replace(/<.*>/, '').trim();

        var from = payload.headers.find(h => h.name === 'From')?.value;
        var simpleFrom = from?.replace(/<.*>/, '').trim();

        var dateStr = payload.headers.find(h => h.name === 'Date')?.value;

        // count the number of attachments in the payload
        var attachments = 0;
        if (payload.parts) {
            payload.parts.forEach(part => {
                if (part.filename) {
                    attachments++;
                }
            });
        }


        //convert dateStr to date using dayjs
        const date = dayjs(dateStr);
        const dateAge = date.tz('America/Edmonton').fromNow();

        const start = new Date().getTime();
        var bodyDetails = await getBodyDetails(payload); // promise
        const elapsed = new Date().getTime() - start;
        // console.log('got email body', id, elapsed, 'ms', bodyDetails.text.length, 'chars')

        var final = {
            id: id,
            subject: subject,
            date: date,
            dateAge: dateAge,
            dateSort: date.toDate(),
            from: from,
            simpleFrom: simpleFrom,
            to: to,
            simpleTo: simpleTo,
            bodyDetails: bodyDetails,
            bodyUrl: urlPrefix + id,
            attachments: attachments,
        };

        msgsCache[id] = final;

        return final;
    }));

    // sort msgList by dateSort with oldest first
    msgList = msgList.sort((a, b) => {
        return a.dateSort - b.dateSort;
    });

    return msgList;
}

async function getBodyDetails (payload) {
    var body = '';
    if (payload.parts) {
        payload.parts.forEach(part => {
            // console.log('part', part.mimeType);
            if (part.mimeType === 'text/plain') {
                body += ' ' + part.body.data;
                // console.log('used part body')
            } else if (part.mimeType === 'multipart/alternative') {
                part.parts.forEach(part2 => {
                    // console.log('sub part', part2.mimeType);
                    if (part2.mimeType === 'text/plain') {
                        body += ' ' + part2.body.data;
                        // console.log('used part body')
                    }
                });
            }
        });
    } else {
        // console.log('used main body')
        body = payload.body.data;
    }

    if (body) {
        body = Buffer.from(body, 'base64').toString('utf8');
    }
    // console.log('before--2--------------------------')
    // console.log('body', body)
    // console.log('----------------------------')

    // clean up

    // remove some standard footer text
    body = body.replaceAll(`Please note that emails sent to community@calgary-bahai.org have been reviewed and approved according to policies of the Local Spiritual Assembly.`, '');
    body = body.replaceAll(`You received this message because you are subscribed to the Google Groups "Calgary Bahá'í Community" group.`, '');
    body = body.replaceAll(`To unsubscribe from this group and stop receiving emails from it, send an email to community+unsubscribe@calgary-bahai.org.`, '');

    // remove empty lines with . or ,
    body = body.replace(/^\..*?$/g, ' '); // lines that start with .
    body = body.replace(/^\,.*?$/g, ' '); // lines that start with ,
    body = body.replace(/-\-+\s*?/g, ' '); // lines that start with --

    // misc cleanup
    body = body.replace(/\*\*/g, '*'); // change ** to *

    // remove all [image: xxx] tags
    //body = body.replace(/\[image:.*?\]/g, '[Image]');

    // replace < xxx > with nothing
    body = body.replace(/<.*?>/g, '[link]. ');

    // remove http links
    body = body.replace(/http.*?\s/g, '[link]. ');

    body = body.replaceAll(`To view this discussion on the web visit [link]. `, '');

    // split into lines by \r or \n
    var lines = body.split(/[\r\n]/);

    // remove empty lines
    lines = lines.filter(line => line.trim().length > 0);

    // find first line that starts with > and remove 2 lines before it
    var firstLine = lines.findIndex(line => line.startsWith('>'));
    if (firstLine > 0) {
        lines.splice(firstLine - 2, 2);
    }

    // remove lines starting with >
    body = lines.filter(line => !line.startsWith('>')).join('\r\n');

    var textForSpeech = body;

    // encode for xml
    // textForSpeech = textForSpeech.replace(/&/g, '&amp;');

    // replace \r\n\r\n with a break
    // textForSpeech = textForSpeech.replace(/\r\n\r\n/g, '<break time="750ms"/>');

    // // convert text to MP3
    // const request = {
    //     input: { text: textForSpeech },
    //     // Select the language and SSML voice gender (optional)
    //     voice: { languageCode: 'en-US', name: 'en-US-Neural2-E' },
    //     // select the type of audio encoding
    //     audioConfig: { audioEncoding: 'MP3' },
    // };

    // Performs the text-to-speech request
    // const [response] = await tts.synthesizeSpeech(request);
    // var mp3 = response.audioContent;

    // return {
    //     text: body,
    //     audio: mp3,
    // };

    return {
        text: body,
        textForSpeech: textForSpeech,
    };
}

async function setLabel (gmail, id, labelId) {
    try {
        await gmail.users.messages.modify({
            auth: gmail.auth,
            userId: 'me',
            id: id,
            resource: {
                addLabelIds: [labelId],
            }
        });
        console.log('set label', labelId);
    } catch (e) {
        console.log('error setting label', e);
    }
}

module.exports = {
    getMessages: getMessages,
    createLabel: createLabel,
    setLabel: setLabel,
};

