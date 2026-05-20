import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';
import { ALL_MODULES, type ModuleName } from '../../types/roles';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const targetProjectRef = process.env.DEMO_SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF;
const validModules = new Set<ModuleName>(ALL_MODULES);

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

if (targetProjectRef && !connectionString.includes(targetProjectRef)) {
  console.error('❌ Database connection string does not target the approved Supabase project.');
  console.error(`Expected project ref: ${targetProjectRef}`);
  process.exit(1);
}

// Type assertion since we've validated above
const validConnectionString = connectionString as string;

interface FAQCategory {
  slug: string;
  name: string;
  sort_order: number;
  description?: string;
  module_name?: ModuleName | null;
}

interface FAQArticle {
  category_slug: string;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  sort_order?: number;
}

interface FAQData {
  categories: FAQCategory[];
  articles: FAQArticle[];
}

async function seedFAQ() {
  console.log('🚀 Seeding FAQ Content...\n');

  // Parse connection string
  const url = new URL(validConnectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Load FAQ data
    const faqDataPath = resolve(process.cwd(), 'scripts/seed/data/faq-howto.json');
    const faqData: FAQData = JSON.parse(readFileSync(faqDataPath, 'utf-8'));
    validateFAQData(faqData);
    
    console.log(`📚 Found ${faqData.categories.length} categories and ${faqData.articles.length} articles\n`);

    // Upsert categories
    console.log('📁 Upserting categories...');
    const categoryIdMap: Record<string, string> = {};
    
    for (const category of faqData.categories) {
      const result = await client.query(`
        INSERT INTO faq_categories (name, slug, description, sort_order, module_name, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (slug) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          module_name = EXCLUDED.module_name,
          is_active = TRUE,
          updated_at = NOW()
        RETURNING id
      `, [
        category.name,
        category.slug,
        category.description || null,
        category.sort_order,
        category.module_name || null,
      ]);
      
      categoryIdMap[category.slug] = result.rows[0].id;
      console.log(`   ✅ ${category.name}`);
    }

    // Upsert articles
    console.log('\n📝 Upserting articles...');
    let articleCount = 0;
    
    for (const article of faqData.articles) {
      const categoryId = categoryIdMap[article.category_slug];
      
      if (!categoryId) {
        console.log(`   ⚠️  Skipping "${article.title}" - category "${article.category_slug}" not found`);
        continue;
      }
      
      await client.query(`
        INSERT INTO faq_articles (category_id, title, slug, summary, content_md, is_published, sort_order)
        VALUES ($1, $2, $3, $4, $5, TRUE, $6)
        ON CONFLICT (category_id, slug) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          content_md = EXCLUDED.content_md,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
      `, [
        categoryId,
        article.title,
        article.slug,
        article.summary,
        article.content_md,
        article.sort_order ?? articleCount,
      ]);
      
      articleCount++;
    }
    
    console.log(`   ✅ ${articleCount} articles upserted`);

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ FAQ CONTENT SEEDED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Verify counts
    const { rows: catCount } = await client.query('SELECT COUNT(*) FROM faq_categories');
    const { rows: artCount } = await client.query('SELECT COUNT(*) FROM faq_articles');
    
    console.log('📊 Database now contains:');
    console.log(`   • ${catCount[0].count} FAQ categories`);
    console.log(`   • ${artCount[0].count} FAQ articles\n`);

  } catch (err: unknown) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ SEED FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const msg = err instanceof Error ? err.message : String(err);
    const detail = (err as { detail?: string }).detail;
    console.error('Error:', msg);
    if (detail) {
      console.error('Details:', detail);
    }
    
    if (msg.includes('does not exist')) {
      console.log('\n💡 Tip: Run the migration first:');
      console.log('   npx tsx scripts/migrations/run-faq-suggestions-migration.ts\n');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

function validateFAQData(faqData: FAQData): void {
  const categorySlugs = new Set<string>();

  for (const category of faqData.categories) {
    if (!category.slug || !category.name) {
      throw new Error('Each FAQ category must include a slug and name.');
    }
    if (categorySlugs.has(category.slug)) {
      throw new Error(`Duplicate FAQ category slug: ${category.slug}`);
    }
    categorySlugs.add(category.slug);

    if (category.module_name && !validModules.has(category.module_name)) {
      throw new Error(`Invalid module_name "${category.module_name}" for FAQ category "${category.slug}".`);
    }
  }

  const articleKeys = new Set<string>();
  for (const article of faqData.articles) {
    if (!categorySlugs.has(article.category_slug)) {
      throw new Error(`FAQ article "${article.slug}" references missing category "${article.category_slug}".`);
    }
    if (!article.slug || !article.title || !article.content_md) {
      throw new Error(`FAQ article in category "${article.category_slug}" is missing slug, title, or content.`);
    }

    const articleKey = `${article.category_slug}:${article.slug}`;
    if (articleKeys.has(articleKey)) {
      throw new Error(`Duplicate FAQ article slug in category: ${articleKey}`);
    }
    articleKeys.add(articleKey);
  }
}

seedFAQ().catch(console.error);
