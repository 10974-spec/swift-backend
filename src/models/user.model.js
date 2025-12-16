const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  passwordHash: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^\+?[\d\s-]{10,}$/, 'Please provide a valid phone number']
  },
  idNumber: {
    type: String,
    required: [true, 'ID number is required'],
    unique: true
  },
  bankDetails: {
    bankName: {
      type: String,
      required: [true, 'Bank name is required']
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required']
    },
    accountName: {
      type: String,
      required: [true, 'Account name is required']
    },
    branchCode: String
  },
  companyName: {
    type: String,
    default: ''
  },
  role: {
    type: String,
    enum: ['host', 'admin'],
    default: 'host'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  profileImage: {
    type: String,
    default: ''
  },
  googleId: {
    type: String,
    sparse: true,
    unique: true
  },
  facebookId: {
    type: String,
    sparse: true,
    unique: true
  },
  refreshTokens: [{
    token: String,
    expiresAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastLogin: Date,
  status: {
    type: String,
    enum: ['active', 'suspended', 'deleted'],
    default: 'active'
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
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ idNumber: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ facebookId: 1 });
userSchema.index({ status: 1 });

// Removed virtuals that cause circular dependencies
// userSchema.virtual('events', {
//   ref: 'Event',
//   localField: '_id',
//   foreignField: 'hostId',
//   justOne: false
// });

// userSchema.virtual('payouts', {
//   ref: 'Payout',
//   localField: '_id',
//   foreignField: 'hostId',
//   justOne: false
// });

// Pre-save middleware
userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.methods.addRefreshToken = function(token, expiresAt) {
  this.refreshTokens.push({ token, expiresAt });
  return this.save();
};

userSchema.methods.removeRefreshToken = function(token) {
  this.refreshTokens = this.refreshTokens.filter(rt => rt.token !== token);
  return this.save();
};

userSchema.methods.clearExpiredTokens = function() {
  const now = new Date();
  this.refreshTokens = this.refreshTokens.filter(rt => rt.expiresAt > now);
  return this.save();
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email, status: 'active' });
};

userSchema.statics.findByGoogleId = function(googleId) {
  return this.findOne({ googleId, status: 'active' });
};

userSchema.statics.findByFacebookId = function(facebookId) {
  return this.findOne({ facebookId, status: 'active' });
};

// Static method for pagination
userSchema.statics.paginate = function(query, options) {
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

const User = mongoose.model('User', userSchema);

module.exports = User;