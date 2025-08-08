// netlify/functions/submission-created.js

// Using the google-spreadsheet library to make API calls easier
const { GoogleSpreadsheet } = require('google-spreadsheet');

// Environment variables stored in Netlify
const {
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY
} = process.env;

// The function is triggered on a "submission-created" event
exports.handler = async (event) => {
  try {
    // 1. Parse the incoming form submission data from the event body
    const { payload } = JSON.parse(event.body);
    const commentData = payload.data;

    // 2. Authenticate with Google Sheets
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // The private key must be formatted correctly with newlines
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });

    // 3. Load the sheet and add a new row
    await doc.loadInfo(); // loads document properties and worksheets
    const sheet = doc.sheetsByIndex[0]; // Or use doc.sheetsByTitle['YourSheetName']

    // 4. Append the new comment data
    // The headers in your Google Sheet must match these keys
    await sheet.addRow({
      timestamp: new Date().toISOString(),
      name: commentData.name,
      comment: commentData.comment,
      postSlug: commentData['post-slug'], // Corresponds to the hidden input
      approved: 'FALSE', // Default to not approved for moderation
    });

    // 5. Return a success response
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Comment submitted successfully!' }),
    };

  } catch (error) {
    console.error('Error adding row to Google Sheet:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to submit comment.' }),
    };
  }
};
