/*
 * The counselor for Windows: one file the student downloads and double-clicks, once. (The Mac
 * version, which works the same way, is mac-installer.ts.)
 *
 * It sets up Claude Code as their counselor, running hidden on their own computer on their own
 * Claude plan. Without Claude Code it offers to install it (Anthropic's own installer, no admin
 * needed) and, not signed in, opens the browser to sign in: nothing to type anywhere.
 * - Braxton's call (9/27/26): students shouldn't have to use a terminal to get Claude Code.
 * - a small watcher (PowerShell, no window) asks the desk every couple of seconds whether
 *   anything new was asked on the website. Waiting costs nothing: Claude isn't involved.
 * - when something arrives, it fetches the request with what answering it needs (the essay, the
 *   college list, the profile; /api/counselor/<token>) and hands it to Claude Code, which it
 *   keeps running between requests (stream-json over stdin/stdout) so there is no start-up wait
 *   and no re-reading. Claude's reply streams onto the desk as it is written.
 * - one conversation carries on from request to request, so the counselor remembers the
 *   student. Claude Code rests after a while with nothing to do and resumes it next time.
 * - the website sets its speed (which model and effort) and can pause it; it starts again
 *   whenever the student signs in to Windows, and turns itself off for good when its connector
 *   link is revoked.
 *
 * The file is a batch/PowerShell hybrid: cmd runs the first lines, which hand the whole file to
 * PowerShell, where those lines are a comment. It must stay ASCII with CRLF line endings.
 * PowerShell code lives in String.raw templates: no backticks in it, and "${" only for our own
 * substitutions.
 */

import { COUNSELOR_VERSION } from "./version";

export interface InstallerConfig {
  /** The website, e.g. https://averageapp.com */
  site: string;
  supabaseUrl: string;
  /** The Supabase publishable (or legacy anon) key; public, it ships in every page. */
  supabaseKey: string;
  /** The counselor's own connector token. */
  token: string;
}

export { COUNSELOR_VERSION };

/** The folder the counselor lives in, under %LOCALAPPDATA%. */
export const COUNSELOR_DIR = String.raw`ApplicationDesk\Counselor`;
export const STARTUP_NAME = "Average App counselor.lnk";
/** The shortcut's name before the rename to Average App: removed with it, so an update leaves just one. */
const OLD_STARTUP_NAME = "Application Desk counselor.lnk";
const REMOVE_STARTUP = `foreach ($lnkName in @('${STARTUP_NAME}', '${OLD_STARTUP_NAME}')) { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Startup')) $lnkName) }`;
export const INSTALLER_NAME = "Average App counselor setup.cmd";

/** The desk's tools in Claude Code: mcp__application-desk__*. Kept from before the rename, so installed counselors match. */
export const MCP_SERVER = "application-desk";

/** The first thing the installer asks, to check Claude Code can reach the desk. */
export const CHECK_PROMPT = "You are now my Average App counselor. Call list_my_desk, then reply with only the desk title.";

/** The counselor's standing instructions (its folder's CLAUDE.md). */
export const COUNSELOR_BRIEF = String.raw`# Average App counselor

You are this student's college counselor and writing partner. You work on their Average App desk through the application-desk tools. The student never sees this conversation directly: each message here is one request from their desk (a question beside an essay, a highlighted passage to rewrite, an odds estimate, an interview answer, a transcript to read into their academics, or a message from the Counselor page), and your final reply to it is posted on the desk as your answer.

Reply to each message with only what the student should read: no preamble, no commentary between tool calls, no sign-off, and don't call answer_request. Each request says what to do and usually includes the essay, college list or profile it is about, so you can often answer right away; use the tools for anything else, and to make changes.

This conversation continues from one request to the next, so you remember what the student has told you. Save anything lasting you learn about them to their profile with save_profile_section.

The student's profile (read_profile) is the ground truth about them. Read all of it at the start of this conversation, and again whenever it may have changed (after you save to it, or when the student says they updated it); a long profile comes in parts, so read every part. Where a draft, a note or what you remember disagrees with it, the profile wins, above all any section of facts the student asks you to get right.

Stay within what the student allows (list_my_desk says). Be honest, specific and encouraging, keep the student's voice, and never invent facts about them.
`;

