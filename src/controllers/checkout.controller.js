const Event = require('../models/event.model');
const Order = require('../models/order.model');
const { AppError, catchAsync } = require('../middlewares/error.middleware');
const redisClient = require('../config/redis');
const paymentService = require('../services/payment.service');

const checkoutController = {
  // Create checkout session
  createCheckout: catchAsync(async (req, res) => {
    const {
      eventId,
      tickets,
      buyerName,
      buyerEmail,
      buyerPhone
    } = req.body;

    // Find event
    const event = await Event.findById(eventId);
    if (!event) {
      throw new AppError('Event not found', 404);
    }

    if (event.status !== 'published') {
      throw new AppError('Event is not published for ticket sales', 400);
    }

    // Validate ticket availability using Redis lock
    const lockKey = `event:${eventId}:lock`;
    const lock = await redisClient.set(lockKey, 'locked', {
      NX: true,
      EX: 5 // 5 second lock
    });

    if (!lock) {
      throw new AppError('Event is being processed by another request', 409);
    }

    try {
      // Check ticket availability and calculate totals
      let subtotal = 0;
      const ticketDetails = [];

      for (const item of tickets) {
        const tier = event.tiers.find(t => t.name === item.tierName);
        
        if (!tier) {
          throw new AppError(`Tier "${item.tierName}" not found`, 400);
        }

        const available = tier.quantityAvailable - tier.quantitySold;
        if (available < item.quantity) {
          throw new AppError(
            `Only ${available} tickets available in tier "${item.tierName}"`,
            400
          );
        }

        const tierTotal = tier.price * item.quantity;
        subtotal += tierTotal;

        ticketDetails.push({
          tierName: item.tierName,
          quantity: item.quantity,
          unitPrice: tier.price,
          totalPrice: tierTotal
        });
      }

      // Calculate fees
      const platformFee = subtotal * 0.05; // 5%
      const processingFee = subtotal * 0.02; // 2%
      const totalAmount = subtotal + processingFee;
      const hostAmount = subtotal * 0.95; // 95%

      // Create order (but don't reserve tickets yet)
      const order = await Order.create({
        buyerName,
        buyerEmail,
        buyerPhone,
        eventId: event._id,
        hostId: event.hostId,
        tickets: ticketDetails,
        subtotal,
        platformFee,
        processingFee,
        totalAmount,
        hostAmount,
        platformAmount: platformFee,
        paymentStatus: 'pending',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          deviceType: req.headers['sec-ch-ua-platform'] || 'unknown'
        }
      });

      // Temporarily reserve tickets for 10 minutes
      const reservationKey = `reservation:${order._id}`;
      await redisClient.set(
        reservationKey,
        JSON.stringify({
          eventId: event._id,
          tickets,
          expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
        }),
        { EX: 600 }
      );

      // Release lock
      await redisClient.del(lockKey);

      res.status(201).json({
        status: 'success',
        message: 'Checkout session created',
        data: {
          order: {
            id: order._id,
            orderNumber: order.orderNumber,
            totalAmount,
            tickets: ticketDetails,
            reservationExpiresIn: 600 // seconds
          },
          paymentMethods: ['mpesa']
        }
      });
    } catch (error) {
      // Release lock on error
      await redisClient.del(lockKey);
      throw error;
    }
  }),

  // Initiate payment
  initiatePayment: catchAsync(async (req, res) => {
    const { orderId, phone } = req.body;

    // Find order
    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (order.paymentStatus !== 'pending') {
      throw new AppError(`Order is already ${order.paymentStatus}`, 400);
    }

    // Check reservation
    const reservationKey = `reservation:${order._id}`;
    const reservation = await redisClient.get(reservationKey);
    
    if (!reservation) {
      throw new AppError('Ticket reservation has expired', 400);
    }

    // Reserve tickets permanently
    const event = await Event.findById(order.eventId);
    for (const ticket of order.tickets) {
      await event.reserveTickets(ticket.tierName, ticket.quantity);
    }

    // Remove reservation
    await redisClient.del(reservationKey);

    // Initiate M-Pesa payment
    const paymentResult = await paymentService.initiateSTKPush(
      order.totalAmount,
      phone,
      order.orderNumber,
      `Ticket purchase for ${order.eventId}`
    );

    if (!paymentResult.success) {
      // Release tickets if payment initiation fails
      for (const ticket of order.tickets) {
        await event.releaseTickets(ticket.tierName, ticket.quantity);
      }
      
      throw new AppError(`Payment initiation failed: ${paymentResult.errorMessage}`, 400);
    }

    // Update order with checkout request ID
    order.checkoutRequestId = paymentResult.checkoutRequestId;
    await order.save();

    res.status(200).json({
      status: 'success',
      message: 'Payment initiated',
      data: {
        checkoutRequestId: paymentResult.checkoutRequestId,
        customerMessage: paymentResult.customerMessage,
        orderId: order.orderNumber
      }
    });
  }),

  // Check payment status
  checkPaymentStatus: catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderNumber: orderId });
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (!order.checkoutRequestId) {
      throw new AppError('No payment initiated for this order', 400);
    }

    // Check payment status from M-Pesa
    const statusResult = await paymentService.checkPaymentStatus(
      order.checkoutRequestId
    );

    res.status(200).json({
      status: 'success',
      data: {
        paymentStatus: order.paymentStatus,
        orderStatus: statusResult,
        orderDetails: {
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          tickets: order.tickets.length,
          createdAt: order.createdAt
        }
      }
    });
  }),

  // Get order details
  getOrderDetails: catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderNumber: orderId })
      .populate('eventId', 'name bannerUrl location eventDateTime')
      .populate('ticketDocuments', 'ticketId tierName status pdfUrl pngUrl');

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Check if buyer is requesting their own order
    const isBuyer = order.buyerEmail === req.user?.email || 
                    order.buyerPhone === req.user?.phone;
    
    if (!isBuyer && req.userRole !== 'host') {
      throw new AppError('Unauthorized', 403);
    }

    res.status(200).json({
      status: 'success',
      data: { order }
    });
  })
};

module.exports = checkoutController;