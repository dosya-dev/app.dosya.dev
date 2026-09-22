/**
 * Re-exported from the generated activity catalog rather than written here.
 *
 * This file used to hold its own copy of the parser while apps/mobile held a
 * second one. The canonical version lives in
 * packages/shared/src/activity/catalog.ts and is copied into each app by
 * scripts/gen-activity-catalog.mjs; keeping this module as the import path
 * means dashboard.tsx and activity.tsx did not have to move.
 */
export { parseUA, type ParsedUA } from "@/lib/activity-catalog.generated";
