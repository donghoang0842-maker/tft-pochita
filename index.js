require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');
const { startWeb } = require('./web');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

function defaultData() {
  return {
    players: [],
    queue: [],
    matches: [],
    nextMatchId: 1,
  };
}

function normalizeData(raw) {
  return {
    players: Array.isArray(raw?.players) ? raw.players : [],
    queue: Array.isArray(raw?.queue) ? raw.queue : [],
    matches: Array.isArray(raw?.matches) ? raw.matches : [],
    nextMatchId: Number.isInteger(raw?.nextMatchId) ? raw.nextMatchId : 1,
  };
}

function loadFileData() {
  if (!fs.existsSync(DATA_FILE)) {
    return defaultData();
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalizeData(JSON.parse(raw));
  } catch {
    return defaultData();
  }
}

function saveFileData(snapshot) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeData(snapshot), null, 2), 'utf8');
}

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

let data = defaultData();
let mongoReady = false;

async function initMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong file .env / Render Environment');
  }

  if (mongoose.connection.readyState === 1) {
    mongoReady = true;
    console.log('MongoDB connected');
    return;
  }
  console.log('MONGO_URI prefix:', String(process.env.MONGO_URI || '').slice(0, 20));
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  mongoReady = true;
  console.log('MongoDB connected');
}

async function loadData() {
  const fileData = loadFileData();
  data = fileData;

  if (!mongoReady) {
    saveFileData(data);
    return;
  }

  const db = await Data.findOne().lean();

  if (!db) {
    await Data.create(fileData);
    data = fileData;
    saveFileData(data);
    console.log('Created new DB from local backup');
    return;
  }

  const mongoData = normalizeData(db);

  const mongoEmpty =
    mongoData.players.length === 0 &&
    mongoData.queue.length === 0 &&
    mongoData.matches.length === 0 &&
    mongoData.nextMatchId === 1;

  const fileHasData =
    fileData.players.length > 0 ||
    fileData.queue.length > 0 ||
    fileData.matches.length > 0 ||
    fileData.nextMatchId !== 1;

  if (mongoEmpty && fileHasData) {
    data = fileData;
    await Data.findOneAndUpdate(
      {},
      { $set: data },
      { upsert: true }
    );
    saveFileData(data);
    console.log('Restored MongoDB from data.json backup');
    return;
  }

  data = mongoData;
  saveFileData(data);
  console.log('Loaded DB from MongoDB');
}

async function saveData() {
  data = normalizeData(data);
  saveFileData(data);

  if (!mongoReady) return;

  await Data.findOneAndUpdate(
    {},
    { $set: data },
    { upsert: true }
  );
}

function getPlayerByDiscordId(discordId) {
  return data.players.find((p) => p.discordId === discordId);
}

function getPlayerByName(name) {
  return data.players.find(
    (p) => String(p.name).toLowerCase() === String(name).toLowerCase()
  );
}

function getOpenMatch() {
  return data.matches.find((m) => m.status === 'OPEN') || null;
}

function createPlacementCounter() {
  return {
    top1: 0,
    top2: 0,
    top3: 0,
    top4: 0,
    top5: 0,
    top6: 0,
    top7: 0,
    top8: 0,
  };
}

function countPlacements(playerName) {
  const result = createPlacementCounter();

  for (const match of data.matches) {
    if (match.status !== 'COMPLETED') continue;

    const player = (match.players || []).find(
      (p) => String(p.name).toLowerCase() === String(playerName).toLowerCase()
    );

    if (!player || !Number.isInteger(player.placement)) continue;

    const key = `top${player.placement}`;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] += 1;
    }
  }

  return result;
}

function getRankedPlayers() {
  return data.players
    .map((player) => {
      const placements = countPlacements(player.name);
      return {
        ...player,
        ...placements,
        points: Number(player.points || 0),
        matchesPlayed: Number(player.matchesPlayed || 0),
        wins: Number(player.wins || 0),
        top4Count: Number(player.top4Count || 0),
      };
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.top1 !== a.top1) return b.top1 - a.top1;
      if (b.top2 !== a.top2) return b.top2 - a.top2;
      if (b.top3 !== a.top3) return b.top3 - a.top3;
      if (b.top4 !== a.top4) return b.top4 - a.top4;
      if (b.top5 !== a.top5) return b.top5 - a.top5;
      if (b.top6 !== a.top6) return b.top6 - a.top6;
      if (b.top7 !== a.top7) return b.top7 - a.top7;
      if (b.top8 !== a.top8) return b.top8 - a.top8;
      if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
      return String(a.name).localeCompare(String(b.name), 'vi');
    });
}

function getQueuePlayers() {
  return data.queue
    .map((discordId) => getPlayerByDiscordId(discordId))
    .filter(Boolean);
}

