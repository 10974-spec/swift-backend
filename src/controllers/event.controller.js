const Event = require('../models/event.model');
const Order = require('../models/order.model');
const Ticket = require('../models/ticket.model');
const { AppError, catchAsync } = require('../middlewares/error.middleware');
const redisClient = require('../config/redis');
const { cloudinary, uploadSingle } = require('../config/cloudinary');

const eventController = {
  // Create event with file upload
  createEvent: [
    uploadSingle('eventBanner'),
    catchAsync(async (req, res) => {
      const {
        eventName,
        aboutText,
        category,
        performers = [],
        location,
        tiers,
        eventDate,
        eventTime,
        status = 'draft',
        bannerUrl: bodyBannerUrl
      } = req.body;

      // Parse performers if string
      let parsedPerformers = performers;
      if (typeof performers === 'string') {
        try {
          parsedPerformers = JSON.parse(performers);
        } catch (error) {
          parsedPerformers = [];
        }
      }

      // Parse location if string
      let parsedLocation = location;
      if (typeof location === 'string') {
        try {
          parsedLocation = JSON.parse(location);
        } catch (error) {
          throw new AppError('Invalid location format', 400);
        }
      }

      // Parse tiers if string
      let parsedTiers = tiers;
      if (typeof tiers === 'string') {
        try {
          parsedTiers = JSON.parse(tiers);
        } catch (error) {
          throw new AppError('Invalid tiers format', 400);
        }
      }

      // Transform tierName to name for Mongoose
      if (parsedTiers && parsedTiers.length > 0) {
        parsedTiers = parsedTiers.map(tier => ({
          name: tier.tierName || tier.name,
          price: tier.price,
          quantityAvailable: tier.quantityAvailable,
          description: tier.description || '',
          benefits: tier.benefits || []
        }));
      }

      // Combine date and time
      const eventDateTime = new Date(`${eventDate}T${eventTime}`);

      // Determine banner URL: file upload > body bannerUrl > default
      let finalBannerUrl = 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80';
      
      if (req.file) {
        finalBannerUrl = req.file.path; // Cloudinary URL
      } else if (bodyBannerUrl && bodyBannerUrl.trim() !== '') {
        finalBannerUrl = bodyBannerUrl; // From request body
      }

      // Create event
      const event = await Event.create({
        hostId: req.userId,
        name: eventName,
        about: aboutText,
        category,
        performers: parsedPerformers,
        tiers: parsedTiers,
        location: {
          venueName: parsedLocation.venueName,
          address: parsedLocation.address || '',
          city: parsedLocation.city || '',
          country: parsedLocation.country || 'Kenya',
          coordinates: {
            type: 'Point',
            coordinates: [parseFloat(parsedLocation.lng), parseFloat(parsedLocation.lat)]
          }
        },
        eventDateTime,
        status,
        bannerUrl: finalBannerUrl
      });

      res.status(201).json({
        status: 'success',
        message: 'Event created successfully',
        data: { event }
      });
    })
  ],

  // Create event with JSON only (no file upload)
  createEventJson: catchAsync(async (req, res) => {
    const {
      eventName,
      aboutText,
      category,
      performers = [],
      location,
      tiers,
      eventDate,
      eventTime,
      status = 'draft',
      bannerUrl
    } = req.body;

    // Parse performers if string
    let parsedPerformers = performers;
    if (typeof performers === 'string') {
      try {
        parsedPerformers = JSON.parse(performers);
      } catch (error) {
        parsedPerformers = [];
      }
    }

    // Parse location if string
    let parsedLocation = location;
    if (typeof location === 'string') {
      try {
        parsedLocation = JSON.parse(location);
      } catch (error) {
        throw new AppError('Invalid location format', 400);
      }
    }

    // Parse tiers if string
    let parsedTiers = tiers;
    if (typeof tiers === 'string') {
      try {
        parsedTiers = JSON.parse(tiers);
      } catch (error) {
        throw new AppError('Invalid tiers format', 400);
      }
    }

    // Transform tierName to name for Mongoose
    if (parsedTiers && parsedTiers.length > 0) {
      parsedTiers = parsedTiers.map(tier => ({
        name: tier.tierName || tier.name,
        price: tier.price,
        quantityAvailable: tier.quantityAvailable,
        description: tier.description || '',
        benefits: tier.benefits || []
      }));
    }

    // Combine date and time
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);

    // Create event
    const event = await Event.create({
      hostId: req.userId,
      name: eventName,
      about: aboutText,
      category,
      performers: parsedPerformers,
      tiers: parsedTiers,
      location: {
        venueName: parsedLocation.venueName,
        address: parsedLocation.address || '',
        city: parsedLocation.city || '',
        country: parsedLocation.country || 'Kenya',
        coordinates: {
          type: 'Point',
          coordinates: [parseFloat(parsedLocation.lng), parseFloat(parsedLocation.lat)]
        }
      },
      eventDateTime,
      status,
      bannerUrl: bannerUrl || 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80'
    });

    res.status(201).json({
      status: 'success',
      message: 'Event created successfully',
      data: { event }
    });
  }),

  // Publish event
  publishEvent: catchAsync(async (req, res) => {
    const { eventId } = req.params;

    const event = await Event.findOne({
      _id: eventId,
      hostId: req.userId
    });

    if (!event) {
      throw new AppError('Event not found or you are not the host', 404);
    }

    // Publish event
    await event.publish();

    // Clear cache for this event
    await redisClient.del(`event:${event.slug}`);

    res.status(200).json({
      status: 'success',
      message: 'Event published successfully',
      data: {
        event,
        publicUrl: `${process.env.APP_URL || 'http://localhost:3000'}/e/${event.slug}`
      }
    });
  }),

  // Get event by slug (public)
  getEventBySlug: catchAsync(async (req, res) => {
    const { slug } = req.params;

    // Try cache first
    const cacheKey = `event:${slug}`;
    const cachedEvent = await redisClient.get(cacheKey);

    if (cachedEvent) {
      // Increment views in background
      Event.findByIdAndUpdate(
        JSON.parse(cachedEvent)._id,
        { $inc: { 'metadata.views': 1 } }
      ).exec();

      return res.status(200).json({
        status: 'success',
        data: { event: JSON.parse(cachedEvent) },
        cached: true
      });
    }

    // Get from database
    const event = await Event.findOne({
      slug,
      status: { $in: ['published', 'completed'] }
    }).populate('hostId', 'name profileImage companyName');

    if (!event) {
      throw new AppError('Event not found', 404);
    }

    // Increment views
    await event.incrementViews();

    // Cache for 5 minutes
    await redisClient.set(cacheKey, JSON.stringify(event), { EX: 300 });

    res.status(200).json({
      status: 'success',
      data: { event }
    });
  }),

  // Get host events
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

    // Calculate stats for each event
    const eventsWithStats = await Promise.all(events.docs.map(async (event) => {
      // Get orders for this event
      const orders = await Order.find({ 
        eventId: event._id, 
        paymentStatus: 'completed' 
      });
      
      const stats = {
        totalRevenue: 0,
        totalTicketsSold: event.ticketsSold,
        totalOrders: orders.length
      };

      stats.totalRevenue = orders.reduce(
        (sum, order) => sum + order.totalAmount, 0
      );

      return {
        ...event.toObject(),
        stats
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

  // Update event
  updateEvent: [
    uploadSingle('eventBanner'),
    catchAsync(async (req, res) => {
      const { eventId } = req.params;
      const updates = req.body;

      // Find event
      const event = await Event.findOne({
        _id: eventId,
        hostId: req.userId,
        status: 'draft' // Only draft events can be updated
      });

      if (!event) {
        throw new AppError('Event not found or cannot be updated', 404);
      }

      // Parse JSON fields if needed
      if (updates.performers && typeof updates.performers === 'string') {
        try {
          updates.performers = JSON.parse(updates.performers);
        } catch (error) {
          throw new AppError('Invalid performers format', 400);
        }
      }

      if (updates.location && typeof updates.location === 'string') {
        try {
          updates.location = JSON.parse(updates.location);
        } catch (error) {
          throw new AppError('Invalid location format', 400);
        }
      }

      if (updates.tiers && typeof updates.tiers === 'string') {
        try {
          updates.tiers = JSON.parse(updates.tiers);
        } catch (error) {
          throw new AppError('Invalid tiers format', 400);
        }
      }

      // Transform tierName to name if provided
      if (updates.tiers && updates.tiers.length > 0) {
        updates.tiers = updates.tiers.map(tier => ({
          name: tier.tierName || tier.name,
          price: tier.price,
          quantityAvailable: tier.quantityAvailable,
          description: tier.description || '',
          benefits: tier.benefits || []
        }));
      }

      // Combine date and time if both provided
      if (updates.eventDate && updates.eventTime) {
        updates.eventDateTime = new Date(`${updates.eventDate}T${updates.eventTime}`);
        delete updates.eventDate;
        delete updates.eventTime;
      }

      // Update banner if provided
      if (req.file) {
        updates.bannerUrl = req.file.path;
      } else if (updates.bannerUrl && updates.bannerUrl.trim() !== '') {
        updates.bannerUrl = updates.bannerUrl;
      }

      // Update event
      Object.assign(event, updates);
      await event.save();

      // Clear cache
      await redisClient.del(`event:${event.slug}`);

      res.status(200).json({
        status: 'success',
        message: 'Event updated successfully',
        data: { event }
      });
    })
  ],

  // Delete event
  deleteEvent: catchAsync(async (req, res) => {
    const { eventId } = req.params;

    const event = await Event.findOne({
      _id: eventId,
      hostId: req.userId,
      status: 'draft'
    });

    if (!event) {
      throw new AppError('Event not found or cannot be deleted', 404);
    }

    // Check if there are any orders
    const orderCount = await Order.countDocuments({ eventId: event._id });
    if (orderCount > 0) {
      throw new AppError('Cannot delete event with existing orders', 400);
    }

    // Delete event
    await event.deleteOne();

    // Clear cache
    await redisClient.del(`event:${event.slug}`);

    res.status(200).json({
      status: 'success',
      message: 'Event deleted successfully'
    });
  }),

  // Get event analytics
  getEventAnalytics: catchAsync(async (req, res) => {
    const { eventId } = req.params;

    const event = await Event.findOne({
      _id: eventId,
      hostId: req.userId
    });

    if (!event) {
      throw new AppError('Event not found', 404);
    }

    // Get orders for this event
    const orders = await Order.find({ 
      eventId: event._id, 
      paymentStatus: 'completed' 
    });
    
    // Get tickets for this event
    const tickets = await Ticket.find({ eventId: event._id });

    const analytics = {
      event: {
        name: event.name,
        status: event.status,
        date: event.eventDateTime,
        venue: event.location.venueName
      },
      sales: {
        totalRevenue: orders.reduce((sum, order) => sum + order.totalAmount, 0),
        hostRevenue: orders.reduce((sum, order) => sum + order.hostAmount, 0),
        platformRevenue: orders.reduce((sum, order) => sum + order.platformAmount, 0),
        totalOrders: orders.length,
        totalTickets: tickets.length,
        ticketsSold: event.ticketsSold,
        ticketsAvailable: event.totalTickets - event.ticketsSold
      },
      ticketsByTier: {},
      timeline: {
        created: event.createdAt,
        published: event.publishedAt,
        eventDate: event.eventDateTime
      }
    };

    // Calculate tickets by tier
    event.tiers.forEach(tier => {
      const tierTickets = tickets.filter(t => t.tierName === tier.name);
      analytics.ticketsByTier[tier.name] = {
        available: tier.quantityAvailable,
        sold: tier.quantitySold,
        remaining: tier.quantityAvailable - tier.quantitySold,
        revenue: tierTickets.reduce((sum, t) => sum + t.price, 0)
      };
    });

    // Get recent orders
    const recentOrders = await Order.find({ eventId: event._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('orderNumber buyerName totalAmount paymentStatus createdAt');

    res.status(200).json({
      status: 'success',
      data: {
        analytics,
        recentOrders
      }
    });
  })
};

module.exports = eventController;