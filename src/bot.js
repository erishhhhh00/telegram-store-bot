const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const dbConnect = require('./db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is required!");
const bot = new Telegraf(config.BOT_TOKEN);

// ─── In-memory state maps ───
const couponWaitingUsers = new Map();   // userId → orderId
const refundWaitingUsers = new Map();   // userId → orderId
const searchWaitingUsers = new Set();   // userId set

// ─── MIDDLEWARE: ensure user exists in DB ───
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
        // Notify admin about new user
        if (config.ADMIN_USER_ID) {
          try {
            await bot.telegram.sendMessage(config.ADMIN_USER_ID,
              `🆕 *New User Joined!*\n👤 ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}\n🔗 @${ctx.from.username || 'no-username'}\n🆔 \`${ctx.from.id}\``,
              { parse_mode: 'Markdown' }
            );
          } catch(e) {}
        }
      }
      ctx.dbUser = user;
    } catch (e) {
      console.error(e);
    }
  }
  return next();
});

// ═══════════════════════════════════════════
// ║         USER COMMANDS & ACTIONS         ║
// ═══════════════════════════════════════════

// ─── /start ───
bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 *Welcome to EeTech4u Store!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Hey *${ctx.from.first_name}*! 👋\n` +
    `India's best digital products store.\n` +
    `Courses, APKs, Data files — sab kuch yahan milega!\n\n` +
    `👇 *Choose an option below:*`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛍️ Browse Products', 'action_products')],
      [Markup.button.callback('📂 Browse by Category', 'action_categories')],
      [Markup.button.callback('🔍 Search Products', 'action_search')],
      [Markup.button.callback('📦 My Orders', 'action_myorders')],
      [Markup.button.callback('📞 Help & Support', 'action_help')]
    ])
  );
});

// ─── Browse Products (Premium Cards) ───
bot.action('action_products', async (ctx) => {
  await dbConnect();
  const products = await Product.find({ isActive: true });
  if (products.length === 0) {
    return ctx.reply("😔 No products available right now. Check back later!");
  }

  await ctx.reply("🛒 *Available Products:*\n━━━━━━━━━━━━━━━━━━━━━", { parse_mode: 'Markdown' });

  for (const p of products) {
    let couponTag = '';
    if (p.couponCode && p.couponDiscount > 0) {
      couponTag = `\n🎟️ *Coupon Available!* — Save ${p.couponDiscount}%`;
    }

    const typeEmoji = p.type === 'course' ? '📚' : p.type === 'apk' ? '📱' : '💾';
    const timeAgo = getTimeAgo(p.createdAt);

    const caption =
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `${typeEmoji} *${p.title}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 _${p.description}_\n\n` +
      `💰 *Price:* ₹${p.price}\n` +
      `📂 *Category:* ${p.category}\n` +
      `⏰ *Added:* ${timeAgo}` +
      couponTag;

    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback(`🛒 Buy Now — ₹${p.price}`, `buy_${p._id}`)]
    ]);

    if (p.imageUrl && p.imageUrl.startsWith('http')) {
      try {
        await ctx.replyWithPhoto(p.imageUrl, { caption, parse_mode: 'Markdown', ...buttons });
        continue;
      } catch(e) {}
    }
    await ctx.replyWithMarkdown(caption, buttons);
  }
});

// ─── Browse by Category ───
bot.action('action_categories', async (ctx) => {
  await dbConnect();
  const products = await Product.find({ isActive: true });
  const categories = [...new Set(products.map(p => p.category))];

  if (categories.length === 0) {
    return ctx.reply("😔 No categories available yet.");
  }

  const buttons = categories.map(cat => {
    const count = products.filter(p => p.category === cat).length;
    return [Markup.button.callback(`📂 ${cat} (${count})`, `cat_${cat}`)];
  });
  buttons.push([Markup.button.callback('⬅️ Back to Menu', 'action_back_start')]);

  await ctx.replyWithMarkdown(
    `📂 *Product Categories*\n━━━━━━━━━━━━━━━━━━━━━\n\nChoose a category:`,
    Markup.inlineKeyboard(buttons)
  );
});

