// const textToSpeech = require('@google-cloud/text-to-speech');
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const calendar = require('dayjs/plugin/calendar')
const relativeTime = require('dayjs/plugin/relativeTime')
dayjs.extend(calendar)
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)
const { convert } = require('html-to-text')

/*
Note: the gmail account being used must have the following settings:
- Conversation mode is OFF
*/

async function getMessages (gmail, labelName, isNew) {
  var start1 = new Date().getTime()
  const messages = []

  // tried to use Drafts but can't get the content easily. Better to use in:sent
  // can't use in:sent

  // get messages in the _Welcome label
  const res1 = await gmail.users.messages.list({
    userId: 'me',
    q: `label:_Welcome NOT label:${labelName}`
  })
  console.log('res1', res1.data)
  var msgs1 = res1.data.messages
  if (msgs1 && msgs1.length) {
    msgs1.forEach(m => (m.isWelcome = true))
    messages.push(...msgs1)
  }
  var numWelcome = messages.length // - numDrafts;
  console.log(
    `Found ${numWelcome} welcome msg(s) in`,
    new Date().getTime() - start1,
    'ms'
  )

  // get all messages from the last 7 days (ignoring the timezone)
  var cutoffDate = dayjs().subtract(7, 'day').format('YYYY/MM/DD')
  start1 = new Date().getTime()

  // get this label's messages
  const res2 = await gmail.users.messages.list({
    userId: 'me',
    q: `in:inbox after:${cutoffDate} NOT label:${labelName}`
    //maxResults: isNew ? 2 : 100
  })
  console.log('res2', res2.data)

  // add the res messages to the messages array
  if (res2.data.messages) {
    messages.push(...res2.data.messages)
  }
  var numMessages = messages.length

  console.log(
    `Found ${numMessages} total message(s) in`,
    new Date().getTime() - start1,
    'ms'
  )

  return messages
}

async function getOlderMessage (gmail, msgs, msgsCache, urlPrefix) {
  console.log('getting old', msgs.length)

  var timeOfEarliestKnownEmail = msgs.length
    ? Math.floor(msgs[0].date.valueOf() / 1000)
    : Math.floor(new Date().getTime() / 1000)

  const res2 = await gmail.users.messages.list({
    userId: 'me',
    q: `in:inbox before:${timeOfEarliestKnownEmail}`,
    maxResults: 1
  })
  console.log('res2', res2.data)

  // add the res messages to the messages array
  var oldMsgList = res2.data.messages
  if (!oldMsgList.length) {
    return 0
  }

  var newMsg = await getMessageDetail(
    gmail,
    oldMsgList[0],
    msgsCache,
    urlPrefix
  )
  msgs.unshift(newMsg)

  return 1
}

// get the body of the messages
async function loadMessages (gmail, messages, msgsCache, urlPrefix) {
  const result = []
  var msgList = await Promise.all(
    messages.map(m => getMessageDetail(gmail, m, msgsCache, urlPrefix))
  )
  // sort msgList by dateSort with oldest first
  msgList = msgList.sort((a, b) => {
    if (a.isWelcome && !b.isWelcome) return -1
    if (!a.isWelcome && b.isWelcome) return 1

    return a.dateSort - b.dateSort
  })

  return msgList
}

// allow just one to be be called at a time
// however, to sort by date, need to get them all first
async function getMessageDetail (gmail, rawMsg, msgsCache, urlPrefix) {
  console.log('rawMsg', rawMsg)

  var id = rawMsg.id

  var cached = msgsCache[id]
  if (cached) {
    cached.dateAge = cached.date.tz('America/Edmonton').fromNow()
    console.log('X got email from cache', id, cached.dateAge, cached.subject)
    return cached
  }

  var startTime = new Date().getTime()
  var payload
  if (id.startsWith('r-')) {
    console.log('get draft', id)
    payload = (
      await gmail.users.drafts.get({
        auth: gmail.auth,
        userId: 'me',
        id: id
      })
    ).data.message.payload

    // console.log('draft', payload);
  } else {
    console.log('get message', id)
    payload = (
      await gmail.users.messages.get({
        auth: gmail.auth,
        userId: 'me',
        id: id
      })
    ).data.payload
  }
  // console.log('payload', JSON.stringify(payload))
  var subject = payload.headers.find(h => h.name === 'Subject')?.value
  subject = subject.replace('[calgary-bahais] ', '').trim()
  subject = fixWords(subject) + '!' // add ! to make it sound better
  // subject = subject.replace(/\bBab\b/g, '<phoneme alphabet=\"ipa\" ph=\"Bˈɑːb\"></phoneme>'); // replace Bab with Báb
  // subject = `<speak>${subject}</speak>`;

  var to = payload.headers.find(h => h.name === 'To')?.value
  var simpleTo = to?.replace(/<.*>/, '').trim()

  var from = payload.headers.find(h => h.name === 'From')?.value
  var simpleFrom = from?.replace(/<.*>/, '').trim()

  var dateStr = payload.headers.find(h => h.name === 'Date')?.value

  // count the number of numAttachments in the payload
  var numAttachments = 0
  if (payload.parts) {
    payload.parts.forEach(part => {
      if (part.filename) {
        numAttachments++
      }
    })
  }

  //convert dateStr to date using dayjs
  const date = dayjs(dateStr)
  const dateAge = date.tz('America/Edmonton').fromNow()

  const start = new Date().getTime()
  var bodyDetails = await getBodyDetails(payload) // promise
  const elapsed = new Date().getTime() - start
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
    numAttachments: numAttachments,
    isWelcome: rawMsg.isWelcome
  }

  msgsCache[id] = final

  return final
}

