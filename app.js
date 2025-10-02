require('dotenv').config()
const main = require('./main')

const express = require('express')
const fsp = require('fs').promises
const path = require('path')
const process = require('process')
const { authenticate } = require('@google-cloud/local-auth')
const { google } = require('googleapis')

const cron = require('node-cron');
const { preCacheAudio } = require('./main'); // Add this

// If modifying these scopes, delete token.json.
const SCOPES = [
  // 'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/cloud-platform'
]
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json')
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json')

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist () {
  try {
    const content = await fsp.readFile(TOKEN_PATH)
    const credentials = JSON.parse(content)
    return google.auth.fromJSON(credentials)
  } catch (err) {
    return null
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials (client) {
  const content = await fsp.readFile(CREDENTIALS_PATH)
  const keys = JSON.parse(content)
  const key = keys.installed || keys.web
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token
  })
  await fsp.writeFile(TOKEN_PATH, payload)
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize () {
  let client = await loadSavedCredentialsIfExist()
  if (client) {
    return client
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH
  })
  if (client.credentials) {
    await saveCredentials(client)
  }
  return client
}

// Create an Express webapp.
let app = express()
app.set('port', 8008)

app.post('/', async (req, res) => {
  try {
    console.log('|')
    console.log('| POST', callCount++, new Date().toLocaleString())
    console.log('|')
    // console.log(Object.keys(req));
    var params = req.body
    // console.log('POST', params);
    processIncoming(params, res)
  } catch (error) {
    console.log('error C', error)
    return error
  }
})

app.get('/', async (req, res) => {
  try {
    console.log('|')
    console.log('| GET', callCount++, new Date().toLocaleString(), req.method)
    console.log('|')
    var params = req.query
    console.log('| PATH', params)
    // console.log('GET', params);
    processIncoming(params, res)
  } catch (error) {
    console.log('error B', error)
    return error
  }
})

async function processIncoming (params, res) {
  // final will be text or an object with the audio
  var final = await doWork(params)

  if (final.isAudio) {
    const isMp3 = final.file && final.file.endsWith('.mp3')
    res.type(isMp3 ? 'audio/mpeg' : 'audio/wav')

    if (final.file) {
      res.sendFile(final.file)
      console.log('==> sent audio file')
    } else {
      res.send(final.audio)
      console.log('==> sent audio bytes')
    }
    return
  }

  console.log('--> RESPONSE', final)
  res.type('text/xml')
  res.send(final)
}

var tempStorage = {
  calls: {}, // details of each call
  msgs: {}, // the messages that have been processed
  clips: [], // mp3 clips for "from" and "subject"
  labels: [] // the known labels in this gmail account
}
var callCount = 0

async function doWork (query) {
  const auth = await authorize()

  const gmail = google.gmail({
    version: 'v1',
    auth
  })

  if (!tempStorage.labels.length) {
    const res = await gmail.users.labels.list({
      userId: 'me'
    })
    tempStorage.labels = res.data.labels
    // console.log('labels', tempStorage.labels);
    /*
        e.g.
        {
          id: 'Label_1',
          name: 'Glen',
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow',
          type: 'user'
        }
        */
  }

  const sheetsApi = google.sheets({
    version: 'v4',
    auth
  })

  const final = await main.respondToCall(query, gmail, sheetsApi, tempStorage)
  return final
}

// for testing
// doWork('test');
// Function to check if any call is active
function isAnyCallActive () {
  return Object.values(tempStorage.calls).some(call => !call.completed);
}

// Function to run pre-caching with call check
async function runPreCacheAudio (gmail) {
  if (isAnyCallActive()) {
    console.log('Skipping pre-caching: Active call(s) detected.');
    return;
  }
  console.log('Running pre-caching...');
  try {
    await preCacheAudio(gmail);
    console.log('Pre-caching completed.');
  } catch (error) {
    console.error('Pre-caching failed:', error);
  }
}

// Schedule pre-caching
(async () => {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  // Run immediately on startup
  console.log('Starting initial email check and audio pre-caching at', new Date().toLocaleString());
  await runPreCacheAudio(gmail);

  // Schedule every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    console.log('Starting scheduled email check and audio pre-caching at', new Date().toLocaleString());
    await runPreCacheAudio(gmail);
  }, {
    timezone: 'America/Edmonton'
  });
})();

// Start the server
let server = app.listen(app.get('port'), function () {
  console.log('|')
  console.log(
    'App started. Listening on port %s at %s',
    server.address().port,
    new Date().toLocaleString()
  )
})
