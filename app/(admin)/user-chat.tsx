import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { getOrCreateConversation, sendMessage, subscribeToMessages, markMessagesAsRead, Message } from '../../services/MessagingService';
import { auth, db } from '../../lib/firebase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import FootballLoader from '../../components/FootballLoader';

const C = {
  bg: '#edf2f8',
  panel: '#f7fbff',
  card: '#ffffff',
  border: '#d6e0ea',
  text: '#102033',
  subtext: '#5b6b7f',
  muted: '#8b9ab0',
  blue: '#124a78',
  blueDark: '#0d3556',
  blueLight: '#dbe8f7',
  accent: '#1f6fb2',
  sent: '#12263a',
  sentMeta: 'rgba(255,255,255,0.68)',
  receivedMeta: '#7b8ba1',
  composer: '#eef3f8',
  success: '#0f766e',
};

type UserProfile = {
  name: string;
  subtitle: string;
  photo?: string;
};

type ChatListItem =
  | { id: string; type: 'separator'; label: string }
  | { id: string; type: 'unread'; label: string }
  | { id: string; type: 'message'; message: Message };

const QUICK_REPLIES = [
  'Thanks for reaching out. We are checking this now.',
  'Please share the booking code so we can help faster.',
  'Noted. You will receive an update shortly.',
];

const normalizeName = (value: any) => {
  const text = String(value || '').trim();
  return text || '';
};

const resolveUserName = (data: any) => {
  return normalizeName(
    data?.parentName ||
    data?.academyName ||
    data?.clinicName ||
    data?.agentName ||
    data?.name ||
    `${data?.firstName || ''} ${data?.lastName || ''}`.trim() ||
    data?.displayName ||
    data?.fullName ||
    data?.email
  );
};

const resolveUserSubtitle = (data: any) => {
  const role = String(data?.role || '').trim();
  if (role) return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
  return 'Direct conversation';
};

const getInitials = (value: string) => {
  return value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '?';
};

