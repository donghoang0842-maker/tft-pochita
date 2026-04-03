require('dotenv').config();
const mongoose = require('mongoose');

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

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    const doc = await Data.findOne().lean();

    if (!doc) {
      console.log('Mongo chưa có document nào.');
      await mongoose.disconnect();
      return;
    }

    const players = Array.isArray(doc.players) ? doc.players : [];
    const queue = Array.isArray(doc.queue) ? doc.queue : [];
    const matches = Array.isArray(doc.matches) ? doc.matches : [];

    console.log('===== MONGO CHECK =====');
    console.log('Players:', players.length);
    console.log('Queue:', queue.length);
    console.log('Matches:', matches.length);
    console.log('Next Match ID:', doc.nextMatchId || 1);
    console.log('');

    if (players.length) {
      console.log('--- PLAYER LIST ---');
      players.forEach((p, i) => {
        console.log(
          `${i + 1}. ${p.name} | discordId=${p.discordId} | points=${p.points ?? 0} | matches=${p.matchesPlayed ?? 0}`
        );
      });
      console.log('');
    }

    if (queue.length) {
      console.log('--- QUEUE DISCORD IDS ---');
      queue.forEach((id, i) => {
        console.log(`${i + 1}. ${id}`);
      });
      console.log('');
    }

    if (matches.length) {
      console.log('--- MATCH LIST ---');
      matches.forEach((m, i) => {
        console.log(
          `${i + 1}. Match #${m.id} | status=${m.status} | players=${Array.isArray(m.players) ? m.players.length : 0}`
        );
      });
      console.log('');
    }

    console.log('--- RAW JSON ---');
    console.log(JSON.stringify(doc, null, 2));

    await mongoose.disconnect();
  } catch (error) {
    console.error('CHECK MONGO ERROR:', error.message);
    process.exit(1);
  }
})();