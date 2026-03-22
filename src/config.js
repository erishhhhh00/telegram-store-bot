module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  MONGODB_URI: process.env.MONGODB_URI || "",
  ADMIN_USER_ID: process.env.ADMIN_USER_ID || "",
  WEBHOOK_DOMAIN: process.env.WEBHOOK_DOMAIN || "", // e.g., https://my-bot.vercel.app
  UPI_ID: process.env.UPI_ID || "myupi@upi",
  UPI_QR_URL: process.env.UPI_QR_URL || "https://example.com/qr.png" 
};
