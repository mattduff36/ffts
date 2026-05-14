/**
 * Centralized Environment Configuration
 * 
 * This module validates and exports all environment variables used in the application.
 * All environment variable access should go through this module to ensure type safety
 * and proper validation.
 * 
 * Usage:
 *   import { env } from '@/lib/config/env';
 *   const url = env.NEXT_PUBLIC_SUPABASE_URL;
 */

import { z } from 'zod';

// Define the schema for environment variables
const envSchema = z.object({
  // Supabase Configuration (Required)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase anon key is required'),
  
  // Database Configuration (Optional - used in scripts)
  POSTGRES_URL_NON_POOLING: z.string().url().optional(),
  
  // Email Configuration (Optional - for error reporting)
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  RESEND_API_KEY_2: z.string().min(1).optional(),
  RESEND_FROM_EMAIL_2: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
  TEMPLATE_SUPERADMIN_EMAIL: z.string().email().optional(),
  APP_MODE: z.enum(['development', 'template', 'demo', 'production']).optional(),
  NEXT_PUBLIC_APP_MODE: z.enum(['development', 'template', 'demo', 'production']).optional(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).optional(),
  NEXT_PUBLIC_SHORT_APP_NAME: z.string().min(1).optional(),
  NEXT_PUBLIC_COMPANY_NAME: z.string().min(1).optional(),
  NEXT_PUBLIC_COMPANY_ADDRESS: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPPORT_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_ADMIN_EMAIL: z.string().email().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_LOGO_PATH: z.string().min(1).optional(),
  NEXT_PUBLIC_FAVICON_PATH: z.string().min(1).optional(),
  NEXT_PUBLIC_BRAND_COLOR: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  NEXT_PUBLIC_BRAND_COLOR_HOVER: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  NEXT_PUBLIC_PWA_BACKGROUND_COLOR: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  NEXT_PUBLIC_DEMO_EMAIL_DOMAIN: z.string().min(1).optional(),
  DEMO_SUPABASE_PROJECT_REF: z.string().min(1).optional(),
  DEMO_RESET_CONFIRM: z.string().optional(),
  APP_SESSION_SECRET: z.string().min(1).optional(),
  APP_SESSION_HASH_SECRET: z.string().min(1).optional(),
  
  // Vercel Analytics (Optional)
  NEXT_PUBLIC_VERCEL_ANALYTICS_ID: z.string().optional(),
  
  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Parse and validate environment variables
function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('Environment validation failed');
    }
    throw error;
  }
}

// Export validated environment variables
// This will validate on first import
export const env = validateEnv();

// Export type for use in other files
export type Env = z.infer<typeof envSchema>;
