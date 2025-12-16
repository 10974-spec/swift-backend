const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  buyerName: {
    type: String,
    required: [true, 'Buyer name is required'],
    trim: true
  },
  buyerEmail: {
    type: String,
    required: [true, 'Buyer email is required'],
    lowercase: true,
    trim: true
  },
  buyerPhone: {
    type: String,
    required: [true, 'Buyer phone is required']
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: [true, 'Event ID is required'],
    index: true
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tickets: [{
    tierName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  processingFee: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  hostAmount: {
    type: Number,
    required: true,
    min: 0
  },
  platformAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'card', 'cash'],
    default: 'mpesa'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  mpesaReference: {
    type: String,
    sparse: true
  },
  checkoutRequestId: {
    type: String,
    sparse: true
  },
  paymentDate: Date,
  ticketStatus: {
    type: String,
    enum: ['pending', 'generated', 'sent', 'error'],
    default: 'pending'
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  notes: String,
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceType: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ buyerEmail: 1 });
orderSchema.index({ buyerPhone: 1 });
orderSchema.index({ eventId: 1, paymentStatus: 1 });
orderSchema.index({ hostId: 1, paymentStatus: 1 });
orderSchema.index({ paymentStatus: 1, createdAt: 1 });
orderSchema.index({ mpesaReference: 1 });

// Virtual for ticket documents (commented out to avoid circular dependency)
// orderSchema.virtual('ticketDocuments', {
//   ref: 'Ticket',
//   localField: '_id',
//   foreignField: 'orderId',
//   justOne: false
// });

// Pre-save middleware to generate order number
orderSchema.pre('save', function(next) {
  if (this.isNew && !this.orderNumber) {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    this.orderNumber = `ORD-${timestamp}-${random}`;
  }
  
  if (this.isModified('tickets')) {
    this.subtotal = this.tickets.reduce((sum, ticket) => sum + ticket.totalPrice, 0);
    this.platformFee = this.subtotal * 0.05; // 5% platform fee
    this.processingFee = this.subtotal * 0.02; // 2% processing fee
    this.totalAmount = this.subtotal + this.processingFee;
    this.hostAmount = this.subtotal * 0.95; // Host gets 95%
    this.platformAmount = this.subtotal * 0.05; // Platform gets 5%
  }
  
  next();
});

// Instance methods
orderSchema.methods.markAsPaid = function(mpesaReference, checkoutRequestId) {
  this.paymentStatus = 'completed';
  this.mpesaReference = mpesaReference;
  this.checkoutRequestId = checkoutRequestId;
  this.paymentDate = new Date();
  return this.save();
};

orderSchema.methods.markAsFailed = function() {
  this.paymentStatus = 'failed';
  return this.save();
};

orderSchema.methods.markTicketsGenerated = function() {
  this.ticketStatus = 'generated';
  return this.save();
};

orderSchema.methods.markEmailSent = function() {
  this.emailSent = true;
  return this.save();
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;