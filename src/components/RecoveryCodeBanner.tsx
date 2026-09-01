'use client';

import { useEffect, useState } from 'react';

/**
 * Shown once, in the creator's browser only: the recovery code handed back
 * by race creation (stashed in sessionStorage across the redirect). The
 * code rebuilds the race — same outcome, same story, same link — on any
 * Summit server, so the host can never lose a race to a crash. It contains
 * the sealed ending, so it is never shown again and never served by the API.
 *
 * Collapsed to a single row so it never crowds the race out of the
 * viewport; the code itself is revealed on demand.
 */
export function RecoveryCodeBanner({ slug }: { slug: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setCode(sessionStorage.getItem(`summit-code-${slug}`));
    } catch {
      // storage unavailable — nothing to show
    }
  }, [slug]);

  if (!code) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // clipboard unavailable — reveal the code for manual selection
      setOpen(true);
    }
  };
  const dismiss = () => {
    try {
      sessionStorage.removeItem(`summit-code-${slug}`);
    } catch {
      // ignore
    }
    setCode(null);
  };

  return (
    <div className="code-banner" role="note">
      <div className="code-banner-row">
        <span className="code-banner-mark" aria-hidden>
          ⛨
        </span>
        <span className="code-banner-lede">
          <strong>Recovery code.</strong> Rebuilds this race — sealed ending
          intact — on any Summit server. Shown once, only to you.
        </span>
        <div className="code-banner-actions">
          <button className="share-btn" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy code'}
          </button>
          <button className="code-banner-dismiss" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show'}
          </button>
          <button className="code-banner-dismiss" onClick={dismiss}>
            {copied ? 'Dismiss' : 'I saved it — dismiss'}
          </button>
        </div>
      </div>
      {open && <code className="code-banner-code">{code}</code>}
    </div>
  );
}
