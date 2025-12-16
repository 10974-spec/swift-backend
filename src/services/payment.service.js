const axios = require('axios');
const crypto = require('crypto');
const Event = require('../models/event.model');
const Order = require('../models/order.model');
const Ticket = require('../models/ticket.model');
const redisClient = require('../config/redis');
const { ticketQueue } = require('../jobs/ticket-generation.job');

class PaymentService {
  constructor() {
    this.baseUrl = process.env.MPESA_ENVIRONMENT === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
    
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.callbackUrl = process.env.MPESA_CALLBACK_URL;
    
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${auth}`
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('Error getting M-Pesa access token:', error.response?.data || error.message);
      throw new Error('Failed to get M-Pesa access token');
    }
  }

  async initiateSTKPush(amount, phone, orderId, description = 'Event Ticket Purchase') {
    try {
      const token = await this.getAccessToken();
      
      // Format phone number (remove leading 0 or +)
      let formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '');
      if (!formattedPhone.startsWith('254')) {
        formattedPhone = `254${formattedPhone}`;
      }

      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');

      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: this.callbackUrl,
        AccountReference: orderId,
        TransactionDesc: description
      };

      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.ResponseCode === '0') {
        // Store checkout request ID in Redis for later reference
        const checkoutRequestId = response.data.CheckoutRequestID;
        await redisClient.set(
          `mpesa:checkout:${checkoutRequestId}`,
          JSON.stringify({
            orderId,
            amount,
            phone: formattedPhone,
            timestamp: new Date().toISOString()
          }),
          { EX: 3600 } // Expire in 1 hour
        );

        return {
          success: true,
          checkoutRequestId,
          responseDescription: response.data.ResponseDescription,
          customerMessage: response.data.CustomerMessage
        };
      } else {
        return {
          success: false,
          errorCode: response.data.ResponseCode,
          errorMessage: response.data.ResponseDescription
        };
      }
    } catch (error) {
      console.error('STK Push error:', error.response?.data || error.message);
      throw new Error('Failed to initiate M-Pesa payment');
    }
  }

  async validateCallback(payload) {
    try {
      const { Body: { stkCallback: callback } } = payload;
      
      if (callback.ResultCode !== 0) {
        // Payment failed
        const metadata = callback.ResultDesc || 'Payment failed';
        const checkoutRequestId = callback.CheckoutRequestID;
        
        // Get order ID from Redis
        const redisKey = `mpesa:checkout:${checkoutRequestId}`;
        const cachedData = await redisClient.get(redisKey);
        
        if (cachedData) {
          const { orderId } = JSON.parse(cachedData);
          
          // Update order status
          await Order.findOneAndUpdate(
            { orderNumber: orderId },
            {
              paymentStatus: 'failed',
              notes: `Payment failed: ${metadata}`
            }
          );
          
          // Release reserved tickets
          const order = await Order.findOne({ orderNumber: orderId });
          if (order) {
            const event = await Event.findById(order.eventId);
            if (event) {
              for (const ticket of order.tickets) {
                await event.releaseTickets(ticket.tierName, ticket.quantity);
              }
            }
          }
          
          // Remove from Redis
          await redisClient.del(redisKey);
        }
        
        return {
          success: false,
          checkoutRequestId,
          resultCode: callback.ResultCode,
          resultDesc: callback.ResultDesc
        };
      }

      // Payment successful
      const { CheckoutRequestID, CallbackMetadata } = callback;
      const metadata = {};
      
      if (CallbackMetadata && CallbackMetadata.Item) {
        CallbackMetadata.Item.forEach(item => {
          metadata[item.Name] = item.Value;
        });
      }

      const mpesaReceiptNumber = metadata.MpesaReceiptNumber;
      const phoneNumber = metadata.PhoneNumber;
      const amountPaid = metadata.Amount;
      const transactionDate = metadata.TransactionDate;

      // Get order ID from Redis
      const redisKey = `mpesa:checkout:${CheckoutRequestID}`;
      const cachedData = await redisClient.get(redisKey);
      
      if (!cachedData) {
        throw new Error('Checkout request not found in cache');
      }

      const { orderId, amount: expectedAmount } = JSON.parse(cachedData);
      
      // Validate amount
      if (parseFloat(amountPaid) < parseFloat(expectedAmount)) {
        throw new Error(`Insufficient payment. Expected: ${expectedAmount}, Received: ${amountPaid}`);
      }

      // Update order status
      const order = await Order.findOneAndUpdate(
        { orderNumber: orderId },
        {
          paymentStatus: 'completed',
          mpesaReference: mpesaReceiptNumber,
          checkoutRequestId: CheckoutRequestID,
          paymentDate: new Date(),
          notes: `Payment received via M-Pesa. Receipt: ${mpesaReceiptNumber}`
        },
        { new: true }
      ).populate('eventId');

      if (!order) {
        throw new Error('Order not found');
      }

      // Add ticket generation job to queue
      await ticketQueue.add('generate-tickets', {
        orderId: order._id,
        eventId: order.eventId._id,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        buyerPhone: order.buyerPhone,
        tickets: order.tickets
      });

      // Remove from Redis
      await redisClient.del(redisKey);

      return {
        success: true,
        orderId: order.orderNumber,
        mpesaReceiptNumber,
        amountPaid,
        phoneNumber,
        transactionDate,
        checkoutRequestId: CheckoutRequestID
      };
    } catch (error) {
      console.error('Payment callback validation error:', error);
      throw new Error('Failed to validate payment callback');
    }
  }

  async checkPaymentStatus(checkoutRequestId) {
    try {
      const token = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');

      const requestData = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: response.data.ResultCode === 0,
        resultCode: response.data.ResultCode,
        resultDesc: response.data.ResultDesc,
        response: response.data
      };
    } catch (error) {
      console.error('Payment status check error:', error.response?.data || error.message);
      throw new Error('Failed to check payment status');
    }
  }

  async refundPayment(orderId, amount, reason = 'Customer request') {
    // Implementation for refunds
    // Note: M-Pesa refunds require special permissions from Safaricom
    console.log(`Refund requested for order ${orderId}: ${amount} - ${reason}`);
    return { success: true, message: 'Refund request logged' };
  }
}

module.exports = new PaymentService();