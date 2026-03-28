const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const dbConnect = require('./db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is required!");
const bot = new Telegraf(config.BOT_TOKEN);

// In-memory map to track users who are about to enter a coupon code
// Key: telegramId (string), Value: orderId (string)
const couponWaitingUsers = new Map();

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

// Inline Action: My Purchases
bot.action('action_mypurchases', async (ctx) => {
  await dbConnect();
  const orders = await Order.find({ telegramId: ctx.from.id.toString(), status: 'approved' }).populate('product');
  if (orders.length === 0) {
    return ctx.reply("You have no purchases yet. Browse our products to get started! 🛍️");
  }

  let text = "📦 *Your Purchases:*\n\n";
  orders.forEach((o, idx) => {
    text += `${idx + 1}. *${o.product.title}* — ₹${o.amount}\n   🔗 ${o.product.deliveryLink}\n\n`;
  });
  await ctx.replyWithMarkdown(text);
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
    let priceText = `₹${p.price}`;
    if (p.couponCode && p.couponDiscount > 0) {
      priceText += ` (🎟 Coupon available!)`;
    }
    text += `${idx + 1}. *${p.title}* - ${priceText}\n   _${p.description}_\n\n`;
    buttons.push([Markup.button.callback(`Buy ${p.title} (₹${p.price})`, `buy_${p._id}`)]);
  });

  ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

// Helper: Send payment instructions message
async function sendPaymentMessage(ctx, product, order) {
  const amount = order.amount;
  let couponLine = '';
  if (order.couponApplied) {
    couponLine = `\n🎟 Coupon Applied: \`${order.couponApplied}\` (${product.couponDiscount}% OFF)\n~~₹${order.originalAmount}~~ → `;
  }

  const msg = `🧾 *Order Summary*\nProduct: ${product.title}\n${couponLine}Amount: ₹${amount}\n\n` +
              `💳 *Payment Instructions*\n1. Pay ₹${amount} to UPI ID: \`${config.UPI_ID}\` or scan the QR code below.\n` + 
              `2. After successful payment, *send the screenshot of the payment to this bot*.\n` +
              `I will notify the admin for verification. Once approved, you will auto-receive the product!`;

  // Build buttons — show "Apply Coupon" only if product has a coupon and user hasn't applied one yet
  const actionButtons = [];
  if (product.couponCode && product.couponDiscount > 0 && !order.couponApplied) {
    actionButtons.push([Markup.button.callback('🎟 Apply Coupon Code', `applycoupon_${order._id}`)]);
  }

  if (config.UPI_QR_URL && config.UPI_QR_URL.startsWith('http')) {
    try {
      await ctx.replyWithPhoto(config.UPI_QR_URL, { 
        caption: msg, 
        parse_mode: 'Markdown',
        ...(actionButtons.length > 0 ? Markup.inlineKeyboard(actionButtons) : {})
      });
    } catch(err) {
      await ctx.replyWithMarkdown(
        msg + "\n\n_(Note: QR image link is invalid, so image could not load. Please pay using the UPI ID above)_",
        actionButtons.length > 0 ? Markup.inlineKeyboard(actionButtons) : {}
      );
    }
  } else {
    await ctx.replyWithMarkdown(msg, actionButtons.length > 0 ? Markup.inlineKeyboard(actionButtons) : {});
  }
}

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
    originalAmount: product.price,
    status: 'pending'
  });

  await sendPaymentMessage(ctx, product, order);
});

// Inline Action: Apply Coupon — ask user to type the code
bot.action(/applycoupon_(.+)/, async (ctx) => {
  const orderId = ctx.match[1];
  couponWaitingUsers.set(ctx.from.id.toString(), orderId);
  await ctx.reply("🎟 Please type your coupon code below:");
});

// Handle incoming Photos (Payment Screenshots)
bot.on('photo', async (ctx) => {
  // Clear any coupon waiting state
  couponWaitingUsers.delete(ctx.from.id.toString());

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
    let couponInfo = '';
    if (order.couponApplied) {
      couponInfo = `\n🎟 Coupon: ${order.couponApplied} (Original: ₹${order.originalAmount})`;
    }

    const adminMsg = `🚨 *NEW PAYMENT VERIFICATION*\n\n` +
                     `User: @${ctx.from.username || ctx.from.id}\n` +
                     `Product: ${order.product.title}\n` +
                     `Amount: ₹${order.amount}${couponInfo}\n` +
                     `Order ID: ${order._id}`;

    try {
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
    } catch (err) {
      console.error("Error notifying admin:", err);
    }
  }

  await ctx.reply("✅ Screenshot received! It has been sent to the admin for verification. You will receive your product here once approved (usually within 15 minutes).");
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
  await ctx.editMessageCaption(`✅ *Order Approved*\nProduct: ${order.product.title}\nAmount: ₹${order.amount}\nSent to User.`, { parse_mode: 'Markdown' });

  // Send product to user
  try {
    const successMsg = `🎉 *Payment Approved!*\n\nThank you for purchasing *${order.product.title}*.\n\n👇 *Here is your Access Link*:\n${order.product.deliveryLink}\n\nKeep growing!`;
    await bot.telegram.sendMessage(order.telegramId, successMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error("Error sending delivery link to user:", err);
    await ctx.reply(`⚠️ Could not deliver link to user ${order.telegramId}. Error: ${err.message}`);
  }
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
  await ctx.editMessageCaption(`❌ *Order Rejected*.`);

  try {
    await bot.telegram.sendMessage(order.telegramId, "❌ Your recent payment screenshot was rejected. If you think this is a mistake, please contact support.");
  } catch (err) {
    console.error("Error notifying user about rejection:", err);
  }
});

