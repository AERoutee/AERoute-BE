import 'dotenv/config'
import { prisma } from '../src/config/db.js'

await prisma.$disconnect()
