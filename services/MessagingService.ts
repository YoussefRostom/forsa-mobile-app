import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  QuerySnapshot,
  DocumentSnapshot
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { createNotification } from './NotificationService';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  mediaUrl?: string;
  isRead: boolean;
  createdAt: any; // Firestore Timestamp
  senderName?: string;
  senderPhoto?: string;
}

export interface Conversation {
  id: string;
  participant1Id: string;
  participant2Id: string;
  participant1Name?: string;
  participant2Name?: string;
  participant1Photo?: string;
  participant2Photo?: string;
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageSenderId?: string;
  unreadCount?: number;
  createdAt: any;
  otherParticipantId?: string;
  otherParticipantName?: string;
  otherParticipantPhoto?: string;
  otherParticipantRole?: string;
}

/**
 * Generate a consistent conversation ID from two user IDs
 * Ensures the same conversation ID regardless of which user initiates
 */
function getConversationId(userId1: string, userId2: string): string {
  // Sort IDs to ensure consistency
  const sorted = [userId1, userId2].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

/**
 * Get or create a conversation between two users
 */
export async function getOrCreateConversation(
  otherUserId: string
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  const conversationId = getConversationId(currentUser.uid, otherUserId);
  
  try {
    const conversationRef = doc(db, 'conversations', conversationId);
    const conversationSnap = await getDoc(conversationRef);

    if (conversationSnap.exists()) {
      return conversationId;
    }

    // Create new conversation
    const participant1Id = currentUser.uid < otherUserId 
      ? currentUser.uid 
      : otherUserId;
    const participant2Id = currentUser.uid < otherUserId 
      ? otherUserId 
      : currentUser.uid;

    await setDoc(doc(db, 'conversations', conversationId), {
      participant1Id,
      participant2Id,
      createdAt: serverTimestamp(),
      lastMessageAt: null,
    });

    return conversationId;
  } catch (error: any) {
    console.error('Error getting/creating conversation:', error);
    throw error;
  }
}

/**
 * Find any admin user ID (returns first found). Used for users to message admin.
 */
export async function findAdminUserId(): Promise<string | null> {
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'admin'), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;
    // try uppercase role
    const q2 = query(collection(db, 'users'), where('role', '==', 'ADMIN'), limit(1));
    const snap2 = await getDocs(q2);
    if (!snap2.empty) return snap2.docs[0].id;
    return null;
  } catch (error) {
    console.error('Error finding admin user:', error);
    return null;
  }
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  mediaUrl?: string
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  if (!content.trim() && !mediaUrl) {
    throw new Error('Message content or media is required');
  }

  try {
    // Add message to messages subcollection
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const messageData: any = {
      senderId: currentUser.uid,
      content: content.trim() || '',
      isRead: false,
      createdAt: serverTimestamp(),
    };

    if (mediaUrl) {
      messageData.mediaUrl = mediaUrl;
    }

    const messageRef = await addDoc(messagesRef, messageData);
    const messageId = messageRef.id;

    // Update conversation with last message info
    const conversationRef = doc(db, 'conversations', conversationId);
    await updateDoc(conversationRef, {
      lastMessage: content.trim() || (mediaUrl ? 'Media' : ''),
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: currentUser.uid,
    });

    // Notify the message recipient for all roles (admin, player, parent, academy, clinic, agent).
    // This drives both notifications list screens and push delivery.
    try {
      const parts = conversationId.split('_');
      const otherUserId = parts[0] === currentUser.uid ? parts[1] : parts[0];

      if (otherUserId && otherUserId !== currentUser.uid) {
        const otherUserRef = doc(db, 'users', otherUserId);
        const otherUserSnap = await getDoc(otherUserRef);
        const otherRole = otherUserSnap.exists() ? String((otherUserSnap.data() as any)?.role || '').toLowerCase() : '';
        const notificationRoute = otherRole === 'admin' ? '/(admin)/notifications' : '/notifications';

        const senderRef = doc(db, 'users', currentUser.uid);
        const senderSnap = await getDoc(senderRef);
        const senderData: any = senderSnap.exists() ? senderSnap.data() : null;
        const senderName =
          senderData?.parentName ||
          senderData?.academyName ||
          senderData?.clinicName ||
          senderData?.agentName ||
          senderData?.name ||
          `${senderData?.firstName || ''} ${senderData?.lastName || ''}`.trim() ||
          senderData?.email ||
          'User';

        await createNotification({
          userId: otherUserId,
          title: `New message from ${senderName}`,
          body: content.trim() || 'Sent a message',
          type: 'info',
          data: {
            senderId: currentUser.uid,
            conversationId,
            route: notificationRoute,
          },
        });
      }
    } catch (err) {
      console.warn('Failed to create message notification:', err);
    }

    return messageId;
  } catch (error: any) {
    console.error('Error sending message:', error);
    throw error;
  }
}

