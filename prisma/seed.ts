import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = crypto.createHash('sha256').update('password123').digest('hex');

  // Create Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@fleetpulse.com' },
    update: {},
    create: {
      email: 'admin@fleetpulse.com',
      role: 'Admin',
      password_hash: passwordHash,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@fleetpulse.com' },
    update: {},
    create: {
      email: 'customer@fleetpulse.com',
      role: 'Customer',
      password_hash: passwordHash,
    },
  });

  console.log('Users created:', { admin: admin.email, customer: customer.email });

  // Create Devices
  const IMEIs = [
    '354678901234561',
    '861234567890123',
    '359876543210987',
    '441234567890123',
    '551234567890123',
  ];

  for (const imei of IMEIs) {
    await prisma.device.upsert({
      where: { imei },
      update: {},
      create: {
        imei,
        vehicle_number: `v-${100 + IMEIs.indexOf(imei)}`,
        customer_id: customer.id, // Assign to customer
      },
    });
  }

  console.log(`Seeded ${IMEIs.length} devices.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
