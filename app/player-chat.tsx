import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import CommonStyles from '../styles/CommonStyles';
import { 
  getOrCreateConversation, 
  sendMessage, 
  subscribeToMessages, 
  markMessagesAsRead,
  Message 
  
} from '../services/MessagingService';
import { auth } from '../lib/firebase';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  hamburgerBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#000' },
  line: { width: 24, height: 3, backgroundColor: '#000', marginVertical: 2, borderRadius: 2 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  messageRowSent: { justifyContent: 'flex-end' },
  messageRowReceived: { justifyContent: 'flex-start' },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#e5e5e5', justifyContent: 'center', alignItems: 'center', marginRight: 8, marginBottom: 8 },
  messageAvatarImage: { width: 30, height: 30, borderRadius: 15, marginRight: 8, marginBottom: 8 },
  bubble: { maxWidth: '78%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 20, shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  bubbleSent: { backgroundColor: '#000000', alignSelf: 'flex-end', borderTopRightRadius: 6 },
  bubbleReceived: { backgroundColor: '#fff', alignSelf: 'flex-start', borderTopLeftRadius: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  textSent: { color: '#fff', fontSize: 15, fontWeight: '500', lineHeight: 21 },
  textReceived: { color: '#111111', fontSize: 15, fontWeight: '500', lineHeight: 21 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.98)', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#dcdcdc', zIndex: 10, shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: '#d9d9d9', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 14, marginRight: 10, color: '#000000', backgroundColor: '#f5f5f5', fontSize: 16 },
  sendBtn: { width: 48, height: 48, backgroundColor: '#000000', borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.55 },
  sendBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 17 },
  messageMetaSent: { marginTop: 6, color: 'rgba(255,255,255,0.75)', fontSize: 11, textAlign: 'right' },
  messageMetaReceived: { marginTop: 6, color: '#6b7280', fontSize: 11, textAlign: 'left' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 56, flex: 1 },
  emptyStateText: { marginTop: 12, color: '#374151', fontSize: 16, fontWeight: '700' },
  emptyStateSubtext: { marginTop: 6, color: '#6b7280', fontSize: 13, textAlign: 'center' },
  headerBar: {
    backgroundColor: '#000',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


export default function PlayerChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const conversationId = params.conversationId as string | undefined;
  const otherUserId = params.otherUserId as string | undefined;
  const agentId = params.agentId as string | undefined; // Legacy support
  const maxFreeMessages = params.maxFreeMessages ? parseInt(params.maxFreeMessages as string, 10) : 3;
  const name = (params.name as string) || '';
  const { openMenu } = useHamburgerMenu();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationIdState, setConversationIdState] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Initialize conversation and subscribe to messages
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initializeChat = async () => {
      try {
        setLoading(true);
        let convId = conversationId;

        // If no conversationId but we have otherUserId, create/get conversation
        if (!convId && otherUserId) {
          convId = await getOrCreateConversation(otherUserId);
          setConversationIdState(convId);
        } else if (convId) {
          setConversationIdState(convId);
        } else if (agentId) {
          // Legacy support: create conversation with agent
          convId = await getOrCreateConversation(agentId);
          setConversationIdState(convId);
        } else {
          setLoading(false);
          return;
        }

        // Mark messages as read when opening chat
        if (convId) {
          await markMessagesAsRead(convId);
        }

        // Subscribe to real-time messages
        if (convId) {
          unsubscribe = subscribeToMessages(convId, (msgs) => {
            setMessages(msgs);
            setLoading(false);
            // Scroll to end when new messages arrive
            setTimeout(() => {
              if (flatListRef.current && msgs.length > 0) {
                flatListRef.current.scrollToEnd({ animated: true });
              }
            }, 100);
          });
        }
      } catch (error: any) {
        console.error('Error initializing chat:', error);
        setLoading(false);
      }
    };

    initializeChat();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [conversationId, otherUserId, agentId]);

  // Load sent message count for this agent (legacy paywall logic)
  useEffect(() => {
    if (!agentId) return;
    (async () => {
      try {
        const now = new Date();
        const key = `agentMsgCount_${agentId}_${now.getFullYear()}_${now.getMonth()}`;
        const stored = await AsyncStorage.getItem(key);
        const count = stored ? parseInt(stored, 10) : 0;
        setSentCount(count);
        setLimitReached(count >= maxFreeMessages);
      } catch {}
    })();
  }, [agentId, maxFreeMessages]);

  // Scroll to end when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (sending || !input.trim() || !conversationIdState) return;
    const message = input.trim();
    setSending(true);
    setInput('');
    Keyboard.dismiss();

    // Legacy paywall check for agents
    if (agentId) {
      const now = new Date();
      const key = `agentMsgCount_${agentId}_${now.getFullYear()}_${now.getMonth()}`;
      let count = sentCount;
      if (count >= maxFreeMessages) {
        setLimitReached(true);
        router.replace('/_paywall');
        return;
      }
      count++;
      await AsyncStorage.setItem(key, String(count));
      setSentCount(count);
      if (count >= maxFreeMessages) {
        setLimitReached(true);
      }
    }

    try {
      await sendMessage(conversationIdState, message);
      await markMessagesAsRead(conversationIdState);
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Optionally show error to user
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Unified Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => router.back()} 
          accessibilityLabel="Back"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">{name || i18n.t('chat') || 'Chat'}</Text>
          <Text style={styles.headerSubtitle}>{i18n.t('directMessages') || 'Direct messages'}</Text>
        </View>
        <TouchableOpacity 
          style={styles.hamburgerBtn} 
          onPress={openMenu} 
          accessibilityLabel="Open menu"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="menu" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      <HamburgerMenu />
      {/* Chat Messages */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#000" />
          <Text style={{ marginTop: 12, color: '#666' }}>{i18n.t('loading') || 'Loading messages...'}</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => {
            const currentUserId = auth.currentUser?.uid;
            const isSent = item.senderId === currentUserId;
            const timeLabel = item.createdAt?.toDate
              ? new Date(item.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
            return (
              <View style={[styles.messageRow, isSent ? styles.messageRowSent : styles.messageRowReceived]}>
                {!isSent && (
                  item.senderPhoto ? (
                    <Image source={{ uri: item.senderPhoto }} style={styles.messageAvatarImage} />
                  ) : (
                    <View style={styles.messageAvatar}>
                      <Ionicons name="person" size={16} color="#444444" />
                    </View>
                  )
                )}
                <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
                  <Text style={isSent ? styles.textSent : styles.textReceived}>
                    {item.content || (item.mediaUrl ? 'Media' : '')}
                  </Text>
                  {!!timeLabel && (
                    <Text style={isSent ? styles.messageMetaSent : styles.messageMetaReceived}>
                      {timeLabel}{isSent ? ` • ${item.isRead ? (i18n.t('messageSeen') || 'Seen') : (i18n.t('messageSent') || 'Sent')}` : ''}
                    </Text>
                  )}
                </View>
              </View>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100, flexGrow: 1 }}
          style={{ flex: 1, backgroundColor: '#f5f5f5' }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="chatbubble-ellipses-outline" size={46} color="#9ca3af" />
              <Text style={styles.emptyStateText}>{i18n.t('noMessages') || 'No messages yet'}</Text>
              <Text style={styles.emptyStateSubtext}>{i18n.t('startConversationBelow') || 'Start the conversation below.'}</Text>
            </View>
          }
        />
      )}
      
      {/* Input Bar */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={i18n.t('typeMessage') || 'Type a message...'}
          placeholderTextColor="#888"
          editable={!limitReached && !sending}
          onSubmitEditing={handleSendMessage}
          blurOnSubmit={true}
        />
        <TouchableOpacity style={[styles.sendBtn, (limitReached || loading || !conversationIdState || sending || !input.trim()) && styles.sendBtnDisabled]} onPress={handleSendMessage} disabled={limitReached || loading || !conversationIdState || sending || !input.trim()}>
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      {limitReached && (
        <View style={{ backgroundColor: '#000', padding: 18, borderRadius: 18, margin: 18, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>{i18n.t('paywallMsg') || 'You have used your free messages for this agent. Please pay to continue.'}</Text>
          <TouchableOpacity style={{ marginTop: 14, backgroundColor: '#fff', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 32 }} onPress={() => router.replace('/_paywall')}>
            <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 16 }}>{i18n.t('close') || 'Close'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

