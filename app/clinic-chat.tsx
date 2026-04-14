import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState, useEffect, useRef } from 'react';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { 
  getOrCreateConversation, 
  sendMessage, 
  subscribeToMessages, 
  markMessagesAsRead,
  Message 
} from '../services/MessagingService';
import { auth } from '../lib/firebase';

export default function ClinicChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationIdState, setConversationIdState] = useState<string | null>(null);
  const { openMenu } = useHamburgerMenu();
  const router = useRouter();
  const params = useLocalSearchParams();
  const conversationId = params.conversationId as string | undefined;
  const otherUserId = params.otherUserId as string | undefined;
  const contact = params.contact || i18n.t('clinicChat') || 'Chat';
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
  }, [conversationId, otherUserId]);

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

    try {
      await sendMessage(conversationIdState, message);
      await markMessagesAsRead(conversationIdState);
    } catch (error: any) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: '#fff' }} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.headerBar}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => router.back()} 
          accessibilityLabel="Back"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{contact}</Text>
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
                <View style={[styles.messageBubble, isSent ? styles.myMessage : styles.systemMessage]}>
                  <Text style={isSent ? styles.myMessageText : styles.systemMessageText}>
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
          style={styles.chatList}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="chatbubble-ellipses-outline" size={46} color="#9ca3af" />
              <Text style={styles.emptyStateText}>{i18n.t('noMessages') || 'No messages yet'}</Text>
              <Text style={styles.emptyStateSubtext}>{i18n.t('messagesWillAppearAfterStart') || 'Messages will appear here once the conversation starts.'}</Text>
            </View>
          }
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={i18n.t('typeMessage') || 'Type a message...'}
          placeholderTextColor="#aaa"
          editable={!sending}
          onSubmitEditing={handleSendMessage}
          blurOnSubmit={true}
        />
        <TouchableOpacity 
          style={[styles.sendBtn, (loading || !conversationIdState || sending || !input.trim()) && styles.sendBtnDisabled]} 
          onPress={handleSendMessage}
          disabled={loading || !conversationIdState || sending || !input.trim()}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      <Image source={require('../assets/forsa-logo.png')} style={styles.forsaLogo} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    backgroundColor: '#000000',
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
  headerTitleWrap: {
    flex: 1,
    marginHorizontal: 12,
    alignItems: 'center',
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
  chatList: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    flex: 1,
  },
  emptyStateText: {
    marginTop: 12,
    color: '#374151',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyStateSubtext: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  messageRowSent: {
    justifyContent: 'flex-end',
  },
  messageRowReceived: {
    justifyContent: 'flex-start',
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e5e5e5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  messageAvatarImage: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    marginBottom: 8,
  },
  messageBubble: {
    maxWidth: '78%',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  myMessage: {
    backgroundColor: '#000000',
    alignSelf: 'flex-end',
    borderTopRightRadius: 6,
  },
  systemMessage: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  myMessageText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
  },
  systemMessageText: {
    color: '#222',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: 1,
    borderColor: '#dcdcdc',
    zIndex: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 6,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: '#f5f5f5',
    color: '#111',
    marginRight: 10,
  },
  sendBtn: {
    width: 48,
    height: 48,
    backgroundColor: '#000000',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.55,
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  messageMetaSent: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    textAlign: 'right',
  },
  messageMetaReceived: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'left',
  },
  forsaLogo: { position: 'absolute', bottom: 18, left: '50%', transform: [{ translateX: -24 }], width: 48, height: 48, opacity: 0.18, zIndex: 1 },
});


