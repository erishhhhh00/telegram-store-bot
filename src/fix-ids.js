require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const Product = require('./models/Product');

async function fixIds() {
  await mongoose.connect(config.MONGODB_URI);
  
  const products = await Product.find({ productId: { $exists: false } });
  let fixed = 0;
  for (let p of products) {
    let uniqueId;
    let isUnique = false;
    while (!isUnique) {
      uniqueId = Math.floor(1000 + Math.random() * 9000).toString();
      const existing = await Product.findOne({ productId: uniqueId });
      if (!existing) isUnique = true;
    }
    p.productId = uniqueId;
    await p.save();
    fixed++;
  }
  
  console.log(`✅ Assigned 4-digit IDs to ${fixed} existing products!`);
  await mongoose.disconnect();
}

fixIds().catch(console.error);
