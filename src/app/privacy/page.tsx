import { H2, LegalPage, List } from "@/components/legal";

export const metadata = { title: "Privacy" };

/*
 * Every statement here is what the code does (see the migrations, src/lib/connector,
 * src/lib/counselor and src/app/desk/settings). Change it when they change.
 */

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="September 27, 2026">
      <p>
        Average App is a free, open-source place for high school students to write their college essays and keep track of their
        applications. The essays on it are mostly written by minors, so it collects as little as it can, sells nothing, and lets you
        delete everything yourself. This page says what happens to your information. The code is public, so anyone can check.
      </p>

      <H2>What we store</H2>
      <List>
        <li>
          <strong>Your account:</strong> your email address and first name, and your password if you use one. Sign-in is run by
          Supabase, which stores passwords scrambled; we never see them. If you sign in with Google, we keep the first name on your
          Google account.
        </li>
        <li>
          <strong>Your desk:</strong> what you put on it. Your colleges and deadlines, your essays and short answers with their notes
          and version history, suggestions people make, your recommenders&apos; names, and the odds, costs and notes on your Strategy
          page.
        </li>
        <li>
          <strong>Your profile:</strong> what you write about yourself, your academics (GPA, test scores, class rank, courses), any
          transcript you paste in, and files you upload to it (a resume, a school&apos;s form), with the copies your counselor fills
          in.
        </li>
        <li>
          <strong>What you ask your counselor:</strong> your questions and messages, the passages you ask about, and the answers.
        </li>
        <li>
          <strong>Sharing:</strong> your desk&apos;s name and sharing password (the password only in scrambled form), any links
          you make (also scrambled), and the name each person types when they open your desk.
        </li>
        <li>
          <strong>Claude or ChatGPT, if you connect them:</strong> a scrambled copy of each connector link, when it was last used,
          and the last thing it did (for example, which essay it read), so the site can show you.
        </li>
      </List>
      <p>
        In your browser, the site keeps a cookie that keeps you signed in, and uses your browser&apos;s storage for edits that
        haven&apos;t reached the server yet and for your preferences, like which panels are folded.
      </p>
      <p>
        There are no analytics, ads or trackers, and your essays aren&apos;t logged. We don&apos;t sell or rent your information to
        anyone.
      </p>

      <H2>Who can see your desk</H2>
      <List>
        <li>You.</li>
        <li>
          People you share with: anyone you tell your desk&apos;s name and password (they open it from the home page), and anyone
          you give a link. They can read your colleges (with the odds and notes on them, and the reasoning behind the odds,
          which can mention your grades and scores), your essays, their notes and history, suggestions and your recommenders. Depending on what you choose, they can also suggest edits or make them, comment on highlighted words, and write in each essay&apos;s notes. They
          can&apos;t see your profile, your academics or your conversations with your counselor, except the Ask chat on each essay:
          they can read the questions asked there and the answers (your own too, including ones from before you shared your
          desk; answers may draw on your profile), and ask in it if they can suggest or edit, while your counselor is on. The
          counselor answers them on your Claude plan from only what they can already read on your desk, apart from your
          conversation with it, and changes nothing for them. Only what you asked before September 27, 2026, when the chat
          became shared, stays yours. You can remove anyone, and
          turning sharing off (or a link) cuts off everyone who came in that way, at once.
        </li>
        <li>An AI assistant, but only one you connect yourself (below).</li>
      </List>
      <p>Nothing on your desk is public.</p>

      <H2>AI</H2>
      <p>The site itself never sends your writing to an AI. An AI only gets involved if you set one up:</p>
      <List>
        <li>
          <strong>Connecting Claude or ChatGPT.</strong> You make a connector link in Settings and add it to your own Claude or
          ChatGPT account. From then on, that assistant can read your whole desk: your essays, notes, profile, academics, colleges
          and questions. It can do what you allow for that link, which is suggesting edits, writing directly, or managing your
          colleges and essays. Any link can also update your profile, academics and odds, fill in forms you upload (saving a filled
          copy next to yours), and answer your questions. New links start
          with everything allowed; you can change that when you make one or at any time. You can turn a link off whenever you like.
        </li>
        <li>
          <strong>The counselor.</strong> A setup for Windows (a file) or Mac (a line for Terminal) that runs Claude Code, on your own Claude account, on your own
          computer. If Claude Code isn&apos;t there yet, the setup installs it from Anthropic, with your OK, and you sign in to it with
          your Claude account. You can run it on several computers; each tells the site its computer&apos;s name (shown to you
          in Settings) and a scrambled id that tells your computers apart. It keeps its settings (including its connector link) and a log in a folder on your computer, and Claude Code
          keeps its conversation there too. &ldquo;Remove from computer&rdquo; in Settings deletes them; otherwise they stay until
          you delete them.
        </li>
      </List>
      <p>
        Either way the AI runs on your own account, so what Anthropic (Claude) or OpenAI (ChatGPT) does with those conversations is
        up to their privacy policies and your settings there. We suggest turning off model training on your chats.
      </p>

      <H2>Services the site uses</H2>
      <List>
        <li>
          <strong>Supabase</strong> stores the database and runs sign-in.
        </li>
        <li>
          <strong>Vercel</strong> hosts the site. Every page and request goes through its servers, which keep ordinary request logs.
        </li>
        <li>
          <strong>An email provider</strong> sends sign-in codes. It gets your email address and the code.
        </li>
        <li>
          <strong>Google</strong>, only if you choose to sign in with Google or import essays from Google Drive. Import can only open
          the files you pick. Your browser reads them, and the text of the essays you choose to import is sent to the site to save
          on your desk.
        </li>
      </List>
      <p>Each handles data under its own terms. None of them gets your information from us for advertising.</p>

      <H2>Keeping and deleting</H2>
      <List>
        <li>
          <strong>Delete everything:</strong> Settings → Account → Delete my data deletes your account and everything on your desk
          from the database right away. It doesn&apos;t go to the Trash and can&apos;t be undone. To keep your writing, use
          &ldquo;Download all my writing&rdquo; on the same page first.
        </li>
        <li>
          <strong>The Trash:</strong> a deleted essay or college waits there for 30 days, then is deleted for good.
        </li>
        <li>
          <strong>Version history:</strong> older versions are thinned out over time (hourly, then daily, then weekly) and kept as
          long as the essay.
        </li>
        <li>We don&apos;t keep backups of the database, so what you delete is gone.</li>
        <li>
          Deleting your desk can&apos;t reach your conversations in your own Claude or ChatGPT account, or the counselor&apos;s folder
          on your computer. Use &ldquo;Remove from computer&rdquo; first, or delete the folder yourself.
        </li>
        <li>
          When someone opens one of your share links, the name they type is kept with the sign-in that lets them back in. Deleting
          your desk removes them from it, but that sign-in, with the name, stays.
        </li>
      </List>

      <H2>Security</H2>
      <p>
        The database only lets you, and the people you&apos;ve shared with, read your desk. Your sharing password, share links
        and connector links are stored only in scrambled form, and wrong passwords are limited to slow down guessing. No
        system is perfectly secure, though: anyone with your desk&apos;s name and password can open it, and a link is its own
        key. Choose a password that&apos;s hard to guess, share it only with people you trust, and turn sharing off when you&apos;re
        done.
      </p>

      <H2>Age</H2>
      <p>
        Average App is made for high school students. It isn&apos;t meant for anyone under 13, and we don&apos;t knowingly collect
        information from children under 13. If a child under 13 is using it, they or a parent can delete the account in Settings →
        Account.
      </p>

      <H2>Changes</H2>
      <p>If this policy changes, the new version goes here with a new date at the top.</p>

      <H2>Your information</H2>
      <p>
        You can see and change everything on your desk, download your writing (Settings → Account → Download all my writing), and
        delete any of it, or all of it (Settings → Account → Delete my data).
      </p>
    </LegalPage>
  );
}
