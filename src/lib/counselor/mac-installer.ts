/*
 * The counselor for Mac: the same counselor as installer.ts (Windows), built for macOS 13 and
 * later with only what every Mac has.
 *
 * - The download is a zip holding one file, "Average App counselor setup.command", marked
 *   executable (a browser can't mark a download executable; a zip can carry it). The student
 *   double-clicks it; macOS asks once, in System Settings → Privacy & Security → Open Anyway,
 *   as it does for any file not from a registered developer. Terminal runs it: nothing to type.
 * - It writes the counselor's folder (~/Library/Application Support/AverageApp/Counselor) and a
 *   LaunchAgent that starts the watcher at every login, in the background.
 * - The watcher is Perl (/usr/bin/perl, which macOS 13 through 26 ship, and core modules only;
 *   HTTPS goes through /usr/bin/curl) and does exactly what the Windows watcher does: asks the
 *   desk every couple of seconds, keeps one Claude Code running over stream-json, streams the
 *   reply onto the desk, switches models in place, follows pause, update, removal and revocation.
 *
 * Everything lives in String.raw templates: no backticks in them, and "${" only for our own
 * substitutions. The files must be plain ASCII with LF line endings.
 */

import { CHECK_PROMPT, checkedConfig, COUNSELOR_BRIEF, COUNSELOR_VERSION, MCP_SERVER, type InstallerConfig } from "./installer";

/** The LaunchAgent's label (and file name, with .plist). */
export const MAC_LABEL = "com.averageapp.counselor";
/** The counselor's folder, under the student's home folder. */
export const MAC_DIR = "Library/Application Support/AverageApp/Counselor";
/** The watcher's file name: what the Mac shows under Login Items. */
export const MAC_WATCHER_NAME = "Average App counselor";
export const MAC_INSTALLER_NAME = "Average App counselor setup.command";
export const MAC_ZIP_NAME = "Average App counselor setup.zip";

