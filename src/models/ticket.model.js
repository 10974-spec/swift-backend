const mongoose = require('mongoose');
const crypto = require('crypto');

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: [true, 'Order ID is required'],
    index: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: [true, 'Event ID is required'],
    index: true
  },
  buyerName: {
    type: String,
    required: true
  },
  buyerEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  buyerPhone: {
    type: String,
    required: true
  },
  tierName: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  qrCodeId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  qrCodeData: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['not_active', 'valid', 'already_used', 'invalid', 'cancelled'],
    default: 'not_active'
  },
  activationTime: {
    type: Date
  },
  scannedAt: Date,
  scannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pdfUrl: {
    type: String,
    required: true
  },
  pngUrl: {
    type: String,
    required: true
  },
  pokemonImageUrl: {
    type: String,
    required: true
  },
  backgroundColor: {
    type: String,
    required: true
  },
  metadata: {
    generatedAt: Date,
    sentAt: Date,
    downloadCount: {
      type: Number,
      default: 0
    }
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
ticketSchema.index({ ticketId: 1 });
ticketSchema.index({ qrCodeId: 1 });
ticketSchema.index({ orderId: 1, eventId: 1 });
ticketSchema.index({ eventId: 1, status: 1 });
ticketSchema.index({ buyerEmail: 1 });
ticketSchema.index({ status: 1, activationTime: 1 });
ticketSchema.index({ qrCodeData: 1 });

// Removed virtuals that cause circular dependencies
// ticketSchema.virtual('event', {
//   ref: 'Event',
//   localField: 'eventId',
//   foreignField: '_id',
//   justOne: true
// });

// ticketSchema.virtual('order', {
//   ref: 'Order',
//   localField: 'orderId',
//   foreignField: '_id',
//   justOne: true
// });

// Pre-save middleware to generate IDs
ticketSchema.pre('save', function(next) {
  if (this.isNew) {
    if (!this.ticketId) {
      this.ticketId = `TKT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }
    if (!this.qrCodeId) {
      this.qrCodeId = `QR-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    }
    if (!this.qrCodeData) {
      this.qrCodeData = JSON.stringify({
        ticketId: this.ticketId,
        qrCodeId: this.qrCodeId,
        eventId: this.eventId.toString(),
        timestamp: Date.now()
      });
    }
    this.metadata.generatedAt = new Date();
  }
  
  next();
});

// Instance methods
ticketSchema.methods.activate = async function() {
  if (this.status !== 'not_active') {
    throw new Error(`Ticket cannot be activated. Current status: ${this.status}`);
  }
  
  this.status = 'valid';
  return this.save();
};

ticketSchema.methods.scan = async function(scannerId) {
  if (this.status !== 'valid') {
    throw new Error(`Ticket cannot be scanned. Current status: ${this.status}`);
  }
  
  this.status = 'already_used';
  this.scannedAt = new Date();
  this.scannedBy = scannerId;
  return this.save();
};

ticketSchema.methods.isActive = async function() {
  if (this.status !== 'valid') return false;
  
  // Fetch event to check activation time
  const Event = mongoose.model('Event');
  const event = await Event.findById(this.eventId);
  
  if (!event) return false;
  
  const eventTime = new Date(event.eventDateTime);
  const activationTime = new Date(eventTime.getTime() - (4 * 60 * 60 * 1000));
  
  return new Date() >= activationTime;
};

ticketSchema.methods.incrementDownloadCount = function() {
  this.metadata.downloadCount += 1;
  return this.save();
};

ticketSchema.methods.getTicketUrl = function() {
  return `${process.env.APP_URL || 'http://localhost:5000'}/tickets/${this.ticketId}`;
};

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = Ticket;