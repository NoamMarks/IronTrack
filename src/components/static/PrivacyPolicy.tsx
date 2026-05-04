import { Dumbbell } from 'lucide-react';

/**
 * Static privacy policy page rendered at `https://irontrack.vercel.app/privacy`.
 * Required by the Google Play Store listing — the link in the listing must
 * resolve to a hosted policy that is accurate to what the app actually
 * collects.
 *
 * Kept as a single in-bundle component so the web build serves it without
 * any extra hosting setup; the SPA shell short-circuits to render this
 * component when `window.location.pathname === '/privacy'`.
 */
export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-background" />
          </div>
          <span className="text-lg font-bold uppercase tracking-widest font-mono">IronTrack</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 prose-style font-mono text-sm leading-relaxed space-y-8">
        <div>
          <h1 className="text-3xl font-bold uppercase tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-xs uppercase tracking-widest">
            Effective: 2026-05-04
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">1. What we collect</h2>
          <p>
            IronTrack stores the data you give us to operate your training plan:
            your name, your email, the workout programs your coach assigns, the
            sets and loads you log, RPE values, and any optional video clips you
            attach to a set for form review.
          </p>
          <p>
            We do <strong>not</strong> collect device identifiers, advertising IDs,
            location, contacts, or analytics events. The app contains no
            third-party tracking SDKs.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">2. Where it lives</h2>
          <p>
            All data is stored in our Supabase project (PostgreSQL with row-level
            security). Authentication is handled by Supabase Auth. Workout videos,
            if you upload them, are stored in Supabase Storage. We do not
            replicate your data to any other system.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">3. Who can see it</h2>
          <p>
            Your coach (the account that invited you) has access to your training
            data within their tenant. No other coach, trainee, or third party can
            read your data — row-level security enforces this at the database
            level. Anthropic, OpenAI, advertisers, brokers — none of them ever
            receive your data, because we never send it to them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">4. Your rights</h2>
          <p>
            You can ask your coach to delete your account at any time, which
            removes your profile and all associated workout history from our
            database. You can export your data on request — email{' '}
            <a href="mailto:noammrks@gmail.com" className="underline">
              noammrks@gmail.com
            </a>{' '}
            and we will return a JSON dump within 30 days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">5. Children</h2>
          <p>
            IronTrack is not directed at children under 13. We do not knowingly
            collect data from children under 13.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">6. Changes</h2>
          <p>
            If we change what we collect, we will update the effective date above
            and notify the email on file at least 30 days before the change
            takes effect.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold uppercase tracking-wider">7. Contact</h2>
          <p>
            Questions, deletion requests, or rights enquiries:{' '}
            <a href="mailto:noammrks@gmail.com" className="underline">
              noammrks@gmail.com
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