/** The watcher, saved as watch.ps1 in the counselor's folder. */
const WATCHER = String.raw`# Average App counselor ${COUNSELOR_VERSION}: watches the desk and has Claude Code answer what is asked.
# Started hidden at sign-in. Log: counselor.log in this folder.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Version = '${COUNSELOR_VERSION}'
# Which computer this is: a name for Settings, and an id (a hash of Windows' own, never the id
# itself) that tells this computer from the student's others.
$Computer = [string]$env:COMPUTERNAME
$Machine = ''
try {
  $guid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
  $sha = [Security.Cryptography.SHA256]::Create()
  $Machine = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('averageapp:' + $guid)) | ForEach-Object { $_.ToString('x2') })
} catch { }
# A database from before migration 20261017 doesn't take them: then it checks in without.
$SaysComputer = $true
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cfg = [IO.File]::ReadAllText((Join-Path $Dir 'config.json')) | ConvertFrom-Json
$LogFile = Join-Path $Dir 'counselor.log'
$SessionFile = Join-Path $Dir 'session.txt'
$Mcp = Join-Path $Dir 'mcp.json'

function Log($m) { try { Add-Content -Path $LogFile -Value ((Get-Date).ToString('s') + ' ' + $m) } catch {} }
if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) { Move-Item -Force $LogFile ($LogFile + '.old') }

# One watcher at a time.
$Fresh = $false
$Mutex = New-Object System.Threading.Mutex($true, 'Local\ApplicationDeskCounselor', [ref]$Fresh)
if (-not $Fresh) { exit }

$Headers = @{ apikey = $Cfg.key }
if ($Cfg.key -like 'eyJ*') { $Headers['Authorization'] = 'Bearer ' + $Cfg.key }
$RpcUrl = $Cfg.supabaseUrl + '/rest/v1/rpc/'
$WorkUrl = $Cfg.site + '/api/counselor/' + $Cfg.token

# The Claude models and efforts the website can choose (Claude Code's aliases), and the model
# and effort each of the older three speeds meant, for a database without per-model settings.
$Models = @('haiku', 'sonnet', 'opus', 'fable')
$Efforts = @('low', 'medium', 'high')
$SpeedModel = @{ fast = 'sonnet'; balanced = 'sonnet'; thorough = 'opus' }
$SpeedEffort = @{ fast = 'low'; balanced = 'medium'; thorough = 'high' }

# JSON that is plain ASCII, whatever it holds: Windows PowerShell sends text in the local code page.
function Ascii($s) { return [regex]::Replace($s, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value }) }
function Quote($a) { return '"' + ($a -replace '"', '\"') + '"' }
function Rpc($fn, $body) {
  $json = Ascii ($body | ConvertTo-Json -Compress -Depth 5)
  return Invoke-RestMethod -Method Post -Uri ($RpcUrl + $fn) -Headers $Headers -ContentType 'application/json' -Body $json -TimeoutSec 30
}
function Activity($tool, $request) {
  $b = @{ token = $Cfg.token; tool = $tool }
  if ($request) { $b['request'] = $request }
  try { $null = Rpc 'connector_activity' $b } catch {}
}
function Revoked($err) { return ($err.ErrorDetails -and $err.ErrorDetails.Message -like '*not valid*') }
# Post an answer. One that can't be posted right now (no network after sleep, a server hiccup) is
# kept and retried, never answered again: that would repeat what it did, like suggestions.
function Finish($id, $text) {
  try { $null = Rpc 'connector_finish_request' @{ token = $Cfg.token; request = $id; answer_text = $text } }
  catch {
    if (Revoked $_) { return }
    Log ('Could not post an answer yet; will retry: ' + $_.Exception.Message)
    [void]$script:Unposted.Add(@{ id = $id; text = $text; tries = 1; next = (Get-Date).AddSeconds(5) })
  }
}
function Retry-Unposted {
  for ($k = $script:Unposted.Count - 1; $k -ge 0; $k--) {
    $u = $script:Unposted[$k]
    if ((Get-Date) -lt $u.next) { continue }
    try {
      $null = Rpc 'connector_finish_request' @{ token = $Cfg.token; request = $u.id; answer_text = $u.text }
      $script:Unposted.RemoveAt($k)
      Log 'Posted an answer that had failed to post.'
      Activity 'idle'
    } catch {
      if (Revoked $_) { $script:Unposted.RemoveAt($k); continue }
      $u.tries = $u.tries + 1
      $u.next = (Get-Date).AddSeconds([Math]::Min(300, 5 * [Math]::Pow(2, $u.tries)))
    }
  }
}

$script:Proc = $null
$script:ProcModel = ''
$script:ProcEffort = ''
$script:Switching = $null
$script:SwitchSeq = 0
$script:Resumed = $false
$script:Out = $null
$script:Err = $null
$script:ErrTail = New-Object System.Collections.Queue
$script:Queue = New-Object System.Collections.ArrayList
$script:Unposted = New-Object System.Collections.ArrayList
$script:Seen = @{}
$script:FetchFails = 0
$script:StartFails = 0
$script:NextStart = [datetime]::MinValue
$script:Current = $null
$script:LastUsed = Get-Date
$script:LastFetch = [datetime]::MinValue
$script:NeedFetch = $true

function Start-Claude($model, $effort) {
  $flags = @('--model', $model, '--effort', $effort)
  $session = ''
  if (Test-Path $SessionFile) { $session = ([IO.File]::ReadAllText($SessionFile)).Trim() }
  # Claude Code deletes conversations unused for a month: resume only one that is still there.
  if ($session) {
    $kept = Get-ChildItem (Join-Path $env:USERPROFILE '.claude\projects') -Filter ($session + '.jsonl') -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $kept) {
      Log 'The saved conversation is gone; starting a new one.'
      $session = ''
    }
  }
  $a = @('-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--restricted') + $flags
  if ($session) {
    $a += @('--resume', $session)
    $script:Resumed = $true
  } else {
    $session = [guid]::NewGuid().ToString()
    [IO.File]::WriteAllText($SessionFile, $session)
    $a += @('--session-id', $session, '--name', (Quote 'Average App counselor'))
    $script:Resumed = $false
  }
  $a += @('--mcp-config', (Quote $Mcp), '--strict-mcp-config', '--allowedTools', 'mcp__${MCP_SERVER}', 'WebSearch', 'WebFetch')
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Cfg.claude
  $psi.Arguments = ($a -join ' ')
  $psi.WorkingDirectory = $Dir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $psi.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
  # Load the desk's tools up front instead of searching for them on every request.
  $psi.EnvironmentVariables['ENABLE_TOOL_SEARCH'] = 'false'
  try {
    $script:Proc = [Diagnostics.Process]::Start($psi)
    $script:ProcModel = $model
    $script:ProcEffort = $effort
    $script:Out = $script:Proc.StandardOutput.ReadLineAsync()
    $script:Err = $script:Proc.StandardError.ReadLineAsync()
    $script:ErrTail.Clear()
    $script:StartFails = 0
    Log ('Claude Code is up (' + $model + ', ' + $effort + ' effort).')
  } catch {
    $script:Proc = $null
    $script:StartFails++
    $script:NextStart = (Get-Date).AddSeconds([Math]::Min(300, 5 * $script:StartFails))
    Log ('Could not start Claude Code: ' + $_.Exception.Message)
    # It may have moved (reinstalled another way): look for it again. (A "claude" under WindowsApps
    # is Claude Desktop's shortcut, which would open the Desktop app.)
    $found = Get-Command claude -All -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\WindowsApps\*' -and $_.Extension -match '^\.(exe|cmd|bat)$' } | Select-Object -First 1
    if (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe')) { $Cfg.claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe' }
    elseif ($found) { $Cfg.claude = $found.Source }
    if ($script:StartFails -ge 3) {
      foreach ($q in @($script:Queue)) {
        Finish $q.id "Your counselor couldn't start Claude Code on your computer. Run the counselor setup again from the Counselor page."
      }
      $script:Queue.Clear()
      Activity 'idle'
    }
  }
}

function Stop-Claude($gently) {
  $p = $script:Proc
  if (-not $p) { return }
  try {
    if ($gently) { $p.StandardInput.Close() }
    if (-not $gently -or -not $p.WaitForExit(10000)) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null }
  } catch {}
  $script:Proc = $null
  $script:Out = $null
  $script:Err = $null
  $script:Switching = $null
}

function Send-Next {
  $item = $script:Queue[0]
  $script:Queue.RemoveAt(0)
  $msg = @{ type = 'user'; message = @{ role = 'user'; content = $item.text } }
  try {
    $script:Proc.StandardInput.WriteLine((Ascii ($msg | ConvertTo-Json -Compress -Depth 5)))
    $script:Proc.StandardInput.Flush()
  } catch {
    Log ('Could not reach Claude Code: ' + $_.Exception.Message)
    [void]$script:Queue.Insert(0, $item)
    Stop-Claude $false
    return
  }
  $script:Current = @{ id = $item.id; text = $item.text; model = $item.model; tries = $item.tries; started = Get-Date; draft = ''; posted = ''; postedAt = [datetime]::MinValue }
  $script:LastUsed = Get-Date
  Activity 'thinking' $item.id
}

function Finish-Current($o) {
  $c = $script:Current
  $script:Current = $null
  $script:LastUsed = Get-Date
  # Resuming failed before any work: it isn't an answer. Start a new conversation and try again.
  if ($script:Resumed -and $o.is_error -and [int]$o.num_turns -eq 0 -and ((@($o.errors) -join ' ') -match 'No conversation found')) {
    Remove-Item -Force -ErrorAction SilentlyContinue $SessionFile
    $script:Resumed = $false
    [void]$script:Queue.Insert(0, @{ id = $c.id; text = $c.text; model = $c.model; tries = $c.tries; at = Get-Date })
    Log 'The saved conversation is gone; starting a new one.'
    return
  }
  $text = ''
  if ($null -ne $o.result) { $text = [string]$o.result }
  if ($o.is_error -or ($o.subtype -and $o.subtype -ne 'success')) {
    Log ('Claude could not answer (' + $o.subtype + '): ' + $text)
    $why = $text.Trim()
    if (-not $why) { $why = [string]$o.subtype }
    $text = "Sorry, I couldn't answer this one: " + $why + ' Try asking again in a little while.'
  }
  if (-not $text.Trim()) { $text = 'Done.' }
  Finish $c.id $text
  Activity 'idle'
  Log ('Answered in ' + [int]((Get-Date) - $c.started).TotalSeconds + 's.')
}

# Change the running Claude Code's model without restarting it (and without losing the conversation).
function Switch-Model($model) {
  $script:SwitchSeq++
  $id = 'model-' + $script:SwitchSeq
  $msg = @{ type = 'control_request'; request_id = $id; request = @{ subtype = 'set_model'; model = $model } }
  try {
    $script:Proc.StandardInput.WriteLine(($msg | ConvertTo-Json -Compress -Depth 5))
    $script:Proc.StandardInput.Flush()
    $script:Switching = @{ id = $id; model = $model; until = (Get-Date).AddSeconds(15) }
  } catch {
    Stop-Claude $false
  }
}

function Handle-Line($line) {
  if ($script:Switching -and $line.IndexOf('"control_response"') -ge 0) {
    try { $o = $line | ConvertFrom-Json } catch { return }
    if ($o.response.request_id -eq $script:Switching.id) {
      if ($o.response.subtype -eq 'success') {
        $script:ProcModel = $script:Switching.model
        Log ('Switched to ' + $script:ProcModel + '.')
      } else {
        # This Claude Code can't switch (or not to that model): start again with it.
        Log ('Could not switch to ' + $script:Switching.model + ': ' + ($o.response | ConvertTo-Json -Compress -Depth 4))
        Stop-Claude $true
      }
      $script:Switching = $null
    }
    return
  }
  $c = $script:Current
  if (-not $c) { return }
  if ($line.IndexOf('"stream_event"') -ge 0) {
    # The reply as it is written: text after the last tool call is the answer.
    if ($line.IndexOf('text_delta') -lt 0 -and $line.IndexOf('message_start') -lt 0 -and $line.IndexOf('"tool_use"') -lt 0) { return }
    try { $o = $line | ConvertFrom-Json } catch { return }
    $e = $o.event
    if ($e.type -eq 'message_start') { $c.draft = '' }
    elseif ($e.type -eq 'content_block_start' -and $e.content_block.type -eq 'tool_use') { $c.draft = '' }
    elseif ($e.type -eq 'content_block_delta' -and $e.delta.type -eq 'text_delta') { $c.draft += [string]$e.delta.text }
    return
  }
  if ($line.IndexOf('"result"') -lt 0) { return }
  try { $o = $line | ConvertFrom-Json } catch { return }
  if ($o.type -eq 'result') { Finish-Current $o }
}

function Read-Output {
  try {
    while ($script:Out -and $script:Out.IsCompleted) {
      $line = $script:Out.Result
      if ($null -eq $line) { $script:Out = $null; break }
      $script:Out = $script:Proc.StandardOutput.ReadLineAsync()
      Handle-Line $line
    }
    while ($script:Err -and $script:Err.IsCompleted) {
      $line = $script:Err.Result
      if ($null -eq $line) { $script:Err = $null; break }
      $script:Err = $script:Proc.StandardError.ReadLineAsync()
      $script:ErrTail.Enqueue($line)
      while ($script:ErrTail.Count -gt 20) { [void]$script:ErrTail.Dequeue() }
    }
  } catch {
    Log ('Lost Claude Code output: ' + $_.Exception.Message)
    $script:Out = $null
  }
}

function Post-Draft {
  $c = $script:Current
  if (-not $c -or $c.draft -eq $c.posted) { return }
  if (((Get-Date) - $c.postedAt).TotalMilliseconds -lt 700) { return }
  $c.postedAt = Get-Date
  try {
    $null = Rpc 'connector_draft_answer' @{ token = $Cfg.token; request = $c.id; draft = $c.draft }
    $c.posted = $c.draft
  } catch {}
}

function Fetch-Work {
  $script:LastFetch = Get-Date
  try {
    $r = Invoke-RestMethod -Method Get -Uri $WorkUrl -TimeoutSec 40
    foreach ($q in $r.requests) {
      if ($script:Seen.ContainsKey($q.id)) { continue }
      $script:Seen[$q.id] = $true
      $m = [string]$q.model
      if ($Models -notcontains $m) { $m = '' }
      [void]$script:Queue.Add(@{ id = $q.id; text = [string]$q.text; model = $m; tries = 0; at = Get-Date })
    }
    $script:NeedFetch = $false
    $script:FetchFails = 0
  } catch {
    $script:FetchFails++
    Log ('Could not fetch the requests: ' + $_.Exception.Message)
  }
}

# Claude Code stopped on its own (or was stopped): try the request it was on once more, then give up on it.
function Handle-Exit {
  Read-Output
  $p = $script:Proc
  if (-not $p.HasExited) { try { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null } catch {} }
  $code = ''
  try { $code = [string]$p.ExitCode } catch {}
  $tail = ($script:ErrTail.ToArray() -join ' | ')
  Log ('Claude Code stopped (' + $code + ') ' + $tail)
  if ($script:Resumed -and $tail -match 'conversation|session') { Remove-Item -Force -ErrorAction SilentlyContinue $SessionFile }
  $script:Proc = $null
  $script:Out = $null
  $script:Err = $null
  $script:Switching = $null
  $c = $script:Current
  $script:Current = $null
  if (-not $c) { return }
  if ($c.tries -lt 1) {
    [void]$script:Queue.Insert(0, @{ id = $c.id; text = $c.text; model = $c.model; tries = $c.tries + 1; at = Get-Date })
  } else {
    Finish $c.id "Sorry, I couldn't answer this one: Claude Code stopped unexpectedly. Try asking again."
    Activity 'idle'
  }
}

# Asked on the website to remove the counselor from this computer: stop, leave sign-in, delete its
# conversation with Claude Code (it holds the student's essays) and this folder, and disconnect.
function Remove-Counselor {
  Log 'Removing the counselor from this computer, as asked on the website.'
  $c = $script:Current
  $script:Current = $null
  Stop-Claude $false
  if ($c) { Finish $c.id 'Your counselor was removed from your computer before it could answer this.' }
  ${REMOVE_STARTUP}
  $session = ''
  if (Test-Path $SessionFile) { $session = ([IO.File]::ReadAllText($SessionFile)).Trim() }
  if ($session) {
    Get-ChildItem (Join-Path $env:USERPROFILE '.claude\projects') -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '*ApplicationDesk-Counselor' -and (Test-Path (Join-Path $_.FullName ($session + '.jsonl'))) } |
      ForEach-Object { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $_.FullName }
  }
  try { $null = Rpc 'connector_counselor_removed' @{ token = $Cfg.token } } catch {}
  # This folder goes last, from outside it, once this script has stopped.
  $conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
  Start-Process -FilePath $conhost -ArgumentList ('--headless cmd.exe /c ping -n 4 127.0.0.1 >nul & rmdir /s /q "' + $Dir + '"') -WorkingDirectory $env:TEMP
  exit
}

Log ('Counselor ' + $Version + ' started.')
$LastPoll = [datetime]::MinValue
$Fails = 0
$Model = 'sonnet'
$Effort = 'medium'
$Paused = $false
$Waiting = 0
while ($true) {
  $now = Get-Date
  $interval = 2
  if ($Fails) { $interval = [Math]::Min(60, 3 * $Fails) }
  if (($now - $LastPoll).TotalSeconds -ge $interval) {
    $LastPoll = $now
    try {
      $pollArgs = @{ token = $Cfg.token; version = $Version }
      if ($SaysComputer) { $pollArgs.computer = $Computer; $pollArgs.machine = $Machine }
      $r = Rpc 'connector_counselor_poll' $pollArgs
      if ($Fails -gt 1) { Log ('Reached the desk again after ' + $Fails + ' tries.') }
      $Fails = 0
      if ($r.remove) { Remove-Counselor }
      if ($Models -contains [string]$r.model) { $Model = [string]$r.model }
      elseif ($SpeedModel.ContainsKey([string]$r.speed)) { $Model = $SpeedModel[[string]$r.speed] }
      if ($Efforts -contains [string]$r.effort) { $Effort = [string]$r.effort }
      elseif ($SpeedEffort.ContainsKey([string]$r.speed)) { $Effort = $SpeedEffort[[string]$r.speed] }
      $Paused = [bool]$r.paused
      $Waiting = [int]$r.waiting
      if ([int]$r.fresh -gt 0) { $script:NeedFetch = $true }
      if ($null -ne $r.pending) {
        $open = @{}
        foreach ($i in @($r.pending)) { $open[[string]$i] = $true }
        for ($k = $script:Queue.Count - 1; $k -ge 0; $k--) {
          $q = $script:Queue[$k]
          if ($q.at -lt $now -and -not $open.ContainsKey([string]$q.id)) {
            $script:Queue.RemoveAt($k)
            Log 'Dropped a request that was withdrawn.'
          }
        }
      }
      # Something is waiting that nothing here is working on: look again now and then.
      if ($Waiting -gt 0 -and -not $script:Current -and $script:Queue.Count -eq 0 -and ($now - $script:LastFetch).TotalSeconds -gt 60) { $script:NeedFetch = $true }
    } catch {
      $detail = ''
      if ($_.ErrorDetails) { $detail = $_.ErrorDetails.Message }
      if ($SaysComputer -and $detail -like '*PGRST202*') {
        $SaysComputer = $false
        Log 'The desk is a database update behind: checking in without this computer''s name.'
        continue
      }
      if ($detail -like '*not valid*') {
        Log 'Its connector link was revoked, so the counselor is turning itself off.'
        Stop-Claude $false
        ${REMOVE_STARTUP}
        exit
      }
      $Fails++
      # Once per outage, not at every retry (a flaky network would fill the log).
      if ($Fails -eq 1) { Log ('Could not reach the desk: ' + $_.Exception.Message + ' ' + $detail) }
    }
  }

  if ($script:Proc) {
    Read-Output
    Post-Draft
    if ($script:Proc -and ($script:Proc.HasExited -or -not $script:Out)) { Handle-Exit }
  }
  if ($script:Current -and ((Get-Date) - $script:Current.started).TotalMinutes -gt 15) {
    Log 'A request took over 15 minutes; stopping it.'
    $c = $script:Current
    $script:Current = $null
    Stop-Claude $false
    Finish $c.id "Sorry, that took too long and I stopped. Try asking again, perhaps in smaller steps."
    Activity 'idle'
  }

  if (-not $Paused -and $script:NeedFetch -and $Waiting -gt 0 -and ((Get-Date) - $script:LastFetch).TotalSeconds -ge [Math]::Min(60, 2 * $script:FetchFails)) { Fetch-Work }
  if ($Waiting -eq 0) { $script:NeedFetch = $false }
  if ($script:Unposted.Count) { Retry-Unposted }

  if ($script:Switching -and (Get-Date) -gt $script:Switching.until) {
    Log ('Switching to ' + $script:Switching.model + ' took too long; starting again with it.')
    $script:Switching = $null
    Stop-Claude $false
  }

  if (-not $script:Current -and -not $script:Switching) {
    # A new effort takes effect between requests (a new model switches in place, below).
    if ($script:Proc -and $script:ProcEffort -ne $Effort) { Stop-Claude $true }
    if (-not $Paused -and $script:Queue.Count -gt 0) {
      $want = $script:Queue[0].model
      if (-not $want) { $want = $Model }
      if (-not $script:Proc -and (Get-Date) -ge $script:NextStart) { Start-Claude $want $Effort }
      if ($script:Proc -and $script:Queue.Count -gt 0) {
        if ($script:ProcModel -ne $want) { Switch-Model $want } else { Send-Next }
      }
    } elseif ($script:Proc -and ($Paused -or ((Get-Date) - $script:LastUsed).TotalMinutes -gt 20)) {
      # Nothing to do for a while: let Claude Code rest; the conversation resumes next time.
      Stop-Claude $true
      Log 'Claude Code is resting.'
    }
  }
  if ($script:Current) { Start-Sleep -Milliseconds 150 } else { Start-Sleep -Milliseconds 400 }
}
`;

