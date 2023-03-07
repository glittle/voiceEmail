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


// Create an Express webapp.
let app = express();
app.set('port', 8008);
// app.set('port', (process.env.PORT || 8008));

app.post('/', async (req, res) => {
    try {
        console.log('|');
        console.log('|', callCount++);
        console.log('|');
        console.log(Object.keys(req));
        var params = req.body;
        console.log('POST', params);
        processIncoming(params, res);
    } catch (error) {
        return error;
    }
})

app.get('/', async (req, res) => {
    try {
        console.log('|');
        console.log('|', callCount++);
        console.log('|');
        var params = req.query;
        console.log('GET', params);
        processIncoming(params, res);
    } catch (error) {
        return error;
    }
});

async function processIncoming (params, res) {
    var final = await doWork(params);
    console.log('--> RESPONSE', final);
    res.type('text/xml');
    res.send(final);
}

var tempStorage = {};
var callCount = 0;

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

    const final = await main.respondToCall(query, gmail, sheetsApi, tempStorage);
    return final;
}


// for testing
// doWork('test');


// Start the server
let server = app.listen(app.get('port'), function () {
    console.log('|');
    console.log('App listening on port %s at %s', server.address().port, new Date().toLocaleString());
});
