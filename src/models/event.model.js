const mongoose = require('mongoose');
const slugify = require('slugify');

const eventSchema = new mongoose.Schema({
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Host ID is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'Event name is required'],
    trim: true,
    minlength: [3, 'Event name must be at least 3 characters'],
    maxlength: [200, 'Event name cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  bannerUrl: {
    type: String,
    required: [true, 'Event banner is required'],
    default: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80'
  },
  about: {
    type: String,
    required: [true, 'About text is required'],
    minlength: [50, 'About text must be at least 50 characters'],
    maxlength: [5000, 'About text cannot exceed 5000 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: [
      'concert', 'conference', 'workshop', 'festival', 'sports',
      'theater', 'exhibition', 'networking', 'party', 'other'
    ]
  },
  performers: [{
    name: {
      type: String,
      required: true
    },
    occupation: {
      type: String,
      required: true
    },
    imageUrl: String,
    description: String
  }],
  tiers: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative']
    },
    quantityAvailable: {
      type: Number,
      required: true,
      min: [1, 'At least 1 ticket must be available'],
      max: [100000, 'Maximum 100,000 tickets per tier']
    },
    quantitySold: {
      type: Number,
      default: 0
    },
    description: String,
    benefits: [String]
  }],
  location: {
    venueName: {
      type: String,
      required: [true, 'Venue name is required']
    },
    address: String,
    city: String,
    country: {
      type: String,
      default: 'Kenya'
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
      }
    },
    mapsUrl: String
  },
  eventDateTime: {
    type: Date,
    required: [true, 'Event date and time is required']
  },
  duration: {
    type: Number, // in minutes
    default: 120,
    min: [30, 'Event must be at least 30 minutes'],
    max: [1440, 'Event cannot exceed 24 hours']
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled', 'completed'],
    default: 'draft'
  },
  publishedAt: Date,
  totalTickets: {
    type: Number,
    default: 0
  },
  ticketsSold: {
    type: Number,
    default: 0
  },
  revenue: {
    type: Number,
    default: 0
  },
  platformFeePercent: {
    type: Number,
    default: 5,
    min: 0,
    max: 100
  },
  processingFeePercent: {
    type: Number,
    default: 2,
    min: 0,
    max: 100
  },
  metadata: {
    views: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    },
    likes: {
      type: Number,
      default: 0
    }
  },
  payoutProcessed: {
    type: Boolean,
    default: false
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
eventSchema.index({ slug: 1 });
eventSchema.index({ hostId: 1, status: 1 });
eventSchema.index({ category: 1, status: 1 });
eventSchema.index({ eventDateTime: 1, status: 1 });
eventSchema.index({ 'location.coordinates': '2dsphere' });
eventSchema.index({ status: 1, publishedAt: 1 });

// Virtual for calculating available tickets
eventSchema.virtual('availableTickets').get(function() {
  return this.totalTickets - this.ticketsSold;
});

// Pre-save middleware to generate slug
eventSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    }) + '-' + Math.random().toString(36).substr(2, 9);
  }
  next();
});

// Pre-save middleware to calculate total tickets
eventSchema.pre('save', function(next) {
  if (this.isModified('tiers')) {
    this.totalTickets = this.tiers.reduce((sum, tier) => sum + tier.quantityAvailable, 0);
  }
  next();
});

// Instance methods
eventSchema.methods.incrementViews = function() {
  this.metadata.views += 1;
  return this.save();
};

eventSchema.methods.reserveTickets = async function(tierName, quantity) {
  const tier = this.tiers.find(t => t.name === tierName);
  
  if (!tier) {
    throw new Error(`Tier "${tierName}" not found`);
  }
  
  const available = tier.quantityAvailable - tier.quantitySold;
  if (available < quantity) {
    throw new Error(`Only ${available} tickets available in tier "${tierName}"`);
  }
  
  tier.quantitySold += quantity;
  this.ticketsSold += quantity;
  
  await this.save();
  return this;
};

eventSchema.methods.releaseTickets = async function(tierName, quantity) {
  const tier = this.tiers.find(t => t.name === tierName);
  
  if (!tier) {
    throw new Error(`Tier "${tierName}" not found`);
  }
  
  tier.quantitySold = Math.max(0, tier.quantitySold - quantity);
  this.ticketsSold = Math.max(0, this.ticketsSold - quantity);
  
  await this.save();
  return this;
};

eventSchema.methods.publish = function() {
  if (this.status !== 'draft') {
    throw new Error('Only draft events can be published');
  }
  
  this.status = 'published';
  this.publishedAt = new Date();
  return this.save();
};

eventSchema.methods.cancel = function() {
  if (this.status === 'cancelled') {
    throw new Error('Event is already cancelled');
  }
  
  this.status = 'cancelled';
  return this.save();
};

// Static method for pagination
eventSchema.statics.paginate = function(query, options) {
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

const Event = mongoose.model('Event', eventSchema);

module.exports = Event;