/**
 * Get all conversations for the current user
 */
export async function getConversations(): Promise<Conversation[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  try {
    const conversationsRef = collection(db, 'conversations');
    // Remove orderBy to avoid index requirement - we'll sort client-side
    const q = query(
      conversationsRef,
      where('participant1Id', '==', currentUser.uid)
    );

    const q2 = query(
      conversationsRef,
      where('participant2Id', '==', currentUser.uid)
    );

    const [snapshot1, snapshot2] = await Promise.all([
      getDocs(q),
      getDocs(q2)
    ]);

    const conversations: Conversation[] = [];

    // Process conversations where user is participant1
    snapshot1.forEach((docSnap) => {
      const data = docSnap.data();
      conversations.push({
        id: docSnap.id,
        participant1Id: data.participant1Id,
        participant2Id: data.participant2Id,
        lastMessage: data.lastMessage,
        lastMessageAt: data.lastMessageAt,
        lastMessageSenderId: data.lastMessageSenderId,
        createdAt: data.createdAt,
        otherParticipantId: data.participant2Id,
      });
    });

    // Process conversations where user is participant2
    snapshot2.forEach((docSnap) => {
      const data = docSnap.data();
      conversations.push({
        id: docSnap.id,
        participant1Id: data.participant1Id,
        participant2Id: data.participant2Id,
        lastMessage: data.lastMessage,
        lastMessageAt: data.lastMessageAt,
        lastMessageSenderId: data.lastMessageSenderId,
        createdAt: data.createdAt,
        otherParticipantId: data.participant1Id,
      });
    });

    // Sort by lastMessageAt (most recent first)
    conversations.sort((a, b) => {
      const timeA = a.lastMessageAt?.toMillis?.() || 0;
      const timeB = b.lastMessageAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    // Fetch user details for other participants
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const otherUserId = conv.otherParticipantId!;
        try {
          const userRef = doc(db, 'users', otherUserId);
          const userSnap = await getDoc(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            conv.otherParticipantName = 
              userData.firstName && userData.lastName
                ? `${userData.firstName} ${userData.lastName}`
                : userData.firstName || userData.lastName || userData.email || userData.phone || 'Unknown';
            conv.otherParticipantPhoto = userData.profilePhoto;
            conv.otherParticipantRole = userData.role;
            
            // Also set participant names for clarity
            if (conv.participant1Id === otherUserId) {
              conv.participant1Name = conv.otherParticipantName;
              conv.participant1Photo = conv.otherParticipantPhoto;
            } else {
              conv.participant2Name = conv.otherParticipantName;
              conv.participant2Photo = conv.otherParticipantPhoto;
            }
          }
        } catch (error) {
          console.error(`Error fetching user ${otherUserId}:`, error);
        }

        // Calculate unread count (client-side filtering to avoid composite index)
        try {
          const messagesRef = collection(db, 'conversations', conv.id, 'messages');
          // Only filter by isRead to avoid composite index requirement
          const unreadQuery = query(
            messagesRef,
            where('isRead', '==', false)
          );
          const unreadSnap = await getDocs(unreadQuery);
          // Filter client-side for senderId != currentUser.uid
          conv.unreadCount = unreadSnap.docs.filter(doc => doc.data().senderId !== currentUser.uid).length;
        } catch (error) {
          console.error(`Error calculating unread count:`, error);
          conv.unreadCount = 0;
        }

        return conv;
      })
    );

    return enrichedConversations;
  } catch (error: any) {
    console.error('Error getting conversations:', error);
    throw error;
  }
}

/**
 * Subscribe to conversations list with real-time updates
 */