/** Stops the watcher and its Claude Code, and removes it from sign-in (stop.ps1, and the installer's first step). */
const STOPPER = String.raw`Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -like '*${COUNSELOR_DIR}\watch.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*${COUNSELOR_DIR}\mcp.json*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
${REMOVE_STARTUP}
`;

const TURN_OFF_CMD = String.raw`@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo The Average App counselor is off. Double-click the setup file again to turn it back on.
pause
`;

/** The installer's PowerShell. Placeholders are filled in by counselorInstaller. */
const SETUP = String.raw`$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Site = '__SITE__'
$SupabaseUrl = '__SUPABASE_URL__'
$Key = '__KEY__'
$Token = '__TOKEN__'
$Dir = Join-Path $env:LOCALAPPDATA '${COUNSELOR_DIR}'
$Shell = New-Object -ComObject WScript.Shell
$NL = [Environment]::NewLine
function Say($text, $icon) { [void]$Shell.Popup($text, 0, 'Average App counselor', $icon) }
# A question with OK and Cancel: true for OK.
function Ask($text) { return $Shell.Popup($text, 0, 'Average App counselor', 1 + 32) -eq 1 }

# Claude Code: the first that answers as Claude Code. Claude Desktop's "claude" (under WindowsApps,
# or its own folder) is skipped: running it would open the Desktop app.
function Find-Claude {
  $candidates = @(Join-Path $env:USERPROFILE '.local\bin\claude.exe')
  $candidates += @(Get-Command claude -All -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(exe|cmd|bat)$' } | ForEach-Object { $_.Source })
  $candidates += (Join-Path $env:APPDATA 'npm\claude.cmd')
  foreach ($c in $candidates) {
    if (-not $c -or -not (Test-Path $c) -or $c -like '*\WindowsApps\*' -or $c -like '*\AnthropicClaude\*') { continue }
    # One that won't start (damaged, or blocked by antivirus) is passed over, and may be installed again.
    $ErrorActionPreference = 'Continue'
    $ok = $false
    try { $v = & $c --version 2>&1 | Out-String; $ok = $LASTEXITCODE -eq 0 -and $v -match 'Claude Code' } catch { }
    $ErrorActionPreference = 'Stop'
    if ($ok) { return $c }
  }
  return $null
}

# Whether Claude Code is signed in, and to what plan: claude auth status --json, or null.
function Get-SignIn($claude) {
  $ErrorActionPreference = 'Continue'
  $out = & $claude auth status --json 2>$null | Out-String
  $ErrorActionPreference = 'Stop'
  $a = $out.IndexOf('{')
  $b = $out.LastIndexOf('}')
  if ($a -lt 0 -or $b -le $a) { return $null }
  try { return ($out.Substring($a, $b - $a + 1) | ConvertFrom-Json) } catch { return $null }
}
function Save($name, $text) { [IO.File]::WriteAllText((Join-Path $Dir $name), $text, (New-Object System.Text.UTF8Encoding($false))) }

try {
  # A setup file from an older download carries a link that's been turned off: say so before
  # installing anything.
  $dead = $false
  try { Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($Site + '/api/counselor/' + $Token) -TimeoutSec 20 | Out-Null }
  catch { if ($_.Exception.Response) { $dead = @(403, 404) -contains [int]$_.Exception.Response.StatusCode } }
  if ($dead) {
    Say ("This setup file is from an older download, and its link has been turned off." + $NL + $NL + "In Downloads, open the newest counselor setup file (its name may end in (1) or (2)), or download it again from Settings > Counselor.") 48
    exit 1
  }

  # Claude Code, which the counselor runs on: installed with Anthropic's own installer when it's
  # missing (into this account's folder; no admin, nothing to type).
  $Claude = Find-Claude
  if (-not $Claude) {
    if (-not (Ask ("Your counselor runs on Claude Code, Anthropic's app for your Claude account, and it isn't on this computer yet." + $NL + $NL + "Install it now? It takes a minute or two, needs no password, and nothing else is installed. (You'll need a Claude Pro or Max plan to use it.)"))) {
      Say ("The counselor needs Claude Code. Double-click this file again whenever you're ready to install it.") 64
      exit 1
    }
    Write-Host 'Installing Claude Code from Anthropic (a minute or two)...'
    $installer = Join-Path $env:TEMP 'averageapp-claude-code-install.ps1'
    $installed = $false
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'https://claude.ai/install.ps1' -OutFile $installer -TimeoutSec 60
      # Its own process: the installer ends with "exit", which would end this setup too.
      $ErrorActionPreference = 'Continue'
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ("[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; & '" + $installer.Replace("'", "''") + "'")
      $installed = $LASTEXITCODE -eq 0
      $ErrorActionPreference = 'Stop'
    } catch {
      Write-Host $_.Exception.Message
    }
    Remove-Item -Force $installer -ErrorAction SilentlyContinue
    $Claude = Find-Claude
    if (-not $Claude) {
      $how = 'It may have been blocked by your internet connection, a school or work network, or antivirus.'
      if ($installed) { $how = 'The installer finished, but Claude Code is not where it should be.' }
      Say ("Claude Code couldn't be installed." + $NL + $NL + $how + $NL + $NL + "You can install it from claude.com/claude-code, then double-click this file again.") 16
      exit 1
    }
  }

  # Signed in: if not, the browser opens to sign in (the same Claude account as the website).
  $signin = Get-SignIn $Claude
  if (-not ($signin -and $signin.loggedIn)) {
    if (-not (Ask ("Next, sign in to Claude Code with your Claude account." + $NL + $NL + "Your browser opens: sign in, click Authorize, then come back to this window. (Claude Code needs a Claude Pro or Max plan.)"))) {
      Say ("The counselor needs Claude Code signed in. Double-click this file again whenever you're ready.") 64
      exit 1
    }
    Write-Host 'Opening your browser to sign in to Claude...'
    $ErrorActionPreference = 'Continue'
    & $Claude auth login --claudeai
    $ErrorActionPreference = 'Stop'
    $signin = Get-SignIn $Claude
    if (-not ($signin -and $signin.loggedIn)) {
      Say ("Claude Code isn't signed in yet, so the counselor can't start." + $NL + $NL + "Double-click this file again to try signing in once more.") 48
      exit 1
    }
  }

  Write-Host 'Setting up your counselor...'
  __STOPPER__
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $config = [ordered]@{ site = $Site; supabaseUrl = $SupabaseUrl; key = $Key; token = $Token; claude = $Claude }
  Save 'config.json' ($config | ConvertTo-Json)
  $mcp = @{ mcpServers = @{ '${MCP_SERVER}' = @{ type = 'http'; url = ($Site + '/api/mcp/' + $Token) } } }
  Save 'mcp.json' ($mcp | ConvertTo-Json -Depth 5)
  Save 'CLAUDE.md' @'
__BRIEF__
'@
  Save 'watch.ps1' @'
__WATCHER__
'@
  Save 'stop.ps1' @'
__STOPPER__
'@
  Save 'Turn off counselor.cmd' @'
__TURN_OFF__
'@

  # A first run checks that Claude Code is signed in and can reach the desk. An update keeps the
  # counselor's conversation (and so what it remembers); a new counselor starts one.
  Write-Host 'Checking that Claude can reach your desk (this takes a few seconds)...'
  Set-Location $Dir
  $env:ENABLE_TOOL_SEARCH = 'false'
  $SessionFile = Join-Path $Dir 'session.txt'
  $session = ''
  if (Test-Path $SessionFile) { $session = ([IO.File]::ReadAllText($SessionFile)).Trim() }
  $common = @('--model', 'sonnet', '--effort', 'low', '--restricted', '--mcp-config', (Join-Path $Dir 'mcp.json'), '--strict-mcp-config', '--allowedTools', 'mcp__${MCP_SERVER}')
  $script:check = ''
  $script:ok = $false
  function Run-Check {
    # Claude Code may write notices to stderr; they mustn't stop the setup.
    $ErrorActionPreference = 'Continue'
    $script:ok = $false
    if ($script:session) {
      $script:check = & $Claude -p '__CHECK__' --resume $script:session @common 2>&1 | Out-String
      $script:ok = $LASTEXITCODE -eq 0
    }
    if (-not $script:ok) {
      $script:session = [guid]::NewGuid().ToString()
      $script:check = & $Claude -p '__CHECK__' --session-id $script:session --name 'Average App counselor' @common 2>&1 | Out-String
      $script:ok = $LASTEXITCODE -eq 0
    }
    $ErrorActionPreference = 'Stop'
  }
  Run-Check
  # A sign-in that has run out (Claude Code still counts it as signed in), or an account without a
  # plan Claude Code takes: offer to sign in again, with this account or another, and check again.
  if (-not $ok) {
    $signin = Get-SignIn $Claude
    $noPlan = $signin -and $signin.authMethod -eq 'claude.ai' -and -not $signin.subscriptionType
    if ($noPlan -or $check -match 'authenticat|/login|oauth|expired|revoked|401|subscription') {
      if (Ask ("Claude Code couldn't use your Claude account: its sign-in may have run out, or the account may not have a Claude Pro or Max plan." + $NL + $NL + "Sign in again? Your browser opens: sign in (with another Claude account if you like), click Authorize, then come back to this window.")) {
        Write-Host 'Opening your browser to sign in to Claude...'
        $ErrorActionPreference = 'Continue'
        & $Claude auth logout 2>&1 | Out-Null
        & $Claude auth login --claudeai
        $ErrorActionPreference = 'Stop'
        Run-Check
      }
    }
  }
  if (-not $ok) {
    $why = $check.Trim()
    if ($why.Length -gt 600) { $why = $why.Substring(0, 600) + '...' }
    Say ("Claude Code couldn't reach your desk:" + $NL + $NL + $why + $NL + $NL + "Double-click this file again to try once more (it offers to sign in to Claude again if that's what is wrong). If it keeps happening, check your internet connection and that your Claude plan is Pro or Max.") 16
    exit 1
  }
  Save 'session.txt' $session

  # Start hidden now, and at every sign-in.
  $conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
  $launch = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Dir 'watch.ps1') + '"'
  ${REMOVE_STARTUP}
  $lnk = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) '${STARTUP_NAME}'))
  $lnk.TargetPath = $conhost
  $lnk.Arguments = $launch
  $lnk.WorkingDirectory = $env:LOCALAPPDATA
  $lnk.WindowStyle = 7
  $lnk.Description = 'Answers what you ask on your Average App desk, with Claude Code'
  $lnk.Save()
  Start-Process -FilePath $conhost -ArgumentList $launch -WorkingDirectory $env:LOCALAPPDATA

  Say ("Your counselor is on." + $NL + $NL + "Talk to it on the Counselor page, or ask anything on your desk (Ask, Polish, odds, the Profile interview): Claude answers there, with nothing else to open. It runs hidden and starts again whenever you sign in to Windows." + $NL + $NL + "Pause it or remove it in Settings, under Counselor.") 64
} catch {
  Say ("Setting up the counselor failed:" + $NL + $NL + $_.Exception.Message) 16
  exit 1
}
`;

