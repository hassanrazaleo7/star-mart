import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
} from 'firebase/auth';
import { firebaseConfig, configured } from './firebase-config.js';
export { configured };
export const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
export {
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
};
