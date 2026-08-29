import { app } from './app.js'
import { env, prisma } from './config/index.js'

const server = app.listen(env.PORT, () => {
  console.log(`AERoute API listening on port ${env.PORT}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
