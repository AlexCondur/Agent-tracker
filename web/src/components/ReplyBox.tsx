import { useEffect, useRef, useState } from 'react';
import { fetchCommands, sendInput, type SavedCommand, type Session } from '../api.ts';

/** Your saved commands, loaded when a reply box that shows them first mounts (edits show up on reopen). */
function useCommands(enabled: boolean): SavedCommand[] {
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  useEffect(() => {
    if (enabled) fetchCommands().then(setCommands, () => {});
  }, [enabled]);
  return commands;
}

/**
 * Free-text message to a session. Enter sends, Shift+Enter adds a line. With showCommands, your saved
 * commands sit above it: clicking one fills in /<name> (add arguments or just press Enter), so a misclick
 * never starts one.
 */
export function ReplyBox({ session, autoFocus, showCommands }: { session: Session; autoFocus?: boolean; showCommands?: boolean }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const commands = useCommands(!!showCommands && !!session.ctId);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await sendInput(session.id, { text: text.trimEnd() });
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!session.ctId) return null;
  return (
    <div onClick={e => e.stopPropagation()}>
      {commands.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-600">Commands</span>
          {commands.map(c => (
            <button
              key={c.name}
              onClick={() => {
                setText(`/${c.name} `);
                input.current?.focus();
              }}
              title={[c.description, c.argumentHint && `Arguments: ${c.argumentHint}`].filter(Boolean).join('\n')}
              className="rounded-md px-2 py-0.5 font-mono text-[11px] text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
            >
              /{c.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        autoFocus={autoFocus}
        rows={1}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={session.state === 'working' ? 'Queue a message…' : 'Reply…'}
        className="field-sizing-content max-h-40 w-full resize-none rounded-md bg-black/40 px-2.5 py-1.5 text-sm outline-none ring-1 ring-zinc-700 placeholder:text-zinc-500 focus:ring-sky-500/60"
      />
      {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
    </div>
  );
}