const HEADER = [
  "<# : Average App counselor setup - double-click to install",
  "@echo off",
  'set "APPDESK_SETUP=%~f0"',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:APPDESK_SETUP))"',
  "exit /b",
  "#>",
].join("\n");

const SAFE = {
  url: /^https?:\/\/[A-Za-z0-9.:\-]+(\/[A-Za-z0-9._\-/]*)?$/,
  key: /^[A-Za-z0-9._\-]+$/,
  token: /^[A-Za-z0-9_\-]{20,64}$/,
};

/** The values an installer is made from, checked to be plain (they go into a script), without trailing slashes. */
export function checkedConfig(c: InstallerConfig): InstallerConfig {
  const site = c.site.replace(/\/+$/, "");
  const supabaseUrl = c.supabaseUrl.replace(/\/+$/, "");
  if (!SAFE.url.test(site) || !SAFE.url.test(supabaseUrl)) throw new Error("Unexpected site or database address.");
  if (!SAFE.key.test(c.supabaseKey)) throw new Error("Unexpected database key.");
  if (!SAFE.token.test(c.token)) throw new Error("Unexpected connector token.");
  if (CHECK_PROMPT.includes("'")) throw new Error("The check prompt can't contain a single quote.");
  return { site, supabaseUrl, supabaseKey: c.supabaseKey, token: c.token };
}

