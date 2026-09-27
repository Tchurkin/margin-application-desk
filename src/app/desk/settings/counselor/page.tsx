import { requireDesk } from "@/lib/supabase/server";
import { SettingsHeader } from "../settings-header";
import { CounselorManage } from "./manage";

export default async function CounselorSettingsPage() {
  const { desk } = await requireDesk();
  return (
    <>
      <SettingsHeader title="Counselor">
        <p className="rounded-md border border-line bg-bg px-3 py-2" data-testid="counselor-why">
          <span className="font-medium">Why a download?</span> The website could ask Claude itself, through Anthropic&apos;s API,
          but that&apos;s paid by the answer and costs far more than the Claude plan you already have. So instead, the counselor is a
          small workaround: it lets Claude Code, which comes with your Claude plan, answer what you ask here, on your own computer.
        </p>
        <p>
          Make Claude your counselor on this computer, so everything you ask on your desk gets answered on its own, with no chat to
          open. It&apos;s one download on Windows, or one line in Terminal on a Mac, run once: it works in the background, starts whenever you sign in, and
          uses your Claude plan only when you ask something. It remembers what you&apos;ve told it from one question to the next.
        </p>
        <p>
          It runs on Claude Code, Anthropic&apos;s app for your Claude account, on your own Claude plan (Pro or Max). If this computer
          doesn&apos;t have Claude Code yet, the setup installs it for you and opens your browser so you can sign in once: nothing to
          type.
        </p>
      </SettingsHeader>
      <CounselorManage deskId={desk.id} />
    </>
  );
}
