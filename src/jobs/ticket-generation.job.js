const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const ticketGenerationService = require('../services/ticket-generation.service');

// Redis connection for BullMQ
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

// Create queue
const ticketQueue = new Queue('ticket-generation', { connection });

// Create worker
const ticketWorker = new Worker('ticket-generation', async job => {
  console.log(`Processing ticket generation job ${job.id}`);
  
  try {
    const { orderId, eventId, buyerName, buyerEmail, buyerPhone, tickets } = job.data;
    
    const result = await ticketGenerationService.generateTicketForOrder({
      orderId,
      eventId,
      buyerName,
      buyerEmail,
      buyerPhone,
      tickets
    });
    
    console.log(`Generated ${result.length} tickets for order ${orderId}`);
    
    return {
      success: true,
      ticketsGenerated: result.length,
      orderId,
      buyerEmail
    };
  } catch (error) {
    console.error(`Ticket generation job ${job.id} failed:`, error);
    
    // Update order status to error
    const Order = require('../models/order.model');
    await Order.findByIdAndUpdate(job.data.orderId, {
      ticketStatus: 'error',
      notes: `Ticket generation failed: ${error.message}`
    });
    
    throw error;
  }
}, { 
  connection,
  concurrency: 5 // Process 5 jobs concurrently
});

module.exports = {
  ticketQueue,
  ticketWorker
};