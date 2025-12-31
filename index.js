require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// ===== MEMORY =====
const memory = {};
const todos = {};
const reminders = {};

// ===== HELPERS =====
const isTikTok = (t) => t.includes('tiktok.com');

// ===== WEATHER =====
// async function getWeather(city) {
//   const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&lang=ru&appid=${process.env.WEATHER_KEY}`;
//   const { data } = await axios.get(url);
//   return `🌤 ${data.name}: ${data.main.temp}°C, ${data.weather[0].description}`;
// }

// ===== AI CHAT =====
async function askAI(chatId, text) {
  if (!memory[chatId]) {
    memory[chatId] = [{ role: 'system', content: 'Ты полезный Telegram-бот помощник' }];
  }

  memory[chatId].push({ role: 'user', content: text });
  if (memory[chatId].length > 6) memory[chatId].splice(1, 1);

  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: memory[chatId]
  });

  const answer = res.choices[0].message.content;
  memory[chatId].push({ role: 'assistant', content: answer });
  return answer;
}

// ===== VOICE =====
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;
  const filePath = await bot.downloadFile(fileId, './');

  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'gpt-4o-transcribe'
  });

  const answer = await askAI(chatId, transcript.text);

  const speech = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: answer
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  fs.writeFileSync('reply.ogg', buffer);

  bot.sendVoice(chatId, 'reply.ogg');
});

// ===== PHOTO =====
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const photo = msg.photo.pop();
  const filePath = await bot.downloadFile(photo.file_id, './');

  const res = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Опиши изображение' },
        { type: 'input_image', image_url: `file://${filePath}` }
      ]
    }]
  });

  bot.sendMessage(chatId, res.output_text);
});

// ===== TEXT =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // // --- WEATHER ---
  // if (text.startsWith('погода')) {
  //   const city = text.split(' ').slice(1).join(' ');
  //   return bot.sendMessage(chatId, await getWeather(city));
  // }

  // --- TODO ---
  if (text.startsWith('Добавь задачу') || text.startsWith('добавь задачу')) {
    const task = text.replace('Добавь задачу', '').replace('добавь задачу', '').trim();
    todos[chatId] = todos[chatId] || [];
    todos[chatId].push(task);
    return bot.sendMessage(chatId, '✅ Задача добавлена');
  }

  if (text === 'Мои задачи' || text === 'мои задачи') {
    return bot.sendMessage(chatId, todos[chatId]?.join('\n') || '📭 Пусто');
  }

  // --- REMINDER ---
  if (text.startsWith('Напомни')) {
    const [_, time, ...msgText] = text.split(' ');
    cron.schedule(time, () => {
      bot.sendMessage(chatId, `⏰ Напоминание: ${msgText.join(' ')}`);
    });
    return bot.sendMessage(chatId, '⏰ Напоминание установлено');
  }

  // --- TIKTOK ---
if (isTikTok(text)) {
  const chatId = msg.chat.id;

  // Создаем inline кнопки
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Видео/Фото 📷", callback_data: `video|${text}` },
          { text: "Скачать звук 🎵", callback_data: `audio|${text}` }
        ]
      ]
    }
  };

  // Отправляем сообщение с кнопками
  return bot.sendMessage(chatId, "Выбери действие..", opts);
}

// Обработка нажатий на кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const [action, url] = query.data.split('|');

  const api = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const { data } = await axios.get(api);

  if (action === 'video') {
    bot.sendVideo(chatId, data.data.play);
  } else if (action === 'audio') {
    bot.sendAudio(chatId, data.data.audio[0]?.play || data.data.audio); // зависит от структуры API
  }

  // Убираем "часики" Telegram
  bot.answerCallbackQuery(query.id);
});


  // --- AI ---
  const reply = await askAI(chatId, text);
  bot.sendMessage(chatId, reply);
});

console.log('🤖 Bot started');

