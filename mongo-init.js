db = db.getSiblingDB('swiftpass');

// Create collections
db.createCollection('users');
db.createCollection('events');
db.createCollection('orders');
db.createCollection('tickets');
db.createCollection('payouts');

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ phone: 1 }, { unique: true });
db.users.createIndex({ idNumber: 1 }, { unique: true });
db.users.createIndex({ googleId: 1 }, { sparse: true, unique: true });
db.users.createIndex({ facebookId: 1 }, { sparse: true, unique: true });

db.events.createIndex({ slug: 1 }, { unique: true });
db.events.createIndex({ hostId: 1 });
db.events.createIndex({ status: 1 });
db.events.createIndex({ eventDateTime: 1 });
db.events.createIndex({ 'location.coordinates': '2dsphere' });

db.orders.createIndex({ orderNumber: 1 }, { unique: true });
db.orders.createIndex({ checkoutRequestId: 1 });
db.orders.createIndex({ mpesaReference: 1 });
db.orders.createIndex({ eventId: 1 });
db.orders.createIndex({ hostId: 1 });
db.orders.createIndex({ paymentStatus: 1 });
db.orders.createIndex({ buyerEmail: 1 });
db.orders.createIndex({ buyerPhone: 1 });

db.tickets.createIndex({ ticketId: 1 }, { unique: true });
db.tickets.createIndex({ qrCodeId: 1 }, { unique: true });
db.tickets.createIndex({ orderId: 1 });
db.tickets.createIndex({ eventId: 1 });
db.tickets.createIndex({ status: 1 });

db.payouts.createIndex({ payoutId: 1 }, { unique: true });
db.payouts.createIndex({ hostId: 1 });
db.payouts.createIndex({ eventId: 1 });
db.payouts.createIndex({ status: 1 });

print('✅ MongoDB initialized successfully');