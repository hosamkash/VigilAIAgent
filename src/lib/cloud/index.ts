export { CLOUD_COLLECTIONS } from "./collections";
export {
  isFirebaseConfigured,
  readFirebaseConfigFromEnv,
  getFirebaseApp,
  getFirebaseAuth,
  getFirebaseDb,
} from "./firebase";
export {
  signInWithEmail,
  signUpWithEmail,
  signOutCloud,
  subscribeAuth,
} from "./auth";
export { assertNoCodeUpload, rejectIfCodeUpload } from "./no-code-upload";
export { planArtifactToCloudDoc, cloudDocToPlanArtifact } from "./plan-cloud";
export {
  pushPlanToCloud,
  pullPlanFromCloud,
  listCloudPlansForUser,
  ensureLocalPlanFromCloud,
  shouldReplaceLocalPlanWithCloud,
} from "./plans-sync";
export {
  chatTabToCloudDoc,
  messageToCloudDoc,
  messagesToCloudDocs,
  sanitizeMessageContent,
  CLOUD_MESSAGE_CONTENT_MAX,
} from "./chat-cloud";
export {
  pushChatToCloud,
  listCloudChatsForUser,
  listCloudMessagesForChat,
  cloudMessageToLocal,
} from "./chats-sync";
export {
  recordDesktopUsageEvent,
  estimateTokenDebit,
} from "./usage";
export {
  buildVigilContinueUrl,
  parseVigilDeepLink,
} from "./deep-link";
export type { VigilDeepLink } from "./deep-link";
export { getOrCreateLocalDeviceId, touchCloudDevice } from "./devices";
export {
  hydrateLocalChatsFromCloud,
  hydrateLocalPlansFromCloud,
} from "./cloud-hydrate";
export type {
  CloudHydrateResult,
  CloudPlanHydrateResult,
} from "./cloud-hydrate";
export type * from "./types";