async function createMatchIfEnoughPlayers() {
  if (data.queue.length < 8) return null;

  const existingOpenMatch = getOpenMatch();
  if (existingOpenMatch) return existingOpenMatch;

  const selectedIds = data.queue.slice(0, 8);
  data.queue = data.queue.slice(8);

  const players = selectedIds
    .map((discordId) => getPlayerByDiscordId(discordId))
    .filter(Boolean)
    .map((player) => ({
      discordId: player.discordId,
      name: player.name,
      placement: null,
      pointsChange: 0,
    }));

  const match = {
    id: data.nextMatchId++,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    reportedAt: null,
    resultImageUrl: null,
    ocrText: null,
    players,
  };

  data.matches.push(match);
  await saveData();
  return match;
}

function formatMatch(match) {
  const lines = [
    `Match #${match.id}`,
    `Status: ${match.status}`,
    '',
    'Players:',
  ];

  const players = [...(match.players || [])];
  const allPlaced = players.every((p) => Number.isInteger(p.placement));

  if (!allPlaced) {
    players.forEach((player, index) => {
      lines.push(`${index + 1}. ${player.name}`);
    });
  } else {
    players
      .sort((a, b) => a.placement - b.placement)
      .forEach((player) => {
        const sign = player.pointsChange > 0 ? '+' : '';
        lines.push(`${player.placement}. ${player.name} (${sign}${player.pointsChange})`);
      });
  }

  return lines.join('\n');
}

const POINTS_BY_PLACEMENT = {
  1: 8,
  2: 6,
  3: 4,
  4: 2,
  5: -2,
  6: -4,
  7: -6,
  8: -8,
};

async function applyResults(matchId, placements) {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match) {
    return { ok: false, message: 'Không tìm thấy match.' };
  }

  if (match.status !== 'OPEN') {
    return { ok: false, message: 'Match này đã được chấm rồi.' };
  }

  if (!Array.isArray(placements) || placements.length !== 8) {
    return { ok: false, message: 'Kết quả phải đủ từ Top 1 đến Top 8.' };
  }

  const normalized = placements.map((name) => String(name).trim().toLowerCase());
  if (normalized.some((x) => !x)) {
    return { ok: false, message: 'Tên người chơi không được để trống.' };
  }

  if (new Set(normalized).size !== 8) {
    return { ok: false, message: 'Tên trong kết quả đang bị trùng.' };
  }

  const matchNames = (match.players || []).map((p) => String(p.name).toLowerCase());
  for (const name of normalized) {
    if (!matchNames.includes(name)) {
      return { ok: false, message: `Tên "${name}" không nằm trong match #${matchId}.` };
    }
  }

  for (let i = 0; i < placements.length; i++) {
    const placement = i + 1;
    const playerName = placements[i].trim();
    const delta = POINTS_BY_PLACEMENT[placement];

    const matchPlayer = (match.players || []).find(
      (p) => String(p.name).toLowerCase() === playerName.toLowerCase()
    );
    const player = getPlayerByName(playerName);

    if (!matchPlayer || !player) {
      return { ok: false, message: `Không tìm thấy người chơi: ${playerName}` };
    }

    matchPlayer.placement = placement;
    matchPlayer.pointsChange = delta;

    player.points = Number(player.points || 0) + delta;
    player.matchesPlayed = Number(player.matchesPlayed || 0) + 1;
    player.wins = Number(player.wins || 0) + (placement === 1 ? 1 : 0);
    player.top4Count = Number(player.top4Count || 0) + (placement <= 4 ? 1 : 0);
  }

  match.status = 'COMPLETED';
  match.reportedAt = new Date().toISOString();
  await saveData();

  return { ok: true, message: `Đã chấm điểm cho match #${matchId}.` };
}

async function extractTextFromImageUrl(imageUrl) {
  const apiKey = process.env.OCR_KEY || process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu OCR_KEY trong file .env / Render Environment');
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const formData = new FormData();
  formData.append('apikey', apiKey);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('file', Buffer.from(imageResponse.data), {
    filename: 'result.png',
    contentType: 'image/png',
  });

  const response = await axios.post('https://api.ocr.space/parse/image', formData, {
    headers: formData.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 60000,
  });

  return response.data?.ParsedResults?.[0]?.ParsedText || '';
}

