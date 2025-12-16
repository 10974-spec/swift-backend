const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const fetch = require('node-fetch');
const { cloudinary } = require('../config/cloudinary');
const Ticket = require('../models/ticket.model');
const Order = require('../models/order.model');
const Event = require('../models/event.model');
const emailService = require('../config/email');

class TicketGenerationService {
  constructor() {
    this.pokemonApiBase = 'https://pokeapi.co/api/v2/pokemon';
    this.gradients = [
      ['#667eea', '#764ba2'],
      ['#f093fb', '#f5576c'],
      ['#4facfe', '#00f2fe'],
      ['#43e97b', '#38f9d7'],
      ['#fa709a', '#fee140'],
      ['#30cfd0', '#330867'],
      ['#a8edea', '#fed6e3'],
      ['#5ee7df', '#b490ca']
    ];
  }

  async generateTicketForOrder(orderData) {
    try {
      const { orderId, eventId, buyerName, buyerEmail, buyerPhone, tickets } = orderData;
      
      // Get event details
      const event = await Event.findById(eventId);
      if (!event) {
        throw new Error('Event not found');
      }

      // Get order
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      const generatedTickets = [];

      // Generate a ticket for each quantity
      for (const ticketItem of tickets) {
        for (let i = 0; i < ticketItem.quantity; i++) {
          const ticket = await this.generateSingleTicket({
            orderId,
            event,
            buyerName,
            buyerEmail,
            buyerPhone,
            tierName: ticketItem.tierName,
            price: ticketItem.unitPrice,
            ticketNumber: i + 1
          });
          
          generatedTickets.push(ticket);
        }
      }

      // Update order status
      await order.markTicketsGenerated();

      // Send email with all tickets
      await this.sendTicketEmail(buyerEmail, buyerName, generatedTickets, event);

      return generatedTickets;
    } catch (error) {
      console.error('Ticket generation error:', error);
      throw error;
    }
  }