/** The watcher, saved as "Average App counselor" in the counselor's folder. Perl 5.30 (macOS 13's) at most. */
const WATCHER = String.raw`#!/usr/bin/perl
# Average App counselor ${COUNSELOR_VERSION} for Mac: watches the desk and has Claude Code answer what is asked.
# launchd starts it at login (~/Library/LaunchAgents/${MAC_LABEL}.plist). Log: counselor.log in this folder.
use strict;
use warnings;
use JSON::PP;
use IO::Select;
use IPC::Open3;
use POSIX ();
use Fcntl qw(:flock);
use Time::HiRes qw(time sleep);
use File::Basename qw(dirname);
use File::Glob qw(bsd_glob);
use File::Path qw(remove_tree);
use Cwd qw(abs_path);
use Symbol qw(gensym);

$SIG{PIPE} = 'IGNORE';
my $Version = '${COUNSELOR_VERSION}';
my $Dir = dirname(abs_path($0));
chdir $Dir;
my $Home = $ENV{HOME};
my $J = JSON::PP->new->utf8->canonical->allow_nonref;
my $LogFile = "$Dir/counselor.log";
my $SessionFile = "$Dir/session.txt";
my $Mcp = "$Dir/mcp.json";
my $Headers = "$Dir/headers.txt";
my $Plist = "$Home/Library/LaunchAgents/${MAC_LABEL}.plist";
my $Test = $ENV{AVERAGEAPP_TEST} ? 1 : 0;
# curl is always /usr/bin/curl on a Mac; a test elsewhere may point at another.
my $Curl = $Test && $ENV{AVERAGEAPP_CURL} ? $ENV{AVERAGEAPP_CURL} : '/usr/bin/curl';
$ENV{ENABLE_TOOL_SEARCH} = 'false';

sub slurp { my ($f) = @_; open(my $fh, '<:raw', $f) or return undef; local $/; my $s = <$fh>; close $fh; return $s }
sub spit { my ($f, $s) = @_; open(my $fh, '>:raw', $f) or return; print {$fh} $s; close $fh }
sub trim { my ($s) = @_; $s = '' unless defined $s; $s =~ s/^\s+|\s+$//g; return $s }
sub stamp { my @t = localtime; return sprintf('%04d-%02d-%02dT%02d:%02d:%02d', $t[5] + 1900, $t[4] + 1, $t[3], $t[2], $t[1], $t[0]) }
sub Log {
  my ($m) = @_;
  $m = '' unless defined $m;
  $m =~ s/\s+$//;
  if (open(my $fh, '>>:encoding(UTF-8)', $LogFile)) { print {$fh} stamp() . ' ' . $m . "\n"; close $fh }
}
for my $f ($LogFile, "$Dir/launchd.log") { rename($f, "$f.old") if -e $f && -s $f > 1048576 }

# One watcher at a time (launchd runs one too; this covers starting it by hand).
open(my $Lock, '>', "$Dir/.lock") or exit 0;
flock($Lock, LOCK_EX | LOCK_NB) or exit 0;

my $Cfg = eval { $J->decode(slurp("$Dir/config.json")) };
if (ref $Cfg ne 'HASH') { Log('config.json is missing or unreadable.'); exit 0 }
my $RpcUrl = $Cfg->{supabaseUrl} . '/rest/v1/rpc/';
my $WorkUrl = $Cfg->{site} . '/api/counselor/' . $Cfg->{token};

# The Claude models and efforts the website can choose (Claude Code's aliases), and the model
# and effort each of the older three speeds meant, for a database without per-model settings.
my %Models = map { ($_ => 1) } qw(haiku sonnet opus fable);
my %Efforts = map { ($_ => 1) } qw(low medium high);
my %SpeedModel = (fast => 'sonnet', balanced => 'sonnet', thorough => 'opus');
my %SpeedEffort = (fast => 'low', balanced => 'medium', thorough => 'high');

# One HTTPS call through curl (headers from a file, so the key isn't in the process list):
# (status, body). Status 0: no answer at all (no network, a timeout).
sub http {
  my ($method, $url, $body, $timeout) = @_;
  # -q first: the student's own ~/.curlrc (fail, include, verbose...) mustn't change what comes back.
  my @cmd = ($Curl, '-q', '-sS', '--max-time', $timeout, '-H', '@' . $Headers, '-X', $method, '-w', '\n%{http_code}');
  push @cmd, ('--data-binary', '@-') if defined $body;
  push @cmd, $url;
  my ($in, $out);
  my $pid = eval { open3($in, $out, undef, @cmd) };
  return (0, 'could not run curl: ' . ($@ || '?')) unless $pid;
  binmode $in;
  binmode $out;
  print {$in} $body if defined $body;
  close $in;
  my $all = do { local $/; <$out> };
  close $out;
  waitpid($pid, 0);
  $all = '' unless defined $all;
  return ($2 + 0, $1) if $all =~ /\A(.*)\n(\d{3})\z/s;
  return (0, $all);
}
sub rpc {
  my ($fn, $args) = @_;
  my ($code, $text) = http('POST', $RpcUrl . $fn, $J->encode($args), 30);
  die "HTTP $code $text\n" if $code < 200 || $code > 299;
  return undef unless length $text;
  return eval { $J->decode($text) };
}
sub revoked { my ($err) = @_; return defined $err && $err =~ /not valid/ }
sub activity {
  my ($tool, $request) = @_;
  my %b = (token => $Cfg->{token}, tool => $tool);
  $b{request} = $request if $request;
  eval { rpc('connector_activity', \%b) };
}

# Post an answer. One that can't be posted right now (no network after sleep, a server hiccup) is
# kept and retried, never answered again: that would repeat what it did, like suggestions.
my @Unposted;
sub finish {
  my ($id, $text) = @_;
  return if eval { rpc('connector_finish_request', { token => $Cfg->{token}, request => $id, answer_text => $text }); 1 };
  my $err = $@;
  return if revoked($err);
  Log('Could not post an answer yet; will retry: ' . $err);
  push @Unposted, { id => $id, text => $text, tries => 1, next => time + 5 };
}
sub retry_unposted {
  for my $k (reverse 0 .. $#Unposted) {
    my $u = $Unposted[$k];
    next if time < $u->{next};
    if (eval { rpc('connector_finish_request', { token => $Cfg->{token}, request => $u->{id}, answer_text => $u->{text} }); 1 }) {
      splice(@Unposted, $k, 1);
      Log('Posted an answer that had failed to post.');
      activity('idle');
    } else {
      my $err = $@;
      if (revoked($err)) { splice(@Unposted, $k, 1); next }
      $u->{tries}++;
      my $wait = 5 * 2 ** $u->{tries};
      $u->{next} = time + ($wait > 300 ? 300 : $wait);
    }
  }
}

my ($Pid, $CIn, $COut, $CErr, $Sel);
my ($ProcModel, $ProcEffort, $Switching, $SwitchSeq, $Resumed) = ('', '', undef, 0, 0);
my ($OutBuf, $ErrBuf, $OutDone, $ExitStatus) = ('', '', 0, undef);
my (@ErrTail, @Queue, %Seen);
my ($FetchFails, $StartFails, $NextStart) = (0, 0, 0);
my $Current;
my $LastUsed = time;
my $LastFetch = 0;
my $NeedFetch = 1;

sub uuid {
  my $b = '';
  if (open(my $r, '<:raw', '/dev/urandom')) { read($r, $b, 16); close $r }
  $b = pack('N4', map { int(rand(4294967296)) } 1 .. 4) if length($b) < 16;
  my @b = unpack('C16', $b);
  $b[6] = ($b[6] & 0x0f) | 0x40;
  $b[8] = ($b[8] & 0x3f) | 0x80;
  return sprintf('%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x', @b);
}

# Claude Code, wherever it is now (reinstalled another way, say).
sub find_claude {
  for my $d (split /:/, (defined $ENV{PATH} ? $ENV{PATH} : '')) { return "$d/claude" if $d ne '' && -x "$d/claude" }
  for my $c ("$Home/.local/bin/claude", '/opt/homebrew/bin/claude', '/usr/local/bin/claude', "$Home/.claude/local/claude", bsd_glob("$Home/.nvm/versions/node/*/bin/claude")) {
    return $c if -x $c;
  }
  return undef;
}

# Claude Code deletes conversations unused for a month: resume only one that is still there.
sub session_kept { my ($s) = @_; my @f = bsd_glob("$Home/.claude/projects/*/$s.jsonl"); return scalar @f }

sub start_claude {
  my ($model, $effort) = @_;
  my $session = trim(slurp($SessionFile));
  if ($session ne '' && !session_kept($session)) {
    Log('The saved conversation is gone; starting a new one.');
    $session = '';
  }
  my @a = ('-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--restricted', '--model', $model, '--effort', $effort);
  if ($session ne '') {
    push @a, ('--resume', $session);
    $Resumed = 1;
  } else {
    $session = uuid();
    spit($SessionFile, $session);
    push @a, ('--session-id', $session, '--name', 'Average App counselor');
    $Resumed = 0;
  }
  push @a, ('--mcp-config', $Mcp, '--strict-mcp-config', '--allowedTools', 'mcp__${MCP_SERVER}', 'WebSearch', 'WebFetch');
  my ($in, $out);
  my $err = gensym;
  my $pid = eval { open3($in, $out, $err, $Cfg->{claude}, @a) };
  if (!$pid) {
    my $why = $@ || '?';
    $StartFails++;
    my $wait = 5 * $StartFails;
    $NextStart = time + ($wait > 300 ? 300 : $wait);
    Log('Could not start Claude Code: ' . $why);
    my $found = find_claude();
    $Cfg->{claude} = $found if $found;
    if ($StartFails >= 3) {
      finish($_->{id}, "Your counselor couldn't start Claude Code on your computer. Run the counselor setup again from the Counselor page.") for @Queue;
      @Queue = ();
      activity('idle');
    }
    return;
  }
  ($Pid, $CIn, $COut, $CErr) = ($pid, $in, $out, $err);
  binmode $CIn;
  binmode $COut;
  binmode $CErr;
  $Sel = IO::Select->new($COut, $CErr);
  ($OutBuf, $ErrBuf, $OutDone, $ExitStatus) = ('', '', 0, undef);
  @ErrTail = ();
  ($ProcModel, $ProcEffort, $StartFails) = ($model, $effort, 0);
  Log("Claude Code is up ($model, $effort effort).");
}

# Whether Claude Code has exited (waiting up to $wait seconds for it to).
sub reap {
  my ($wait) = @_;
  return 1 unless $Pid;
  my $until = time + $wait;
  while (1) {
    my $r = waitpid($Pid, POSIX::WNOHANG());
    if ($r == $Pid || $r == -1) { $ExitStatus = $? if $r == $Pid; return 1 }
    return 0 if time >= $until;
    sleep 0.1;
  }
}

sub forget_claude {
  close $CIn if $CIn;
  close $COut if $COut;
  close $CErr if $CErr;
  ($Pid, $CIn, $COut, $CErr, $Sel, $Switching) = (undef) x 6;
}

sub stop_claude {
  my ($gently) = @_;
  return unless $Pid;
  if ($gently && $CIn) { close $CIn; $CIn = undef }
  if (!$gently || !reap(10)) {
    kill 'TERM', $Pid;
    if (!reap(3)) { kill 'KILL', $Pid; reap(1) }
  }
  forget_claude();
}

# One line of stream-json to Claude Code, all of it.
sub send_line {
  my ($obj) = @_;
  return 0 unless $CIn;
  my $line = $J->encode($obj) . "\n";
  my $off = 0;
  while ($off < length $line) {
    my $w = syswrite($CIn, $line, length($line) - $off, $off);
    return 0 unless defined $w;
    $off += $w;
  }
  return 1;
}

sub send_next {
  my $item = shift @Queue;
  if (!send_line({ type => 'user', message => { role => 'user', content => $item->{text} } })) {
    Log('Could not reach Claude Code.');
    unshift @Queue, $item;
    stop_claude(0);
    return;
  }
  $Current = { id => $item->{id}, text => $item->{text}, model => $item->{model}, tries => $item->{tries}, started => time, draft => '', posted => '', postedAt => 0 };
  $LastUsed = time;
  activity('thinking', $item->{id});
}

sub finish_current {
  my ($o) = @_;
  my $c = $Current;
  $Current = undef;
  $LastUsed = time;
  my $errors = ref $o->{errors} eq 'ARRAY' ? join(' ', map { defined $_ ? "$_" : '' } @{ $o->{errors} }) : '';
  # Resuming failed before any work: it isn't an answer. Start a new conversation and try again.
  if ($Resumed && $o->{is_error} && int($o->{num_turns} || 0) == 0 && $errors =~ /No conversation found/) {
    unlink $SessionFile;
    $Resumed = 0;
    unshift @Queue, { id => $c->{id}, text => $c->{text}, model => $c->{model}, tries => $c->{tries}, at => time };
    Log('The saved conversation is gone; starting a new one.');
    return;
  }
  my $text = defined $o->{result} ? "$o->{result}" : '';
  my $subtype = defined $o->{subtype} ? "$o->{subtype}" : '';
  if ($o->{is_error} || ($subtype ne '' && $subtype ne 'success')) {
    Log("Claude could not answer ($subtype): $text");
    my $why = trim($text);
    $why = $subtype if $why eq '';
    $text = "Sorry, I couldn't answer this one: " . $why . ' Try asking again in a little while.';
  }
  $text = 'Done.' if trim($text) eq '';
  finish($c->{id}, $text);
  activity('idle');
  Log('Answered in ' . int(time - $c->{started}) . 's.');
}

# Change the running Claude Code's model without restarting it (and without losing the conversation).
sub switch_model {
  my ($model) = @_;
  $SwitchSeq++;
  my $id = 'model-' . $SwitchSeq;
  if (send_line({ type => 'control_request', request_id => $id, request => { subtype => 'set_model', model => $model } })) {
    $Switching = { id => $id, model => $model, until => time + 15 };
  } else {
    stop_claude(0);
  }
}

sub handle_line {
  my ($line) = @_;
  if ($Switching && index($line, '"control_response"') >= 0) {
    my $o = eval { $J->decode($line) };
    return unless ref $o eq 'HASH';
    my $resp = ref $o->{response} eq 'HASH' ? $o->{response} : {};
    my $rid = defined $resp->{request_id} ? $resp->{request_id} : '';
    if ($rid eq $Switching->{id}) {
      my $want = $Switching->{model};
      $Switching = undef;
      if ((defined $resp->{subtype} ? $resp->{subtype} : '') eq 'success') {
        $ProcModel = $want;
        Log("Switched to $ProcModel.");
      } else {
        # This Claude Code can't switch (or not to that model): start again with it.
        Log("Could not switch to $want: " . $J->encode($resp));
        stop_claude(1);
      }
    }
    return;
  }
  my $c = $Current;
  return unless $c;
  if (index($line, '"stream_event"') >= 0) {
    # The reply as it is written: text after the last tool call is the answer.
    return if index($line, 'text_delta') < 0 && index($line, 'message_start') < 0 && index($line, '"tool_use"') < 0;
    my $o = eval { $J->decode($line) };
    return unless ref $o eq 'HASH' && ref $o->{event} eq 'HASH';
    my $e = $o->{event};
    my $type = defined $e->{type} ? $e->{type} : '';
    if ($type eq 'message_start') { $c->{draft} = '' }
    elsif ($type eq 'content_block_start' && ref $e->{content_block} eq 'HASH' && (defined $e->{content_block}{type} ? $e->{content_block}{type} : '') eq 'tool_use') { $c->{draft} = '' }
    elsif ($type eq 'content_block_delta' && ref $e->{delta} eq 'HASH' && (defined $e->{delta}{type} ? $e->{delta}{type} : '') eq 'text_delta') {
      $c->{draft} .= defined $e->{delta}{text} ? $e->{delta}{text} : '';
    }
    return;
  }
  return if index($line, '"result"') < 0;
  my $o = eval { $J->decode($line) };
  return unless ref $o eq 'HASH';
  finish_current($o) if (defined $o->{type} ? $o->{type} : '') eq 'result';
}

# Read what Claude Code has written, waiting up to $timeout seconds for it.
sub read_output {
  my ($timeout) = @_;
  return unless $Sel;
  for my $fh ($Sel->can_read($timeout)) {
    return unless $Sel;
    my $buf;
    my $n = sysread($fh, $buf, 65536);
    if (!$n) {
      $Sel->remove($fh);
      $OutDone = 1 if $COut && $fh == $COut;
      next;
    }
    if ($COut && $fh == $COut) {
      $OutBuf .= $buf;
      while ((my $i = index($OutBuf, "\n")) >= 0) {
        my $line = substr($OutBuf, 0, $i);
        $OutBuf = substr($OutBuf, $i + 1);
        handle_line($line);
        return unless $Sel;
      }
    } else {
      $ErrBuf .= $buf;
      while ((my $i = index($ErrBuf, "\n")) >= 0) {
        push @ErrTail, substr($ErrBuf, 0, $i);
        $ErrBuf = substr($ErrBuf, $i + 1);
        shift @ErrTail while @ErrTail > 20;
      }
    }
  }
}

sub post_draft {
  my $c = $Current;
  return unless $c;
  return if $c->{draft} eq $c->{posted};
  return if time - $c->{postedAt} < 0.7;
  $c->{postedAt} = time;
  eval { rpc('connector_draft_answer', { token => $Cfg->{token}, request => $c->{id}, draft => $c->{draft} }); $c->{posted} = $c->{draft}; 1 };
}

sub fetch_work {
  $LastFetch = time;
  my ($code, $text) = http('GET', $WorkUrl, undef, 40);
  my $r = ($code >= 200 && $code <= 299) ? eval { $J->decode($text) } : undef;
  if (ref $r ne 'HASH') {
    $FetchFails++;
    Log("Could not fetch the requests: HTTP $code " . substr(defined $text ? $text : '', 0, 300));
    return;
  }
  for my $q (@{ ref $r->{requests} eq 'ARRAY' ? $r->{requests} : [] }) {
    next if ref $q ne 'HASH' || !defined $q->{id} || $Seen{$q->{id}}++;
    my $m = defined $q->{model} ? "$q->{model}" : '';
    $m = '' unless $Models{$m};
    push @Queue, { id => $q->{id}, text => (defined $q->{text} ? "$q->{text}" : ''), model => $m, tries => 0, at => time };
  }
  $NeedFetch = 0;
  $FetchFails = 0;
}

# Claude Code stopped on its own (or was stopped): try the request it was on once more, then give up on it.
sub handle_exit {
  for (1 .. 50) { last unless $Sel && $Sel->can_read(0); read_output(0) }
  if ($Pid && !reap(0)) {
    kill 'TERM', $Pid;
    if (!reap(3)) { kill 'KILL', $Pid; reap(1) }
  }
  my $code = defined $ExitStatus ? ($ExitStatus >> 8) : '';
  my $tail = join(' | ', @ErrTail);
  Log("Claude Code stopped ($code) $tail");
  unlink $SessionFile if $Resumed && $tail =~ /conversation|session/;
  forget_claude();
  my $c = $Current;
  $Current = undef;
  return unless $c;
  if ($c->{tries} < 1) {
    unshift @Queue, { id => $c->{id}, text => $c->{text}, model => $c->{model}, tries => $c->{tries} + 1, at => time };
  } else {
    finish($c->{id}, "Sorry, I couldn't answer this one: Claude Code stopped unexpectedly. Try asking again.");
    activity('idle');
  }
}

# Run something with no output, for at most $timeout seconds.
sub run_quietly {
  my ($timeout, @cmd) = @_;
  my $pid = fork();
  return unless defined $pid;
  if ($pid == 0) {
    open(STDIN, '<', '/dev/null');
    open(STDOUT, '>', '/dev/null');
    open(STDERR, '>', '/dev/null');
    exec(@cmd) or POSIX::_exit(127);
  }
  my $until = time + $timeout;
  while (time < $until) {
    return if waitpid($pid, POSIX::WNOHANG()) == $pid;
    sleep 0.2;
  }
  kill 'KILL', $pid;
  waitpid($pid, 0);
}

# Leave launchd: this was its last run.
sub leave {
  exit 0 if $Test;
  exec('/bin/launchctl', 'bootout', 'gui/' . $< . '/${MAC_LABEL}') or exit 0;
}

# Asked on the website to remove the counselor from this Mac: stop, leave login, delete its
# conversation with Claude Code (it holds the student's essays) and this folder, and disconnect.
sub remove_counselor {
  Log('Removing the counselor from this computer, as asked on the website.');
  my $c = $Current;
  $Current = undef;
  stop_claude(0);
  finish($c->{id}, 'Your counselor was removed from your computer before it could answer this.') if $c;
  unlink $Plist;
  my $session = trim(slurp($SessionFile));
  run_quietly(30, $Cfg->{claude}, 'project', 'purge', '-y', $Dir) if $Cfg->{claude} && -x $Cfg->{claude};
  if ($session ne '') {
    for my $f (bsd_glob("$Home/.claude/projects/*/$session.jsonl")) {
      my $p = dirname($f);
      remove_tree($p) if $p =~ /AverageApp-Counselor$/;
    }
  }
  eval { rpc('connector_counselor_removed', { token => $Cfg->{token} }) };
  chdir '/';
  remove_tree($Dir);
  leave();
}

Log("Counselor $Version started.");
my ($LastPoll, $Fails, $Model, $Effort, $Paused, $Waiting) = (0, 0, 'sonnet', 'medium', 0, 0);
while (1) {
  my $now = time;
  my $interval = $Fails ? ($Fails * 3 > 60 ? 60 : $Fails * 3) : 2;
  if ($now - $LastPoll >= $interval) {
    $LastPoll = $now;
    # "-mac": the website tells a Mac counselor from a Windows one (to offer the right update).
    my $r = eval { rpc('connector_counselor_poll', { token => $Cfg->{token}, version => "$Version-mac" }) };
    my $err = $@;
    if ($err) {
      if (revoked($err)) {
        Log('Its connector link was revoked, so the counselor is turning itself off.');
        stop_claude(0);
        unlink $Plist;
        leave();
      }
      $Fails++;
      # Once per outage, not at every retry (a flaky network would fill the log).
      Log('Could not reach the desk: ' . $err) if $Fails == 1;
    } elsif (ref $r eq 'HASH') {
      Log("Reached the desk again after $Fails tries.") if $Fails > 1;
      $Fails = 0;
      remove_counselor() if $r->{remove};
      my $m = defined $r->{model} ? "$r->{model}" : '';
      my $s = defined $r->{speed} ? "$r->{speed}" : '';
      my $ef = defined $r->{effort} ? "$r->{effort}" : '';
      if ($Models{$m}) { $Model = $m } elsif ($SpeedModel{$s}) { $Model = $SpeedModel{$s} }
      if ($Efforts{$ef}) { $Effort = $ef } elsif ($SpeedEffort{$s}) { $Effort = $SpeedEffort{$s} }
      $Paused = $r->{paused} ? 1 : 0;
      $Waiting = int($r->{waiting} || 0);
      $NeedFetch = 1 if int($r->{fresh} || 0) > 0;
      if (ref $r->{pending} eq 'ARRAY') {
        my %open = map { ("$_" => 1) } @{ $r->{pending} };
        for my $k (reverse 0 .. $#Queue) {
          my $q = $Queue[$k];
          if ($q->{at} < $now && !$open{$q->{id}}) {
            splice(@Queue, $k, 1);
            Log('Dropped a request that was withdrawn.');
          }
        }
      }
      # Something is waiting that nothing here is working on: look again now and then.
      $NeedFetch = 1 if $Waiting > 0 && !$Current && !@Queue && $now - $LastFetch > 60;
    }
  }

  if ($Pid) {
    read_output($Current ? 0.15 : 0.4);
    post_draft();
    handle_exit() if $Pid && (reap(0) || $OutDone);
  }
  if ($Current && time - $Current->{started} > 900) {
    Log('A request took over 15 minutes; stopping it.');
    my $c = $Current;
    $Current = undef;
    stop_claude(0);
    finish($c->{id}, 'Sorry, that took too long and I stopped. Try asking again, perhaps in smaller steps.');
    activity('idle');
  }

  my $backoff = 2 * $FetchFails;
  fetch_work() if !$Paused && $NeedFetch && $Waiting > 0 && time - $LastFetch >= ($backoff > 60 ? 60 : $backoff);
  $NeedFetch = 0 if $Waiting == 0;
  retry_unposted() if @Unposted;

  if ($Switching && time > $Switching->{until}) {
    Log("Switching to $Switching->{model} took too long; starting again with it.");
    $Switching = undef;
    stop_claude(0);
  }

  if (!$Current && !$Switching) {
    # A new effort takes effect between requests (a new model switches in place, below).
    stop_claude(1) if $Pid && $ProcEffort ne $Effort;
    if (!$Paused && @Queue) {
      my $want = $Queue[0]{model} || $Model;
      start_claude($want, $Effort) if !$Pid && time >= $NextStart;
      if ($Pid && @Queue) {
        if ($ProcModel ne $want) { switch_model($want) } else { send_next() }
      }
    } elsif ($Pid && ($Paused || time - $LastUsed > 1200)) {
      # Nothing to do for a while: let Claude Code rest; the conversation resumes next time.
      stop_claude(1);
      Log('Claude Code is resting.');
    }
  }
  sleep($Current ? 0.15 : 0.4) unless $Pid;
}
`;

