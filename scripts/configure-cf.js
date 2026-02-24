#!/usr/bin/env node

/**
 * Utility to generate Cloudflare resource IDs
 * and update wrangler.toml with actual values
 */

const fs = require('fs')
const path = require('path')

function updateWranglerConfig(type, name, id, previewId = null) {
  const wranglerPath = path.join(__dirname, '../wrangler.toml')
  let content = fs.readFileSync(wranglerPath, 'utf-8')

  if (type === 'd1') {
    content = content.replace(
      new RegExp(`database_id = "YOUR_D1.*?ID"`),
      `database_id = "${id}"`,
    )
  } else if (type === 'kv') {
    content = content.replace(
      new RegExp(`id = "YOUR_KV_${name.toUpperCase()}_ID"`),
      `id = "${id}"`,
    )
    if (previewId) {
      content = content.replace(
        new RegExp(`preview_id = "YOUR_KV_${name.toUpperCase()}_PREVIEW_ID"`),
        `preview_id = "${previewId}"`,
      )
    }
  }

  fs.writeFileSync(wranglerPath, content)
  console.log(`✅ Updated wrangler.toml with ${type} configuration`)
}

function main() {
  console.log('📋 Cloudflare Resource Configuration')
  console.log('')
  console.log(
    'Run the following commands and provide the IDs to update wrangler.toml:',
  )
  console.log('')
  console.log('1. Create D1 Databases:')
  console.log('   wrangler d1 create orquestra-prod')
  console.log('   wrangler d1 create orquestra-dev')
  console.log('')
  console.log('2. Create KV Namespaces:')
  console.log('   wrangler kv:namespace create "IDLS"')
  console.log('   wrangler kv:namespace create "CACHE"')
  console.log('')
  console.log('3. Then run:')
  console.log('   node scripts/configure-cf.js --d1-id <id> --kv-idls-id <id>')
  console.log('')
}

main()