// Category filter
bot.action(/cat_(.+)/, async (ctx) => {
  const category = ctx.match[1];
  await dbConnect();
  const products = await Product.find({ isActive: true, category });

  if (products.length === 0) {
    return ctx.reply(`No products in category "${category}".`);
  }

  for (const p of products) {
    const typeEmoji = p.type === 'course' ? '📚' : p.type === 'apk' ? '📱' : '💾';
    let couponTag = '';
    if (p.couponCode && p.couponDiscount > 0) {
      couponTag = `\n🎟️ *Coupon Available!* — Save ${p.couponDiscount}%`;
    }

    const caption =
      `${typeEmoji} *${p.title}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 _${p.description}_\n\n` +
      `💰 *Price:* ₹${p.price}` +
      couponTag;

    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback(`🛒 Buy Now — ₹${p.price}`, `buy_${p._id}`)]
    ]);

    if (p.imageUrl && p.imageUrl.startsWith('http')) {
      try {
        await ctx.replyWithPhoto(p.imageUrl, { caption, parse_mode: 'Markdown', ...buttons });
        continue;
      } catch(e) {}
    }
    await ctx.replyWithMarkdown(caption, buttons);
  }
});

// ─── Search Products ───
bot.action('action_search', async (ctx) => {
  searchWaitingUsers.add(ctx.from.id.toString());
  await ctx.reply("🔍 Type the name of the product you're looking for:");
});

bot.command('search', async (ctx) => {
  const keyword = ctx.message.text.replace('/search', '').trim();
  if (!keyword) {
    searchWaitingUsers.add(ctx.from.id.toString());
    return ctx.reply("🔍 Type the name of the product you're looking for:");
  }
  await performSearch(ctx, keyword);
});

async function performSearch(ctx, keyword) {
  await dbConnect();
  const products = await Product.find({
    isActive: true,
    title: { $regex: keyword, $options: 'i' }
  });

  if (products.length === 0) {
    return ctx.reply(`❌ No products found for "*${keyword}*". Try a different keyword or /start to browse all.`, { parse_mode: 'Markdown' });
  }

  await ctx.reply(`🔍 *Found ${products.length} result(s) for "${keyword}":*`, { parse_mode: 'Markdown' });

  for (const p of products) {
    const typeEmoji = p.type === 'course' ? '📚' : p.type === 'apk' ? '📱' : '💾';
    const caption = `${typeEmoji} *${p.title}* — ₹${p.price}\n_${p.description}_`;
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback(`🛒 Buy Now — ₹${p.price}`, `buy_${p._id}`)]
    ]);

    if (p.imageUrl && p.imageUrl.startsWith('http')) {
      try {
        await ctx.replyWithPhoto(p.imageUrl, { caption, parse_mode: 'Markdown', ...buttons });
        continue;
      } catch(e) {}
    }
    await ctx.replyWithMarkdown(caption, buttons);
  }
}

// ─── Buy Product ───
bot.action(/buy_(.+)/, async (ctx) => {
  const productId = ctx.match[1];
  await dbConnect();
  const product = await Product.findById(productId);
  if (!product) return ctx.reply("❌ Product not found.");

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

// ─── Helper: Send Payment Instructions ───
async function sendPaymentMessage(ctx, product, order) {
  const amount = order.amount;
  let couponLine = '';
  if (order.couponApplied) {
    couponLine = `🎟️ *Coupon:* \`${order.couponApplied}\` (${product.couponDiscount}% OFF)\n~~₹${order.originalAmount}~~ → `;
  }

  const msg =
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🧾 *ORDER SUMMARY*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📦 *Product:* ${product.title}\n` +
    `${couponLine}💰 *Amount:* ₹${amount}\n` +
    `🆔 *Order:* \`${order._id}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 *PAYMENT INSTRUCTIONS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `1️⃣ Pay *₹${amount}* to UPI ID:\n   \`${config.UPI_ID}\`\n\n` +
    `2️⃣ Or scan the QR code below\n\n` +
    `3️⃣ After payment, *send the screenshot here*\n\n` +
    `⏱️ Admin will verify within 15 minutes.\n` +
    `Once approved, you'll auto-receive the product! ✅`;

  const actionButtons = [];
  if (product.couponCode && product.couponDiscount > 0 && !order.couponApplied) {
    actionButtons.push([Markup.button.callback('🎟️ Apply Coupon Code', `applycoupon_${order._id}`)]);
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
        msg + "\n\n_(QR image could not load. Use the UPI ID above)_",
        actionButtons.length > 0 ? Markup.inlineKeyboard(actionButtons) : {}
      );
    }
  } else {
    await ctx.replyWithMarkdown(msg, actionButtons.length > 0 ? Markup.inlineKeyboard(actionButtons) : {});
  }
}

