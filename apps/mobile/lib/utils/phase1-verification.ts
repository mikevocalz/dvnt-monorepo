/**
 * PHASE 1 VERIFICATION INSTRUMENTATION
 * 
 * Temporary logging utilities to verify critical fixes are working.
 * Remove after Phase 1 verification is complete.
 */

// Track active Supabase channels to detect leaks
const activeChannels = new Map<string, { created: number; type: string }>();

export function registerChannel(channelId: string, type: string) {
  activeChannels.set(channelId, { created: Date.now(), type });
  console.log(`[Phase1Verify] Channel registered: ${channelId} (${type})`);
  console.log(`[Phase1Verify] Total active channels: ${activeChannels.size}`);
  
  // ALERT if too many channels (leak detection)
  if (activeChannels.size > 5) {
    console.error(
      `[Phase1Verify] ⚠️ CHANNEL LEAK DETECTED: ${activeChannels.size} active channels`,
      Array.from(activeChannels.entries())
    );
  }
}

export function unregisterChannel(channelId: string) {
  const channel = activeChannels.get(channelId);
  if (channel) {
    const lifetime = Date.now() - channel.created;
    console.log(
      `[Phase1Verify] Channel unregistered: ${channelId} (lived ${lifetime}ms)`
    );
    activeChannels.delete(channelId);
  }
  console.log(`[Phase1Verify] Total active channels: ${activeChannels.size}`);
}

export function getActiveChannels() {
  return Array.from(activeChannels.entries()).map(([id, info]) => ({
    id,
    type: info.type,
    ageMs: Date.now() - info.created,
  }));
}

// Track query cache pollution across users
let lastViewerId: string | null = null;

export function verifyQueryKeyScoping(
  queryKey: readonly unknown[],
  viewerId: string | undefined
) {
  const keyStr = JSON.stringify(queryKey);
  
  // Check if viewerId is in the key
  const hasViewerId = keyStr.includes(viewerId || "__no_user__");
  
  if (!hasViewerId && viewerId) {
    console.error(
      `[Phase1Verify] ⚠️ CACHE KEY MISSING USER SCOPE:`,
      queryKey,
      `Expected viewerId: ${viewerId}`
    );
  }
  
  // Detect user switch
  if (lastViewerId && lastViewerId !== viewerId) {
    console.log(
      `[Phase1Verify] User switch detected: ${lastViewerId} → ${viewerId}`
    );
  }
  lastViewerId = viewerId || null;
}

// Track conversation cleanup
const activeConversations = new Set<string>();

export function registerConversation(conversationId: string) {
  activeConversations.add(conversationId);
  console.log(
    `[Phase1Verify] Conversation registered: ${conversationId}`,
    `Total: ${activeConversations.size}`
  );
}

export function unregisterConversation(conversationId: string) {
  activeConversations.delete(conversationId);
  console.log(
    `[Phase1Verify] Conversation unregistered: ${conversationId}`,
    `Total: ${activeConversations.size}`
  );
}

export function getActiveConversations() {
  return Array.from(activeConversations);
}

// Track mutation deduplication
const mutationAttempts = new Map<string, number>();

export function trackMutationAttempt(
  mutationType: string,
  entityId: string,
  blocked: boolean
) {
  const key = `${mutationType}:${entityId}`;
  const count = (mutationAttempts.get(key) || 0) + 1;
  mutationAttempts.set(key, count);
  
  if (blocked) {
    console.log(
      `[Phase1Verify] ✅ DUPLICATE MUTATION BLOCKED: ${key} (attempt ${count})`
    );
  } else {
    console.log(`[Phase1Verify] Mutation allowed: ${key} (attempt ${count})`);
  }
  
  // Alert if too many attempts (potential issue)
  if (count > 3) {
    console.warn(
      `[Phase1Verify] ⚠️ Excessive mutation attempts: ${key} (${count} times)`
    );
  }
}

export function resetMutationTracking() {
  mutationAttempts.clear();
}

// Summary report
export function generatePhase1Report() {
  const report = {
    timestamp: new Date().toISOString(),
    activeChannels: getActiveChannels(),
    activeConversations: getActiveConversations(),
    mutationStats: Array.from(mutationAttempts.entries()).map(([key, count]) => ({
      mutation: key,
      attempts: count,
    })),
  };
  
  console.log("=== PHASE 1 VERIFICATION REPORT ===");
  console.log(JSON.stringify(report, null, 2));
  console.log("===================================");
  
  return report;
}
