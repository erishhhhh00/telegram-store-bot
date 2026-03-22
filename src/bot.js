const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const dbConnect = require('./db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is required!");
const bot = new Telegraf(config.BOT_TOKEN);

// Middleware to Ensure the user exists in DB
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    try {
      await dbConnect();
      let user = await User.findOne({ telegramId: ctx.from.id.toString() });
      if (!user) {
        user = await User.create({
          telegramId: ctx.from.id.toString(),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name
        });
      }
      ctx.dbUser = user;
    } catch (e) {
      console.error(e);
    }
  }
  return next();
});

// Start Command
bot.start((ctx) => {
  ctx.reply(
    `Welcome to our Pro Digital Store, ${ctx.from.first_name}! 🚀\nWhat are you looking for today?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛍️ Browse Products', 'action_products')],
      [Markup.button.callback('📦 My Purchases', 'action_mypurchases')]
    ])
  );
});

// Inline Action: Products
bot.action('action_products', async (ctx) => {
  await dbConnect();
  const products = await Product.find({ isActive: true });
  if (products.length === 0) {
    return ctx.reply("No products available right now. Check back later!");
  }

  let text = "🛒 *Available Products:*\n\n";
  const buttons = [];
  products.forEach((p, idx) => {
    text += `${idx + 1}. *${p.title}* - ₹${p.price}\n   _${p.description}_\n\n`;
    buttons.push([Markup.button.callback(`Buy ${p.title} (₹${p.price})`, `buy_${p._id}`)]);
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

// Inline Action: Buy Product
bot.action(/buy_(.+)/, async (ctx) => {
  const productId = ctx.match[1];
  await dbConnect();
  const product = await Product.findById(productId);
  if (!product) return ctx.reply("Product not found.");

  // Create a pending order
  const order = await Order.create({
    user: ctx.dbUser._id,
    telegramId: ctx.from.id.toString(),
    product: product._id,
    amount: product.price,
    status: 'pending'
  });

  const msg = `🧾 *Order Summary*\nProduct: ${product.title}\nAmount: ₹${product.price}\n\n` +
              `💳 *Payment Instructions*\n1. Pay ₹${product.price} to UPI ID: \`${config.UPI_ID}\` or scan the QR code below.\n` + 
              `2. After successful payment, *send the screenshot of the payment to this bot*.\n` +
              `I will notify the admin for verification. Once approved, you will auto-receive the product!`;

  if (config.UPI_QR_URL && config.UPI_QR_URL.startsWith('http')) {
    try {
      await ctx.replyWithPhoto(config.UPI_QR_URL, { caption: msg, parse_mode: 'Markdown' });
    } catch(err) {
      await ctx.replyWithMarkdown(msg + "\n\n_(Note: QR image link is invalid, so image could not load. Please pay using the UPI ID above)_");
    }
  } else {
    await ctx.replyWithMarkdown(msg);
  }
});

// Handle incoming Photos (Payment Screenshots)
bot.on('photo', async (ctx) => {
  await dbConnect();
  // Find user's latest pending order
  const order = await Order.findOne({ telegramId: ctx.from.id.toString(), status: 'pending' }).sort({ createdAt: -1 }).populate('product');
  
  if (!order) {
    return ctx.reply("You have no pending orders. Type /start to browse products.");
  }

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  order.screenshotId = fileId;
  await order.save();

  // Notify Admin
  if (config.ADMIN_USER_ID) {
    const adminMsg = `🚨 *NEW PAYMENT VERIFICATION*\n\n` +
                     `User: @${ctx.from.username || ctx.from.id}\n` +
                     `Product: ${order.product.title}\n` +
                     `Amount: ₹${order.amount}\n` +
                     `Order ID: ${order._id}`;

    await ctx.telegram.sendPhoto(config.ADMIN_USER_ID, fileId, {
      caption: adminMsg,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approve', `approve_${order._id}`),
          Markup.button.callback('❌ Reject', `reject_${order._id}`)
        ]
      ])
    });
  }

  ctx.reply("✅ Screenshot received! It has been sent to the admin for verification. You will receive your product here once approved (usually within 15 minutes).");
});

