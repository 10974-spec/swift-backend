# SwiftPass Backend

A complete event ticketing platform with QR codes, M-Pesa payments, and ticket generation.

## Features

- **Host Management**: Event creation, management, and analytics
- **Ticket Sales**: Multi-tier ticketing with real-time availability
- **M-Pesa Integration**: Secure payment processing
- **QR Code Generation**: Unique QR codes for each ticket
- **Ticket Generation**: PDF and PNG tickets with Pokémon images
- **Background Jobs**: Automated payouts and ticket activation
- **Redis Caching**: Performance optimization
- **Email Notifications**: Ticket delivery and updates
- **Google/Facebook OAuth**: Social authentication

## Tech Stack

- **Node.js** + **Express.js** - Backend framework
- **MongoDB** + **Mongoose** - Database and ODM
- **Redis** - Caching and queues
- **BullMQ** - Background job processing
- **Cloudinary** - Image and file storage
- **JWT** - Authentication
- **Joi** - Input validation
- **Winston** - Logging

## Quick Start

### Using Docker (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd swiftpass-backend

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f app