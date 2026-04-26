import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, Alert } from 'react-native';
import i18n from '../locales/i18n';
import {
  getOrCreateConversation,
  sendMessage,
  subscribeToMessages,
  markMessagesAsRead,
  clearConversationUnreadCache,
  deleteMessage,
  Message,
  findAdminUserId,
} from '../services/MessagingService';
import { auth } from '../lib/firebase';
import FootballLoader from '../components/FootballLoader';

export default function AgentMessagesScreen() {
  const router = useRouter();
  const { conversationId, otherUserId, id, name } = useLocalSearchParams<{ 
    conversationId?: string; 
    otherUserId?: string; 
    id?: string; 
    name?: string 
  }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationIdState, setConversationIdState] = useState<string | null>(null);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const openAdminChat = async () => {
    if (openingAdminChat) return;

    try {
      setOpeningAdminChat(true);
      const adminId = await findAdminUserId();
      if (!adminId) { Alert.alert(i18n.t('noAdminFound') || 'No admin found'); return; }
      const convId = await getOrCreateConversation(adminId);
      router.push({ pathname: '/agent-messages', params: { conversationId: convId, otherUserId: adminId, name: i18n.t('adminLabel') || 'Admin' } });
    } catch (err) {
      console.error(err);
    } finally {
      setOpeningAdminChat(false);
    }
  };

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

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
        } else if (id) {
          // Legacy support: create conversation with player
          convId = await getOrCreateConversation(id);
          setConversationIdState(convId);
        } else {
          setLoading(false);
          return;
        }

        // Subscribe to real-time messages
        if (convId) {
          clearConversationUnreadCache(convId);
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

          markMessagesAsRead(convId).catch((error) => {
            console.warn('Failed to mark agent chat messages as read on open:', error);
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
  }, [conversationId, otherUserId, id]);

  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleDeleteMessage = (message: Message) => {
    if (!conversationIdState) return;

    const createdAtMs = message.createdAt?.toDate ? message.createdAt.toDate().getTime() : 0;
    if (!createdAtMs || Date.now() - createdAtMs > 10 * 60 * 1000) {
      Alert.alert(
        i18n.t('deleteMessage') || 'Delete message',
        i18n.t('deleteTimeLimitReached') || 'You can delete messages only within 10 minutes.'
      );
      return;
    }

    Alert.alert(
      i18n.t('deleteMessage') || 'Delete message',
      i18n.t('deleteMessageConfirm') || 'Delete this message for everyone?',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('delete') || 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMessage(conversationIdState, message.id).catch((err: any) => {
              if (err?.message === 'DELETE_WINDOW_EXPIRED') {
                Alert.alert(
                  i18n.t('deleteMessage') || 'Delete message',
                  i18n.t('deleteTimeLimitReached') || 'You can delete messages only within 10 minutes.'
                );
                return;
              }
              console.warn('Delete message failed:', err);
            });
          },
        },
      ]
    );
  };

  const handleSendMessage = async () => {
    if (sending || !input.trim() || !conversationIdState) return;
    const message = input.trim();
    setSending(true);
    setInput('');
    Keyboard.dismiss();

    try {
      await sendMessage(conversationIdState, message);
    } catch (error: any) {
      console.error('Error sending message:', error);
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
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={openAdminChat} disabled={openingAdminChat} style={{ opacity: openingAdminChat ? 0.6 : 1 }}>
                  <View style={styles.textAdminBtn}>
                    {openingAdminChat ? (
                      <FootballLoader size="small" color="#fff" style={{ marginRight: 6 }} />
                    ) : (
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" style={{marginRight: 6}} />
                    )}
                    <Text style={styles.textAdminText}>{openingAdminChat ? (i18n.t('loading') || 'Loading...') : (i18n.t('textAdmin') || 'Text Admin')}</Text>
                  </View>
                </TouchableOpacity>
                
              </View>
            </View>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{name || i18n.t('player') || 'Player'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('chatting') || 'Chatting'}</Text>
            </View>
          </View>

      {/* Chat Area */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <FootballLoader size="large" color="#fff" />
          <Text style={{ marginTop: 12, color: 'rgba(255, 255, 255, 0.7)' }}>{i18n.t('loading') || 'Loading messages...'}</Text>
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
                <TouchableOpacity
                  activeOpacity={isSent ? 0.7 : 1}
                  onLongPress={isSent ? () => handleDeleteMessage(item) : undefined}
                  delayLongPress={400}
                  style={{ maxWidth: '76%' }}
                >
                <View style={[
                  styles.bubble,
                  isSent ? styles.agentBubble : styles.playerBubble,
                ]}>
                  <Text style={[
                    styles.bubbleText,
                    isSent ? styles.agentBubbleText : styles.playerBubbleText
                  ]}>
                    {item.content || (item.mediaUrl ? (i18n.t('mediaLabel') || 'Media') : '')}
                  </Text>
                  {!!timeLabel && (
                    <Text style={isSent ? styles.messageMetaSent : styles.messageMetaReceived}>
                      {timeLabel}{isSent ? ` - ${item.isRead ? (i18n.t('messageSeen') || 'Seen') : (i18n.t('messageSent') || 'Sent')}` : ''}
                    </Text>
                  )}
                </View>
                </TouchableOpacity>
              </View>
            );
          }}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 16 }}>{i18n.t('noMessagesYet') || 'No messages yet'}</Text>
            </View>
          }
        />
      )}

      {/* Input Bar */}
          <View style={styles.inputBar}>
        <TextInput
              style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={i18n.t('typeMessage') || 'Type a message...'}
              placeholderTextColor="#999"
          editable={!sending}
          onSubmitEditing={() => handleSendMessage()}
          blurOnSubmit={true}
          returnKeyType="send"
        />
            <TouchableOpacity 
              style={[styles.sendBtn, (loading || !conversationIdState || sending || !input.trim()) && styles.sendBtnDisabled]} 
              onPress={handleSendMessage} 
              activeOpacity={0.8}
              disabled={loading || !conversationIdState || sending || !input.trim()}
            >
              <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContent: {
    alignItems: 'center',
  },
  textAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  textAdminText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
    flexGrow: 1,
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
  bubble: {
    maxWidth: '76%',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  agentBubble: {
    backgroundColor: '#000000',
    alignSelf: 'flex-end',
    borderTopRightRadius: 6,
  },
  playerBubble: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bubbleText: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
  },
  agentBubbleText: {
    color: '#fff',
  },
  playerBubbleText: {
    color: '#000',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#dcdcdc',
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#d9d9d9',
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.55,
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
});

