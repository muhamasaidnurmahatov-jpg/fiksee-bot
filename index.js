require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const OpenAI = require('openai');

// Инициализация бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Инициализация OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

// Память: chatId -> история сообщений
const memory = {};
const MAX_HISTORY = 4; // ограничиваем историю для надежности

// Функция для безопасного вызова OpenAI
async function askOpenAI(chatId, userMessage) {
  if (!memory[chatId]) {
    memory[chatId] = [
      { role: 'system', content: 'Ты дружелюбный Telegram-бот помощник' }
    ];
  }

  // добавляем сообщение пользователя
  memory[chatId].push({ role: 'user', content: userMessage });

  // обрезаем историю
  if (memory[chatId].length > MAX_HISTORY + 1) { 
    memory[chatId].splice(1, memory[chatId].length - MAX_HISTORY - 1);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: memory[chatId]
    });

    const answer = response.choices[0].message.content;

    // сохраняем ответ ИИ
    memory[chatId].push({ role: 'assistant', content: answer });

    return answer;
  } catch (err) {
    console.error('OpenAI Error:', err);
    return 'Ошибка связи с ИИ 😢 Попробуй ещё раз.';
  }
}

// Обработка сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // команды
  if (text.startsWith('/')) {
    if (text === '/reset') {
      delete memory[chatId];
      return bot.sendMessage(chatId, 'Память очищена 🧹');
    }
    return;
  }

  // ответ через OpenAI
  const reply = await askOpenAI(chatId, text);
  bot.sendMessage(chatId, reply);
});
