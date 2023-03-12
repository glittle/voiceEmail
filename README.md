# Voice Email

Listen to emails by phone.

Can be used by multiple people to listen to emails in a single shared mailbox. Callers must be pre-registered in a Google Sheet.

# Development Requirements

* [Node.js](https://nodejs.org/en/)
* [Twilio](https://www.twilio.com/)
* [Google Cloud Account](https://cloud.google.com/)
* [Google Cloud SDK](https://cloud.google.com/sdk/)
* [Google Cloud Text-to-Speech API](https://cloud.google.com/text-to-speech/)

# Runtime Requirements

* A Google account
* A GMail mailbox account (turn off conversation view)
* A Google Sheet in the same account
* A Twilio account
* A Twilio phone number

Twilio must be configured to call this application using GET when a call is received.

## Google Sheet

The Google Sheet must have two sheets.

The first sheet will have 6 column. You can title them in row 1 something like this:

* Phone
* Full Name
* Short Name
* Name - phonetic
* Gmail Label Name
* Last Call

In this sheet, add a line for each person who will use this application. The phone number must be in the format: nnn-nnn-nnnn. The Gmail Label Name is the name of the label you want to use to mark emails as read. The Last Call column is used to keep track of the last time this person has called. You can leave this blank.

The second sheet must be named "Call Log" will have 5 columns. You can label them like this:

* Call Start
* Phone
* Name
* SID
* Steps
