const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/user.model');
const redisClient = require('../config/redis');
const { AppError, catchAsync } = require('../middlewares/error.middleware');
const emailService = require('../config/email');

const authController = {
  // Register new host
  register: catchAsync(async (req, res) => {
    const { name, email, password, phone, idNumber, bankDetails, companyName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }, { idNumber }]
    });

    if (existingUser) {
      throw new AppError('User with this email, phone, or ID number already exists', 400);
    }

    // Create user
    const user = await User.create({
      name,
      email,
      passwordHash: password, // Will be hashed by pre-save middleware
      phone,
      idNumber,
      bankDetails,
      companyName,
      role: 'host'
    });

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id, user.role);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await user.addRefreshToken(refreshToken, expiresAt);

    // Remove password from response
    user.passwordHash = undefined;
    user.refreshTokens = undefined;

    // Send welcome email
    await sendWelcomeEmail(user);

    res.status(201).json({
      status: 'success',
      message: 'Registration successful',
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt
        }
      }
    });
  }),

  // Login
  login: catchAsync(async (req, res) => {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email }).select('+passwordHash');
    
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new AppError('Account is suspended or deleted', 403);
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id, user.role);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await user.addRefreshToken(refreshToken, expiresAt);

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Remove password from response
    user.passwordHash = undefined;
    user.refreshTokens = undefined;

    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt
        }
      }
    });
  }),

  // Google OAuth
  googleAuth: catchAsync(async (req, res) => {
    const { token } = req.body;

    // Verify Google token (simplified - in production, use google-auth-library)
    // For now, we'll assume the token is verified by the frontend
    const googleUser = {
      googleId: `google_${crypto.randomBytes(16).toString('hex')}`,
      email: 'user@example.com', // Extract from token in production
      name: 'Google User',
      picture: ''
    };

    // Check if user exists with this Google ID
    let user = await User.findOne({ googleId: googleUser.googleId });

    if (!user) {
      // Check if user exists with this email
      user = await User.findOne({ email: googleUser.email });

      if (user) {
        // Link Google account
        user.googleId = googleUser.googleId;
        await user.save();
      } else {
        // Create new user
        user = await User.create({
          name: googleUser.name,
          email: googleUser.email,
          passwordHash: crypto.randomBytes(32).toString('hex'), // Random password
          phone: '', // Required field - prompt user to complete profile
          idNumber: `GOOGLE_${googleUser.googleId}`,
          bankDetails: {
            bankName: 'To be added',
            accountNumber: 'To be added',
            accountName: googleUser.name
          },
          profileImage: googleUser.picture,
          googleId: googleUser.googleId,
          emailVerified: true,
          role: 'host'
        });
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id, user.role);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.addRefreshToken(refreshToken, expiresAt);

    // Remove sensitive data
    user.passwordHash = undefined;
    user.refreshTokens = undefined;

    res.status(200).json({
      status: 'success',
      message: 'Google authentication successful',
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt
        }
      }
    });
  }),

  // Facebook OAuth
  facebookAuth: catchAsync(async (req, res) => {
    const { token } = req.body;

    // Verify Facebook token (simplified)
    const facebookUser = {
      facebookId: `facebook_${crypto.randomBytes(16).toString('hex')}`,
      email: 'user@example.com',
      name: 'Facebook User',
      picture: ''
    };

    // Similar logic as Google OAuth
    let user = await User.findOne({ facebookId: facebookUser.facebookId });

    if (!user) {
      user = await User.findOne({ email: facebookUser.email });

      if (user) {
        user.facebookId = facebookUser.facebookId;
        await user.save();
      } else {
        user = await User.create({
          name: facebookUser.name,
          email: facebookUser.email,
          passwordHash: crypto.randomBytes(32).toString('hex'),
          phone: '',
          idNumber: `FACEBOOK_${facebookUser.facebookId}`,
          bankDetails: {
            bankName: 'To be added',
            accountNumber: 'To be added',
            accountName: facebookUser.name
          },
          profileImage: facebookUser.picture,
          facebookId: facebookUser.facebookId,
          emailVerified: true,
          role: 'host'
        });
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id, user.role);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.addRefreshToken(refreshToken, expiresAt);

    // Remove sensitive data
    user.passwordHash = undefined;
    user.refreshTokens = undefined;

    res.status(200).json({
      status: 'success',
      message: 'Facebook authentication successful',
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
          expiresAt
        }
      }
    });
  }),

  // Refresh token
  refreshToken: catchAsync(async (req, res) => {
    const { refreshToken: oldRefreshToken } = req.body;
    const { userId, userRole } = req;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(userId, userRole);
    const newRefreshToken = generateRefreshToken(userId, userRole);

    // Remove old refresh token
    await user.removeRefreshToken(oldRefreshToken);

    // Save new refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.addRefreshToken(newRefreshToken, expiresAt);

    // Blacklist old token
    await redisClient.set(
      `blacklist:${oldRefreshToken}`,
      '1',
      { EX: 7 * 24 * 60 * 60 } // 7 days
    );

    res.status(200).json({
      status: 'success',
      message: 'Token refreshed',
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt
        }
      }
    });
  }),

  // Logout
  logout: catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Find user and remove refresh token
      const user = await User.findOne({ 'refreshTokens.token': refreshToken });
      if (user) {
        await user.removeRefreshToken(refreshToken);
      }

      // Blacklist token
      await redisClient.set(
        `blacklist:${refreshToken}`,
        '1',
        { EX: 7 * 24 * 60 * 60 }
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully'
    });
  }),

  // Get current user
  getMe: catchAsync(async (req, res) => {
    const user = await User.findById(req.userId).select('-passwordHash -refreshTokens');
    
    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: { user }
    });
  }),

  // Update profile
  updateProfile: catchAsync(async (req, res) => {
    const updates = req.body;
    const allowedUpdates = ['name', 'phone', 'companyName', 'profileImage'];
    
    // Filter allowed updates
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.userId,
      filteredUpdates,
      { new: true, runValidators: true }
    ).select('-passwordHash -refreshTokens');

    res.status(200).json({
      status: 'success',
      message: 'Profile updated',
      data: { user }
    });
  })
};

// Helper functions
function generateAccessToken(userId, role) {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
}

function generateRefreshToken(userId, role) {
  return jwt.sign(
    { userId, role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
}

async function sendWelcomeEmail(user) {
  try {
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to SwiftPass</title>
        </head>
        <body>
          <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1>🎉 Welcome to SwiftPass!</h1>
              <p>Your journey as an event host begins now</p>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2>Hello ${user.name},</h2>
              <p>Thank you for joining SwiftPass! We're excited to have you on board.</p>
              
              <div style="background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea;">
                <h3>🚀 Get Started</h3>
                <p>Here's what you can do now:</p>
                <ul>
                  <li>Create your first event</li>
                  <li>Set up ticket tiers</li>
                  <li>Start selling tickets</li>
                  <li>Manage attendees</li>
                </ul>
              </div>
              
              <p>If you have any questions, our support team is here to help at support@swiftpass.app.</p>
              
              <p>Best regards,<br>The SwiftPass Team</p>
            </div>
            <div style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
              <p>© ${new Date().getFullYear()} SwiftPass. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await emailService.sendEmail(
      user.email,
      'Welcome to SwiftPass!',
      emailHtml
    );
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
}

module.exports = authController;