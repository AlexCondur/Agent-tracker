import { useState } from 'react';
import { openInCursor, questionsOf, sendInput, type Dialog, type InputBody, type Session } from '../api.ts';

const btn = 'rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

/** One-click answers for a session that is blocked on a question or a permission prompt. */
export function PromptActions({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState(0); // which question of a multi-question prompt we're on
  const [other, setOther] = useState('');
  const pending = session.pending!;
  const canReply = !!session.ctId;

  async function send(...inputs: InputBody[]) {
    setBusy(true);
    setError(undefined);
    try {
      for (const [i, input] of inputs.entries()) {
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        await sendInput(session.id, input);
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const disabledHint = canReply ? undefined : 'Started with plain claude, so it can’t be answered from here. Use `ct` to start sessions.';

  // Cursor can't be answered from outside: show what it's asking and bring its window forward.
  if (session.tool === 'cursor') {
    const input = pending.toolInput as { command?: string; blockReason?: string } | undefined;
    const q = questionsOf(session)[0];
    return (
      <div className="space-y-2" onClick={e => e.stopPropagation()}>
        {pending.kind === 'question' && q ? (
          <>
            <div className="text-sm text-amber-100">{q.question}</div>
            <div className="flex flex-wrap gap-1.5">
              {(q.options ?? []).map(o => (
                <span key={o.label} className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {o.label}
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-amber-200/90">
              Wants to run <span className="font-semibold">{pending.toolName}</span>
              {input?.blockReason && <span className="text-zinc-400"> · {input.blockReason}</span>}
            </div>
            {input?.command && (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-300">{input.command}</pre>
            )}
          </>
        )}
        <button className={`${btn} bg-violet-600 text-white hover:bg-violet-500`} onClick={() => openInCursor(session.id)}>
          Open in Cursor
        </button>
      </div>
    );
  }

  if (pending.kind === 'dialog') {
    const d = pending.toolInput as Dialog;
    return (
      <div className="space-y-2" onClick={e => e.stopPropagation()}>
        <div className="text-sm text-amber-100">{d.title}</div>
        {d.body && <div className="line-clamp-2 text-xs text-zinc-400">{d.body}</div>}
        <div className="flex flex-wrap gap-1.5">
          {d.options.map(o => (
            <button
              key={o.n}
              className={`${btn} bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30 hover:bg-amber-500/30`}
              disabled={busy}
              onClick={() => send({ option: o.n })}
            >
              {o.label}
            </button>
          ))}
          <button className={`${btn} text-zinc-400 hover:text-zinc-200`} disabled={busy} onClick={() => send({ key: 'esc' })}>
            Dismiss (Esc)
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    );
  }

  if (pending.kind === 'permission') {
    const input = pending.toolInput as Record<string, unknown> | undefined;
    const preview = String(input?.command ?? input?.file_path ?? input?.url ?? JSON.stringify(input ?? {}));
    return (
      <div className="space-y-2" onClick={e => e.stopPropagation()}>
        <div className="text-xs text-amber-200/90">
          Wants to run <span className="font-semibold">{pending.toolName}</span>
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-300">
          {preview}
        </pre>
        <div className="flex flex-wrap gap-1.5" title={disabledHint}>
          <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`} disabled={!canReply || busy} onClick={() => send({ key: '1' })}>
            Approve
          </button>
          <button className={`${btn} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`} disabled={!canReply || busy} onClick={() => send({ key: 'esc' })}>
            Deny
          </button>
          <button className={`${btn} text-zinc-400 hover:text-zinc-200`} onClick={onOpen}>
            More options…
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    );
  }

  const questions = questionsOf(session);
  const q = questions[Math.min(step, questions.length - 1)];
  if (!q) return null;
  const options = q.options ?? [];
  const answer = (...inputs: InputBody[]) => send(...inputs).then(() => setStep(s => s + 1));

  return (
    <div className="space-y-2" onClick={e => e.stopPropagation()}>
      <div className="text-sm text-amber-100">
        {questions.length > 1 && <span className="mr-1 text-xs text-amber-300/70">{step + 1}/{questions.length}</span>}
        {q.question}
      </div>
      {q.multiSelect ? (
        <button className={`${btn} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`} onClick={onOpen}>
          Multiple choice: answer in terminal
        </button>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" title={disabledHint}>
            {options.map((o, i) => (
              <button
                key={o.label}
                title={o.description}
                className={`${btn} bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30 hover:bg-amber-500/30`}
                disabled={!canReply || busy}
                onClick={() => answer({ key: String(i + 1) })}
              >
                {o.label}
              </button>
            ))}
          </div>
          {canReply && (
            <form
              className="flex gap-1.5"
              onSubmit={e => {
                e.preventDefault();
                // The option after the listed ones is "Type something": select it, then type.
                if (other.trim()) answer({ key: String(options.length + 1) }, { text: other.trim() }).then(() => setOther(''));
              }}
            >
              <input
                value={other}
                onChange={e => setOther(e.target.value)}
                placeholder="Other answer…"
                className="min-w-0 flex-1 rounded-md bg-black/40 px-2 py-1 text-xs outline-none ring-1 ring-zinc-700 focus:ring-amber-400/50"
              />
            </form>
          )}
        </>
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
