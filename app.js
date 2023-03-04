require('dotenv').config()
const main = require('./main');

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {
    authenticate
} = require('@google-cloud/local-auth');
const {
    google
} = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist () {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials (client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize () {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

let app = express();
app.set('port', 8008);
// app.set('port', (process.env.PORT || 8008));

app.get('/', async (req, res) => {
    try {
        var final = await doWork(req.query);
        res.send(final);
    } catch (error) {
        return error;
    }
})

var tempStorage = {};
const xml = '<?xml version="1.0" encoding="UTF-8"?>';

async function doWork (query) {
    const auth = await authorize();

    const gmail = google.gmail({
        version: 'v1',
        auth
    });

    const sheetsApi = google.sheets({
        version: 'v4',
        auth,

    });

    // console.log('test', process.env.sheetId)



    // console.log('range', range)
    try {
        const final = await main.respondToCall(query, gmail, sheetsApi, tempStorage);
        console.log(final);
        return final;
    } catch (err) {
        console.log(err);
        return `${xml}
<Response>
  <Say voice="man" language="en-us">
    Oops! Something went wrong. Here's the error: ${err}
  </Say>
  <Hangup/>
</Response>`;
    }

}


// for testing
// doWork('test');


// Start the server
let server = app.listen(app.get('port'), function () {
    console.log('App listening on port %s at %s', server.address().port, new Date());
    console.log('Press Ctrl+C to quit.');
});
