require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const dataSchema = new mongoose.Schema(
  {
    players: { type: Array, default: [] },
    queue: { type: Array, default: [] },
    matches: { type: Array, default: [] },
    nextMatchId: { type: Number, default: 1 },
  },
  {
    collection: 'datas',
    versionKey: false,
    strict: false,
  }
);

const Data = mongoose.models.Data || mongoose.model('Data', dataSchema);

function defaultData() {
  return {
    players: [],
    queue: [],
    matches: [],
    nextMatchId: 1,
  };
}

function loadFileData() {
  if (!fs.existsSync(DATA_FILE)) {
    return defaultData();
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      matches: Array.isArray(parsed.matches) ? parsed.matches : [],
      nextMatchId: Number.isInteger(parsed.nextMatchId) ? parsed.nextMatchId : 1,
    };
  } catch {
    return defaultData();
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const fileData = loadFileData();

  await Data.findOneAndUpdate(
    {},
    {
      $set: fileData,
    },
    {
      upsert: true,
    }
  );

  console.log('Restore to Mongo done');
  await mongoose.disconnect();
})();