export function subscribeToConversations(
  callback: (conversations: Conversation[]) => void
): () => void {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  const conversationsRef = collection(db, 'conversations');
  // Remove orderBy to avoid index requirement - we'll sort client-side
  const q1 = query(
    conversationsRef,
    where('participant1Id', '==', currentUser.uid)
  );

  const q2 = query(
    conversationsRef,
    where('participant2Id', '==', currentUser.uid)
  );

  let conversations: Conversation[] = [];
  const userCache: { [key: string]: any } = {};

  const processConversations = async () => {
    const enriched: Conversation[] = [];

    for (const conv of conversations) {
      const otherUserId = conv.otherParticipantId!;
      
      // Get user data from cache or fetch
      if (!userCache[otherUserId]) {
        try {
          const userRef = doc(db, 'users', otherUserId);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            userCache[otherUserId] = userSnap.data();
          }
        } catch (error) {
          console.error(`Error fetching user ${otherUserId}:`, error);
        }
      }

      const userData = userCache[otherUserId];
      if (userData) {
        conv.otherParticipantName = 
          userData.firstName && userData.lastName
            ? `${userData.firstName} ${userData.lastName}`
            : userData.firstName || userData.lastName || userData.email || userData.phone || 'Unknown';
        conv.otherParticipantPhoto = userData.profilePhoto;
        conv.otherParticipantRole = userData.role;
      }

      // Calculate unread count (client-side filtering to avoid composite index)
      try {
        const messagesRef = collection(db, 'conversations', conv.id, 'messages');
        // Only filter by isRead to avoid composite index requirement
        const unreadQuery = query(
          messagesRef,
          where('isRead', '==', false)
        );
        const unreadSnap = await getDocs(unreadQuery);
        // Filter client-side for senderId != currentUser.uid
        conv.unreadCount = unreadSnap.docs.filter(doc => doc.data().senderId !== currentUser.uid).length;
      } catch (error) {
        conv.unreadCount = 0;
      }

      enriched.push(conv);
    }

    // Show ALL existing conversations - don't filter by bookings
    // Booking checks only apply when STARTING new conversations, not viewing existing ones
    // This ensures all users who have communicated are visible
    let filtered = enriched;

    // Sort by lastMessageAt
    filtered.sort((a, b) => {
      const timeA = a.lastMessageAt?.toMillis?.() || 0;
      const timeB = b.lastMessageAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    callback(filtered);
  };

  const unsubscribe1 = onSnapshot(q1, (snapshot) => {
    // Update conversations array - keep all existing conversations and update/add new ones
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const existingIndex = conversations.findIndex(c => c.id === docSnap.id);
      const conv: Conversation = {
        id: docSnap.id,
        participant1Id: data.participant1Id,
        participant2Id: data.participant2Id,
        lastMessage: data.lastMessage,
        lastMessageAt: data.lastMessageAt,
        lastMessageSenderId: data.lastMessageSenderId,
        createdAt: data.createdAt,
        otherParticipantId: data.participant2Id,
      };
      
      if (existingIndex >= 0) {
        conversations[existingIndex] = conv;
      } else {
        conversations.push(conv);
      }
    });
    
    // Remove conversations that no longer exist in this query
    const snapshotIds = new Set(snapshot.docs.map(doc => doc.id));
    conversations = conversations.filter(c => 
      c.participant1Id === currentUser.uid ? snapshotIds.has(c.id) : true
    );
    
    processConversations();
  });

  const unsubscribe2 = onSnapshot(q2, (snapshot) => {
    // Update conversations array - keep all existing conversations and update/add new ones
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const existingIndex = conversations.findIndex(c => c.id === docSnap.id);
      const conv: Conversation = {
        id: docSnap.id,
        participant1Id: data.participant1Id,
        participant2Id: data.participant2Id,
        lastMessage: data.lastMessage,
        lastMessageAt: data.lastMessageAt,
        lastMessageSenderId: data.lastMessageSenderId,
        createdAt: data.createdAt,
        otherParticipantId: data.participant1Id,
      };
      
      if (existingIndex >= 0) {
        conversations[existingIndex] = conv;
      } else {
        conversations.push(conv);
      }
    });
    
    // Remove conversations that no longer exist in this query
    const snapshotIds = new Set(snapshot.docs.map(doc => doc.id));
    conversations = conversations.filter(c => 
      c.participant2Id === currentUser.uid ? snapshotIds.has(c.id) : true
    );
    
    processConversations();
  });

  return () => {
    unsubscribe1();
    unsubscribe2();
  };
}

/**
 * Get messages for a conversation
 */
