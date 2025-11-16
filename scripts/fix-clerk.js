#!/usr/bin/env node

/**
 * Fix for @clerk/react@5.54.0 bug:
 * Adds missing loadClerkUiScript export to @clerk/shared
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@clerk',
  'shared',
  'dist',
  'runtime',
  'loadClerkJsScript.mjs'
)

const fix = 'export { loadClerkJsScript as loadClerkUiScript };'

try {
  if (!fs.existsSync(filePath)) {
    console.log('⚠️  Clerk fix: File not found (maybe @clerk/shared not installed yet)')
    console.log(`   Path: ${filePath}`)
    process.exit(0) // Don't fail, just skip
  }

  const content = fs.readFileSync(filePath, 'utf8')

  if (content.includes('loadClerkUiScript')) {
    console.log('✅ Clerk fix already applied')
    process.exit(0)
  }

  // Add the fix
  const newContent = content.trim() + '\n' + fix + '\n'
  fs.writeFileSync(filePath, newContent, 'utf8')

  console.log('✅ Clerk fix applied successfully')
  console.log(`   Added: ${fix}`)
} catch (error) {
  console.error('❌ Error applying Clerk fix:', error.message)
  // Don't fail the install if the fix fails
  process.exit(0)
}