// Admin commands
bot.command('addproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  // format: /addproduct Title | Desc | Price | Type | Link | CouponCode | DiscountPercent
  const rawText = ctx.message.text.replace('/addproduct ', '');
  const args = rawText.split('|').map(s => s.trim());
  if (args.length < 5) {
    return ctx.reply("Usage: /addproduct Title | Description | Price | Type(course/data/apk) | DeliveryLink\n\nOptional coupon: /addproduct Title | Desc | Price | Type | Link | CouponCode | DiscountPercent\nExample: /addproduct My Course | Best course | 900 | course | https://link.com | SAVE20 | 20");
  }
  
  try {
    await dbConnect();
    const [title, description, price, type, deliveryLink, couponCode, couponDiscount] = args;
    const productData = { title, description, price: Number(price), type, deliveryLink };
    
    // Add coupon if provided
    if (couponCode && couponDiscount) {
      productData.couponCode = couponCode.toUpperCase();
      productData.couponDiscount = Number(couponDiscount);
    }

    await Product.create(productData);
    let successMsg = "✅ Product added successfully!";
    if (couponCode && couponDiscount) {
      successMsg += `\n🎟 Coupon: ${couponCode.toUpperCase()} → ${couponDiscount}% OFF`;
    }
    ctx.reply(successMsg);
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
  ctx.reply(
    "🛠 *Admin Commands*\n\n" +
    "`/addproduct Title | Desc | Price | Type | Link`\n" +
    "With coupon: `/addproduct Title | Desc | Price | Type | Link | Code | Discount%`\n\n" +
    "`/broadcast [message]`\n" +
    "`/setqr [Image URL]`",
    { parse_mode: 'Markdown' }
  );
});

// Handle text messages — coupon code input + fallback
bot.on('message', async (ctx, next) => {
  if (!ctx.message || !ctx.message.text) return next();
  if (ctx.message.text.startsWith('/')) return next();

  const userId = ctx.from.id.toString();
  const txt = ctx.message.text.trim();

  // Check if user is entering a coupon code
  if (couponWaitingUsers.has(userId)) {
    const orderId = couponWaitingUsers.get(userId);
    couponWaitingUsers.delete(userId);

    try {
      await dbConnect();
      const order = await Order.findById(orderId).populate('product');
      if (!order || order.status !== 'pending') {
        return ctx.reply("❌ Order not found or already processed. Please start a new purchase with /start");
      }

      const product = order.product;
      const enteredCode = txt.toUpperCase();

      // Validate coupon code
      if (!product.couponCode || product.couponCode.toUpperCase() !== enteredCode) {
        return ctx.reply("❌ Invalid coupon code! Please try again or send your payment screenshot to proceed without a coupon.");
      }

      // Apply discount
      const discount = product.couponDiscount;
      const discountedAmount = Math.round(product.price - (product.price * discount / 100));

      order.amount = discountedAmount;
      order.originalAmount = product.price;
      order.couponApplied = enteredCode;
      await order.save();

      await ctx.reply(`✅ Coupon *${enteredCode}* applied! You get *${discount}% OFF*\n\n~~₹${product.price}~~ → *₹${discountedAmount}*`, { parse_mode: 'Markdown' });

      // Re-send payment instructions with updated price
      await sendPaymentMessage(ctx, product, order);
      return;
    } catch (e) {
      console.error("Coupon error:", e);
      return ctx.reply("❌ Something went wrong. Please try again or /start over.");
    }
  }

  // Normal fallback messages
  const lower = txt.toLowerCase();
  if (lower === 'hi' || lower === 'hello' || lower === 'hey') {
    return ctx.reply("Hello ji! 👋 Humare digital store mein aapka swagat hai. \n\nProducts dekhne ke liye yahan click karein 👉 /start");
  } else {
    return ctx.reply("Main ek Automated Store Bot hoon 🤖. \n\nDirect menu dekhne ke liye kripya 👉 /start bhejein.");
  }
});

module.exports = bot;
