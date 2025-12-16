const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

// Redis connection for BullMQ
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Create queue
const activationQueue = new Queue('ticket-activation', { connection });

// Create worker
const activationWorker = new Worker('ticket-activation', async job => {
  console.log(`Processing ticket activation job ${job.id}`);
  
  try {
    const { ticketId } = job.data;
    
    // Import models inside the worker to avoid circular dependencies
    const Ticket = require('../models/ticket.model');
    const Event = require('../models/event.model');
    
    const ticket = await Ticket.findById(ticketId);
    
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }
    
    if (ticket.status !== 'not_active') {
      console.log(`Ticket ${ticketId} is already ${ticket.status}`);
      return { success: true, status: ticket.status };
    }
    
    // Get event to check activation time
    const event = await Event.findById(ticket.eventId);
    if (!event) {
      throw new Error(`Event not found for ticket ${ticketId}`);
    }
    
    // Calculate activation time (4 hours before event)
    const eventTime = new Date(event.eventDateTime);
    const activationTime = new Date(eventTime.getTime() - (4 * 60 * 60 * 1000));
    
    // Check if activation time has been reached
    const now = new Date();
    if (now >= activationTime) {
      ticket.status = 'valid';
      ticket.activationTime = activationTime;
      await ticket.save();
      
      console.log(`Ticket ${ticketId} activated`);
      
      return {
        success: true,
        ticketId: ticket.ticketId,
        status: 'valid',
        activatedAt: now.toISOString()
      };
    } else {
      // Reschedule for later
      const timeUntilActivation = activationTime.getTime() - now.getTime();
      
      if (timeUntilActivation > 0) {
        await activationQueue.add(
          'activate-ticket',
          { ticketId: ticket._id },
          { delay: timeUntilActivation }
        );
        
        console.log(`Ticket ${ticketId} scheduled for activation in ${Math.round(timeUntilActivation / 1000 / 60)} minutes`);
      }
      
      return {
        success: true,
        ticketId: ticket.ticketId,
        status: 'scheduled',
        activationTime: activationTime.toISOString()
      };
    }
  } catch (error) {
    console.error(`Ticket activation job ${job.id} failed:`, error);
    throw error;
  }
}, { connection });

// Function to schedule ticket activations
async function scheduleTicketActivations() {
  console.log('Scheduling ticket activations...');
  
  try {
    // Import models inside the function
    const Ticket = require('../models/ticket.model');
    const Event = require('../models/event.model');
    
    // Find tickets that need activation (4 hours before their event)
    const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
    
    // Get all active tickets
    const ticketsToActivate = await Ticket.find({
      status: 'not_active'
    });
    
    console.log(`Found ${ticketsToActivate.length} tickets to check for activation`);
    
    for (const ticket of ticketsToActivate) {
      // Get event to check activation time
      const event = await Event.findById(ticket.eventId);
      if (!event || event.eventDateTime <= new Date()) {
        continue; // Event not found or already passed
      }
      
      // Calculate activation time
      const eventTime = new Date(event.eventDateTime);
      const activationTime = new Date(eventTime.getTime() - (4 * 60 * 60 * 1000));
      
      // Check if activation time is within the next 4 hours
      if (activationTime <= fourHoursFromNow) {
        // Check if already in queue
        const jobs = await activationQueue.getJobs(['waiting', 'delayed', 'active']);
        const alreadyQueued = jobs.some(job => 
          job.data.ticketId && job.data.ticketId.toString() === ticket._id.toString()
        );
        
        if (!alreadyQueued) {
          const delay = Math.max(0, activationTime.getTime() - Date.now());
          
          await activationQueue.add('activate-ticket', {
            ticketId: ticket._id,
            ticketNumber: ticket.ticketId,
            eventId: ticket.eventId,
            eventName: event.name
          }, {
            delay,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Error scheduling ticket activations:', error);
  }
}

// Check for ticket activations every hour
setInterval(scheduleTicketActivations, 60 * 60 * 1000);

// Initial run (wait 5 seconds for app to start)
setTimeout(scheduleTicketActivations, 5000);

module.exports = {
  activationQueue,
  activationWorker,
  scheduleTicketActivations
};