/** Turns it off: stops it and takes it out of login (the folder stays, like Windows' "Turn off counselor.cmd"). */
const TURN_OFF = String.raw`#!/bin/bash
# Turns the Average App counselor off: it stops, and no longer starts when you log in.
/bin/launchctl bootout "gui/$(id -u)/${MAC_LABEL}" >/dev/null 2>&1
/usr/bin/pkill -f "$HOME/${MAC_DIR}/mcp.json" >/dev/null 2>&1
rm -f "$HOME/Library/LaunchAgents/${MAC_LABEL}.plist"
echo "The Average App counselor is off. Run the setup from the Counselor page again to turn it back on."
`;

/** The setup script itself. Placeholders are filled in by macInstaller. */
const SETUP = String.raw`#!/bin/bash
# Average App counselor setup for Mac. Double-click to install; your Mac asks once, in
# System Settings > Privacy & Security > Open Anyway. This file was written for you by the
# website: it sets up Claude Code as your counselor, running in the background on your own Claude
# plan. Without Claude Code it offers to install it (Anthropic's own installer, no password) and,
# not signed in, opens your browser to sign in. Nothing else comes from the internet.
SITE='__SITE__'
SUPABASE_URL='__SUPABASE_URL__'
KEY='__KEY__'
TOKEN='__TOKEN__'
LABEL='${MAC_LABEL}'
DIR="$HOME/${MAC_DIR}"
WATCHER="$DIR/${MAC_WATCHER_NAME}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN=$(id -u)
cd "$HOME" || exit 1

# A dialog (0 stop, 1 note, 2 caution), or in a test just the text.
say() {
  echo
  echo "$1"
  if [ -n "$AVERAGEAPP_TEST" ]; then return; fi
  /usr/bin/osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "Average App counselor" buttons {"OK"} default button "OK" with icon ((item 2 of argv) as integer)' -e 'end run' "$1" "$2" >/dev/null 2>&1
}
fail() { say "$(printf 'Setting up the counselor failed:\n\n%s' "$1")" 0; exit 1; }

# A question with Not now and Continue: true for Continue. In a test, AVERAGEAPP_TEST_ANSWER says.
ask() {
  echo
  echo "$1"
  if [ -n "$AVERAGEAPP_TEST" ]; then [ "$AVERAGEAPP_TEST_ANSWER" = yes ]; return; fi
  [ "$(/usr/bin/osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "Average App counselor" buttons {"Not now", "Continue"} default button "Continue" with icon 1' -e 'end run' "$1" 2>/dev/null)" = "button returned:Continue" ]
}

# Claude Code: the first that answers as Claude Code.
find_claude() {
  CLAUDE=""
  for c in "$(command -v claude 2>/dev/null)" "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.claude/local/claude" "$HOME"/.nvm/versions/node/*/bin/claude; do
    if [ -n "$c" ] && [ -x "$c" ] && "$c" --version 2>/dev/null | grep -q 'Claude Code'; then CLAUDE="$c"; return 0; fi
  done
  return 1
}

# Whether Claude Code is signed in (claude auth status --json).
signed_in() { "$CLAUDE" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; }

echo "Setting up your counselor..."

# Perl, which the counselor runs on: every Mac from macOS 13 on comes with it.
if ! /usr/bin/perl -MJSON::PP -MIO::Select -MIPC::Open3 -MFcntl -MTime::HiRes -MFile::Path -MFile::Glob -e 1 >/dev/null 2>&1; then
  say "$(printf 'The counselor needs the Perl that comes with macOS, and this Mac does not have it.\n\nYou can still use your desk with a Claude chat: add your connector and say "Watch my Average App".')" 0
  exit 1
fi

# A setup file from an older download carries a link that's been turned off: say so, and change
# nothing (and install nothing).
LIVE=$(/usr/bin/curl -q -sS -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/api/counselor/$TOKEN" 2>/dev/null)
if [ "$LIVE" = 403 ] || [ "$LIVE" = 404 ]; then
  say "$(printf 'This setup file is from an older download, and its link has been turned off.\n\nIn Downloads, open the newest counselor setup file (its name may end in 2 or (1)), or download it again from Settings > Counselor.')" 2
  exit 1
fi

# Claude Code, which the counselor runs on: installed with Anthropic's own installer when it's
# missing (into your home folder; no password, nothing to type).
if ! find_claude; then
  if ! ask $'Your counselor runs on Claude Code, Anthropic\'s app for your Claude account, and it is not on this Mac yet.\n\nInstall it now? It takes a minute or two, needs no password, and nothing else is installed. (You will need a Claude Pro or Max plan to use it.)'; then
    say $'The counselor needs Claude Code. Open this file again whenever you are ready to install it.' 1
    exit 1
  fi
  echo "Installing Claude Code from Anthropic (a minute or two)..."
  if [ -n "$AVERAGEAPP_TEST" ]; then
    [ -n "$AVERAGEAPP_TEST_INSTALLER" ] && /bin/bash "$AVERAGEAPP_TEST_INSTALLER"
  else
    ( set -o pipefail; /usr/bin/curl -q -fsSL https://claude.ai/install.sh | /bin/bash )
  fi
  if ! find_claude; then
    say $'Claude Code could not be installed.\n\nIt may have been blocked by your internet connection or a school or work network. You can install it from claude.com/claude-code, then open this file again.' 0
    exit 1
  fi
fi

# Signed in: if not, your browser opens to sign in (the same Claude account as the website).
if ! signed_in; then
  if ! ask $'Next, sign in to Claude Code with your Claude account.\n\nYour browser opens: sign in, click Authorize, then come back to this window. (Claude Code needs a Claude Pro or Max plan.)'; then
    say $'The counselor needs Claude Code signed in. Open this file again whenever you are ready.' 1
    exit 1
  fi
  echo "Opening your browser to sign in to Claude..."
  "$CLAUDE" auth login --claudeai
  if ! signed_in; then
    say $'Claude Code is not signed in yet, so the counselor cannot start.\n\nOpen this file again to try signing in once more.' 2
    exit 1
  fi
fi
if "$CLAUDE" auth status --json 2>/dev/null | grep -q '"subscriptionType": *"free"'; then
  say $'Claude Code needs a Claude Pro or Max plan, and this Claude account is on the free plan.\n\nUpgrade at claude.ai (or sign in to Claude Code with another account), then open this file again.' 2
  exit 1
fi

# An older counselor stops first (an update replaces it). A test leaves the real one alone.
if [ -z "$AVERAGEAPP_TEST" ] || [ -n "$AVERAGEAPP_TEST_LAUNCHD" ]; then
  /bin/launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1
  for i in 1 2 3 4 5 6 7 8 9 10; do
    /bin/launchctl print "gui/$UIDN/$LABEL" >/dev/null 2>&1 || break
    sleep 0.5
  done
fi
/usr/bin/pkill -f "$DIR/mcp.json" >/dev/null 2>&1

mkdir -p "$DIR" || fail "Could not make its folder, $DIR."
chmod 700 "$DIR"
cd "$DIR" || fail "Could not open its folder, $DIR."
umask 077

/usr/bin/perl -MJSON::PP -e '
  my ($site, $url, $key, $token, $claude, $server) = @ARGV;
  my $j = JSON::PP->new->canonical->pretty;
  open(my $c, ">", "config.json") or die "config.json: $!";
  print {$c} $j->encode({ site => $site, supabaseUrl => $url, key => $key, token => $token, claude => $claude });
  close $c;
  open(my $m, ">", "mcp.json") or die "mcp.json: $!";
  print {$m} $j->encode({ mcpServers => { $server => { type => "http", url => "$site/api/mcp/$token" } } });
  close $m;
' "$SITE" "$SUPABASE_URL" "$KEY" "$TOKEN" "$CLAUDE" '${MCP_SERVER}' || fail "Could not write its settings."
{
  echo "apikey: $KEY"
  case "$KEY" in eyJ*) echo "Authorization: Bearer $KEY" ;; esac
  echo "Content-Type: application/json"
} > headers.txt

cat > CLAUDE.md <<'AVERAGEAPP_BRIEF'
__BRIEF__
AVERAGEAPP_BRIEF

cat > "$WATCHER" <<'AVERAGEAPP_WATCHER'
__WATCHER__
AVERAGEAPP_WATCHER
chmod 755 "$WATCHER"

cat > "Turn off counselor.command" <<'AVERAGEAPP_OFF'
__TURN_OFF__
AVERAGEAPP_OFF
chmod 755 "Turn off counselor.command"

# Without Apple's developer tools, /usr/bin/git only asks to install them: a stand-in that
# answers like git outside a repository keeps that question from popping up.
mkdir -p bin
if /usr/bin/xcode-select -p >/dev/null 2>&1; then
  rm -f bin/git
else
  printf '#!/bin/sh\nexit 128\n' > bin/git
  chmod 755 bin/git
fi
RUNPATH="$DIR/bin:$(dirname "$CLAUDE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# launchd starts the watcher with little of what this Terminal has (none of your shell's
# settings), so the check runs with the same, plus the settings Claude Code itself may need if you
# have them (a key or token it signs in with, a proxy, a school network's certificates), which go
# into the LaunchAgent too. A check that passes then means the counselor will work.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
NL='
'
EXTRA_ENV=""
set -- HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" SHELL="$SHELL" TMPDIR="$TMPDIR" PATH="$RUNPATH" LANG=en_US.UTF-8 ENABLE_TOOL_SEARCH=false
for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR NODE_EXTRA_CA_CERTS SSL_CERT_FILE HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy; do
  val=$(printenv "$v")
  if [ -n "$val" ]; then
    set -- "$@" "$v=$val"
    EXTRA_ENV="$EXTRA_ENV    <key>$v</key>$NL    <string>$(xml "$val")</string>$NL"
  fi
done
# A test's stand-in Claude Code writes its log where it's told.
if [ -n "$AVERAGEAPP_TEST" ]; then set -- "$@" "FAKE_CLAUDE_LOG=$FAKE_CLAUDE_LOG"; fi

# A first run checks that Claude Code is signed in and can reach the desk. An update keeps the
# counselor's conversation (and so what it remembers); a new counselor starts one.
echo "Checking that Claude can reach your desk (this takes a few seconds)..."
export PATH="$RUNPATH"
SESSION=""
[ -f session.txt ] && SESSION=$(cat session.txt)
OK=0
if [ -n "$SESSION" ]; then
  CHECK=$(env -i "$@" "$CLAUDE" -p '__CHECK__' --resume "$SESSION" --model sonnet --effort low --restricted --mcp-config "$DIR/mcp.json" --strict-mcp-config --allowedTools 'mcp__${MCP_SERVER}' 2>&1 </dev/null) && OK=1
fi
if [ "$OK" = 0 ]; then
  SESSION=$( { /usr/bin/uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid; } | tr 'A-Z' 'a-z')
  CHECK=$(env -i "$@" "$CLAUDE" -p '__CHECK__' --session-id "$SESSION" --name 'Average App counselor' --model sonnet --effort low --restricted --mcp-config "$DIR/mcp.json" --strict-mcp-config --allowedTools 'mcp__${MCP_SERVER}' 2>&1 </dev/null) && OK=1
fi
if [ "$OK" = 0 ]; then
  say "$(printf 'Claude Code could not reach your desk:\n\n%s\n\nIf it asks you to sign in, open Claude Code once and sign in, then open this file again.' "$(printf '%s' "$CHECK" | head -c 600)")" 0
  exit 1
fi
printf '%s' "$SESSION" > session.txt

# Start in the background now, and at every login.
mkdir -p "$HOME/Library/LaunchAgents" || fail "Could not make $HOME/Library/LaunchAgents."
umask 022
cat > "$PLIST.tmp" <<AVERAGEAPP_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WATCHER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$RUNPATH</string>
    <key>LANG</key>
    <string>en_US.UTF-8</string>
    <key>ENABLE_TOOL_SEARCH</key>
    <string>false</string>
$EXTRA_ENV  </dict>
  <key>StandardOutPath</key>
  <string>$DIR/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$DIR/launchd.log</string>
</dict>
</plist>
AVERAGEAPP_PLIST
mv "$PLIST.tmp" "$PLIST" || fail "Could not save $PLIST."
chmod 644 "$PLIST"
if [ -x /usr/bin/plutil ] && ! /usr/bin/plutil -lint "$PLIST" >/dev/null 2>&1; then fail "Its startup file, $PLIST, is not valid."; fi

if [ -z "$AVERAGEAPP_TEST" ] || [ -n "$AVERAGEAPP_TEST_LAUNCHD" ]; then
  /bin/launchctl enable "gui/$UIDN/$LABEL" >/dev/null 2>&1
  LOADED=0
  for i in 1 2 3 4 5; do
    if /bin/launchctl bootstrap "gui/$UIDN" "$PLIST" >/dev/null 2>&1; then LOADED=1; break; fi
    sleep 1
  done
  [ "$LOADED" = 1 ] || fail "macOS would not start it in the background. Try opening this file again."
fi

say "$(printf 'Your counselor is on.\n\nTalk to it on the Counselor page, or ask anything on your desk (Ask, Polish, odds, the Profile interview): Claude answers there, with nothing else to open. It runs in the background and starts again whenever you log in to your Mac. If your Mac says Background Items Added, that is your counselor: leave it on.\n\nPause it or remove it in Settings, under Counselor. You can close this window.')" 1
exit 0
`;