function fixWords (s) {
  // s = s.replace(/\bBab\b/g, 'Baub'); // replace Bab with Báb
  // s = s.replace(/\bBáb\b/g, 'Baub'); // replace Bab with Báb
  return s
}

async function getBodyDetails (payload) {
  var body = ''
  const debug = 0 // set to 1 to see final text, 2 to debug process, 3 to see full text
  // var numPdfs = 0;
  var useHtml = false

  const fnDoPart = (depth, part) => {
    if (debug > 1) console.log('Level', depth, part.mimeType)

    if (part.mimeType === 'text/plain') {
      body += ' ' + Buffer.from(part.body.data, 'base64').toString('utf8')
      if (debug > 1) console.log('used this text part')
      return
    }

    if (useHtml && part.mimeType === 'text/html') {
      body += ' ' + Buffer.from(part.body.data, 'base64').toString('utf8')
      if (debug > 1) console.log('used this HTML part')
      return
    }

    // if (part.mimeType === 'application/pdf') {
    //     numPdfs++;
    // }

    if (
      part.mimeType === 'multipart/alternative' ||
      part.mimeType === 'multipart/related'
    ) {
      part.parts.forEach(p => fnDoPart(depth + 1, p))
    }
  }

  if (payload.parts) {
    payload.parts.forEach(part => fnDoPart(1, part))

    if (!body) {
      useHtml = true
      console.log('no text found - try with html')
      payload.parts.forEach(part => fnDoPart(1, part))
    }
  } else {
    if (debug > 1) console.log('used main body')
    body = Buffer.from(payload.body.data, 'base64').toString('utf8')
  }

  // remove any extra spaces or non-printing letters
  body = body.trim()
  body = body.replace(/[\u200B-\u200F\uFEFF]/g, '')

  // remove html tags
  if (body.startsWith('<')) {
    if (debug > 2) {
      console.log('html-before--------------------------')
      console.log(body)
      console.log('----------------------------')
    }

    // Extract the visible text using html-to-text
    body = convert(body, {
      wordwrap: false,
      ignoreHref: true,
      ignoreImage: true
    })
    var lines = body.split('\n')
    // add , to make tts pause between lines
    // body = lines.join(',\n');
    lines = lines.map(line => line.trim())

    // remove any [xx] text - emails get duplicated
    body = body.replace(/\[.*?\]/g, '')

    if (debug > 2) {
      console.log('html-after--------------------------')
      console.log(body)
      console.log('----------------------------')
    }
  } else {
    if (debug > 2) {
      console.log('plain-text--------------------------')
      console.log(body)
      console.log('----------------------------')
    }
  }
  // clean up

  // remove some standard footer text
  body = body.replaceAll(
    `Please note that emails sent to community@calgary-bahai.org have been reviewed and approved according to policies of the Local Spiritual Assembly.`,
    ''
  )
  body = body.replaceAll(
    `You received this message because you are subscribed to the Google Groups "Calgary Bahá'í Community" group.`,
    ''
  )
  body = body.replaceAll(
    `To unsubscribe from this group and stop receiving emails from it, send an email to community+unsubscribe@calgary-bahai.org.`,
    ''
  )

  // in NSA emails
  body = body.replace(
    /In order to open the \.pdf message.*readstep2\.html\./gs,
    ''
  )

  // remove empty lines with . or ,
  body = body.replace(/^\..*?$/g, ' ') // lines that start with .
  body = body.replace(/^\,.*?$/g, ' ') // lines that start with ,
  body = body.replace(/-\-+\s*?/g, ' ') // lines that start with --
  body = body.replace(/^\+1.*?$/g, '') // lines that start with +1

  // misc cleanup
  body = body.replace(/\*\*/g, '*') // change ** to *

  // remove all [image: xxx] tags
  //body = body.replace(/\[image:.*?\]/g, '[Image]');

  // remove all [one-tab phone number] tags
  // body = body.replace(/\+\d{11},,.*$/g, '');
  body = body.replace(/\+\d{11},,.*/g, '') // first one didn't work for some reason
  body = body.replace(/One tap mobile/g, '') // don't need this line

  // remove all <a> tags
  body = body.replace(/<a.*?>/g, ' [link] ')

  // remove text versions of image or tracking tags
  body = body.replace(/<http.*?>/g, '')
  // body = body.replace(/<https:\/\/bahai\.us14\.list-manage\.com\/track\/click\?.*>/g, '');

  body = body.replace(/<img.*?>/g, ' [image] ')

  // remove plain http links
  body = body.replace(/http.*?\s/g, ' [link] ')

  body = body.replace(/To view this discussion on the web visit.*\./gs, '')

  body = body.replace(/To view this discussion visit.*\./gs, '')

  // split into lines by \r or \n
  var lines = body.split(/[\r\n]/)

  // remove empty lines
  lines = lines.filter(line => line.trim().length > 0)

  // find first line that starts with > and remove 2 lines before it
  var firstLine = lines.findIndex(line => line.startsWith('>'))
  if (firstLine > 0) {
    lines.splice(firstLine - 2, 2)
  }

  // remove all lines starting with >
  lines = lines.filter(line => !line.startsWith('>'))

  // save as body
  body = lines.join('\r\n')

  if (body.length > maxLength) {
    const originalLength = body.length
    body = body.substring(0, maxLength - 25) + '... [Message Truncated]'
    // chop off and say 'truncated'
    console.log(
      `--> long text truncated to ${body.length} from ${originalLength}`
    )
  }

  var textForSpeech = `<speak><prosody rate="slow">${lines.join(
    '<break/>\r\n'
  )}</prosody></speak>`
  // textForSpeech = textForSpeech.replace(/&/g, 'and'); // replace & with and
  // textForSpeech = textForSpeech.replace(/\bBab\b/g, '<phoneme alphabet=\"ipa\" ph=\"BˈAːb\">Báb</phoneme>'); // replace Bab with Báb
  textForSpeech = fixWords(textForSpeech)

  if (debug) {
    console.log('final-------------------------')
    console.log(body)
    console.log('----------------------------')
    console.log(textForSpeech)
    console.log('----------------------------')
  }

  return {
    text: body,
    textForSpeech: textForSpeech
    // numPdf: numPdfs,
  }
}

