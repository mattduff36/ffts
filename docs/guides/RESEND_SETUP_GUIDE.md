# Resend Email Setup Guide

## Quick Start (5 minutes)

### Step 1: Create Resend Account
1. Go to https://resend.com
2. Click **"Sign Up"** (free tier available)
3. Verify your email address

### Step 2: Get API Key
1. Log into Resend dashboard
2. Navigate to **API Keys** in the sidebar
3. Click **"Create API Key"**
4. Name it: `FieldOps Template Production` (or similar)
5. Copy the API key (starts with `re_...`)
6. **Important**: Save it securely - you won't see it again!

### Step 3: Configure Sender Domain

#### Option A: Use Testing Domain (Quick)
For testing/development only:
- Default sender: `onboarding@resend.dev`
- No setup required
- Limited to 100 emails/day

#### Option B: Add Your Domain (Recommended)
For production use:
1. In Resend dashboard, go to **Domains**
2. Click **"Add Domain"**
3. Enter your domain (e.g., `example.com`)
4. Add the DNS records to your domain provider:
   - **TXT record** for verification
   - **MX records** for deliverability (optional but recommended)
   - **DKIM records** for authentication
5. Wait for verification (usually 5-15 minutes)
6. Once verified, you can use any email like: `noreply@example.com`

### Step 4: Update Environment Variables
Edit your `.env.local` file:

```env
# Add these lines (replace with your actual values)
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=noreply@yourdomain.com

# Or use test domain:
RESEND_FROM_EMAIL=onboarding@resend.dev
```

### Step 5: Restart Development Server
```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

### Step 6: Test the Integration
1. Go to **Admin → Users** in your app
2. Click **"Add User"**
3. Create a test user with your email
4. Check:
   - ✅ Password displays in modal
   - ✅ Check your inbox for welcome email
   - ✅ Email should arrive within seconds

## Testing Checklist

### Development Testing (Using resend.dev)
- [x] Set `RESEND_FROM_EMAIL=onboarding@resend.dev`
- [x] Create test user with your personal email
- [x] Verify email arrives
- [x] Test password reset email

### Production Setup (Using your domain)
- [ ] Domain verified in Resend
- [ ] DNS records configured
- [ ] `RESEND_FROM_EMAIL` set to your domain
- [ ] Test emails sent successfully
- [ ] Check spam folder if emails not arriving
- [ ] Test from production environment

## Pricing (as of Oct 2024)

### Free Tier
- 100 emails per day
- 3,000 emails per month
- Perfect for testing and small teams

### Pro Tier ($20/month)
- 50,000 emails per month
- Dedicated IP available
- Priority support

### Scale Tier
- Custom pricing
- Higher volumes
- Enterprise features

## Troubleshooting

### "Email service not configured" error
**Problem**: `RESEND_API_KEY` not set  
**Solution**: Add the API key to `.env.local` and restart server

### Emails not arriving
1. **Check spam/junk folder** - This is the most common issue
2. **Verify sender domain** - Make sure domain is verified in Resend
3. **Check Resend logs** - Go to "Logs" in Resend dashboard
4. **Test with personal email** - Gmail, Outlook, etc.
5. **Check API key** - Ensure it's correct and not expired

### "Invalid from address" error
**Problem**: Using unverified domain  
**Solution**: Either:
- Use `onboarding@resend.dev` for testing
- Or verify your domain in Resend first

### Rate limit exceeded
**Problem**: Sent too many emails (100/day on free tier)  
**Solution**: 
- Upgrade to Pro tier
- Or wait until next day
- Or use fewer test emails

## DNS Configuration Example

When adding your domain to Resend, you'll need to add these DNS records:

### For Domain: `example.com`

| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | @ | `resend-verification=xyz123...` | 3600 |
| MX | @ | `feedback-smtp.resend.com` | 3600 |
| TXT | resend._domainkey | `p=MIGfMA0GCS...` | 3600 |

**Note**: Exact values will be provided by Resend when you add your domain.

## Email Deliverability Tips

### Improve Inbox Placement
1. **Use authenticated domain** - Don't use resend.dev in production
2. **Set up SPF, DKIM, DMARC** - Resend handles this automatically
3. **Use professional "from" address** - Like `noreply@example.com`
4. **Professional email content** - Already handled in templates
5. **Avoid spam triggers** - Templates already optimized

### Monitor Email Performance
1. Go to **Logs** in Resend dashboard
2. Check delivery status for each email
3. Review bounce and spam rates
4. Test with multiple email providers

## Alternative Email Providers

If you prefer not to use Resend:

### SendGrid
- Update `lib/utils/email.ts` to use SendGrid API
- Similar setup process

### AWS SES
- More complex setup
- Requires AWS account
- Very cost-effective at scale

### Mailgun
- Good alternative
- Similar features to Resend

### SMTP (Generic)
- Use Nodemailer
- Works with any SMTP provider
- More configuration needed

## Support

### Resend Documentation
- Docs: https://resend.com/docs
- API Reference: https://resend.com/docs/api-reference
- SDKs: Available for Node.js, Python, Ruby, etc.

### Common Issues
- **Status page**: https://status.resend.com
- **Support**: support@resend.com
- **Community**: Discord & GitHub Discussions

## Security Best Practices

### Protect Your API Key
- ✅ Never commit `.env.local` to git
- ✅ Use different keys for dev/staging/production
- ✅ Rotate keys periodically
- ✅ Restrict key permissions if possible

### Email Content Security
- ✅ Templates don't include sensitive data
- ✅ Passwords are temporary
- ✅ Links are HTTPS only
- ✅ Professional, legitimate-looking content

## Next Steps After Setup

Once Resend is configured:

1. ✅ Test user creation flow
2. ✅ Test password reset flow
3. ✅ Verify emails arrive quickly
4. ✅ Check email rendering on different clients
5. ✅ Set up monitoring/alerts in Resend
6. ✅ Add company logo to email templates (optional)
7. ✅ Customize email content if needed

---

**Setup Time**: ~5 minutes with testing domain, ~30 minutes with custom domain  
**Cost**: Free for testing and small teams  
**Status**: Ready to configure

