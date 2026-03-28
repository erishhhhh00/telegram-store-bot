/**
 * Seed Script — Add your own products here and run once.
 * Run: node src/seed-products.js
 * 
 * Categories: 📚 Courses, 📱 Modded APKs, 🎙️ PocketFM Episodes, 📝 Study Notes, 📊 B2B Data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const Product = require('./models/Product');

const products = [
  // Add your products here using this format:
  // {
  //   title: "Product Name",
  //   description: "Short description",
  //   price: 499,
  //   type: "course",        // course, data, or apk
  //   category: "📚 Courses", // must match one of the 6 categories
  //   deliveryLink: "https://your-link.com",
  //   imageUrl: "https://image-url.com/img.jpg",
  //   couponCode: "SAVE20",  // optional
  //   couponDiscount: 20     // optional, percentage
  // },
];

async function seed() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log("✅ MongoDB Connected\n");

    const result = await Product.insertMany(products);
    console.log(`🎉 Successfully added ${result.length} products!`);

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

seed();