// ─── Apply Coupon ───
bot.action(/applycoupon_(.+)/, async (ctx) => {
  const orderId = ctx.match[1];
  couponWaitingUsers.set(ctx.from.id.toString(), orderId);
  await ctx.reply("🎟️ Type your coupon code below:");
});

// ─── My Orders ───
bot.action('action_myorders', async (ctx) => {
  await showMyOrders(ctx);
});

bot.command('myorders', async (ctx) => {
  await showMyOrders(ctx);
});

async function showMyOrders(ctx) {
  await dbConnect();
  const orders = await Order.find({ telegramId: ctx.from.id.toString() })
    .sort({ createdAt: -1 })
    .limit(15)
    .populate('product');

  if (orders.length === 0) {
    return ctx.reply("📦 You have no orders yet. Start shopping! 👉 /start");
  }

  let text = `━━━━━━━━━━━━━━━━━━━━━\n📦 *YOUR ORDERS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const o of orders) {
    const statusEmoji = o.status === 'approved' ? '🟢' : o.status === 'pending' ? '🟡' : '🔴';
    const statusText = o.status.charAt(0).toUpperCase() + o.status.slice(1);
    const date = o.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    let couponInfo = '';
    if (o.couponApplied) {
      couponInfo = ` (🎟️ ${o.couponApplied})`;
    }
    let refundInfo = '';
    if (o.refundStatus === 'requested') refundInfo = '\n   ↳ 🔄 _Refund Requested_';
    else if (o.refundStatus === 'approved') refundInfo = '\n   ↳ ✅ _Refund Approved_';
    else if (o.refundStatus === 'rejected') refundInfo = '\n   ↳ ❌ _Refund Rejected_';

    text += `${statusEmoji} *${o.product.title}*\n`;
    text += `   💰 ₹${o.amount}${couponInfo} — ${statusText}\n`;
    text += `   📅 ${date}${refundInfo}\n\n`;
  }

  const buttons = [];
  const approvedOrders = orders.filter(o => o.status === 'approved' && o.refundStatus === 'none');
  if (approvedOrders.length > 0) {
    buttons.push([Markup.button.callback('🔄 Request Refund', 'action_refund_select')]);
  }
  buttons.push([Markup.button.callback('🔗 View My Downloads', 'action_mypurchases')]);
  buttons.push([Markup.button.callback('⬅️ Back to Menu', 'action_back_start')]);

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
}

// ─── My Purchases (Downloads) ───
bot.action('action_mypurchases', async (ctx) => {
  await dbConnect();
  const orders = await Order.find({ telegramId: ctx.from.id.toString(), status: 'approved' }).populate('product');
  if (orders.length === 0) {
    return ctx.reply("📭 No purchases yet. Browse products! 👉 /start");
  }

  let text = `━━━━━━━━━━━━━━━━━━━━━\n🔗 *YOUR DOWNLOADS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  orders.forEach((o, idx) => {
    text += `${idx + 1}. *${o.product.title}*\n   💰 ₹${o.amount}\n   🔗 ${o.product.deliveryLink}\n\n`;
  });
  await ctx.replyWithMarkdown(text);
});