/** Text for a quoted bash heredoc: no line may be its end marker. */
function heredoc(text: string, marker: string): string {
  const body = text.replace(/\s+$/, "");
  if (body.split("\n").some((l) => l === marker)) throw new Error(`A heredoc can't contain its end marker, ${marker}.`);
  return body;
}

/** The setup script (the .command in the zip), ready to run. */
export function macInstaller(config: InstallerConfig): string {
  const c = checkedConfig(config);
  // Functions, so "$" in the scripts is never read as a replacement pattern.
  const fill: [string, string][] = [
    ["__BRIEF__", heredoc(COUNSELOR_BRIEF, "AVERAGEAPP_BRIEF")],
    ["__WATCHER__", heredoc(WATCHER, "AVERAGEAPP_WATCHER")],
    ["__TURN_OFF__", heredoc(TURN_OFF, "AVERAGEAPP_OFF")],
    ["__CHECK__", CHECK_PROMPT],
    ["__CHECK__", CHECK_PROMPT],
    ["__SITE__", c.site],
    ["__SUPABASE_URL__", c.supabaseUrl],
    ["__KEY__", c.supabaseKey],
    ["__TOKEN__", c.token],
  ];
  const out = fill.reduce((text, [mark, value]) => text.replace(mark, () => value), SETUP);
  if (/[^\x09\x0a\x20-\x7e]/.test(out)) throw new Error("The Mac installer must be plain ASCII with LF line endings.");
  return out;
}

/** The zip the student downloads: the setup script, marked executable (Unix mode 0755). */
export async function macInstallerZip(config: InstallerConfig): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync({ [MAC_INSTALLER_NAME]: [strToU8(macInstaller(config)), { os: 3, attrs: (0o100755 << 16) >>> 0 }] });
}
