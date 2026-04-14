import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Image, Modal, Alert } from 'react-native';
import i18n from '../locales/i18n';
import { 
  getOrCreateConversation, 
  sendMessage, 
  subscribeToMessages, 
  markMessagesAsRead,
  Message 
} from '../services/MessagingService';
import { findAdminUserId } from '../services/MessagingService';
import { getChattableUsers, startConversationWithUser } from '../services/BookingMessagingService';
import { auth } from '../lib/firebase';

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
  const [chattableUsers, setChattableUsers] = useState<Array<{userId: string; name: string; photo?: string; role: string}>>([]);
  const [showUsersList, setShowUsersList] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

  // Load chattable users
  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        const users = await getChattableUsers();
        setChattableUsers(users);
      } catch (error) {
        console.error('Error loading chattable users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };
    loadUsers();
  }, []);

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
  }, [conversationId, otherUserId, id]);

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

  const handleSwitchUser = async (userId: string, userName: string) => {
    try {
      const convId = await startConversationWithUser(userId);
      router.replace({
        pathname: '/agent-messages',
        params: {
          conversationId: convId,
          otherUserId: userId,
          name: userName
        }
      });
      setShowUsersList(false);
    } catch (error: any) {
      console.error('Error switching user:', error);
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
                <TouchableOpacity 
                  onPress={async () => {
                    try {
                      const adminId = await findAdminUserId();
                      if (!adminId) { Alert.alert(i18n.t('noAdminFound') || 'No admin found'); return; }
                      const convId = await getOrCreateConversation(adminId);
                      router.push({ pathname: '/agent-messages', params: { conversationId: convId, otherUserId: adminId, name: 'Admin' } });
                    } catch (err) { console.error(err); }
                  }}
                >
                  <View style={styles.textAdminBtn}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" style={{marginRight: 6}} />
                    <Text style={styles.textAdminText}>{i18n.t('textAdmin') || 'Text Admin'}</Text>
                  </View>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.usersButton} 
                  onPress={() => setShowUsersList(true)}
                >
                  <Ionicons name="people" size={24} color="#fff" />
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
          <ActivityIndicator size="large" color="#fff" />
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
                <View style={[
                  styles.bubble,
                  isSent ? styles.agentBubble : styles.playerBubble,
                ]}>
                  <Text style={[
                    styles.bubbleText,
                    isSent ? styles.agentBubbleText : styles.playerBubbleText
                  ]}>
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
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 16 }}>{i18n.t('noMessages') || 'No messages yet'}</Text>
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

      {/* Users List Modal */}
      <Modal
        visible={showUsersList}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowUsersList(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{i18n.t('allUsers') || 'All Users'}</Text>
              <TouchableOpacity onPress={() => setShowUsersList(false)}>
                <Ionicons name="close" size={28} color="#000" />
              </TouchableOpacity>
            </View>
            {loadingUsers ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#000" />
              </View>
            ) : (
              <FlatList
                data={chattableUsers}
                keyExtractor={item => item.userId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.userItem,
                      item.userId === otherUserId && styles.userItemActive
                    ]}
                    onPress={() => handleSwitchUser(item.userId, item.name)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.userAvatar}>
                      {item.photo ? (
                        <Image source={{ uri: item.photo }} style={styles.userAvatarImage} />
                      ) : (
                        <Ionicons name="person" size={24} color="#000" />
                      )}
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{item.name}</Text>
                      <Text style={styles.userRole}>{item.role}</Text>
                    </View>
                    {item.userId === otherUserId && (
                      <Ionicons name="checkmark-circle" size={24} color="#000" />
                    )}
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.modalListContent}
              />
            )}
          </View>
        </View>
      </Modal>
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
  usersButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  modalLoading: {
    padding: 40,
    alignItems: 'center',
  },
  modalListContent: {
    padding: 16,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#f8f8f8',
  },
  userItemActive: {
    backgroundColor: '#e8e8e8',
    borderWidth: 2,
    borderColor: '#000',
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  userRole: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
  },
});

