// const textToSpeech = require('@google-cloud/text-to-speech');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const calendar = require('dayjs/plugin/calendar');
dayjs.extend(calendar);
dayjs.extend(utc);
dayjs.extend(timezone);

async function getMessages (gmail, msgsCache, urlPrefix) {
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:inbox',
    });
    const messages = res.data.messages || [];

    // console.log(`Found ${messages.length} message(s).`);

    if (!messages.length) {
        return [];
    }

    // const tts = new textToSpeech.TextToSpeechClient();

    const result = [];
    var msgList = await Promise.all(messages.map(async (msgIds) => {

        var id = msgIds.id;

        var cached = msgsCache[id];
        if (cached) {
            cached.dateAge = cached.date.tz('America/Edmonton').calendar();
            console.log('got email from cache', id, cached.dateAge, cached.subject);
            return cached;
        }

        var payload = (await gmail.users.messages.get({
            auth: gmail.auth,
            userId: "me",
            id: id,
        })).data.payload;

        // console.log('payload', JSON.stringify(payload))
        var subject = payload.headers.find(h => h.name === 'Subject')?.value;
        console.log('get email with subject', subject);

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
        const dateAge = date.tz('America/Edmonton').calendar();

        // const start = new Date().getTime();
        var bodyDetails = await getBodyDetails(payload); // promise
        // const elapsed = new Date().getTime() - start;
        // console.log('got email body', id, elapsed, 'ms', bodyDetails.text.length, 'chars', bodyDetails.audio.length, 'bytes')

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
            if (part.mimeType === 'text/plain') {
                body += ' ' + part.body.data;
            }
        });
    } else {
        body = payload.body.data;
    }

    body = Buffer.from(body, 'base64').toString('utf8');
    // console.log('before--2--------------------------')
    // console.log('' + body)
    // console.log('----------------------------')
    // clean up

    // replace &#xD; with a space - will make lines run together, but that's ok
    body = body.replace(/^\.$/g, ' ');
    body = body.replace(/^\,$/g, ' ');

    // misc cleanup
    body = body.replace(/\*\*/g, '*');


    // replace [image: xxx] with nothing
    body = body.replace(/\[image:[^]*?\]/g, '(Image)');

    // replace < xxx > with nothing
    body = body.replace(/<[^]*?>/g, '');

    var textForSpeech = body;

    // encode for xml
    textForSpeech = textForSpeech.replace(/&/g, '&amp;');

    // replace \r\n\r\n with a break
    textForSpeech = textForSpeech.replace(/\r\n\r\n/g, '<break time="750ms"/>');

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

module.exports = {
    getMessages: getMessages
};

