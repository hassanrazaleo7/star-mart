import React from 'react';
export default function LoadingState({ label = 'Loading Star Mart…', compact = false }) {
  return (
    <div
      className={'sm-loading' + (compact ? ' sm-loading-compact' : '')}
      role="status"
      aria-live="polite"
    >
      <div className="sm-loading-mark" aria-hidden="true">
        <span />
        <img src="/favicon.png" alt="" />
      </div>
      <div>
        <strong>{label}</strong>
        <p>Please wait a moment</p>
      </div>
    </div>
  );
}
