require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// 🧠 память: chatId -> история сообщений
const memory = {};

// сколько сообщений хранить
const MAX_HISTORY = 6;

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // команды не отправляем в ИИ
  if (text.startsWith('/')) {
    if (text === '/reset') {
      delete memory[chatId];
      return bot.sendMessage(chatId, 'Память очищена 🧹');
    }
    return;
  }

  // если нет истории — создаём
  if (!memory[chatId]) {
    memory[chatId] = [
      { role: 'system', content: 'Ты дружелюбный Telegram-бот помощник' }
    ];
  }

  // добавляем сообщение пользователя
  memory[chatId].push({ role: 'user', content: text });

  // обрезаем историю
  if (memory[chatId].length > MAX_HISTORY) {
    memory[chatId].splice(1, 1);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: memory[chatId]
    });

    const answer = response.choices[0].message.content;

    // сохраняем ответ ИИ
    memory[chatId].push({ role: 'assistant', content: answer });

    bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, 'Ошибка 😢');
  }
});


