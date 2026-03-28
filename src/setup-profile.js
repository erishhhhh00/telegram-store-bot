/**
 * Run this script ONCE to set your bot's description, short description,
 * and command menu via the Telegram Bot API.
 * 
 * Usage: node src/setup-profile.js
 */

require('dotenv').config();
const config = require('./config');

const BOT_TOKEN = config.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing! Set it in .env file.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Bot Description (shown when user opens bot for the first time / clicks "What can this bot do?") ───
const DESCRIPTION =
  `🏪 EeTech4u Store — India's #1 Digital Products Store on Telegram!\n\n` +
  `✅ Verified & Trusted Since 2024\n` +
  `⚡ Instant Delivery After Payment\n` +
  `💰 Best Prices on Courses, APKs & Data Files\n` +
  `🎟️ Coupon Discounts Available\n` +
  `🔒 100% Secure UPI Payments\n` +
  `📦 1000+ Happy Customers\n\n` +
  `Hit /start to begin shopping! 🛒`;

// ─── Short Description (shown in bot profile card & search results) ───
const SHORT_DESCRIPTION =
  `🏪 India's Best Digital Store — Courses, APKs & More | ⚡ Instant Delivery | 💰 Best Prices | 🎟️ Coupons | 🔒 Secure UPI Pay`;

// ─── Bot Command Menu ───
const COMMANDS = [
  { command: "start", description: "🏪 Open Store — Main Menu" },
  { command: "search", description: "🔍 Search Products by Name" },
  { command: "myorders", description: "📦 View My Orders & Downloads" }
];

async function callAPI(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function setup() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🤖 Setting up Bot Profile...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. Set Description
  const descResult = await callAPI('setMyDescription', { description: DESCRIPTION });
  if (descResult.ok) {
    console.log("✅ Bot Description set successfully!");
  } else {
    console.log("❌ Failed to set description:", descResult.description);
  }

  // 2. Set Short Description
  const shortResult = await callAPI('setMyShortDescription', { short_description: SHORT_DESCRIPTION });
  if (shortResult.ok) {
    console.log("✅ Bot Short Description set successfully!");
  } else {
    console.log("❌ Failed to set short description:", shortResult.description);
  }

  // 3. Set Commands Menu
  const cmdResult = await callAPI('setMyCommands', { commands: COMMANDS });
  if (cmdResult.ok) {
    console.log("✅ Bot Command Menu set successfully!");
  } else {
    console.log("❌ Failed to set commands:", cmdResult.description);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 Done! Your bot profile is updated.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n📸 PROFILE PHOTO: You need to set this manually via @BotFather:");
  console.log("   1. Open @BotFather on Telegram");
  console.log("   2. Send /mybots → Select your bot");
  console.log("   3. Click 'Edit Bot' → 'Edit Botpic'");
  console.log("   4. Send the profile image generated for you");
  console.log("");
}

setup().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
