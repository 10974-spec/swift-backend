const Ticket = require('../models/ticket.model');
const Event = require('../models/event.model');
const { AppError, catchAsync } = require('../middlewares/error.middleware');
const redisClient = require('../config/redis');

const ticketController = {
  // Scan ticket QR code
  scanTicket: catchAsync(async (req, res) => {
    const { qrCodeId } = req.body;
    const scannerId = req.userId; // Assuming scanner is authenticated

    // Try cache first
    const cacheKey = `ticket:${qrCodeId}`;
    const cachedTicket = await redisClient.get(cacheKey);

    let ticket;

    if (cachedTicket) {
      ticket = JSON.parse(cachedTicket);
    } else {
      // Find ticket
      ticket = await Ticket.findOne({ qrCodeId })
        .populate('event', 'name eventDateTime location.venueName')
        .populate('order', 'orderNumber buyerName');

      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Cache for 5 minutes
      await redisClient.set(cacheKey, JSON.stringify(ticket), { EX: 300 });
    }

    // Check ticket status
    if (ticket.status === 'already_used') {
      return res.status(400).json({
        status: 'error',
        message: 'Ticket already used',
        data: {
          ticketId: ticket.ticketId,
          scannedAt: ticket.scannedAt,
          event: ticket.event?.name
        }
      });
    }

    if (ticket.status === 'invalid' || ticket.status === 'cancelled') {
      return res.status(400).json({
        status: 'error',
        message: `Ticket is ${ticket.status}`,
        data: {
          ticketId: ticket.ticketId,
          event: ticket.event?.name
        }
      });
    }

    if (ticket.status === 'not_active') {
      const now = new Date();
      const eventTime = new Date(ticket.event?.eventDateTime);
      const fourHoursBefore = new Date(eventTime.getTime() - 4 * 60 * 60 * 1000);

      if (now < fourHoursBefore) {
        return res.status(400).json({
          status: 'error',
          message: 'Ticket not yet active. Becomes valid 4 hours before event.',
          data: {
            ticketId: ticket.ticketId,
            activationTime: fourHoursBefore,
            currentTime: now
          }
        });
      }

      // Auto-activate if within valid time
      ticket.status = 'valid';
    }

    // Mark ticket as used
    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticket._id,
      {
        status: 'already_used',
        scannedAt: new Date(),
        scannedBy: scannerId
      },
      { new: true }
    ).populate('event', 'name location.venueName');

    // Update cache
    await redisClient.set(cacheKey, JSON.stringify(updatedTicket), { EX: 300 });

    // Log scan
    await redisClient.lPush(
      'scans:log',
      JSON.stringify({
        ticketId: ticket.ticketId,
        qrCodeId: ticket.qrCodeId,
        scannedAt: new Date().toISOString(),
        scannedBy: scannerId,
        eventId: ticket.event?._id,
        eventName: ticket.event?.name
      })
    );

    res.status(200).json({
      status: 'success',
      message: 'Ticket scanned successfully',
      data: {
        ticket: {
          ticketId: updatedTicket.ticketId,
          buyerName: updatedTicket.buyerName,
          tier: updatedTicket.tierName,
          event: updatedTicket.event?.name,
          venue: updatedTicket.event?.location?.venueName,
          scannedAt: updatedTicket.scannedAt,
          status: updatedTicket.status
        }
      }
    });
  }),

  // Get ticket by ID
  getTicketById: catchAsync(async (req, res) => {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ ticketId })
      .populate('event', 'name eventDateTime location bannerUrl')
      .populate('order', 'orderNumber');

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    // Check authorization
    const isOwner = ticket.buyerEmail === req.user?.email;
    const isEventHost = req.userRole === 'host' && 
                      (await Event.exists({ _id: ticket.eventId, hostId: req.userId }));

    if (!isOwner && !isEventHost && req.userRole !== 'admin') {
      throw new AppError('Unauthorized to view this ticket', 403);
    }

    // Increment download count
    await ticket.incrementDownloadCount();

    res.status(200).json({
      status: 'success',
      data: { ticket }
    });
  }),

  // Get tickets by order
  getTicketsByOrder: catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const tickets = await Ticket.find({ orderId })
      .populate('event', 'name eventDateTime location')
      .sort({ createdAt: 1 });

    if (!tickets || tickets.length === 0) {
      throw new AppError('No tickets found for this order', 404);
    }

    // Check authorization
    const firstTicket = tickets[0];
    const isOwner = firstTicket.buyerEmail === req.user?.email;
    const isEventHost = req.userRole === 'host' && 
                      (await Event.exists({ _id: firstTicket.eventId, hostId: req.userId }));

    if (!isOwner && !isEventHost && req.userRole !== 'admin') {
      throw new AppError('Unauthorized to view these tickets', 403);
    }

    res.status(200).json({
      status: 'success',
      data: {
        tickets,
        count: tickets.length
      }
    });
  }),

  // Get tickets by event (for host)
  getTicketsByEvent: catchAsync(async (req, res) => {
    const { eventId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    // Verify host owns event
    const event = await Event.findOne({
      _id: eventId,
      hostId: req.userId
    });

    if (!event) {
      throw new AppError('Event not found or unauthorized', 404);
    }

    const query = { eventId };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const tickets = await Ticket.paginate(query, options);

    // Calculate stats
    const stats = {
      total: tickets.totalDocs,
      valid: 0,
      used: 0,
      notActive: 0,
      invalid: 0
    };

    tickets.docs.forEach(ticket => {
      stats[ticket.status === 'already_used' ? 'used' : ticket.status] += 1;
    });

    res.status(200).json({
      status: 'success',
      data: {
        tickets: tickets.docs,
        stats,
        pagination: {
          total: tickets.totalDocs,
          pages: tickets.totalPages,
          page: tickets.page,
          limit: tickets.limit,
          hasNext: tickets.hasNextPage,
          hasPrev: tickets.hasPrevPage
        }
      }
    });
  }),

  // Download ticket
  downloadTicket: catchAsync(async (req, res) => {
    const { ticketId, format = 'pdf' } = req.params;

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    // Check authorization
    const isOwner = ticket.buyerEmail === req.user?.email;
    const isEventHost = req.userRole === 'host' && 
                      (await Event.exists({ _id: ticket.eventId, hostId: req.userId }));

    if (!isOwner && !isEventHost && req.userRole !== 'admin') {
      throw new AppError('Unauthorized to download this ticket', 403);
    }

    // Increment download count
    await ticket.incrementDownloadCount();

    // Redirect to Cloudinary URL
    const downloadUrl = format === 'pdf' ? ticket.pdfUrl : ticket.pngUrl;
    
    res.status(200).json({
      status: 'success',
      data: {
        downloadUrl,
        ticketId: ticket.ticketId,
        format
      }
    });
  }),

  // Validate ticket (for checking validity without scanning)
  validateTicket: catchAsync(async (req, res) => {
    const { qrCodeId } = req.body;

    const ticket = await Ticket.findOne({ qrCodeId })
      .populate('event', 'name eventDateTime location.venueName')
      .populate('order', 'orderNumber');

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    // Check if ticket is valid
    const now = new Date();
    const eventTime = new Date(ticket.event?.eventDateTime);
    const isValid = ticket.status === 'valid' || 
                   (ticket.status === 'not_active' && 
                    now >= new Date(eventTime.getTime() - 4 * 60 * 60 * 1000));

    res.status(200).json({
      status: 'success',
      data: {
        ticketId: ticket.ticketId,
        buyerName: ticket.buyerName,
        event: ticket.event?.name,
        eventTime: ticket.event?.eventDateTime,
        venue: ticket.event?.location?.venueName,
        tier: ticket.tierName,
        currentStatus: ticket.status,
        isValid,
        message: isValid ? 'Ticket is valid' : 'Ticket is not valid for entry'
      }
    });
  })
};

module.exports = ticketController;