/** Text for a single-quoted PowerShell here-string: no line may start with '@. */
function hereString(s: string): string {
  if (/^'@/m.test(s)) throw new Error("A here-string can't contain a line starting with '@");
  return s.replace(/\s+$/, "");
}

function crlf(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/** The whole installer, ready to download. */
export function counselorInstaller(config: InstallerConfig): string {
  const c = checkedConfig(config);
  const { site, supabaseUrl } = c;
  // Functions, so "$" in PowerShell code is never read as a replacement pattern.
  const fill: [string, string][] = [
    ["__STOPPER__", STOPPER.trim().split("\n").join("\n  ")],
    ["__BRIEF__", hereString(COUNSELOR_BRIEF)],
    ["__WATCHER__", hereString(WATCHER)],
    ["__STOPPER__", hereString(STOPPER)],
    ["__TURN_OFF__", hereString(TURN_OFF_CMD)],
    ["__CHECK__", CHECK_PROMPT],
    ["__CHECK__", CHECK_PROMPT],
    ["__SITE__", site],
    ["__SUPABASE_URL__", supabaseUrl],
    ["__KEY__", c.supabaseKey],
    ["__TOKEN__", c.token],
  ];
  const body = fill.reduce((text, [mark, value]) => text.replace(mark, () => value), SETUP);
  const out = crlf(`${HEADER}\n${body}`);
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(out)) throw new Error("The installer must be plain ASCII.");
  return out;
}
