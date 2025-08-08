// scripts/fetch-comments.js

const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs').promises;
const path =require('path');

// Environment variables must be available in your build environment
const {
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY
} = process.env;

async function fetchComments() {
  try {
    console.log('Fetching comments from Google Sheet for Hugo...');

    // 1. Authenticate with Google Sheets
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });

    // 2. Load the sheet and get all rows
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    // 3. Filter for approved comments
    const approvedComments = rows
      .filter(row => row.approved === 'TRUE')
      .map(({ timestamp, name, comment, postSlug }) => ({
        timestamp,
        name,
        comment,
        postSlug,
      }));

    // 4. Group comments by their post slug
    const commentsBySlug = approvedComments.reduce((acc, comment) => {
      const { postSlug } = comment;
      if (!acc[postSlug]) {
        acc[postSlug] = [];
      }
      acc[postSlug].push(comment);
      acc[postSlug].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      return acc;
    }, {});

    // 5. Save the data to Hugo's data directory
    // This path goes from the script's location to the `data` folder.
    const dataDirPath = path.join(__dirname, '../data');
    await fs.mkdir(dataDirPath, { recursive: true });
    await fs.writeFile(
      path.join(dataDirPath, 'comments.json'),
      JSON.stringify(commentsBySlug, null, 2)
    );

    console.log(`Successfully fetched and saved ${approvedComments.length} comments.`);

  } catch (error) {
    console.error('Error fetching comments:', error);
    process.exit(1);
  }
}

fetchComments();
