'use client';

import { useEffect, useState } from 'react';

/**
 * Shown once, in the creator's browser only: the recovery code handed back
 * by race creation (stashed in sessionStorage across the redirect). The
 * code rebuilds the race — same outcome, same story, same link — on any
 * Summit server, so the host can never lose a race to a crash. It contains
 * the sealed ending, so it is never shown again and never served by the API.
 */
export function RecoveryCodeBanner({ slug }: { slug: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      // selection fallback: the code is visible below
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
      <div className="code-banner-head">
        <strong>Recovery code — save this somewhere safe.</strong>
        <span>
          It can rebuild this race, mid-flight, on any Summit server if
          anything ever crashes. Shown only once, only to you. It contains
          the sealed ending — keep it, don&apos;t decode it.
        </span>
      </div>
      <code className="code-banner-code">{code}</code>
      <div className="code-banner-actions">
        <button className="share-btn" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy code'}
        </button>
        <button className="code-banner-dismiss" onClick={dismiss}>
          I saved it — dismiss
        </button>
      </div>
    </div>
  );
}
