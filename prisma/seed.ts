import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Modules par défaut
  const modules = [
    { name: 'stock', displayName: 'Gestion de Stock', description: 'Gestion des produits et stocks', icon: '📦', monthlyPrice: 99 },
    { name: 'commercial', displayName: 'Module Commercial', description: 'Clients, fournisseurs, factures', icon: '💼', monthlyPrice: 149 },
    { name: 'accounting', displayName: 'Comptabilité', description: 'Plan comptable et écritures', icon: '💰', monthlyPrice: 199 },
    { name: 'hr', displayName: 'GRH & Paie', description: 'Gestion des employés et paie', icon: '👥', monthlyPrice: 179 },
    { name: 'crm', displayName: 'CRM & Prospection', description: 'Pipeline de leads, suivi commercial', icon: '🎯', monthlyPrice: 79 },
    { name: 'gmao', displayName: 'GMAO', description: 'Gestion de la maintenance', icon: '🔧', monthlyPrice: 129 },
    { name: 'gpao', displayName: 'GPAO', description: 'Gestion de la production', icon: '🏭', monthlyPrice: 249 },
  ]

  for (const mod of modules) {
    await prisma.module.upsert({
      where: { name: mod.name },
      update: {},
      create: mod,
    })
  }

  // Tenant demo
  const demoTenant = await prisma.tenant.upsert({
    where: { subdomain: 'demo' },
    update: {},
    create: {
      name: 'Demo Entreprise',
      subdomain: 'demo',
      isActive: true,
    },
  })

  // Admin user pour demo
  await prisma.user.upsert({
    where: { email: 'admin@demo.tn' },
    update: {},
    create: {
      email: 'admin@demo.tn',
      password: bcrypt.hashSync('demo123', 10),
      firstName: 'Admin',
      lastName: 'Demo',
      role: 'ADMIN',
      tenantId: demoTenant.id,
      isActive: true,
    },
  })

  // Super admin
  await prisma.user.upsert({
    where: { email: 'belloumi.kkarim.professional@gmail.com' },
    update: {},
    create: {
      email: 'belloumi.kkarim.professional@gmail.com',
      password: bcrypt.hashSync('admin123', 10),
      firstName: 'Karim',
      lastName: 'Belloumi',
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  })

  // Activer tous les modules pour demo
  const allModules = await prisma.module.findMany()
  for (const mod of allModules) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: demoTenant.id, moduleId: mod.id } },
      update: { isEnabled: true },
      create: { tenantId: demoTenant.id, moduleId: mod.id, isEnabled: true },
    })
  }

  // Products pour demo
  const products = [
    { code: 'SKU-001', name: 'Ramette Papier A4', category: 'Fournitures', purchasePrice: 12, salePrice: 18, minStock: 50, currentStock: 250, unit: 'ramette' },
    { code: 'SKU-002', name: 'Cartouche HP 304 Noir', category: 'Consommables', purchasePrice: 45, salePrice: 65, minStock: 10, currentStock: 12, unit: 'unité' },
    { code: 'SKU-003', name: 'Vis TF 4x40mm (Bx100)', category: 'Quincaillerie', purchasePrice: 8.5, salePrice: 15, minStock: 20, currentStock: 5, unit: 'boîte' },
  ]

  for (const prod of products) {
    await prisma.product.upsert({
      where: { tenantId_code: { tenantId: demoTenant.id, code: prod.code } },
      update: {},
      create: {
        ...prod,
        tenantId: demoTenant.id,
      },
    })
  }

  console.log('Seed completed!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