async function setLabel (gmail, id, labelId, name) {
  try {
    /// --> Can't change labels on drafts!
    if (id.startsWith('r-')) {
      //     await gmail.users.drafts.modify({
      //         auth: gmail.auth,
      //         userId: 'me',
      //         id: id,
      //         resource: {
      //             addLabelIds: [labelId],
      //         }
      //     });
      //     console.log('set label on draft', labelId);
    } else {
      var result = await gmail.users.messages.modify({
        auth: gmail.auth,
        userId: 'me',
        id: id,
        resource: {
          addLabelIds: [labelId]
        }
      })

      if (result) {
        console.log(`LABEL set on msg: ${name} (${labelId})`)
      } else {
        console.warn(`failed to set label on msg: ${name} (${labelId})`)
      }
    }
  } catch (e) {
    console.log('error setting label', e)
  }
}

async function createLabel (gmail, labelName) {
  // catch if this crashes
  try {
    const res = await gmail.users.labels.create({
      // auth: gmail.auth,
      userId: 'me',
      resource: {
        name: labelName
      }
    })
    const label = res.data
    console.log('created label', labelName, label.id)
    return label.id
  } catch (e) {
    console.log('label already created')
  }
}

let voiceModel = ''
let maxLength = 4000 // default

module.exports = {
  getMessages: getMessages,
  loadMessages: loadMessages,
  getOlderMessage: getOlderMessage,
  createLabel: createLabel,
  setLabel: setLabel,
  setVoiceModel: function (model) {
    voiceModel = model
    // const maxLength = 4500; // Google real limit is 5000, but seems like we need to stop before that
    // const maxLength = 4000; // OpenAi real limit is 4096
    // const maxLength = 2000 // Deepgram limit
    // const maxLength = 4000 // AWS limit. Real is supposed to be 6000.
    maxLength = voiceModel === 'ms' || voiceModel === 'gemini' ? 9000 : 4000 // real limits: Microsoft limit is 10,000, AWS is 5,000
  }
}
