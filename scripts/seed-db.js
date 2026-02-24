#!/usr/bin/env node

/**
 * Database seeding script
 * Populates D1 database with sample data for development
 */

const sampleUsers = [
  {
    id: 'user_1',
    github_id: 12345,
    username: 'developer1',
    email: 'dev1@example.com',
    avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
  },
]

const sampleProjects = [
  {
    id: 'proj_1',
    user_id: 'user_1',
    name: 'My First Program',
    description: 'Sample Solana program',
    program_id: '11111111111111111111111111111111',
    is_public: true,
  },
]

const sampleIDLVersions = [
  {
    id: 'idl_v_1',
    project_id: 'proj_1',
    idl_json: JSON.stringify({ version: '0.1.0', name: 'sample' }),
    cpi_md: null,
    version: 1,
  },
]

async function seedDatabase(db) {
  console.log('🌱 Seeding database...')

  try {
    // Users
    console.log('  → Adding users...')
    for (const user of sampleUsers) {
      await db.prepare(`
        INSERT INTO users (id, github_id, username, email, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(user.id, user.github_id, user.username, user.email, user.avatar_url).run()
    }

    // Projects
    console.log('  → Adding projects...')
    for (const project of sampleProjects) {
      await db.prepare(`
        INSERT INTO projects (id, user_id, name, description, program_id, is_public)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        project.id,
        project.user_id,
        project.name,
        project.description,
        project.program_id,
        project.is_public,
      ).run()
    }

    // IDL Versions
    console.log('  → Adding IDL versions...')
    for (const idl of sampleIDLVersions) {
      await db.prepare(`
        INSERT INTO idl_versions (id, project_id, idl_json, cpi_md, version)
        VALUES (?, ?, ?, ?, ?)
      `).bind(idl.id, idl.project_id, idl.idl_json, idl.cpi_md, idl.version).run()
    }

    console.log('✅ Database seeding complete!')
  } catch (error) {
    console.error('❌ Error seeding database:', error)
    process.exit(1)
  }
}

// Export for use in other scripts
module.exports = { seedDatabase }
