/**
 * Seeds the initial categories into MongoDB.
 * Run ONCE: node src/seed-categories.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./config');
const Category = require('./models/Category');

const categories = [
  { name: '📚 Courses' },
  { name: '📱 Modded APKs' },
  { name: '🎙️ PocketFM Episodes' },
  { name: '📝 Study Notes' },
  { name: '📊 B2B Data' }
];

async function seed() {
  await mongoose.connect(config.MONGODB_URI);
  await Category.deleteMany({});
  await Category.insertMany(categories);
  console.log(`✅ Seeded ${categories.length} categories!`);
  categories.forEach(c => console.log(`   ${c.name}`));
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
