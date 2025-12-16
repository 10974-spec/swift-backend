const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const Event = require('../models/event.model');
const Payout = require('../models/payout.model');
const Order = require('../models/order.model');
const User = require('../models/user.model');
const emailService = require('../config/email');

// Redis connection for BullMQ
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Create queue
const payoutQueue = new Queue('payouts', { connection });

// Create worker
const payoutWorker = new Worker('payouts', async job => {
  console.log(`Processing payout job ${job.id}`);
  
  try {
    const { eventId } = job.data;
    
    // Find event
    const event = await Event.findById(eventId);
    
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }
    
    if (event.status !== 'completed') {
      throw new Error(`Event ${eventId} is not completed`);
    }
    
    // Get completed orders for this event
    const completedOrders = await Order.find({
      eventId: event._id,
      paymentStatus: 'completed'
    });
    
    // Calculate total payout
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.hostAmount, 0);
    
    if (totalRevenue <= 0) {
      console.log(`No revenue to payout for event ${eventId}`);
      return { success: true, message: 'No revenue to payout' };
    }
    
    // Check if payout already exists
    const existingPayout = await Payout.findOne({ eventId, status: 'completed' });
    if (existingPayout) {
      throw new Error(`Payout already completed for event ${eventId}`);
    }
    
    // Get host details
    const host = await User.findById(event.hostId);
    if (!host) {
      throw new Error(`Host not found for event ${eventId}`);
    }
    
    // Create payout record
    const payout = await Payout.create({
      hostId: event.hostId,
      eventId: event._id,
      amount: totalRevenue,
      currency: 'KES',
      method: 'bank_transfer',
      bankDetails: host.bankDetails,
      status: 'processing',
      metadata: {
        ticketSales: completedOrders.length,
        platformFee: completedOrders.reduce((sum, order) => sum + order.platformFee, 0),
        processingFee: completedOrders.reduce((sum, order) => sum + order.processingFee, 0),
        netAmount: totalRevenue,
        taxAmount: 0
      }
    });
    
    // Simulate bank transfer (in production, integrate with banking API)
    // For now, we'll mark it as completed after a delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Update payout status
    payout.status = 'completed';
    payout.transactionId = `BANK-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    payout.receiptUrl = 'https://example.com/receipt.pdf';
    payout.completedAt = new Date();
    await payout.save();
    
    // Send email notification to host
    await sendPayoutEmail(host, event, payout);
    
    console.log(`Payout completed for event ${eventId}: KES ${totalRevenue}`);
    
    return {
      success: true,
      payoutId: payout.payoutId,
      amount: totalRevenue,
      eventName: event.name
    };
  } catch (error) {
    console.error(`Payout job ${job.id} failed:`, error);
    throw error;
  }
}, { connection });

// Function to schedule payout jobs
async function schedulePayoutJobs() {
  console.log('Scheduling payout jobs...');
  
  try {
    // Find events that ended 24 hours ago and haven't been paid out
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const eventsToPayout = await Event.find({
      eventDateTime: { $lt: twentyFourHoursAgo },
      status: 'completed',
      payoutProcessed: { $ne: true }
    });
    
    console.log(`Found ${eventsToPayout.length} events ready for payout`);
    
    for (const event of eventsToPayout) {
      // Check if payout already in queue
      const jobs = await payoutQueue.getJobs(['waiting', 'delayed', 'active']);
      const alreadyQueued = jobs.some(job => job.data.eventId.toString() === event._id.toString());
      
      if (!alreadyQueued) {
        await payoutQueue.add('process-payout', {
          eventId: event._id,
          eventName: event.name,
          hostId: event.hostId
        }, {
          delay: 1000, // 1 second delay
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
        });
        
        // Mark as payout processed
        event.payoutProcessed = true;
        await event.save();
      }
    }
  } catch (error) {
    console.error('Error scheduling payout jobs:', error);
  }
}

// Function to send payout email
async function sendPayoutEmail(host, event, payout) {
  try {
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Payout Processed - SwiftPass</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4CAF50; }
            .amount { font-size: 32px; font-weight: bold; color: #4CAF50; text-align: center; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💰 Payout Processed</h1>
              <p>Your event revenue has been transferred</p>
            </div>
            <div class="content">
              <h2>Hello ${host.name},</h2>
              <p>We're pleased to inform you that the payout for your event has been successfully processed.</p>
              
              <div class="info-box">
                <h3>Event Details</h3>
                <p><strong>Event:</strong> ${event.name}</p>
                <p><strong>Event Date:</strong> ${new Date(event.eventDateTime).toLocaleDateString()}</p>
                <p><strong>Payout ID:</strong> ${payout.payoutId}</p>
                <p><strong>Processed On:</strong> ${new Date(payout.completedAt).toLocaleDateString()}</p>
              </div>
              
              <div class="amount">KES ${payout.amount.toLocaleString()}</div>
              
              <div class="info-box">
                <h3>Payment Details</h3>
                <p><strong>Bank:</strong> ${payout.bankDetails.bankName}</p>
                <p><strong>Account:</strong> ${payout.bankDetails.accountNumber}</p>
                <p><strong>Account Name:</strong> ${payout.bankDetails.accountName}</p>
                <p><strong>Transaction ID:</strong> ${payout.transactionId}</p>
              </div>
              
              <p>Please allow 1-3 business days for the funds to reflect in your account.</p>
              <p>If you have any questions about this payout, please contact our support team at support@swiftpass.app.</p>
              
              <p>Thank you for hosting your event with SwiftPass!</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} SwiftPass. All rights reserved.</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    await emailService.sendEmail(
      host.email,
      `Payout Processed for ${event.name}`,
      emailHtml
    );
    
    console.log(`Payout email sent to ${host.email}`);
  } catch (error) {
    console.error('Error sending payout email:', error);
  }
}

// Schedule payout check daily at midnight
setInterval(schedulePayoutJobs, 24 * 60 * 60 * 1000); // Every 24 hours

// Initial run (wait 5 seconds for app to start)
setTimeout(schedulePayoutJobs, 5000);

module.exports = {
  payoutQueue,
  payoutWorker,
  schedulePayoutJobs,
  sendPayoutEmail
};