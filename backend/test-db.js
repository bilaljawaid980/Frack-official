const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ select: { walletAddress: true, requestedRole: true } });
  console.log('Users:', users);
  const kycs = await prisma.kycApplication.findMany({ select: { walletAddress: true, status: true } });
  console.log('KYCs:', kycs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