function detectPlacementsFromOcrText(match, ocrText) {
  const normalized = String(ocrText || '').toLowerCase();

  const found = [];
  for (const player of match.players || []) {
    const idx = normalized.indexOf(String(player.name).toLowerCase());
    if (idx !== -1) {
      found.push({
        name: player.name,
        index: idx,
      });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const uniqueNames = [];
  const seen = new Set();

  for (const item of found) {
    const key = item.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueNames.push(item.name);
    }
  }

  if (uniqueNames.length !== 8) {
    return {
      ok: false,
      message: `OCR chỉ nhận ra ${uniqueNames.length}/8 tên.`,
      detectedNames: uniqueNames,
    };
  }

  return {
    ok: true,
    placements: uniqueNames,
  };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', async () => {
  console.log('BOT ONLINE');

  const commands = [
    {
      name: 'register',
      description: 'Register player',
      options: [
        {
          name: 'name',
          description: 'Ingame name',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'join',
      description: 'Join queue',
    },
    {
      name: 'leave',
      description: 'Leave queue',
    },
    {
      name: 'queue',
      description: 'Show current queue',
    },
    {
      name: 'current_match',
      description: 'Show current open match',
    },
    {
      name: 'leaderboard',
      description: 'Show leaderboard',
    },
    {
      name: 'match_history',
      description: 'Show completed matches',
      options: [
        {
          name: 'limit',
          description: 'How many matches',
          type: 4,
          required: false,
        },
      ],
    },
    {
      name: 'report_result',
      description: 'Upload result image and auto-score with OCR',
      options: [
        {
          name: 'match_id',
          description: 'Match ID',
          type: 4,
          required: true,
        },
        {
          name: 'image',
          description: 'Result image',
          type: 11,
          required: true,
        },
      ],
    },
    {
      name: 'manual_result',
      description: 'Manual fallback result entry',
      options: [
        { name: 'match_id', description: 'Match ID', type: 4, required: true },
        { name: 'top1', description: 'Top 1', type: 3, required: true },
        { name: 'top2', description: 'Top 2', type: 3, required: true },
        { name: 'top3', description: 'Top 3', type: 3, required: true },
        { name: 'top4', description: 'Top 4', type: 3, required: true },
        { name: 'top5', description: 'Top 5', type: 3, required: true },
        { name: 'top6', description: 'Top 6', type: 3, required: true },
        { name: 'top7', description: 'Top 7', type: 3, required: true },
        { name: 'top8', description: 'Top 8', type: 3, required: true },
      ],
    },
  ];

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered');
  } catch (error) {
    console.error('Register commands failed:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'register') {
      const name = interaction.options.getString('name', true).trim();

      if (getPlayerByDiscordId(interaction.user.id)) {
        await interaction.reply({ content: 'Bạn đã đăng ký rồi.', ephemeral: true });
        return;
      }

      if (getPlayerByName(name)) {
        await interaction.reply({ content: 'Tên này đã được dùng.', ephemeral: true });
        return;
      }

      data.players.push({
        discordId: interaction.user.id,
        name,
        points: 100,
        matchesPlayed: 0,
        wins: 0,
        top4Count: 0,
      });

      await saveData();
      await interaction.reply(`Đăng ký thành công: **${name}** | Điểm khởi đầu: **100**`);
      return;
    }

    if (interaction.commandName === 'join') {
      const player = getPlayerByDiscordId(interaction.user.id);

      if (!player) {
        await interaction.reply({
          content: 'Bạn chưa đăng ký. Dùng `/register` trước.',
          ephemeral: true,
        });
        return;
      }

      if (data.queue.includes(interaction.user.id)) {
        await interaction.reply({
          content: 'Bạn đã ở trong queue rồi.',
          ephemeral: true,
        });
        return;
      }

      const inOpenMatch = data.matches.some(
        (m) =>
          m.status === 'OPEN' &&
          (m.players || []).some((p) => p.discordId === interaction.user.id)
      );

      if (inOpenMatch) {
        await interaction.reply({
          content: 'Bạn đang nằm trong một match chưa chấm.',
          ephemeral: true,
        });
        return;
      }

      data.queue.push(interaction.user.id);
      await saveData();

      const match = await createMatchIfEnoughPlayers();

      if (match && (match.players || []).some((p) => p.discordId === interaction.user.id)) {
        await interaction.reply(
          `**${player.name}** đã vào queue.\nĐủ 8 người, đã tạo **match #${match.id}**.\nDùng \`/current_match\` để xem danh sách.`
        );
        return;
      }

      await interaction.reply(
        `**${player.name}** đã vào queue. Hiện có **${data.queue.length}** người trong queue.`
      );
      return;
    }

    if (interaction.commandName === 'leave') {
      const index = data.queue.indexOf(interaction.user.id);

      if (index === -1) {
        await interaction.reply({
          content: 'Bạn không ở trong queue.',
          ephemeral: true,
        });
        return;
      }

      data.queue.splice(index, 1);
      await saveData();

      await interaction.reply('Bạn đã rời queue.');
      return;
    }

    if (interaction.commandName === 'queue') {
      const players = getQueuePlayers();

      if (!players.length) {
        await interaction.reply('Queue đang trống.');
        return;
      }

      const lines = players.map((player, index) => `${index + 1}. ${player.name}`);
      await interaction.reply(
        `Hiện có **${players.length}** người trong queue:\n${lines.join('\n')}`
      );
      return;
    }

    if (interaction.commandName === 'current_match') {
      const openMatch = getOpenMatch();

      if (!openMatch) {
        await interaction.reply('Hiện không có match nào đang mở.');
        return;
      }

      await interaction.reply(`\`\`\`\n${formatMatch(openMatch)}\n\`\`\``);
      return;
    }

    if (interaction.commandName === 'leaderboard') {
      const ranked = getRankedPlayers();

      if (!ranked.length) {
        await interaction.reply('Chưa có người chơi nào.');
        return;
      }

      const lines = ranked.slice(0, 20).map((player, index) => {
        return `${index + 1}. ${player.name} | ${player.points} điểm | ${player.matchesPlayed} trận | Top1: ${player.top1} | Top4: ${player.top4}`;
      });

      await interaction.reply(`**Leaderboard**\n${lines.join('\n')}`);
      return;
    }

    if (interaction.commandName === 'match_history') {
      const limitRaw = interaction.options.getInteger('limit');
      const limit = Math.max(1, Math.min(20, limitRaw || 5));

      const completed = [...data.matches]
        .filter((m) => m.status === 'COMPLETED')
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);

      if (!completed.length) {
        await interaction.reply('Chưa có match nào hoàn thành.');
        return;
      }

      const blocks = completed.map((match) => {
        const sorted = [...(match.players || [])].sort((a, b) => a.placement - b.placement);
        const lines = sorted.map((p) => {
          const sign = p.pointsChange > 0 ? '+' : '';
          return `${p.placement}. ${p.name} (${sign}${p.pointsChange})`;
        });

        const imageLine = match.resultImageUrl ? `Image: ${match.resultImageUrl}` : 'Image: none';
        return `Match #${match.id}\n${lines.join('\n')}\n${imageLine}`;
      });

      await interaction.reply(`\`\`\`\n${blocks.join('\n\n')}\n\`\`\``);
      return;
    }

    if (interaction.commandName === 'report_result') {
      const matchId = interaction.options.getInteger('match_id', true);
      const image = interaction.options.getAttachment('image', true);

      const match = data.matches.find((m) => m.id === matchId);
      if (!match) {
        await interaction.reply({ content: 'Không tìm thấy match.', ephemeral: true });
        return;
      }

      if (match.status !== 'OPEN') {
        await interaction.reply({ content: 'Match này đã được chấm rồi.', ephemeral: true });
        return;
      }

      match.resultImageUrl = image.url;
      await saveData();

      await interaction.deferReply();

      let ocrText = '';
      try {
        ocrText = await extractTextFromImageUrl(image.url);
        match.ocrText = ocrText;
        await saveData();
      } catch (error) {
        await interaction.editReply(
          `Đã lưu ảnh cho **match #${matchId}** nhưng OCR lỗi.\nLỗi: ${error.message}`
        );
        return;
      }

      const detected = detectPlacementsFromOcrText(match, ocrText);

      if (!detected.ok) {
        await interaction.editReply(
          `Đã lưu ảnh cho **match #${matchId}**.\nBot chưa tự chấm được.\n${detected.message}\nBot đọc được: ${detected.detectedNames.join(', ') || 'không đọc được tên nào'}`
        );
        return;
      }

      const result = await applyResults(matchId, detected.placements);

      if (!result.ok) {
        await interaction.editReply(
          `Bot đọc được ảnh nhưng chấm không thành công.\nLý do: ${result.message}\nBot đọc thứ tự: ${detected.placements.join(', ')}`
        );
        return;
      }

      const updatedMatch = data.matches.find((m) => m.id === matchId);
      await interaction.editReply(
        `Bot đã tự chấm điểm cho **match #${matchId}**.\n\`\`\`\n${formatMatch(updatedMatch)}\n\`\`\``
      );
      return;
    }

    if (interaction.commandName === 'manual_result') {
      const matchId = interaction.options.getInteger('match_id', true);
      const placements = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        interaction.options.getString(`top${n}`, true).trim()
      );

      const result = await applyResults(matchId, placements);

      if (!result.ok) {
        await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }

      const match = data.matches.find((m) => m.id === matchId);
      await interaction.reply(`${result.message}\n\`\`\`\n${formatMatch(match)}\n\`\`\``);
      return;
    }
  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Có lỗi xảy ra.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Có lỗi xảy ra.', ephemeral: true });
    }
  }
});

(async () => {
  try {
    await initMongo();
  } catch (error) {
    console.error('MongoDB connect failed:', error.message);
    process.exit(1);
  }

  await loadData();
  await startWeb();
  client.login(process.env.DISCORD_TOKEN);
})();