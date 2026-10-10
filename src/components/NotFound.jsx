import React from 'react';
export default function NotFound() {
  return (
    <main className="sm-not-found">
      <img src="/logo.png" alt="Star Mart" width="160" />
      <h1>Page not found</h1>
      <p>The address you opened does not exist in Star Mart.</p>
      <nav>
        <a href="/shop">Go to the store</a>
        <a href="/account">My account</a>
        <a href="/admin">Owner sign in</a>
      </nav>
    </main>
  );
}
