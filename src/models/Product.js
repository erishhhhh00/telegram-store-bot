const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true }, // Price in INR
  type: { type: String, enum: ['course', 'data', 'apk'], required: true },
  deliveryLink: { type: String, required: true }, // The hidden link given after purchase
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
