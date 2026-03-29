const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const dbConnect = require('./db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Category = require('./models/Category');
const Setting = require('./models/Setting');

if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is required!");
const bot = new Telegraf(config.BOT_TOKEN);

// ─── In-memory state maps ───
const couponWaitingUsers = new Map();   // userId → orderId
const refundWaitingUsers = new Map();   // userId → orderId
const searchWaitingUsers = new Set();   // userId set
const pendingProductData = new Map();   // userId → product data (waiting for category selection)

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
      [Markup.button.url('🎨 Apply Premium Dark Theme', 'https://t.me/bg/mP3FG_iwSFAFAAAA2AklJO978pA?bg_color=2c0b22~290020~160a22~3b1834&intensity=40')],
      [Markup.button.callback('🛍️ Browse', 'action_products'), Markup.button.callback('📂 Categories', 'action_categories')],
      [Markup.button.callback('🔍 Search', 'action_search'), Markup.button.callback('📦 My Orders', 'action_myorders')],
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

// ─── Helper: Get categories from DB ───
async function getCategories() {
  await dbConnect();
  const cats = await Category.find({}).sort({ createdAt: 1 });
  return cats.map(c => c.name);
}

// ─── Browse by Category ───
bot.action('action_categories', async (ctx) => {
  await dbConnect();
  const categories = await getCategories();
  const products = await Product.find({ isActive: true });

  if (categories.length === 0) {
    return ctx.reply("😔 No categories yet. Admin can add via /addcategory");
  }

  const buttons = categories.map(cat => {
    const count = products.filter(p => p.category === cat).length;
    return [Markup.button.callback(`${cat} (${count})`, `cat_${cat}`)];
  });
  buttons.push([Markup.button.callback('⬅️ Back to Menu', 'action_back_start')]);

  await ctx.replyWithMarkdown(
    `📂 *Product Categories*\n━━━━━━━━━━━━━━━━━━━━━\n\nChoose a category:`,
    Markup.inlineKeyboard(buttons)
  );
});

// Category filter
bot.action(/^cat_(.+)$/, async (ctx) => {
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
      `💰 *Price:* ₹${p.price}\n` +
      `🆔 *ID:* \`${p.productId || p._id}\`` +
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
    const caption = `${typeEmoji} *${p.title}* — ₹${p.price}\n_${p.description}_\n🆔 *ID:* \`${p.productId || p._id}\``;
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
bot.action(/^buy_(.+)$/, async (ctx) => {
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

  await sendCheckoutSummary(ctx, product, order);
});

// ─── Helper: Get Dynamic Setting ───
async function getSetting(key, defaultVal) {
  const s = await Setting.findOne({ key });
  return s ? s.value : defaultVal;
}

// ─── Step 1: Checkout Summary ───
async function sendCheckoutSummary(ctx, product, order) {
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
    `${couponLine}💰 *Total Amount:* ₹${amount}\n` +
    `🆔 *Order ID:* \`${order._id}\`\n\n` +
    `👇 *Please choose an option below:*`;

  const actionButtons = [];
  if (product.couponCode && product.couponDiscount > 0 && !order.couponApplied) {
    actionButtons.push([Markup.button.callback('🎟️ Apply Coupon Code', `applycoupon_${order._id}`)]);
  }
  actionButtons.push([Markup.button.callback('💳 Proceed to Pay', `checkout_${order._id}`)]);

  await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(actionButtons));
}

// ─── Step 2: Final Payment Screen ───
bot.action(/^checkout_(.+)$/, async (ctx) => {
  const userId = ctx.from.id.toString();
  couponWaitingUsers.delete(userId); // Clear if user was mid-typing a coupon
  
  const orderId = ctx.match[1];
  await dbConnect();
  const order = await Order.findById(orderId).populate('product');
  if (!order) return ctx.reply("❌ Order not found.");

  if (order.status === 'pending') {
    order.status = 'checkout';
    await order.save();
  }

  const upiId = await getSetting('UPI_ID', config.UPI_ID);
  const upiQr = await getSetting('UPI_QR_URL', config.UPI_QR_URL);

  const msg =
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 *PAYMENT INSTRUCTIONS*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `1️⃣ Pay *₹${order.amount}* to UPI ID:\n   \`${upiId}\`\n\n` +
    `2️⃣ Or scan the QR code below\n\n` +
    `3️⃣ After payment, *send the screenshot here*\n\n` +
    `⏱️ Admin will verify within 15 minutes.\n` +
    `Once approved, you'll auto-receive the product! ✅`;

  if (upiQr && upiQr.startsWith('http')) {
    try {
      await ctx.replyWithPhoto(upiQr, { caption: msg, parse_mode: 'Markdown' });
    } catch(err) {
      await ctx.replyWithMarkdown(msg + "\n\n_(QR image could not load. Use the UPI ID above)_");
    }
  } else {
    await ctx.replyWithMarkdown(msg);
  }
});

// ─── Apply Coupon ───
bot.action(/^applycoupon_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  couponWaitingUsers.set(ctx.from.id.toString(), orderId);
  await ctx.replyWithMarkdown("🎟️ *Type your coupon code below:*\n\n_(Or just click '💳 Proceed to Pay' on the message above if you don't have one)_");
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

bot.action(/^refund_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  refundWaitingUsers.set(ctx.from.id.toString(), orderId);
  await ctx.reply("📝 Please type the reason for your refund request:");
});

// Admin refund actions
bot.action(/^refundapprove_(.+)$/, async (ctx) => {
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

bot.action(/^refundreject_(.+)$/, async (ctx) => {
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
  const order = await Order.findOne({ telegramId: ctx.from.id.toString(), status: 'checkout' })
    .sort({ createdAt: -1 })
    .populate('product');
  
  if (!order) {
    const pendingOrder = await Order.findOne({ telegramId: ctx.from.id.toString(), status: 'pending' }).sort({ createdAt: -1 });
    if (pendingOrder) {
      return ctx.reply("⚠️ *Hold on!* Please click **'💳 Proceed to Pay'** on your Order Summary before sending the payment screenshot.", { parse_mode: 'Markdown' });
    }
    return ctx.reply("❌ You have no active orders waiting for payment. Type /start to browse products.");
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

bot.action(/^approve_(.+)$/, async (ctx) => {
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

bot.action(/^reject_(.+)$/, async (ctx) => {
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
  const rawText = ctx.message.text.replace('/addproduct ', '').trim();

  // Show format guide if no args
  if (!rawText || rawText === '/addproduct') {
    return ctx.replyWithMarkdown(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 *ADD PRODUCT GUIDE*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Format (required fields):*\n` +
      `\`/addproduct Title | Description | Price | Type | DeliveryLink\`\n\n` +
      `*Format (all fields):*\n` +
      `\`/addproduct Title | Description | Price | Type | DeliveryLink | ImageURL | CouponCode | Discount%\`\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *FIELD DETAILS:*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `1️⃣ *Title* — Product name\n` +
      `2️⃣ *Description* — Short info (2-3 lines)\n` +
      `3️⃣ *Price* — Number only (e.g. 499)\n` +
      `4️⃣ *Type* — \`course\` / \`apk\` / \`data\`\n` +
      `5️⃣ *DeliveryLink* — Download link (user gets after payment)\n` +
      `6️⃣ *ImageURL* — Product thumbnail (optional)\n` +
      `7️⃣ *CouponCode* — e.g. SAVE20 (optional)\n` +
      `8️⃣ *Discount%* — e.g. 20 (optional)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✏️ *EXAMPLES:*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Basic:*\n` +
      `\`/addproduct Java Course | Complete Java Bootcamp | 900 | course | https://link.com\`\n\n` +
      `*With image:*\n` +
      `\`/addproduct Spotify MOD | Ad-free premium | 49 | apk | https://link.com | https://img.com/pic.jpg\`\n\n` +
      `*With coupon:*\n` +
      `\`/addproduct UPSC Notes | Full syllabus PDF | 299 | data | https://link.com | https://img.com/pic.jpg | UPSC30 | 30\`\n\n` +
      `⚡ _Category select buttons will appear after you send!_`
    );
  }

  const args = rawText.split('|').map(s => s.trim());
  if (args.length < 5) {
    return ctx.reply("❌ Minimum 5 fields required: Title | Desc | Price | Type | Link\n\nType /addproduct alone to see the full guide.");
  }

  try {
    const [title, description, price, type, deliveryLink] = args;
    
    // Validate type enum
    const validTypes = ['course', 'data', 'apk'];
    if (!validTypes.includes(type.toLowerCase())) {
      return ctx.reply(`❌ *Invalid Type!*\n\nYou wrote: \`${type}\`\nIt must be exactly one of these: \`course\`, \`data\`, or \`apk\``, { parse_mode: 'Markdown' });
    }

    let imageUrl = '';
    let couponCode = '';
    let couponDiscount = 0;

    // Smart parsing for optional args (index 5, 6, 7)
    if (args[5]) {
      if (args[5].startsWith('http')) {
        imageUrl = args[5];
        if (args[6]) couponCode = args[6];
        if (args[7]) couponDiscount = args[7];
      } else {
        // Skipped image URL, directly provided coupon code
        couponCode = args[5];
        if (args[6]) couponDiscount = args[6];
      }
    }

    if (couponCode && !couponDiscount) {
      return ctx.reply("❌ You provided a Coupon Code but missed the Discount %!\n\nIf you want to add a coupon, you must provide BOTH. Example:\n`... | DeliveryLink | ImageURL | GET50 | 50`\nOr if no image:\n`... | DeliveryLink | GET50 | 50`", { parse_mode: 'Markdown' });
    }

    const productData = {
      title,
      description,
      price: Number(price),
      type,
      deliveryLink,
      imageUrl
    };

    if (couponCode) {
      productData.couponCode = couponCode.toUpperCase();
      productData.couponDiscount = Number(String(couponDiscount).replace('%', '').trim());
    }

    // Store pending product and show category buttons from DB
    pendingProductData.set(ctx.from.id.toString(), productData);
    const categories = await getCategories();

    if (categories.length === 0) {
      return ctx.reply("❌ No categories exist! Add one first with /addcategory");
    }

    const catButtons = categories.map(cat => [
      Markup.button.callback(cat, `admincat_${cat}`)
    ]);
    catButtons.push([Markup.button.callback('❌ Cancel', 'admincat_cancel')]);

    await ctx.replyWithMarkdown(
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *PRODUCT READY*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 *Title:* ${title}\n` +
      `📝 *Desc:* ${description}\n` +
      `💰 *Price:* ₹${price}\n` +
      `📁 *Type:* ${type}\n` +
      (imageUrl ? `🖼️ *Image:* Set\n` : '') +
      (couponCode ? `🎟️ *Coupon:* ${couponCode.toUpperCase()} → ${couponDiscount}% OFF\n` : '') +
      `\n👇 *Select category to add this product:*`,
      Markup.inlineKeyboard(catButtons)
    );
  } catch (e) {
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── Category selection for addproduct ───
bot.action(/^admincat_(.+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return ctx.answerCbQuery('Not Authorized');
  const selected = ctx.match[1];
  const userId = ctx.from.id.toString();

  if (selected === 'cancel') {
    pendingProductData.delete(userId);
    return ctx.editMessageText('❌ Product addition cancelled.');
  }

  const productData = pendingProductData.get(userId);
  if (!productData) {
    return ctx.editMessageText('❌ No pending product found. Use /addproduct again.');
  }

  try {
    await dbConnect();
    productData.category = selected;

    // Generate unique 4-digit ID
    let uniqueId;
    let isUnique = false;
    while (!isUnique) {
      uniqueId = Math.floor(1000 + Math.random() * 9000).toString();
      const existing = await Product.findOne({ productId: uniqueId });
      if (!existing) isUnique = true;
    }
    productData.productId = uniqueId;

    const product = await Product.create(productData);
    pendingProductData.delete(userId);

    let successMsg =
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *PRODUCT ADDED!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 *${productData.title}*\n` +
      `💰 Price: ₹${productData.price}\n` +
      `📂 Category: ${selected}\n` +
      `🆔 ID: \`${product.productId}\``;
    if (productData.couponCode) {
      successMsg += `\n🎟️ Coupon: ${productData.couponCode} → ${productData.couponDiscount}% OFF`;
    }
    if (productData.imageUrl) {
      successMsg += `\n🖼️ Image: Set`;
    }
    await ctx.editMessageText(successMsg, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.editMessageText('❌ Error adding product: ' + e.message);
  }
});

// ─── /coupons ───
bot.command('coupons', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();
  
  const products = await Product.find({ couponCode: { $ne: '' }, couponCode: { $exists: true } });
  
  if (products.length === 0) {
    return ctx.reply("🎟️ No products currently have an active coupon.");
  }
  
  let msg = `🎟️ *ACTIVE COUPONS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  products.forEach(p => {
    msg += `📦 *${p.title}* (ID: \`${p.productId || p._id}\`)\n`;
    msg += `   🎟️ Code: \`${p.couponCode}\` — *${p.couponDiscount}% OFF*\n\n`;
  });
  
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🛠️ *How to Edit/Delete?*\n`;
  msg += `*To change code:* \`/editproduct ${products[0].productId || 'ID'} | couponCode | NEWCODE\`\n`;
  msg += `*To change discount:* \`/editproduct ${products[0].productId || 'ID'} | couponDiscount | 50\`\n`;
  msg += `*To remove coupon:* \`/editproduct ${products[0].productId || 'ID'} | couponCode | \`  _(Leave space after last |)_`;
  
  await ctx.replyWithMarkdown(msg);
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
    text += `   🆔 \`${p.productId || p._id}\`\n`;
    if (p.couponCode) text += `   🎟️ ${p.couponCode} (${p.couponDiscount}% off)\n`;
    text += `\n`;
  });
  text += `_Use \`/editproduct\`, \`/deleteproduct\`, \`/toggleproduct\` with product ID_`;
  await ctx.replyWithMarkdown(text);
});

// ─── /coupons ───
bot.command('coupons', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();
  
  const products = await Product.find({ couponCode: { $ne: '' }, couponDiscount: { $gt: 0 } });
  
  if (products.length === 0) {
    return ctx.reply("🎟️ No active coupons found on any products.\n\nTo add a coupon, edit a product using:\n`/editproduct <id> | couponCode | NEWCODE`\n`/editproduct <id> | couponDiscount | 50%`", { parse_mode: 'Markdown' });
  }

  let text = `━━━━━━━━━━━━━━━━━━━━━\n🎟️ *ACTIVE COUPONS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  products.forEach((p, idx) => {
    text += `${idx + 1}. *${p.title}*\n`;
    text += `   🆔 \`${p.productId || p._id}\`\n`;
    text += `   🎟️ Code: \`${p.couponCode}\`  |  Discount: *${p.couponDiscount}%*\n\n`;
  });
  
  text += `_To change a coupon's %, copy ID and use:_ \n\`/editproduct ID | couponDiscount | 60%\`\n`;
  text += `_To change code, use:_ \n\`/editproduct ID | couponCode | NEWCODE\``;
  
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

    const updateValue = (field === 'price' || field === 'couponDiscount') ? Number(String(value).replace('%', '').trim()) : value;
    const query = id.length <= 6 ? { productId: id } : { _id: id };
    const product = await Product.findOneAndUpdate(query, { [field]: updateValue }, { new: true });
    
    if (!product) return ctx.reply("❌ Product not found.");
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
    const query = id.length <= 6 ? { productId: id } : { _id: id };
    const product = await Product.findOneAndDelete(query);
    if (!product) return ctx.reply("❌ Product not found.");
    await Order.deleteMany({ product: product._id });
    await ctx.reply("✅ Product and its related orders permanently deleted from the database.");
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
    const query = id.length <= 6 ? { productId: id } : { _id: id };
    const product = await Product.findOne(query);
    if (!product) return ctx.reply("❌ Product not found.");
    product.isActive = !product.isActive;
    await product.save();
    await ctx.reply(`✅ Product "${product.title}" is now ${product.isActive ? '🟢 Active' : '🔴 Inactive'}`);
  } catch (e) {
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── /addcategory ───
bot.command('addcategory', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const name = ctx.message.text.replace('/addcategory ', '').trim();
  if (!name || name === '/addcategory') {
    return ctx.reply("Usage: /addcategory 📂 Category Name\n\nExample: /addcategory 🎵 Songs Collection");
  }
  try {
    await dbConnect();
    await Category.create({ name });
    const allCats = await getCategories();
    let msg = `✅ *Category Added:* ${name}\n\n📂 *All Categories:*\n`;
    allCats.forEach((c, i) => { msg += `   ${i + 1}. ${c}\n`; });
    await ctx.replyWithMarkdown(msg);
  } catch (e) {
    if (e.code === 11000) return ctx.reply("❌ This category already exists!");
    ctx.reply("❌ Error: " + e.message);
  }
});

// ─── /deletecategory ───
bot.command('deletecategory', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();
  const categories = await getCategories();
  if (categories.length === 0) return ctx.reply("No categories to delete.");

  const buttons = categories.map(cat => [
    Markup.button.callback(`🗑️ ${cat}`, `delcat_${cat}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Cancel', 'delcat_cancel')]);

  await ctx.replyWithMarkdown(
    `🗑️ *Select a category to delete:*`,
    Markup.inlineKeyboard(buttons)
  );
});

bot.action(/^delcat_(.+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return ctx.answerCbQuery('Not Authorized');
  const selected = ctx.match[1];
  if (selected === 'cancel') return ctx.editMessageText('❌ Cancelled.');

  try {
    await dbConnect();
    await Category.deleteOne({ name: selected });
    const remaining = await getCategories();
    let msg = `✅ *Deleted:* ${selected}\n\n📂 *Remaining Categories:*\n`;
    if (remaining.length === 0) msg += '   _None_';
    else remaining.forEach((c, i) => { msg += `   ${i + 1}. ${c}\n`; });
    await ctx.editMessageText(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.editMessageText('❌ Error: ' + e.message);
  }
});

// ─── /categories (list all) ───
bot.command('categories', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  await dbConnect();
  const categories = await getCategories();
  if (categories.length === 0) return ctx.reply("No categories. Use /addcategory to add one.");
  let msg = `📂 *All Categories:*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  categories.forEach((c, i) => { msg += `${i + 1}. ${c}\n`; });
  msg += `\n_Use /addcategory or /deletecategory to manage._`;
  await ctx.replyWithMarkdown(msg);
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
bot.command('setqr', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const newQr = ctx.message.text.replace('/setqr ', '').trim();
  if (!newQr || !newQr.startsWith('http')) {
    return ctx.reply("Usage: /setqr [Image URL]");
  }
  await dbConnect();
  await Setting.findOneAndUpdate({ key: 'UPI_QR_URL' }, { value: newQr }, { upsert: true });
  ctx.reply("✅ UPI QR Code URL updated globally in Database!");
});

// ─── /setupi ───
bot.command('setupi', async (ctx) => {
  if (ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
  const newUpi = ctx.message.text.replace('/setupi ', '').trim();
  if (!newUpi || newUpi === '/setupi') {
    return ctx.reply("Usage: /setupi [Your UPI ID]\nExample: /setupi 9999999999@ybl");
  }
  await dbConnect();
  await Setting.findOneAndUpdate({ key: 'UPI_ID' }, { value: newUpi }, { upsert: true });
  ctx.reply(`✅ UPI ID updated globally to: \`${newUpi}\``, { parse_mode: 'Markdown' });
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
    `📂 *Category Management:*\n` +
    `   /categories — View all categories\n` +
    `   /addcategory — Add new category\n` +
    `   /deletecategory — Delete a category\n\n` +
    `📦 *Product Management:*\n` +
    `   /addproduct — Add product (shows guide)\n` +
    `   /listproducts — View all products\n` +
    `   /coupons — View active coupons\n` +
    `   /editproduct — Edit product field\n` +
    `   /deleteproduct — Soft delete product\n` +
    `   /toggleproduct — Enable/disable product\n\n` +
    `📢 *Communication:*\n` +
    `   /broadcast — Message all users\n` +
    `   /setqr — Update QR code image\n` +
    `   /setupi — Update UPI ID`
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
      if (!order || !['pending', 'checkout'].includes(order.status)) {
        return ctx.reply("❌ Order not found or already processed. /start to try again.");
      }

      const product = order.product;
      const enteredCode = txt.toUpperCase();

      if (!product.couponCode || product.couponCode.toUpperCase() !== enteredCode) {
        await ctx.replyWithMarkdown("❌ *Invalid coupon code!*\nTry typing it again, or click **💳 Proceed to Pay** below to continue without a discount.");
        await sendCheckoutSummary(ctx, product, order);
        return;
      }

      const discount = product.couponDiscount;
      const discountedAmount = Math.round(product.price - (product.price * discount / 100));

      order.amount = discountedAmount;
      order.originalAmount = product.price;
      order.couponApplied = enteredCode;
      order.status = 'pending'; // Reset state so they must click Proceed to Pay again
      await order.save();

      await ctx.replyWithMarkdown(
        `✅ *Coupon Applied!*\n\n` +
        `🎟️ Code: \`${enteredCode}\` — *${discount}% OFF*\n` +
        `~~₹${product.price}~~ → *₹${discountedAmount}*\n\n` +
        `💰 *You save ₹${product.price - discountedAmount}!*`
      );

      await sendCheckoutSummary(ctx, product, order);
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
