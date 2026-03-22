const bot = require('./bot');

bot.launch().then(() => {
    console.log("Bot is running in polling mode for local dev...");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
