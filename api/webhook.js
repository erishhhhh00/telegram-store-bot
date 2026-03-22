const bot = require('../src/bot');

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).json({ status: 'Bot is running', details: 'Webhook endpoint.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong!');
  }
};
