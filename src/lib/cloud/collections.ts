/** Canonical Firestore collection IDs for Vigil Cloud Bridge. */

export const CLOUD_COLLECTIONS = {
  users: "users",
  orgs: "orgs",
  packages: "packages",
  subscriptions: "subscriptions",
  wallets: "wallets",
  payments: "payments",
  usageEvents: "usageEvents",
  chats: "chats",
  messages: "messages",
  projects: "projects",
  libraryItems: "libraryItems",
  plans: "plans",
  schedules: "schedules",
  devices: "devices",
} as const;

export type CloudCollectionName =
  (typeof CLOUD_COLLECTIONS)[keyof typeof CLOUD_COLLECTIONS];