// ─── Refund System ───
bot.action('action_refund_select', async (ctx) => {
  await dbConnect();
  const orders = await Order.find({
    telegramId: ctx.from.id.toString(),
    status: 'approved',
    refundStatus: 'none'
  }).populate('product');

  if (orders.length === 0) {
    return ctx.reply("No eligible orders for refund.");
  }

  const buttons = orders.map(o => [
    Markup.button.callback(`🔄 ${o.product.title} — ₹${o.amount}`, `refund_${o._id}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Cancel', 'action_myorders')]);

  await ctx.replyWithMarkdown(
    `🔄 *Select an order to request refund:*`,
    Markup.inlineKeyboard(buttons)
  );
});

bot.action(/refund_(.+)/, async (ctx) => {
  const orderId = ctx.match[1];
  refundWaitingUsers.set(ctx.from.id.toString(), orderId);
  await ctx.reply("📝 Please type the reason for your refund request:");
});

// Admin refund actions
bot.action(/refundapprove_(.+)/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return ctx.answerCbQuery('Not Authorized');
  await dbConnect();
  const order = await Order.findById(ctx.match[1]).populate('product');
  if (!order) return ctx.editMessageText('Order not found.');

  order.refundStatus = 'approved';
  await order.save();
  await ctx.editMessageText(`✅ *Refund Approved* for ${order.product.title} (₹${order.amount})`, { parse_mode: 'Markdown' });

  try {
    await bot.telegram.sendMessage(order.telegramId,
      `✅ *Refund Approved!*\n\nYour refund for *${order.product.title}* (₹${order.amount}) has been approved. Amount will be refunded shortly.`,
      { parse_mode: 'Markdown' }
    );
  } catch(e) { console.error("Error notifying user about refund:", e); }
});

bot.action(/refundreject_(.+)/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return ctx.answerCbQuery('Not Authorized');
  await dbConnect();
  const order = await Order.findById(ctx.match[1]).populate('product');
  if (!order) return ctx.editMessageText('Order not found.');

  order.refundStatus = 'rejected';
  await order.save();
  await ctx.editMessageText(`❌ *Refund Rejected* for ${order.product.title}`, { parse_mode: 'Markdown' });

  try {
    await bot.telegram.sendMessage(order.telegramId,
      `❌ *Refund Rejected*\n\nYour refund request for *${order.product.title}* has been rejected. Contact support for more info.`,
      { parse_mode: 'Markdown' }
    );
  } catch(e) { console.error("Error notifying user about refund rejection:", e); }
});

// ─── Help & Support ───
bot.action('action_help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📞 *HELP & SUPPORT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔹 *How to buy:*\n` +
    `   1. Browse products\n` +
    `   2. Click "Buy Now"\n` +
    `   3. Pay via UPI/QR\n` +
    `   4. Send screenshot\n` +
    `   5. Get product link instantly!\n\n` +
    `🔹 *Commands:*\n` +
    `   /start — Main menu\n` +
    `   /search — Search products\n` +
    `   /myorders — View your orders\n\n` +
    `🔹 *Have a coupon?*\n` +
    `   Click "Apply Coupon" during checkout\n\n` +
    `🔹 *Need a refund?*\n` +
    `   Go to My Orders → Request Refund\n\n` +
    `❓ For other issues, contact the admin.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Back to Menu', 'action_back_start')]
    ])
  );
});

// ─── Back to Start ───
bot.action('action_back_start', async (ctx) => {
  await ctx.replyWithMarkdown(
    `🏪 *Main Menu*\n━━━━━━━━━━━━━━━━━━━━━`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛍️ Browse Products', 'action_products')],
      [Markup.button.callback('📂 Browse by Category', 'action_categories')],
      [Markup.button.callback('🔍 Search Products', 'action_search')],
      [Markup.button.callback('📦 My Orders', 'action_myorders')],
      [Markup.button.callback('📞 Help & Support', 'action_help')]
    ])
  );
});

// ─── Handle Photos (Payment Screenshots) ───
bot.on('photo', async (ctx) => {
  couponWaitingUsers.delete(ctx.from.id.toString());
  searchWaitingUsers.delete(ctx.from.id.toString());
  refundWaitingUsers.delete(ctx.from.id.toString());

  await dbConnect();
  const order = await Order.findOne({ telegramId: ctx.from.id.toString(), status: 'pending' })
    .sort({ createdAt: -1 })
    .populate('product');
  
  if (!order) {
    return ctx.reply("❌ You have no pending orders. Type /start to browse products.");
  }

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  order.screenshotId = fileId;
  await order.save();

  // Notify Admin
  if (config.ADMIN_USER_ID) {
    let couponInfo = '';
    if (order.couponApplied) {
      couponInfo = `\n🎟️ Coupon: ${order.couponApplied} (Original: ₹${order.originalAmount})`;
    }

    const adminMsg =
      `🚨 *NEW PAYMENT VERIFICATION*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 User: @${ctx.from.username || ctx.from.id}\n` +
      `📦 Product: ${order.product.title}\n` +
      `💰 Amount: ₹${order.amount}${couponInfo}\n` +
      `🆔 Order: \`${order._id}\``;

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

  await ctx.reply("✅ Screenshot received! Sent to admin for verification.\n⏱️ You'll receive your product within 15 minutes once approved.");
});


// ═══════════════════════════════════════════
// ║         ADMIN APPROVAL ACTIONS          ║
// ═══════════════════════════════════════════

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

  let couponInfo = '';
  if (order.couponApplied) {
    couponInfo = `\n🎟️ Coupon: ${order.couponApplied}`;
  }
  await ctx.editMessageCaption(
    `✅ *Order Approved*\n📦 Product: ${order.product.title}\n💰 Amount: ₹${order.amount}${couponInfo}\n\n📤 Delivery link sent to user.`,
    { parse_mode: 'Markdown' }
  );

  try {
    const successMsg =
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 *PAYMENT APPROVED!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Thank you for purchasing *${order.product.title}*!\n\n` +
      `👇 *Your Access Link:*\n${order.product.deliveryLink}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ _Keep growing! Check /start for more products._`;
    await bot.telegram.sendMessage(order.telegramId, successMsg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error("Error sending delivery link:", err);
    await ctx.reply(`⚠️ Could not deliver link to user ${order.telegramId}. Error: ${err.message}`);
  }
});

bot.action(/reject_(.+)/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
    return ctx.answerCbQuery('Not Authorized');
  }
  const orderId = ctx.match[1];
  await dbConnect();
  const order = await Order.findById(orderId).populate('product');
  if (!order || order.status !== 'pending') {
    return ctx.editMessageCaption('Order already processed or not found.');
  }

  order.status = 'rejected';
  await order.save();
  await ctx.editMessageCaption(`❌ *Order Rejected*\n📦 ${order.product.title}`, { parse_mode: 'Markdown' });

  try {
    await bot.telegram.sendMessage(order.telegramId,
      `❌ *Payment Rejected*\n\nYour payment for *${order.product.title}* was rejected.\nIf this is a mistake, please contact support or try again.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error("Error notifying user about rejection:", err);
  }
});


// ═══════════════════════════════════════════
// ║            ADMIN COMMANDS               ║
// ═══════════════════════════════════════════

// ─── /dashboard ───
bot.command('dashboard', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();

  const totalUsers = await User.countDocuments();
  const totalProducts = await Product.countDocuments({ isActive: true });
  const totalOrders = await Order.countDocuments();
  const approvedOrders = await Order.countDocuments({ status: 'approved' });
  const pendingOrders = await Order.countDocuments({ status: 'pending' });
  const rejectedOrders = await Order.countDocuments({ status: 'rejected' });
  const refundRequests = await Order.countDocuments({ refundStatus: 'requested' });

  // Calculate revenue
  const revenueResult = await Order.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

  // Today's revenue
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayResult = await Order.aggregate([
    { $match: { status: 'approved', createdAt: { $gte: todayStart } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const todayRevenue = todayResult.length > 0 ? todayResult[0].total : 0;

  const dashboard =
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *ADMIN DASHBOARD*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👥 *Total Users:* ${totalUsers}\n` +
    `🛍️ *Active Products:* ${totalProducts}\n\n` +
    `📦 *Orders Overview:*\n` +
    `   ✅ Approved: ${approvedOrders}\n` +
    `   🟡 Pending: ${pendingOrders}\n` +
    `   🔴 Rejected: ${rejectedOrders}\n` +
    `   📦 Total: ${totalOrders}\n\n` +
    `💰 *Revenue:*\n` +
    `   📈 Today: ₹${todayRevenue.toLocaleString('en-IN')}\n` +
    `   💵 All Time: ₹${totalRevenue.toLocaleString('en-IN')}\n\n` +
    `🔄 *Pending Refunds:* ${refundRequests}`;

  await ctx.replyWithMarkdown(dashboard);
});

// ─── /addproduct ───
bot.command('addproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  // format: /addproduct Title | Desc | Price | Type | Link | ImageURL | Category | CouponCode | Discount%
  const rawText = ctx.message.text.replace('/addproduct ', '');
  const args = rawText.split('|').map(s => s.trim());
  if (args.length < 5) {
    return ctx.replyWithMarkdown(
      `📝 *Add Product Format:*\n\n` +
      `\`/addproduct Title | Desc | Price | Type | Link\`\n\n` +
      `*Full format with all options:*\n` +
      `\`/addproduct Title | Desc | Price | Type | Link | ImageURL | Category | CouponCode | Discount%\`\n\n` +
      `*Types:* course, data, apk\n\n` +
      `*Example:*\n` +
      `\`/addproduct Java Course | Complete Java | 900 | course | https://link.com | https://img.com/java.jpg | Programming | JAVA20 | 20\``
    );
  }
  
  try {
    await dbConnect();
    const [title, description, price, type, deliveryLink, imageUrl, category, couponCode, couponDiscount] = args;
    const productData = {
      title,
      description,
      price: Number(price),
      type,
      deliveryLink,
      imageUrl: imageUrl || '',
      category: category || 'General'
    };
    
    if (couponCode && couponDiscount) {
      productData.couponCode = couponCode.toUpperCase();
      productData.couponDiscount = Number(couponDiscount);
    }

    const product = await Product.create(productData);
    let successMsg = `✅ *Product Added!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    successMsg += `📦 *${title}*\n💰 Price: ₹${price}\n📂 Category: ${category || 'General'}\n🆔 ID: \`${product._id}\``;
    if (couponCode && couponDiscount) {
      successMsg += `\n🎟️ Coupon: ${couponCode.toUpperCase()} → ${couponDiscount}% OFF`;
    }
    if (imageUrl) {
      successMsg += `\n🖼️ Image: Set`;
    }
    await ctx.replyWithMarkdown(successMsg);
  } catch (e) {
    ctx.reply("❌ Error adding product: " + e.message);
  }
});

// ─── /listproducts ───
bot.command('listproducts', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();
  const products = await Product.find({});

  if (products.length === 0) return ctx.reply("No products in database.");

  let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *ALL PRODUCTS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  products.forEach((p, idx) => {
    const status = p.isActive ? '🟢' : '🔴';
    text += `${status} ${idx + 1}. *${p.title}*\n`;
    text += `   💰 ₹${p.price} | 📂 ${p.category} | ${p.type}\n`;
    text += `   🆔 \`${p._id}\`\n`;
    if (p.couponCode) text += `   🎟️ ${p.couponCode} (${p.couponDiscount}% off)\n`;
    text += `\n`;
  });
  text += `_Use \`/editproduct\`, \`/deleteproduct\`, \`/toggleproduct\` with product ID_`;
  await ctx.replyWithMarkdown(text);
});

// ─── /editproduct ───
bot.command('editproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  // format: /editproduct <id> | <field> | <new value>
  const rawText = ctx.message.text.replace('/editproduct ', '');
  const args = rawText.split('|').map(s => s.trim());
  if (args.length < 3) {
    return ctx.replyWithMarkdown(
      `✏️ *Edit Product Format:*\n\n` +
      `\`/editproduct ID | field | new value\`\n\n` +
      `*Fields:* title, description, price, type, deliveryLink, imageUrl, category, couponCode, couponDiscount\n\n` +
      `*Example:*\n\`/editproduct 6651abc... | price | 799\``
    );
  }

  try {
    await dbConnect();
    const [id, field, ...valueParts] = args;
    const value = valueParts.join('|').trim();
    const allowedFields = ['title', 'description', 'price', 'type', 'deliveryLink', 'imageUrl', 'category', 'couponCode', 'couponDiscount'];

    if (!allowedFields.includes(field)) {
      return ctx.reply(`❌ Invalid field. Allowed: ${allowedFields.join(', ')}`);
    }

    const updateValue = (field === 'price' || field === 'couponDiscount') ? Number(value) : value;
    await Product.findByIdAndUpdate(id, { [field]: updateValue });
    await ctx.replyWithMarkdown(`✅ *Product updated!*\n🔧 ${field} → \`${value}\``);
  } catch (e) {
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── /deleteproduct ───
bot.command('deleteproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const id = ctx.message.text.replace('/deleteproduct ', '').trim();
  if (!id || id === '/deleteproduct') {
    return ctx.reply("Usage: /deleteproduct <product_id>");
  }
  try {
    await dbConnect();
    await Product.findByIdAndUpdate(id, { isActive: false });
    await ctx.reply("✅ Product deactivated (soft deleted). Use /toggleproduct to re-enable.");
  } catch (e) {
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── /toggleproduct ───
bot.command('toggleproduct', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const id = ctx.message.text.replace('/toggleproduct ', '').trim();
  if (!id || id === '/toggleproduct') {
    return ctx.reply("Usage: /toggleproduct <product_id>");
  }
  try {
    await dbConnect();
    const product = await Product.findById(id);
    if (!product) return ctx.reply("Product not found.");
    product.isActive = !product.isActive;
    await product.save();
    await ctx.reply(`✅ Product "${product.title}" is now ${product.isActive ? '🟢 Active' : '🔴 Inactive'}`);
  } catch (e) {
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── /broadcast ───
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
    } catch(e) {}
  }
  await ctx.reply(`✅ Broadcast sent to ${sent}/${users.length} users.`);
});

// ─── /setqr ───
bot.command('setqr', (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const newQr = ctx.message.text.replace('/setqr ', '').trim();
  if (!newQr || !newQr.startsWith('http')) {
    return ctx.reply("Usage: /setqr [Image URL]");
  }
  config.UPI_QR_URL = newQr;
  ctx.reply("✅ QR Code URL updated in memory.\n⚠️ To persist, update Vercel Environment Variables.");
});

// ─── /helpadmin ───
bot.command('helpadmin', (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  ctx.replyWithMarkdown(
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🛠️ *ADMIN COMMANDS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📊 *Dashboard:*\n` +
    `   /dashboard — Stats & revenue\n\n` +
    `📦 *Product Management:*\n` +
    `   /addproduct — Add new product\n` +
    `   /listproducts — View all products\n` +
    `   /editproduct — Edit product field\n` +
    `   /deleteproduct — Soft delete product\n` +
    `   /toggleproduct — Enable/disable product\n\n` +
    `📢 *Communication:*\n` +
    `   /broadcast — Message all users\n` +
    `   /setqr — Update QR code image\n\n` +
    `🎟️ *Product format:*\n` +
    `   \`Title | Desc | Price | Type | Link | ImageURL | Category | CouponCode | Discount%\``
  );
});


// ═══════════════════════════════════════════
// ║          TEXT MESSAGE HANDLER           ║
// ═══════════════════════════════════════════

bot.on('message', async (ctx, next) => {
  if (!ctx.message || !ctx.message.text) return next();
  if (ctx.message.text.startsWith('/')) return next();

  const userId = ctx.from.id.toString();
  const txt = ctx.message.text.trim();

  // ─── Coupon Code Input ───
  if (couponWaitingUsers.has(userId)) {
    const orderId = couponWaitingUsers.get(userId);
    couponWaitingUsers.delete(userId);

    try {
      await dbConnect();
      const order = await Order.findById(orderId).populate('product');
      if (!order || order.status !== 'pending') {
        return ctx.reply("❌ Order not found or already processed. /start to try again.");
      }

      const product = order.product;
      const enteredCode = txt.toUpperCase();

      if (!product.couponCode || product.couponCode.toUpperCase() !== enteredCode) {
        return ctx.reply("❌ Invalid coupon code! Send payment screenshot to continue without coupon.");
      }

      const discount = product.couponDiscount;
      const discountedAmount = Math.round(product.price - (product.price * discount / 100));

      order.amount = discountedAmount;
      order.originalAmount = product.price;
      order.couponApplied = enteredCode;
      await order.save();

      await ctx.replyWithMarkdown(
        `✅ *Coupon Applied!*\n\n` +
        `🎟️ Code: \`${enteredCode}\` — *${discount}% OFF*\n` +
        `~~₹${product.price}~~ → *₹${discountedAmount}*\n\n` +
        `💰 *You save ₹${product.price - discountedAmount}!*`
      );

      await sendPaymentMessage(ctx, product, order);
      return;
    } catch (e) {
      console.error("Coupon error:", e);
      return ctx.reply("❌ Something went wrong. /start to try again.");
    }
  }

  // ─── Search Input ───
  if (searchWaitingUsers.has(userId)) {
    searchWaitingUsers.delete(userId);
    return performSearch(ctx, txt);
  }

  // ─── Refund Reason Input ───
  if (refundWaitingUsers.has(userId)) {
    const orderId = refundWaitingUsers.get(userId);
    refundWaitingUsers.delete(userId);

    try {
      await dbConnect();
      const order = await Order.findById(orderId).populate('product');
      if (!order) return ctx.reply("❌ Order not found.");

      order.refundStatus = 'requested';
      order.refundReason = txt;
      await order.save();

      await ctx.reply("✅ Refund request submitted! Admin will review it shortly.");

      // Notify admin
      if (config.ADMIN_USER_ID) {
        try {
          await bot.telegram.sendMessage(config.ADMIN_USER_ID,
            `🔄 *REFUND REQUEST*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 User: @${ctx.from.username || ctx.from.id}\n` +
            `📦 Product: ${order.product.title}\n` +
            `💰 Amount: ₹${order.amount}\n` +
            `📝 Reason: _${txt}_\n` +
            `🆔 Order: \`${order._id}\``,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('✅ Approve Refund', `refundapprove_${order._id}`),
                  Markup.button.callback('❌ Reject Refund', `refundreject_${order._id}`)
                ]
              ])
            }
          );
        } catch(e) { console.error("Error notifying admin about refund:", e); }
      }
      return;
    } catch (e) {
      console.error("Refund error:", e);
      return ctx.reply("❌ Something went wrong. Try again later.");
    }
  }

  // ─── Fallback Messages ───
  const lower = txt.toLowerCase();
  if (lower === 'hi' || lower === 'hello' || lower === 'hey') {
    return ctx.reply("Hello ji! 👋 Humare digital store mein aapka swagat hai.\n\nProducts dekhne ke liye 👉 /start");
  } else {
    return ctx.reply("Main ek Automated Store Bot hoon 🤖\n\nMenu ke liye 👉 /start");
  }
});


// ═══════════════════════════════════════════
// ║             UTILITY HELPERS             ║
// ═══════════════════════════════════════════

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

module.exports = bot;
