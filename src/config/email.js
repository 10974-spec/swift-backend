const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  async sendEmail(to, subject, html, attachments = []) {
    try {
      const mailOptions = {
        from: `SwiftPass <${process.env.EMAIL_FROM}>`,
        to,
        subject,
        html,
        attachments
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('Email send error:', error);
      throw new Error('Failed to send email');
    }
  }

  // Template for ticket email
  generateTicketEmail(ticketDetails) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your SwiftPass Ticket</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .ticket-info { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
            .download-btn { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎟️ Your SwiftPass Ticket</h1>
              <p>Thank you for your purchase!</p>
            </div>
            <div class="content">
              <h2>Hello ${ticketDetails.buyerName},</h2>
              <p>Your ticket for <strong>${ticketDetails.eventName}</strong> is ready!</p>
              
              <div class="ticket-info">
                <h3>📋 Ticket Details</h3>
                <p><strong>Event:</strong> ${ticketDetails.eventName}</p>
                <p><strong>Date & Time:</strong> ${ticketDetails.eventDateTime}</p>
                <p><strong>Venue:</strong> ${ticketDetails.venue}</p>
                <p><strong>Ticket Tier:</strong> ${ticketDetails.tierName}</p>
                <p><strong>Ticket ID:</strong> ${ticketDetails.ticketId}</p>
                <p><strong>QR Code ID:</strong> ${ticketDetails.qrCodeId}</p>
              </div>
              
              <p>📎 Your ticket attachments:</p>
              <a href="${ticketDetails.pdfUrl}" class="download-btn">Download PDF Ticket</a>
              <a href="${ticketDetails.pngUrl}" class="download-btn">Download PNG Ticket</a>
              
              <h3>🎫 Important Information</h3>
              <ul>
                <li>Please bring either the PDF or PNG version of your ticket</li>
                <li>Your QR code will become active 4 hours before the event</li>
                <li>Each ticket can only be scanned once</li>
                <li>For any issues, contact support@swiftpass.app</li>
              </ul>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} SwiftPass. All rights reserved.</p>
              <p>This is an automated email, please do not reply.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

module.exports = new EmailService();