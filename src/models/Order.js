const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  telegramId: { type: String, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  screenshotId: { type: String }, // Telegram File ID for the proof
  amount: { type: Number, required: true },
  originalAmount: { type: Number }, // Price before coupon discount
  couponApplied: { type: String, default: '' }, // Coupon code that was used
  refundStatus: { type: String, enum: ['none', 'requested', 'approved', 'rejected'], default: 'none' },
  refundReason: { type: String, default: '' },
  paymentMethod: { type: String, enum: ['qr', 'cashfree'], default: 'qr' }
}, { timestamps: true });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
