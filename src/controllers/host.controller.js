const User = require('../models/user.model');
const Event = require('../models/event.model');
const Payout = require('../models/payout.model');
const Order = require('../models/order.model');
const { AppError, catchAsync } = require('../middlewares/error.middleware');

const hostController = {
  // Get host dashboard stats
  getDashboardStats: catchAsync(async (req, res) => {
    const hostId = req.userId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all events
    const events = await Event.find({ hostId });
    
    // Get completed orders
    const orders = await Order.find({
      hostId,
      paymentStatus: 'completed',
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Get recent payouts
    const payouts = await Payout.find({
      hostId,
      status: 'completed'
    }).sort({ completedAt: -1 }).limit(5);

    // Calculate stats
    const stats = {
      totalEvents: events.length,
      activeEvents: events.filter(e => e.status === 'published').length,
      totalRevenue: orders.reduce((sum, order) => sum + order.hostAmount, 0),
      totalTicketsSold: orders.reduce((sum, order) => {
        return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
      }, 0),
      totalPayouts: payouts.reduce((sum, payout) => sum + payout.amount, 0),
      upcomingEvents: events.filter(e => 
        e.status === 'published' && 
        new Date(e.eventDateTime) > new Date()
      ).length
    };

    // Get recent activity
    const recentActivity = [
      ...events.map(e => ({
        type: 'event',
        action: e.status === 'draft' ? 'created' : 'published',
        title: e.name,
        date: e.status === 'published' ? e.publishedAt : e.createdAt,
        status: e.status
      })),
      ...orders.map(o => ({
        type: 'order',
        action: 'purchase',
        title: `${o.tickets.length} ticket${o.tickets.length > 1 ? 's' : ''} sold`,
        date: o.paymentDate || o.createdAt,
        amount: o.totalAmount
      })),
      ...payouts.map(p => ({
        type: 'payout',
        action: 'processed',
        title: `Payout for event`,
        date: p.completedAt,
        amount: p.amount
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    res.status(200).json({
      status: 'success',
      data: {
        stats,
        recentActivity,
        upcomingEvents: events
          .filter(e => e.status === 'published' && new Date(e.eventDateTime) > new Date())
          .sort((a, b) => new Date(a.eventDateTime) - new Date(b.eventDateTime))
          .slice(0, 5)
          .map(e => ({
            id: e._id,
            name: e.name,
            date: e.eventDateTime,
            ticketsSold: e.ticketsSold,
            totalTickets: e.totalTickets
          }))
      }
    });
  }),

  // Get host events with pagination
  getHostEvents: catchAsync(async (req, res) => {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { hostId: req.userId };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const events = await Event.paginate(query, options);

    // Add stats to each event
    const eventsWithStats = await Promise.all(events.docs.map(async (event) => {
      const eventOrders = await Order.find({ 
        eventId: event._id, 
        paymentStatus: 'completed' 
      });
      
      const revenue = eventOrders.reduce((sum, order) => sum + order.hostAmount, 0);
      const ticketsSold = eventOrders.reduce((sum, order) => {
        return sum + order.tickets.reduce((ticketSum, ticket) => ticketSum + ticket.quantity, 0);
      }, 0);

      return {
        ...event.toObject(),
        stats: {
          revenue,
          ticketsSold,
          orders: eventOrders.length
        }
      };
    }));

    res.status(200).json({
      status: 'success',
      data: {
        events: eventsWithStats,
        pagination: {
          total: events.totalDocs,
          pages: events.totalPages,
          page: events.page,
          limit: events.limit,
          hasNext: events.hasNextPage,
          hasPrev: events.hasPrevPage
        }
      }
    });
  }),

  // Get host payouts
  getHostPayouts: catchAsync(async (req, res) => {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { hostId: req.userId };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const payouts = await Payout.paginate(query, options);

    // Calculate totals
    const totalPayouts = payouts.docs.reduce((sum, payout) => sum + payout.amount, 0);
    const pendingPayouts = payouts.docs
      .filter(p => p.status === 'pending')
      .reduce((sum, payout) => sum + payout.amount, 0);

    res.status(200).json({
      status: 'success',
      data: {
        payouts: payouts.docs,
        summary: {
          totalPayouts,
          pendingPayouts,
          completedPayouts: totalPayouts - pendingPayouts
        },
        pagination: {
          total: payouts.totalDocs,
          pages: payouts.totalPages,
          page: payouts.page,
          limit: payouts.limit,
          hasNext: payouts.hasNextPage,
          hasPrev: payouts.hasPrevPage
        }
      }
    });
  }),

  // Update bank details
  updateBankDetails: catchAsync(async (req, res) => {
    const { bankName, accountNumber, accountName, branchCode } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.bankDetails = {
      bankName,
      accountNumber,
      accountName,
      branchCode
    };

    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Bank details updated successfully',
      data: {
        bankDetails: user.bankDetails
      }
    });
  }),

  // Get host profile
  getHostProfile: catchAsync(async (req, res) => {
    const user = await User.findById(req.userId)
      .select('-passwordHash -refreshTokens');

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get recent events
    const recentEvents = await Event.find({ hostId: req.userId })
      .select('name status eventDateTime ticketsSold')
      .sort({ createdAt: -1 })
      .limit(5);

    // Calculate total revenue from completed events
    const events = await Event.find({ hostId: req.userId });
    let totalRevenue = 0;
    let totalTicketsSold = 0;

    for (const event of events) {
      const orders = await Order.find({ 
        eventId: event._id, 
        paymentStatus: 'completed' 
      });
      
      totalRevenue += orders.reduce((sum, order) => sum + order.hostAmount, 0);
      totalTicketsSold += event.ticketsSold;
    }

    res.status(200).json({
      status: 'success',
      data: {
        user,
        recentEvents,
        stats: {
          totalRevenue,
          totalEvents: events.length,
          totalTicketsSold
        }
      }
    });
  }),

  // Update host profile
  updateHostProfile: catchAsync(async (req, res) => {
    const updates = req.body;
    const allowedUpdates = ['name', 'phone', 'companyName', 'profileImage'];
    
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
      message: 'Profile updated successfully',
      data: { user }
    });
  })
};

module.exports = hostController;