const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  payoutId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Host ID is required'],
    index: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: [true, 'Event ID is required'],
    index: true
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'KES',
    enum: ['KES', 'USD', 'EUR']
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  method: {
    type: String,
    enum: ['bank_transfer', 'mpesa', 'paypal'],
    default: 'bank_transfer'
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    branchCode: String
  },
  transactionId: {
    type: String,
    sparse: true
  },
  receiptUrl: {
    type: String
  },
  releasedAt: {
    type: Date,
    index: true
  },
  completedAt: Date,
  failedAt: Date,
  failureReason: String,
  metadata: {
    ticketSales: Number,
    platformFee: Number,
    processingFee: Number,
    netAmount: Number,
    taxAmount: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
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
payoutSchema.index({ payoutId: 1 });
payoutSchema.index({ hostId: 1, status: 1 });
payoutSchema.index({ eventId: 1 });
payoutSchema.index({ status: 1, releasedAt: 1 });
payoutSchema.index({ releasedAt: 1 });

// Removed virtuals that cause circular dependencies
// payoutSchema.virtual('host', {
//   ref: 'User',
//   localField: 'hostId',
//   foreignField: '_id',
//   justOne: true
// });

// payoutSchema.virtual('event', {
//   ref: 'Event',
//   localField: 'eventId',
//   foreignField: '_id',
//   justOne: true
// });

// Pre-save middleware to generate payout ID
payoutSchema.pre('save', function(next) {
  if (this.isNew && !this.payoutId) {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    this.payoutId = `PYT-${timestamp}-${random}`;
  }
  next();
});

// Instance methods
payoutSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  return this.save();
};

payoutSchema.methods.markAsCompleted = function(transactionId, receiptUrl) {
  this.status = 'completed';
  this.transactionId = transactionId;
  this.receiptUrl = receiptUrl;
  this.completedAt = new Date();
  return this.save();
};

payoutSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  this.failedAt = new Date();
  return this.save();
};

payoutSchema.methods.scheduleRelease = function() {
  this.releasedAt = new Date();
  return this.save();
};

// Static method for pagination
payoutSchema.statics.paginate = function(query, options) {
  const page = options.page || 1;
  const limit = options.limit || 10;
  const skip = (page - 1) * limit;
  
  return this.find(query)
    .skip(skip)
    .limit(limit)
    .sort(options.sort || { createdAt: -1 })
    .populate(options.populate || '')
    .exec()
    .then(docs => {
      return this.countDocuments(query).then(total => ({
        docs,
        totalDocs: total,
        totalPages: Math.ceil(total / limit),
        page,
        limit,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }));
    });
};

const Payout = mongoose.model('Payout', payoutSchema);

module.exports = Payout;