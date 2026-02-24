#!/usr/bin/env node

/**
 * Setup script for initial project configuration
 * Creates necessary Cloudflare resources and generates secrets
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function generateSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex')
}

function createEnvFile() {
  const envTemplate = path.join(__dirname, '../.env.example')
  const envLocal = path.join(__dirname, '../.env.local')

  if (fs.existsSync(envLocal)) {
    console.log('⚠️  .env.local already exists')
    return
  }

  console.log('📝 Creating .env.local from template...')

  let envContent = fs.readFileSync(envTemplate, 'utf-8')

  // Generate JWT secret if needed
  envContent = envContent.replace(
    /JWT_SECRET=your_very_long_random_jwt_secret_key_here_min_32_chars/,
    `JWT_SECRET=${generateSecret(32)}`,
  )

  fs.writeFileSync(envLocal, envContent)
  console.log('✅ .env.local created')
  console.log('⚠️  Please update with your Cloudflare credentials')
}

function printSetupInstructions() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║            orquestra Project Setup Instructions                ║
╚════════════════════════════════════════════════════════════════╝

1. 📋 Configure Environment
   • Copy .env.example to .env.local
   • Fill in your Cloudflare credentials:
     - CLOUDFLARE_API_TOKEN
     - CLOUDFLARE_ACCOUNT_ID
   • Fill in GitHub OAuth credentials
   • Generate a JWT_SECRET (32+ chars recommended)

2. ☁️  Create Cloudflare Resources
   • Create D1 databases:
     npm run db:migrate:dev

   • Create KV namespaces:
     wrangler kv:namespace create "IDLS"
     wrangler kv:namespace create "CACHE"

3. 🐙 GitHub OAuth Setup
   • Go to GitHub Settings → Developer settings → OAuth Apps
   • Create a new OAuth App
   • Copy Client ID and Client Secret to .env.local

4. 📦 Install Dependencies
   npm run install:all

5. 🏃 Run Development Servers
   npm run dev

6. 🔍 Verify Setup
   • Frontend: http://localhost:5173
   • Backend: http://localhost:8787
   • Health check: http://localhost:8787/health

For more details, see SETUP_GUIDE.md
`)
}

function main() {
  console.log('🚀 orquestra Project Setup')
  console.log('')

  try {
    createEnvFile()
    printSetupInstructions()
  } catch (error) {
    console.error('❌ Setup failed:', error.message)
    process.exit(1)
  }
}

main()