// Admin Approval Actions (Only Admin can trigger this)
bot.action(/approve_(.+)/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
    return ctx.answerCbQuery('Not Authorized');
  }
  const orderId = ctx.match[1];
  await dbConnect();
  const order = await Order.findById(orderId).populate('product');
  if (!order || order.status !== 'pending') {
    return ctx.editMessageCaption('Order already processed or not found.');
  }

  order.status = 'approved';
  await order.save();
  ctx.editMessageCaption(`✅ *Order Approved*\nProduct: ${order.product.title}\nSent to User.`, { parse_mode: 'Markdown' });

  // Send product to user
  const successMsg = `🎉 *Payment Approved!*\n\nThank you for purchasing *${order.product.title}*.\n\n👇 *Here is your Access Link*:\n${order.product.deliveryLink}\n\nKeep growing!`;
  bot.telegram.sendMessage(order.telegramId, successMsg, { parse_mode: 'Markdown' });
});

bot.action(/reject_(.+)/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
    return ctx.answerCbQuery('Not Authorized');
  }
  const orderId = ctx.match[1];
  await dbConnect();
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'pending') {
    return ctx.editMessageCaption('Order already processed or not found.');
  }

  order.status = 'rejected';
  await order.save();
  ctx.editMessageCaption(`❌ *Order Rejected*.`);

  bot.telegram.sendMessage(order.telegramId, "❌ Your recent payment screenshot was rejected. If you think this is a mistake, please contact support.");
});

// Admin commands
bot.command('addproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  // format: /addproduct Title | Desc | Price | Type | Link
  const args = ctx.message.text.replace('/addproduct ', '').split('|').map(s => s.trim());
  if (args.length < 5) {
    return ctx.reply("Usage: /addproduct Title | Description | Price | Type(course/data/apk) | DeliveryLink");
  }
  
  try {
    await dbConnect();
    const [title, description, price, type, deliveryLink] = args;
    await Product.create({ title, description, price: Number(price), type, deliveryLink });
    ctx.reply("✅ Product added successfully!");
  } catch (e) {
    ctx.reply("❌ Error adding product: " + e.message);
  }
});

bot.command('broadcast', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const msgText = ctx.message.text.replace('/broadcast ', '').trim();
  if (!msgText || msgText.startsWith('/broadcast')) {
    return ctx.reply("Usage: /broadcast [your message]");
  }
  
  await dbConnect();
  const users = await User.find({});
  let sent = 0;
  for (let u of users) {
    try {
      await bot.telegram.sendMessage(u.telegramId, `📢 *Announcement:*\n\n${msgText}`, { parse_mode: 'Markdown' });
      sent++;
    } catch(e) { /* Ignore users who blocked the bot */ }
  }
  ctx.reply(`✅ Broadcast sent to ${sent} users.`);
});

bot.command('setqr', (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const newQr = ctx.message.text.replace('/setqr ', '').trim();
  if (!newQr || !newQr.startsWith('http')) {
    return ctx.reply("Usage: /setqr [Image URL]");
  }
  config.UPI_QR_URL = newQr;
  ctx.reply("✅ QR Code URL updated in memory. (Note: To persist forever, update Vercel Environment Variables)");
});

bot.command('helpadmin', (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  ctx.reply("🛠 *Admin Commands*\n/addproduct Title | Desc | Price | Type | Link\n/broadcast [message]\n/setqr [Image URL]");
});

// Fallback for normal messages like "hi" or "hello"
bot.on('message', async (ctx, next) => {
  if (ctx.message && ctx.message.text && !ctx.message.text.startsWith('/')) {
    const txt = ctx.message.text.toLowerCase();
    if (txt === 'hi' || txt === 'hello' || txt === 'hey') {
      return ctx.reply("Hello ji! 👋 Humare digital store mein aapka swagat hai. \n\nProducts dekhne ke liye yahan click karein 👉 /start");
    } else {
      return ctx.reply("Main ek Automated Store Bot hoon 🤖. \n\nDirect menu dekhne ke liye kripya 👉 /start bhejein.");
    }
  }
  return next();
});

module.exports = bot;