  async generateSingleTicket(ticketData) {
    const {
      orderId,
      event,
      buyerName,
      buyerEmail,
      buyerPhone,
      tierName,
      price,
      ticketNumber
    } = ticketData;

    try {
      // Get random Pokémon
      const pokemon = await this.getRandomPokemon();
      
      // Get random gradient
      const gradient = this.gradients[Math.floor(Math.random() * this.gradients.length)];
      
      // Generate QR code
      const qrCodeData = {
        ticketId: `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        eventId: event._id.toString(),
        buyerEmail,
        timestamp: Date.now()
      };
      
      const qrCodeBase64 = await QRCode.toDataURL(JSON.stringify(qrCodeData));
      
      // Generate PDF
      const pdfBuffer = await this.generatePDFTicket({
        event,
        buyerName,
        buyerEmail,
        buyerPhone,
        tierName,
        price,
        ticketNumber,
        qrCodeBase64,
        pokemon,
        gradient
      });

      // Generate PNG
      const pngBuffer = await this.generatePNGTicket({
        event,
        buyerName,
        tierName,
        qrCodeBase64,
        pokemon,
        gradient
      });

      // Upload to Cloudinary
      const [pdfUpload, pngUpload] = await Promise.all([
        this.uploadToCloudinary(pdfBuffer, 'pdf'),
        this.uploadToCloudinary(pngBuffer, 'png')
      ]);

      // Create ticket in database
      const ticket = await Ticket.create({
        orderId,
        eventId: event._id,
        buyerName,
        buyerEmail,
        buyerPhone,
        tierName,
        price,
        qrCodeId: qrCodeData.ticketId,
        qrCodeData: JSON.stringify(qrCodeData),
        pdfUrl: pdfUpload.secure_url,
        pngUrl: pngUpload.secure_url,
        pokemonImageUrl: pokemon.image,
        backgroundColor: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        metadata: {
          generatedAt: new Date()
        }
      });

      return ticket;
    } catch (error) {
      console.error('Single ticket generation error:', error);
      throw error;
    }
  }

  async getRandomPokemon() {
    try {
      const randomId = Math.floor(Math.random() * 898) + 1; // There are 898 Pokémon
      const response = await fetch(`${this.pokemonApiBase}/${randomId}`);
      const data = await response.json();
      
      return {
        id: data.id,
        name: data.name,
        image: data.sprites.other['official-artwork'].front_default,
        types: data.types.map(t => t.type.name)
      };
    } catch (error) {
      // Fallback Pokémon
      return {
        id: 25,
        name: 'pikachu',
        image: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
        types: ['electric']
      };
    }
  }

  async generatePDFTicket(data) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Ticket for ${data.event.name}`,
          Author: 'SwiftPass',
          Subject: 'Event Ticket',
          Keywords: 'ticket, event, qr code'
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      doc.on('error', reject);

      // Add gradient background
      const gradient = doc.linearGradient(0, 0, doc.page.width, doc.page.height);
      gradient.stop(0, data.gradient[0]);
      gradient.stop(1, data.gradient[1]);
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(gradient);

      // Add white content area
      doc.fillColor('white')
         .roundedRect(40, 40, doc.page.width - 80, doc.page.height - 80, 20)
         .fill();

      // Add header
      doc.fillColor('#333')
         .fontSize(32)
         .font('Helvetica-Bold')
         .text('SWIFTPASS', 60, 70, { align: 'center' });

      doc.fillColor('#667eea')
         .fontSize(14)
         .font('Helvetica')
         .text('OFFICIAL EVENT TICKET', 60, 110, { align: 'center' });

      // Add event details
      doc.fillColor('#333')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text(data.event.name, 60, 150, { align: 'center' });

      doc.fillColor('#666')
         .fontSize(14)
         .font('Helvetica')
         .text(`Date: ${new Date(data.event.eventDateTime).toLocaleDateString()}`, 60, 190)
         .text(`Time: ${new Date(data.event.eventDateTime).toLocaleTimeString()}`, 60, 210)
         .text(`Venue: ${data.event.location.venueName}`, 60, 230)
         .text(`City: ${data.event.location.city || 'N/A'}`, 60, 250);

      // Add buyer details
      doc.fillColor('#333')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('TICKET HOLDER', 60, 290);

      doc.fillColor('#666')
         .fontSize(14)
         .font('Helvetica')
         .text(`Name: ${data.buyerName}`, 60, 320)
         .text(`Email: ${data.buyerEmail}`, 60, 340)
         .text(`Phone: ${data.buyerPhone}`, 60, 360)
         .text(`Ticket Tier: ${data.tierName}`, 60, 380)
         .text(`Price: KES ${data.price.toLocaleString()}`, 60, 400);

      // Add QR code (center)
      const qrCodeSize = 150;
      const qrCodeX = (doc.page.width - qrCodeSize) / 2;
      const qrCodeY = 450;

      // Add QR code image
      doc.image(Buffer.from(data.qrCodeBase64.split(',')[1], 'base64'), qrCodeX, qrCodeY, {
        width: qrCodeSize,
        height: qrCodeSize
      });

      // Add Pokémon image (right side) if buffer available
      if (pokemonBuffer) {
        try {
          doc.image(pokemonBuffer, doc.page.width - 160, 450, {
            width: 100,
            height: 100
          });

          doc.fillColor('#333')
             .fontSize(10)
             .font('Helvetica')
             .text(`Pokémon: ${data.pokemon.name.charAt(0).toUpperCase() + data.pokemon.name.slice(1)}`, 
                   doc.page.width - 160, 560, { width: 100, align: 'center' });
        } catch (error) {
          console.log('Could not add Pokémon image to PDF:', error.message);
        }
      }

      // Add footer
      doc.fillColor('#999')
         .fontSize(10)
         .font('Helvetica')
         .text('This ticket will become active 4 hours before the event.', 60, doc.page.height - 80)
         .text('Each ticket can only be scanned once.', 60, doc.page.height - 65)
         .text('For support: support@swiftpass.app', 60, doc.page.height - 50)
         .text(`Ticket ID: TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
               60, doc.page.height - 35, { align: 'left' });

      // Add watermark
      doc.fillColor('rgba(0,0,0,0.05)')
         .fontSize(60)
         .font('Helvetica-Bold')
         .rotate(45)
         .text('SWIFTPASS', 100, 400)
         .rotate(-45);

      doc.end();
    });
  }

  async generatePNGTicket(data) {
    // For PNG generation, we'll create a simpler version
    // In production, you might want to use a library like canvas
    // For now, we'll return the QR code as PNG
    
    const qrBuffer = await QRCode.toBuffer(JSON.stringify({
      ticketId: `TKT-${Date.now()}`,
      event: data.event.name,
      buyer: data.buyerName,
      tier: data.tierName
    }), {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    return qrBuffer;
  }

  async uploadToCloudinary(buffer, resourceType) {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType === 'pdf' ? 'raw' : 'image',
          folder: 'swiftpass/tickets',
          format: resourceType,
          public_id: `ticket-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      uploadStream.end(buffer);
    });
  }

  async sendTicketEmail(to, name, tickets, event) {
    try {
      const attachments = [];
      
      for (const ticket of tickets) {
        // Add PDF attachment
        const pdfResponse = await fetch(ticket.pdfUrl);
        const pdfBuffer = await pdfResponse.buffer();
        
        attachments.push({
          filename: `ticket-${ticket.ticketId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        });

        // Add PNG attachment
        const pngResponse = await fetch(ticket.pngUrl);
        const pngBuffer = await pngResponse.buffer();
        
        attachments.push({
          filename: `ticket-${ticket.ticketId}.png`,
          content: pngBuffer,
          contentType: 'image/png'
        });
      }

      const emailHtml = emailService.generateTicketEmail({
        buyerName: name,
        eventName: event.name,
        eventDateTime: new Date(event.eventDateTime).toLocaleString(),
        venue: event.location.venueName,
        tierName: tickets[0]?.tierName || 'General',
        ticketId: tickets[0]?.ticketId || 'N/A',
        qrCodeId: tickets[0]?.qrCodeId || 'N/A',
        pdfUrl: tickets[0]?.pdfUrl || '#',
        pngUrl: tickets[0]?.pngUrl || '#'
      });

      await emailService.sendEmail(
        to,
        `Your Tickets for ${event.name}`,
        emailHtml,
        attachments.slice(0, 4) // Limit attachments to avoid email size issues
      );

      // Update ticket metadata
      for (const ticket of tickets) {
        await Ticket.findByIdAndUpdate(ticket._id, {
          'metadata.sentAt': new Date()
        });
      }

      // Update order
      const order = await Order.findById(tickets[0].orderId);
      if (order) {
        await order.markEmailSent();
      }

      console.log(`Ticket email sent to ${to}`);
    } catch (error) {
      console.error('Error sending ticket email:', error);
      throw error;
    }
  }
}

module.exports = new TicketGenerationService();