export async function getMessages(
  conversationId: string,
  limitCount: number = 50
): Promise<Message[]> {
  try {
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    const messages: Message[] = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      messages.push({
        id: docSnap.id,
        conversationId,
        senderId: data.senderId,
        content: data.content || '',
        mediaUrl: data.mediaUrl,
        isRead: data.isRead || false,
        createdAt: data.createdAt,
      });
    });

    // Reverse to show oldest first
    messages.reverse();

    // Fetch sender names
    const senderIds = [...new Set(messages.map(m => m.senderId))];
    const senderData: { [key: string]: any } = {};

    await Promise.all(
      senderIds.map(async (senderId) => {
        try {
          const userRef = doc(db, 'users', senderId);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            senderData[senderId] = {
              name: userData.firstName && userData.lastName
                ? `${userData.firstName} ${userData.lastName}`
                : userData.firstName || userData.lastName || userData.email || userData.phone || 'Unknown',
              photo: userData.profilePhoto,
            };
          }
        } catch (error) {
          console.error(`Error fetching sender ${senderId}:`, error);
        }
      })
    );

    // Enrich messages with sender info
    messages.forEach((msg) => {
      const sender = senderData[msg.senderId];
      if (sender) {
        msg.senderName = sender.name;
        msg.senderPhoto = sender.photo;
      }
    });

    return messages;
  } catch (error: any) {
    console.error('Error getting messages:', error);
    throw error;
  }
}

/**
 * Subscribe to messages in a conversation with real-time updates
 */
export function subscribeToMessages(
  conversationId: string,
  callback: (messages: Message[]) => void,
  onError?: (error: any) => void
): () => void {
  const currentUserId = auth.currentUser?.uid;
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');
  const q = query(
    messagesRef,
    orderBy('createdAt', 'asc')
  );

  const senderCache: { [key: string]: any } = {};

  const unsubscribe = onSnapshot(
    q,
    async (snapshot) => {
      const messages: Message[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        messages.push({
          id: docSnap.id,
          conversationId,
          senderId: data.senderId,
          content: data.content || '',
          mediaUrl: data.mediaUrl,
          isRead: data.isRead || false,
          createdAt: data.createdAt,
        });
      });

      // Fetch sender names for new senders
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const newSenderIds = senderIds.filter(id => !senderCache[id]);

      await Promise.all(
        newSenderIds.map(async (senderId) => {
          try {
            const userRef = doc(db, 'users', senderId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const userData = userSnap.data();
              senderCache[senderId] = {
                name: userData.firstName && userData.lastName
                  ? `${userData.firstName} ${userData.lastName}`
                  : userData.firstName || userData.lastName || userData.email || userData.phone || 'Unknown',
                photo: userData.profilePhoto,
              };
            }
          } catch (error) {
            console.error(`Error fetching sender ${senderId}:`, error);
          }
        })
      );

      // Enrich messages with sender info
      messages.forEach((msg) => {
        const sender = senderCache[msg.senderId];
        if (sender) {
          msg.senderName = sender.name;
          msg.senderPhoto = sender.photo;
        }
      });

      callback(messages);

      const hasUnreadFromOtherUser = !!currentUserId && messages.some(
        (msg) => !msg.isRead && msg.senderId !== currentUserId
      );
      if (hasUnreadFromOtherUser) {
        markMessagesAsRead(conversationId).catch((error) => {
          console.warn('Auto mark-as-read failed:', error);
        });
      }
    },
    (error: any) => {
      if (error?.code === 'permission-denied') {
        console.warn('Chat subscription blocked by permission-denied for conversation:', conversationId);
        callback([]);
        onError?.(error);
        return;
      }

      console.error('Error subscribing to messages:', error);
      onError?.(error);
    }
  );

  return unsubscribe;
}

/**
 * Mark messages as read
 */
export async function markMessagesAsRead(
  conversationId: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  try {
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    // Only filter by isRead to avoid composite index requirement
    const q = query(
      messagesRef,
      where('isRead', '==', false)
    );

    const snapshot = await getDocs(q);
    // Filter client-side for senderId != currentUser.uid, then update
    const unreadMessagesFromOthers = snapshot.docs.filter(
      doc => doc.data().senderId !== currentUser.uid
    );
    
    const updatePromises = unreadMessagesFromOthers.map((docSnap) => {
      const messageRef = doc(db, 'conversations', conversationId, 'messages', docSnap.id);
      return updateDoc(messageRef, { isRead: true });
    });

    await Promise.all(updatePromises);
  } catch (error: any) {
    // Some deployments restrict message read-receipt updates by rules.
    // Do not break chat initialization/subscriptions when that happens.
    if (error?.code === 'permission-denied') {
      console.warn('Skipping markMessagesAsRead due to permission-denied');
      return;
    }

    console.error('Error marking messages as read:', error);
    throw error;
  }
}

