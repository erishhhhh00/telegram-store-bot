# Pro Telegram Digital Store Bot

Welcome to your Pro-Level Telegram Bot! This bot is designed to run 24/7 for **FREE** on Vercel and MongoDB Atlas.

## Features
- **Manual QR Payment Flow**: No payment gateway needed. Users send a screenshot, you approve tracking easily.
- **Admin Panel inside Telegram**: Inline buttons to Approve/Reject payments. Command `/addproduct` to add new courses directly from chat.
- **Serverless Ready**: Built to be completely serverless on Vercel.

---

## 🚀 How to Deploy (Step by Step)

### Step 1: Push to GitHub
1. Create a new repository on GitHub.
2. Upload all the files in this folder (`telegram-store-bot`) to your GitHub repo.

### Step 2: Set up MongoDB Atlas (Free)
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a free account.
2. Create a Free Cluster.
3. Under "Database Access", create a Database User with a password.
4. Under "Network Access", add IP address `0.0.0.0/0` (allow from anywhere).
5. Click "Connect" -> "Drivers" -> Copy the **Connection String** (`mongodb+srv://...`).

### Step 3: Deploy on Vercel (Free)
1. Go to [Vercel](https://vercel.com/) and login with GitHub.
2. Click **Add New Project** and import your GitHub repository.
3. Before clicking Deploy, expand the **Environment Variables** section and add the following keys:
   - `BOT_TOKEN`: (Get this from [@BotFather](https://t.me/botfather) on Telegram)
   - `MONGODB_URI`: (Your MongoDB Connection string from Step 2)
   - `ADMIN_USER_ID`: (Your personal Telegram ID. Find it via [@userinfobot](https://t.me/userinfobot))
   - `WEBHOOK_DOMAIN`: (Leave empty for now, we will add it later)
   - `UPI_ID`: (Your UPI ID, e.g., `yourname@ybl`)
   - `UPI_QR_URL`: (Direct link to your QR code image)
4. Click **Deploy**.

### Step 4: Set the Webhook
Once Vercel gives you your domain (e.g., `https://my-store.vercel.app`), you must connect Telegram to Vercel:
1. Open your browser and paste this URL (replace variables):
`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>/api/webhook`
2. You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.

## 🛠 Admin Commands (Send directly in Bot)
- `/addproduct Title | Description | Price | Type | DeliveryLink`
- `/broadcast Your Message`
- `/setqr https://link-to-your-new-qr.png`
- `/helpadmin`

Enjoy your new automated business! 🎉
