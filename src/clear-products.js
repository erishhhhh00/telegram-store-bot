/**
 * Clears all products from the database.
 * Run: node src/clear-products.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const Product = require('./models/Product');

async function clear() {
  await mongoose.connect(config.MONGODB_URI);
  const count = await Product.countDocuments();
  await Product.deleteMany({});
  console.log(`🗑️  Deleted ${count} products. Database is now empty.`);
  await mongoose.disconnect();
}

clear().catch(err => { console.error(err); process.exit(1); });
