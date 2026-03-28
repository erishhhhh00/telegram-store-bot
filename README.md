# Pro Telegram Digital Store Bot

Welcome to your Pro-Level Telegram Bot! This bot is designed to run 24/7 for **FREE** on Vercel and MongoDB Atlas.

## Features
- **🖼️ Premium Product Cards**: Rich product listings with images, categories, and formatted UI
- **💳 Manual QR Payment Flow**: Users send payment screenshot, admin approves via inline buttons
- **🎟️ Coupon Code System**: Add discount coupons to products, users apply at checkout
- **📊 Admin Dashboard**: Real-time stats — users, orders, revenue
- **📂 Categories & Search**: Browse by category or search by keyword
- **📦 Order Tracking**: Full order history with status badges
- **🔄 Refund System**: Users request refunds, admin approves/rejects
- **🔔 Smart Notifications**: New user alerts to admin
- **🛠️ Product Management**: Add, edit, delete, toggle products via commands
- **☁️ Serverless Ready**: Built for Vercel deployment

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
3. Before clicking Deploy, expand the **Environment Variables** section and add:
   - `BOT_TOKEN`: (Get from [@BotFather](https://t.me/botfather))
   - `MONGODB_URI`: (Connection string from Step 2)
   - `ADMIN_USER_ID`: (Your Telegram ID from [@userinfobot](https://t.me/userinfobot))
   - `WEBHOOK_DOMAIN`: (Leave empty, add after deploy)
   - `UPI_ID`: (Your UPI ID, e.g., `yourname@ybl`)
   - `UPI_QR_URL`: (Direct link to your QR code image)
4. Click **Deploy**.

### Step 4: Set the Webhook
Once Vercel gives you your domain (e.g., `https://my-store.vercel.app`):
1. Open browser and paste:
`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>/api/webhook`
2. You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.

---

## 🛠 Admin Commands

### Dashboard & Stats
- `/dashboard` — View users, orders, revenue stats
- `/helpadmin` — Show all admin commands

### Product Management
- `/addproduct Title | Desc | Price | Type | Link`
- Full format: `/addproduct Title | Desc | Price | Type | Link | ImageURL | Category | CouponCode | Discount%`
- Example: `/addproduct Java Course | Complete Java | 900 | course | https://link.com | https://img.com/java.jpg | Programming | JAVA20 | 20`
- `/listproducts` — View all products with IDs
- `/editproduct ID | field | new value` — Edit a product field
- `/deleteproduct ID` — Soft delete (deactivate)
- `/toggleproduct ID` — Enable/disable product

### Communication
- `/broadcast Your Message` — Send to all users
- `/setqr https://link-to-your-new-qr.png` — Update QR code

---

## 👤 User Commands
- `/start` — Main menu
- `/search keyword` — Search products
- `/myorders` — View order history

Enjoy your new automated business! 🎉
