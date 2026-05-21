const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const assets = await prisma.asset.findMany();
  console.log("Deployed Assets in DB:", assets);
  
  const purchases = await prisma.tokenPurchaseRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log("Latest Purchase Requests in DB:", purchases);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
