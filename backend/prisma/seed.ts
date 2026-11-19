/* Creates the initial SUPER_ADMIN from SEED_ADMIN_* env vars (idempotent). */
import { PrismaClient, AdminRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* env provided externally */
}

async function main() {
  const prisma = new PrismaClient();
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const name = process.env.SEED_ADMIN_NAME ?? 'ToolkitGo Admin';
  if (!email || password.length < 10) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (>= 10 chars)');

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists (role ${existing.role}).`);
  } else {
    await prisma.adminUser.create({ data: { email, name, role: AdminRole.SUPER_ADMIN, passwordHash: await bcrypt.hash(password, 12) } });
    console.log(`Created SUPER_ADMIN ${email}. Change the password after first login.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