const formatTime = (value: any) => {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDayLabel = (value: any) => {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return 'Unknown date';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = date.toDateString();
  if (key === today.toDateString()) return 'Today';
  if (key === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

const buildChatItems = (messages: Message[], currentUserId?: string): ChatListItem[] => {
  const items: ChatListItem[] = [];
  let lastLabel = '';
  let unreadInserted = false;

  messages.forEach((message) => {
    const isUnreadIncoming = !!currentUserId && message.senderId !== currentUserId && !message.isRead;
    if (isUnreadIncoming && !unreadInserted) {
      items.push({ id: `unread-${message.id}`, type: 'unread', label: 'New messages' });
      unreadInserted = true;
    }

    const label = formatDayLabel(message.createdAt);
    if (label !== lastLabel) {
      items.push({ id: `separator-${message.id}`, type: 'separator', label });
      lastLabel = label;
    }
    items.push({ id: message.id, type: 'message', message });
  });

  return items;
};

export default function AdminUserChat() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const otherUserId = params.otherUserId as string | undefined;
  const routeName = decodeURIComponent((params.name as string) || '');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [retryDraft, setRetryDraft] = useState<string | null>(null);
  const [conversationIdState, setConversationIdState] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    name: routeName || 'User',
    subtitle: 'Direct conversation',
  });
  const flatListRef = useRef<FlatList>(null);

  const initials = getInitials(profile.name);
  const currentUserId = auth.currentUser?.uid;
  const chatItems = useMemo(() => buildChatItems(messages, currentUserId), [messages, currentUserId]);

  const scrollToLatest = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setShowJumpToLatest(false);
  };

  const handleCopyMessage = async (text: string) => {
    if (!text?.trim()) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Message copied to clipboard.');
  };

  const handleMessageActions = (message: Message) => {
    Alert.alert('Message actions', 'Choose an action', [
      {
        text: 'Copy',
        onPress: () => {
          handleCopyMessage(message.content || (message.mediaUrl ? 'Media' : ''));
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  useEffect(() => {
    const loadProfile = async () => {
      if (!otherUserId) return;
      try {
        const snap = await getDoc(doc(db, 'users', otherUserId));
        if (!snap.exists()) return;
        const data: any = snap.data();
        setProfile({
          name: resolveUserName(data) || routeName || 'User',
          subtitle: resolveUserSubtitle(data),
          photo: data?.photoURL || data?.profileImage || data?.image || data?.photo,
        });
      } catch (error) {
        console.error('Failed to load admin chat profile:', error);
      }
    };

    loadProfile();
  }, [otherUserId, routeName]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    const init = async () => {
      try {
        setLoading(true);
        if (!otherUserId) {
          Alert.alert('Error', 'No user specified');
          setLoading(false);
          return;
        }
        const convId = await getOrCreateConversation(otherUserId);
        setConversationIdState(convId);
        await markMessagesAsRead(convId);
        unsubscribe = subscribeToMessages(
          convId,
          (msgs) => {
            setMessages(msgs);
            setLoading(false);
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
          },
          (error) => {
            setLoading(false);
            if (error?.code === 'permission-denied') {
              Alert.alert('Access denied', 'You do not have access to this conversation.');
            }
          }
        );
      } catch (err) {
        console.error('Init admin chat error:', err);
        setLoading(false);
      }
    };
    init();
    // no admin log UI anymore
    return () => { if (unsubscribe) unsubscribe(); };
  }, [otherUserId]);

  const handleSend = async () => {
    if (sending || !input.trim() || !conversationIdState) return;
    const message = input.trim();

    setSending(true);
    setInput('');
    setRetryDraft(null);
    Keyboard.dismiss();
    try {
      await sendMessage(conversationIdState, message);
    } catch (err) {
      console.error('Error sending admin message:', err);
      setRetryDraft(message);
      setInput(message);
      Alert.alert('Error', 'Failed to send message. You can retry from the composer.');
    } finally {
      setSending(false);
    }
  };

  const handleRetryLastDraft = () => {
    if (!retryDraft?.trim()) return;
    setInput(retryDraft);
    setRetryDraft(null);
  };

  return (
    <KeyboardAvoidingView
      style={S.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
    >
      <View style={[S.headerShell, { paddingTop: insets.top + 10 }]}>
        <View style={S.header}>
          <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          {profile.photo ? (
            <Image source={{ uri: profile.photo }} style={S.avatarImage} />
          ) : (
            <View style={S.avatarCircle}>
              <Text style={S.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={S.headerInfo}>
            <Text style={S.headerName} numberOfLines={1}>{profile.name || 'User'}</Text>
            <Text style={S.headerSub}>{profile.subtitle}</Text>
          </View>
          <View style={S.headerStatus}>
            <Text style={S.headerStatusText}>Admin</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={S.center}>
          <View style={S.loadingOrb}>
            <FootballLoader size="large" color={C.blue} />
          </View>
          <Text style={S.loadingTitle}>Loading conversation</Text>
          <Text style={S.loadingText}>Pulling the latest messages for this user.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={chatItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={S.messagesList}
          style={S.messagesContainer}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onScroll={({ nativeEvent }) => {
            const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
            const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            setShowJumpToLatest(distanceFromBottom > 160);
          }}
          scrollEventThrottle={16}
          ListEmptyComponent={
            <View style={S.emptyState}>
              <View style={S.emptyIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={36} color={C.muted} />
              </View>
              <Text style={S.emptyTitle}>No messages yet</Text>
              <Text style={S.emptyDesc}>Send the first message to start a clean admin conversation thread.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === 'separator') {
              return (
                <View style={S.separatorWrap}>
                  <View style={S.separatorLine} />
                  <Text style={S.separatorText}>{item.label}</Text>
                  <View style={S.separatorLine} />
                </View>
              );
            }

            if (item.type === 'unread') {
              return (
                <View style={S.unreadWrap}>
                  <View style={S.unreadLine} />
                  <Text style={S.unreadText}>{item.label}</Text>
                  <View style={S.unreadLine} />
                </View>
              );
            }

            const message = item.message;
            const isSent = message.senderId === currentUserId;
            const timeLabel = formatTime(message.createdAt);
            return (
              <View style={[S.messageRow, isSent ? S.rowSent : S.rowReceived]}>
                {!isSent && (
                  profile.photo ? (
                    <Image source={{ uri: profile.photo }} style={S.msgAvatarImage} />
                  ) : (
                    <View style={S.msgAvatar}>
                      <Text style={S.msgAvatarText}>{initials}</Text>
                    </View>
                  )
                )}
                <View style={[S.messageCluster, isSent ? S.clusterSent : S.clusterReceived]}>
                  {!isSent && <Text style={S.senderName}>{profile.name}</Text>}
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onLongPress={() => handleMessageActions(message)}
                  >
                    <View style={[S.bubble, isSent ? S.bubbleSent : S.bubbleReceived]}>
                      <Text style={isSent ? S.textSent : S.textReceived}>{message.content || (message.mediaUrl ? 'Media' : '')}</Text>
                    </View>
                  </TouchableOpacity>
                  {!!timeLabel && (
                    <Text style={isSent ? S.metaSent : S.metaReceived}>
                      {timeLabel}{isSent ? (message.isRead ? ' - Seen' : ' - Sent') : ''}
                    </Text>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {showJumpToLatest && (
        <TouchableOpacity style={S.jumpFab} onPress={scrollToLatest}>
          <Ionicons name="arrow-down" size={18} color="#fff" />
          <Text style={S.jumpFabText}>Latest</Text>
        </TouchableOpacity>
      )}

      <View style={S.composerWrap}>
        {!!retryDraft && (
          <TouchableOpacity style={S.retryBar} onPress={handleRetryLastDraft}>
            <Ionicons name="refresh" size={14} color="#fff" />
            <Text style={S.retryText}>Tap to retry last failed message</Text>
          </TouchableOpacity>
        )}

        <View style={S.quickRepliesRow}>
          {QUICK_REPLIES.map((reply) => (
            <TouchableOpacity
              key={reply}
              style={S.quickChip}
              onPress={() => setInput(reply)}
            >
              <Text style={S.quickChipText} numberOfLines={1}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={S.inputBar}>
          <View style={S.inputShell}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Write a clear message to the customer"
              placeholderTextColor={C.muted}
              style={S.input}
              multiline
              editable={!sending}
              onSubmitEditing={handleSend}
              blurOnSubmit
            />
          </View>
          <TouchableOpacity
            style={[S.sendBtn, (!conversationIdState || sending || !input.trim()) && S.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!conversationIdState || sending || !input.trim()}
          >
            {sending ? (
              <FootballLoader size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
        <Text style={S.composerHint}>Live conversation</Text>
      </View>
      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerShell: {
    backgroundColor: C.blueDark,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 1 },
  headerStatus: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 118, 110, 0.24)',
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.25)',
  },
  headerStatusText: { color: '#d1fae5', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  loadingOrb: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: C.panel,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  loadingTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  loadingText: { color: C.subtext, fontSize: 14, textAlign: 'center' },
  messagesContainer: { flex: 1, backgroundColor: C.bg },
  messagesList: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, flexGrow: 1 },
  separatorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 10,
  },
  separatorLine: { flex: 1, height: 1, backgroundColor: 'rgba(16,32,51,0.08)' },
  separatorText: { color: C.subtext, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  unreadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 8,
  },
  unreadLine: { flex: 1, height: 1, backgroundColor: 'rgba(18,74,120,0.26)' },
  unreadText: {
    color: C.blue,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    backgroundColor: 'rgba(18,74,120,0.08)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 70, gap: 10 },
  emptyIcon: { width: 74, height: 74, borderRadius: 37, backgroundColor: C.panel, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  emptyDesc: { fontSize: 13, color: C.subtext, textAlign: 'center', lineHeight: 19, maxWidth: 250 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  rowSent: { justifyContent: 'flex-end' },
  rowReceived: { justifyContent: 'flex-start' },
  msgAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.blueLight, justifyContent: 'center', alignItems: 'center', marginRight: 8, marginBottom: 20 },
  msgAvatarImage: { width: 30, height: 30, borderRadius: 15, marginRight: 8, marginBottom: 20 },
  msgAvatarText: { fontSize: 10, fontWeight: '800', color: C.blue },
  messageCluster: { maxWidth: '80%' },
  clusterSent: { alignItems: 'flex-end' },
  clusterReceived: { alignItems: 'flex-start' },
  senderName: { color: C.subtext, fontSize: 11, fontWeight: '700', marginBottom: 5, marginLeft: 4 },
  bubble: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: 20 },
  bubbleSent: { backgroundColor: C.sent, borderTopRightRadius: 6, shadowColor: '#0b1220', shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  bubbleReceived: { backgroundColor: C.card, borderTopLeftRadius: 6, borderWidth: 1, borderColor: C.border },
  textSent: { color: '#fff', fontSize: 15, lineHeight: 22 },
  textReceived: { color: C.text, fontSize: 15, lineHeight: 22 },
  metaSent: { color: C.sentMeta, fontSize: 10, marginTop: 5, textAlign: 'right', paddingRight: 4 },
  metaReceived: { color: C.receivedMeta, fontSize: 10, marginTop: 5, paddingLeft: 4 },
  composerWrap: {
    backgroundColor: C.panel,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  retryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#b45309',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  quickRepliesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  quickChip: {
    flex: 1,
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quickChipText: {
    color: C.blueDark,
    fontSize: 11,
    fontWeight: '700',
  },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inputShell: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: C.composer,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  input: { color: C.text, fontSize: 15, maxHeight: 120, paddingVertical: 11 },
  sendBtn: { width: 48, height: 48, backgroundColor: C.blueDark, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.45 },
  composerHint: { color: C.muted, fontSize: 11, marginTop: 6, paddingLeft: 4 },
  jumpFab: {
    position: 'absolute',
    right: 14,
    bottom: 94,
    backgroundColor: C.blueDark,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#0b1220',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  jumpFabText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
