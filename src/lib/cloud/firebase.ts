/**
 * Firebase app bootstrap for Vigil Desktop (Cloud Bridge).
 * Config via Vite env — never hardcode production secrets in source.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export type VigilFirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  measurementId?: string;
};

export function readFirebaseConfigFromEnv(): VigilFirebaseConfig | null {
  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || "").trim();
  const authDomain = String(
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  ).trim();
  const projectId = String(
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  ).trim();
  const appId = String(import.meta.env.VITE_FIREBASE_APP_ID || "").trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket:
      String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim() ||
      undefined,
    messagingSenderId:
      String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "").trim() ||
      undefined,
    measurementId:
      String(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "").trim() ||
      undefined,
  };
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseConfigFromEnv() != null;
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  const config = readFirebaseConfigFromEnv();
  if (!config) {
    throw new Error(
      "Firebase is not configured. Set VITE_FIREBASE_* in .env.local",
    );
  }
  app = getApps().length ? getApps()[0]! : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

/** Test helper — reset singletons between tests. */
export function __resetFirebaseSingletonsForTests(): void {
  app = null;
  auth = null;
  db = null;
}
