import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@ui/card';

const FAQPage = () => {
  // Track which categories are expanded (all expanded by default)
  const [expandedCategories, setExpandedCategories] = useState({
    gettingStarted: true,
    practiceFeatures: true,
    chordCharts: true,
    accountManagement: true,
    billingSubscriptions: true,
    dataPrivacy: true,
  });

  // Track which individual questions are expanded
  const [expandedQuestions, setExpandedQuestions] = useState({});

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const toggleQuestion = (questionId) => {
    setExpandedQuestions(prev => ({
      ...prev,
      [questionId]: !prev[questionId]
    }));
  };

  const FAQCategory = ({ id, title, children }) => (
    <Card className="bg-gray-800 border-gray-700 mb-4">
      <CardHeader
        className="cursor-pointer select-none hover:bg-gray-750 transition-colors"
        onClick={() => toggleCategory(id)}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-100">{title}</h2>
          {expandedCategories[id] ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </CardHeader>
      {expandedCategories[id] && (
        <CardContent className="space-y-3">
          {children}
        </CardContent>
      )}
    </Card>
  );

  const FAQItem = ({ id, question, answer }) => (
    <div className="border-b border-gray-700 last:border-0 pb-3 last:pb-0">
      <button
        onClick={() => toggleQuestion(id)}
        className="w-full text-left flex items-start justify-between gap-4 py-2 hover:text-orange-400 transition-colors"
      >
        <h3 className="font-medium text-gray-200">{question}</h3>
        {expandedQuestions[id] ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
        )}
      </button>
      {expandedQuestions[id] && (
        <div className="mt-2 text-sm text-gray-400 leading-relaxed pl-2">
          {answer}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-gray-100">Frequently asked questions</h1>
      <p className="text-gray-400 mb-8">
        Find answers to common questions about using Guitar Practice Routine App
      </p>

      {/* Getting Started */}
      <FAQCategory id="gettingStarted" title="Getting started">
        <FAQItem
          id="what-are-items"
          question="What are practice items?"
          answer={
            <>
              Practice items are the building blocks of your practice routine. An item can be anything you want to practice: a song, an exercise, a technique, a reminder, or even a warm-up routine. Each item can have details like notes, YouTube links, local file paths, and chord charts attached to it.
            </>
          }
        />
        <FAQItem
          id="what-are-routines"
          question="What are routines?"
          answer={
            <>
              Routines are organized collections of practice items. You create routines to group related items together for structured practice sessions. For example, you might have a "Morning Warmup" routine, a "Jazz Standards" routine, or a "Blues Practice" routine. You can have multiple routines and switch between them based on what you want to work on.
            </>
          }
        />
        <FAQItem
          id="how-to-create-items"
          question="How do I create practice items?"
          answer={
            <>
              Go to the Items page and use the "Add new item" form at the top. You can add details like the item name, notes, links to YouTube videos, paths to local files (like songbooks), and attach chord charts. After creating items, you can add them to routines.
            </>
          }
        />
        <FAQItem
          id="how-to-create-routines"
          question="How do I create and organize routines?"
          answer={
            <>
              On the Routines page, enter a name for your new routine and click "+ Add". Once created, click the edit icon (✏️) next to the routine to add items to it. You can drag and drop items to reorder them within the routine.
            </>
          }
        />
        <FAQItem
          id="active-routine"
          question="What is an active routine?"
          answer={
            <>
              The active routine is the one that appears on your Practice page. To make a routine active, go to the Routines page and click the "+" button next to the routine you want to practice. Only one routine can be active at a time.
            </>
          }
        />
      </FAQCategory>

      {/* Practice Features */}
      <FAQCategory id="practiceFeatures" title="Practice features">
        <FAQItem
          id="practice-timers"
          question="How do practice timers work?"
          answer={
            <>
              Each practice item can have a timer. Click the timer button to start counting up from zero. The timer helps you track how long you spend on each item. You can stop, restart, or reset timers as needed during your practice session.
            </>
          }
        />
        <FAQItem
          id="completion-tracking"
          question="How does completion tracking work?"
          answer={
            <>
              You can mark items as complete during your practice session by clicking the checkbox next to each item. This helps you track your progress through a routine. Completion status resets when you start a new practice session, so you can use the same routine day after day.
            </>
          }
        />
        <FAQItem
          id="youtube-integration"
          question="Can I link YouTube videos to practice items?"
          answer={
            <>
              Yes! When creating or editing an item, you can paste a YouTube URL in the "YouTube link" field. The video will be embedded in the item's details, making it easy to reference tutorial videos or play-along tracks during practice.
            </>
          }
        />
        <FAQItem
          id="local-files"
          question="Can I link to files on my computer?"
          answer={
            <>
              Yes, you can add file paths to items (like paths to PDF songbooks or sheet music on your computer). This is especially useful if you have local resources you want to reference during practice. The app supports both Windows and WSL file paths.
            </>
          }
        />
      </FAQCategory>

      {/* Chord Charts */}
      <FAQCategory id="chordCharts" title="Chord charts">
        <FAQItem
          id="what-are-chord-charts"
          question="What are chord charts?"
          answer={
            <>
              Chord charts are visual diagrams showing how to play chords on guitar. GPRA displays them as interactive chord grids with fret positions, finger placements, and tuning information. You can attach multiple chord charts to each practice item, organized by song sections (intro, verse, chorus, etc.).
            </>
          }
        />
        <FAQItem
          id="autocreate-feature"
          question="What is the autocreate feature?"
          answer={
            <>
              Autocreate uses AI (Claude) to automatically generate chord charts from various sources: PDF files, images of chord charts, YouTube lesson videos, or just by typing the names of chord sections and chords. This saves you from manually creating chord diagrams one by one.
            </>
          }
        />
        <FAQItem
          id="autocreate-access"
          question="How do I use autocreate?"
          answer={
            <>
              <strong>Free and Basic tiers:</strong> Enter your own Anthropic API key on the Account page (this is the "byoClaude" model - bring your own Claude). You'll need an API key from{' '}
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
              >
                Anthropic Console
                <ExternalLink className="w-3 h-3" />
              </a>
              .<br />
              <strong>The Goods tier and above:</strong> Autocreate is included! Just use the feature without needing your own API key.
            </>
          }
        />
        <FAQItem
          id="manual-chord-charts"
          question="Can I create chord charts manually?"
          answer={
            <>
              Yes! You can manually create and edit chord charts using the chord chart editor. This gives you full control over fret positions, finger placements, and chord names. You can access the editor from the Practice, Routines, or Items pages.
            </>
          }
        />
      </FAQCategory>

      {/* Account Management */}
      <FAQCategory id="accountManagement" title="Account management">
        <FAQItem
          id="change-password"
          question="How do I change my password?"
          answer={
            <>
              Go to the Account page, expand the "Change password" section, and enter your current password along with your new password. Your new password must be at least 12 characters long and include uppercase letters, lowercase letters, numbers, and symbols.
            </>
          }
        />
        <FAQItem
          id="change-email"
          question="How do I change my email address?"
          answer={
            <>
              Currently, email changes need to be handled through the Stripe Customer Portal. On the Account page, scroll to your subscription tier and click "Manage billing". This will take you to Stripe where you can update your email address.
            </>
          }
        />
        <FAQItem
          id="oauth-accounts"
          question="I signed up with Google or Tidal. Can I set a password?"
          answer={
            <>
              If you signed up using OAuth (Google or Tidal), you don't have a password by default. You can use the "Change password" section on the Account page to set one - just leave the "Current password" field empty and enter your new password twice.
            </>
          }
        />
        <FAQItem
          id="restart-tour"
          question="How do I restart the guided tour?"
          answer={
            <>
              On the Account page, expand the "Guided tour" section and click the "Restart tour" button. This will reload the page and take you through the interactive tour again.
            </>
          }
        />
        <FAQItem
          id="api-key-management"
          question="How do I manage my Anthropic API key?"
          answer={
            <>
              On the Account page, expand the "Anthropic API key" section. You can add, validate, update, or delete your API key here. Your key is encrypted and stored securely. You can use the "Validate" button to check if your key is working before saving it.
            </>
          }
        />
      </FAQCategory>

      {/* Billing & Subscriptions */}
      <FAQCategory id="billingSubscriptions" title="Billing and subscriptions">
        <FAQItem
          id="subscription-tiers"
          question="What are the different subscription tiers?"
          answer={
            <>
              GPRA offers 5 tiers:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li><strong>Free:</strong> 15 items, 1 routine, byoClaude for autocreate</li>
                <li><strong>Basic:</strong> 80 items, 5 routines, byoClaude for autocreate</li>
                <li><strong>The Goods:</strong> 200 items, 10 routines, autocreate included</li>
                <li><strong>More Goods:</strong> 600 items, 25 routines, autocreate included</li>
                <li><strong>The Most:</strong> 1500 items, 50 routines, autocreate included</li>
              </ul>
              All paid tiers can be billed monthly or yearly (yearly saves ~25%).
            </>
          }
        />
        <FAQItem
          id="upgrade-downgrade"
          question="How do I upgrade or downgrade my subscription?"
          answer={
            <>
              On the Account page, find the subscription tier you want in the right column and click the "Upgrade" or "Change tier" button. This will take you through the Stripe checkout process for tier changes.
            </>
          }
        />
        <FAQItem
          id="cancel-subscription"
          question="How do I cancel my subscription?"
          answer={
            <>
              There are two ways to stop your paid subscription:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li><strong>Pause (recommended):</strong> On the Account page in the "Danger zone" section, click "Pause subscription when it expires". You'll keep access to your most recently active routine for free, and we'll save your other routines for 90 days in case you renew.</li>
                <li><strong>Cancel:</strong> Use the Stripe Customer Portal (click "Manage billing" on the Account page) to fully cancel your subscription. You'll keep access until the end of your billing period, then revert to the free tier.</li>
              </ul>
            </>
          }
        />
        <FAQItem
          id="unplugged-mode"
          question="What is unplugged mode?"
          answer={
            <>
              Unplugged mode is a grace period after your paid subscription ends. You can still access your most recently active routine for free for 90 days. Your other routines are saved during this time in case you decide to renew. After 90 days, if you haven't renewed, your account will be permanently downgraded to the free tier and excess data will be deleted.
            </>
          }
        />
        <FAQItem
          id="billing-portal"
          question="How do I view my invoices and payment methods?"
          answer={
            <>
              On the Account page, find your current subscription tier and click "Manage billing". This opens the Stripe Customer Portal where you can view invoices, update payment methods, and manage your subscription details.
            </>
          }
        />
      </FAQCategory>

      {/* Data & Privacy */}
      <FAQCategory id="dataPrivacy" title="Data and privacy">
        <FAQItem
          id="data-download"
          question="How do I download my practice data?"
          answer={
            <>
              On the Account page, expand the "Practice data download" section and click "Download CSV" or "Download JSON". This will download your practice history from the last 90 days. Practice data older than 90 days is automatically deleted, so download regularly if you want to keep permanent records.
            </>
          }
        />
        <FAQItem
          id="analytics-tracking"
          question="Does GPRA track my activity?"
          answer={
            <>
              We use PostHog for anonymous usage analytics to help improve the app. This is opt-in only - you'll see a cookie consent banner when you first visit, and you can change your preference anytime on the Account page in the "Analytics and privacy" section. We never sell your data.
            </>
          }
        />
        <FAQItem
          id="delete-account"
          question="How do I delete my account?"
          answer={
            <>
              On the Account page, expand the "Danger zone" section. You have two deletion options:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li><strong>Schedule deletion:</strong> Your account will be deleted at the end of your current billing period (paid users only)</li>
                <li><strong>Delete immediately:</strong> Your account and all data are deleted right away (no refunds for paid users)</li>
              </ul>
              Both options require you to type a confirmation phrase and verify your email. Account deletion is permanent and cannot be undone.
            </>
          }
        />
        <FAQItem
          id="data-security"
          question="How is my data protected?"
          answer={
            <>
              Your data is protected with industry-standard security measures:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>All connections use HTTPS encryption</li>
                <li>Passwords are hashed using secure algorithms</li>
                <li>API keys are encrypted before storage</li>
                <li>Row-Level Security (RLS) isolates your data from other users</li>
                <li>Regular automated backups</li>
              </ul>
              See our{' '}
              <a href="/privacy" className="text-orange-400 hover:text-orange-300">
                Privacy Policy
              </a>
              {' '}for full details.
            </>
          }
        />
      </FAQCategory>

      {/* Contact Section */}
      <div className="mt-8 p-6 bg-gray-800 border border-gray-700 rounded-lg">
        <h2 className="text-lg font-semibold text-gray-100 mb-2">Still have questions?</h2>
        <p className="text-gray-400 mb-4">
          If you didn't find what you're looking for, feel free to reach out.
        </p>
        <a
          href="mailto:support@guitarpracticeroutine.com"
          className="inline-block px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors"
        >
          Contact support
        </a>
      </div>
    </div>
  );
};

export default FAQPage;
