# Vigil Cloud Bridge — Firebase

Phase 1 foundation for Unified Cloud Bridge (`02-جسر-السحابة-الموحد.mdc`).

## Setup

1. Create a Firebase project (do **not** reuse VigilHub credentials in source).
2. Enable **Email/Password** Auth (Google optional later).
3. Create a web app and copy config into desktop `.env.local`:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

4. Deploy rules/indexes when ready:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Guardrails

- Never upload workspace source / `.git` / deep index to Firestore.
- Client rules: own-data only; packages/wallets/payments writes via Admin SDK / Functions later.

## Desktop slice status

- Auth + Account UI (Settings → Account)
- Push: plans, chats/messages, usageEvents; device touch on login
- Pull: chats into local history (Account → Pull chats from cloud)
- Next: Vigil Web shell (`03`), embed, wallet Functions
