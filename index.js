require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// ===== MEMORY =====
const memory = {};
const todos = {};
const reminders = {};

// ===== HELPERS =====
const isTikTok = (t) => /tiktok\.com/.test(t);

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
  try {
    const chatId = msg.chat.id;
    const photo = msg.photo.pop(); // берем самую большую версию
    const filePath = await bot.downloadFile(photo.file_id, './');

    const ext = path.extname(filePath) || '.jpg';
    const newPath = `photo_${Date.now()}${ext}`;
    fs.renameSync(filePath, newPath);

    const res = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Опиши изображение' },
          { type: 'input_image', image_url: `file://${path.resolve(newPath)}` }
        ]
      }]
    });

    bot.sendMessage(chatId, res.output_text);
    fs.unlinkSync(newPath);
  } catch (err) {
    console.log(err);
  }
});

// ===== TEXT MESSAGES =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // --- TODO ---
 if (text.startsWith('Добавь задачу') || text.startsWith('добавь задачу')){
    const task = text.replace(/добавь задачу/i, '').trim();
    todos[chatId] = todos[chatId] || [];
    todos[chatId].push(task);
    return bot.sendMessage(chatId, '✅ Задача добавлена');
  }

  if (text === 'Мои задачи' || text === 'мои задачи') {
    return bot.sendMessage(chatId, todos[chatId]?.join('\n') || '📭 Пусто');
  }

  // --- REMINDER ---
  if (text.startsWith('Напомни') || text.startsWith('напомни')) {
    const [_, time, ...msgText] = text.split(' ');
    cron.schedule(time, () => {
      bot.sendMessage(chatId, `⏰ Напоминание: ${msgText.join(' ')}`);
    });
    return bot.sendMessage(chatId, '⏰ Напоминание установлено');
  }

  // --- TIKTOK ---
  if (isTikTok(text)) {
    return bot.sendMessage(chatId, 'Выбери действие..', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Видео / Фото 📹', callback_data: `video|${text}` },
            { text: 'Скачать звук 🎵', callback_data: `audio|${text}` }
          ]
        ]
      }
    });
  }

  // --- AI ---
  const reply = await askAI(chatId, text);
  bot.sendMessage(chatId, reply);
});

// ===== CALLBACK QUERY =====
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const [type, url] = query.data.split('|');

  try {
    const api = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const { data } = await axios.get(api);

    // --- Видео ---
    if (data.data.play) {
      const videoUrl = data.data.play;
      const videoPath = `tt_video_${Date.now()}.mp4`;

      const videoResp = await axios.get(videoUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(videoPath);
      videoResp.data.pipe(writer);

      await new Promise((res, rej) => {
        writer.on('finish', res);
        writer.on('error', rej);
      });

      await bot.sendVideo(chatId, videoPath);
      fs.unlinkSync(videoPath);
    }

    // --- Фото / миниатюры ---
    if (data.data.images && data.data.images.length > 0) {
      for (const [i, imgUrl] of data.data.images.entries()) {
        const ext = path.extname(imgUrl) || '.jpg';
        const imgPath = `tt_img_${Date.now()}_${i}${ext}`;

        const imgResp = await axios.get(imgUrl, { responseType: 'stream' });
        const imgWriter = fs.createWriteStream(imgPath);
        imgResp.data.pipe(imgWriter);

        await new Promise((res, rej) => {
          imgWriter.on('finish', res);
          imgWriter.on('error', rej);
        });

        await bot.sendPhoto(chatId, imgPath);
        fs.unlinkSync(imgPath);
      }
    }

    // --- Аудио ---
    if (type === 'audio' && data.data.music) {
      const audioUrl = data.data.music;
      const audioPath = `tt_audio_${Date.now()}.mp3`;

      const audioResp = await axios.get(audioUrl, { responseType: 'stream' });
      const audioWriter = fs.createWriteStream(audioPath);
      audioResp.data.pipe(audioWriter);

      await new Promise((res, rej) => {
        audioWriter.on('finish', res);
        audioWriter.on('error', rej);
      });

      await bot.sendAudio(chatId, audioPath);
      fs.unlinkSync(audioPath);
    }

    // Удаляем сообщение с кнопкой
    await bot.deleteMessage(chatId, messageId);
    bot.answerCallbackQuery(query.id);

  } catch (err) {
    bot.sendMessage(chatId, '❌ Ошибка при загрузке TikTok');
    console.log(err);
  }
});

console.log('🤖 Bot started');
