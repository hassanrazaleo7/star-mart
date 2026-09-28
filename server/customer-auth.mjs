export async function firebaseIdentity(req) {
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];

  if (!token) {
    throw Object.assign(new Error('Sign in first'), {status: 401});
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw Object.assign(
      new Error('Google/mobile sign-in is not configured'),
      {status: 503}
    );
  }

  const [{initializeApp, getApps}, {getAuth}] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth')
  ]);

  if (!getApps().length) initializeApp({projectId});

  let user;
  try {
    user = await getAuth().verifyIdToken(token);
  } catch {
    throw Object.assign(
      new Error('Session expired. Sign in again.'),
      {status: 401}
    );
  }

  if (user.firebase?.sign_in_provider === 'password' && !user.email_verified) {
    throw Object.assign(
      new Error('Verify your email before ordering'),
      {status: 403}
    );
  }

  return {
    id: user.uid,
    email: user.email || '',
    phone: user.phone_number || '',
    name: user.name || user.email?.split('@')[0] || 'Customer'
  };
}

export const customerFrom = firebaseIdentity;
