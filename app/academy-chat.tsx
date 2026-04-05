import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState, useEffect, useRef } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
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

export default function AcademyChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [conversationIdState, setConversationIdState] = useState<string | null>(null);
  const { openMenu } = useHamburgerMenu();
  const router = useRouter();
  const params = useLocalSearchParams();
  const conversationId = params.conversationId as string | undefined;
  const otherUserId = params.otherUserId as string | undefined;
  const contact = params.contact || i18n.t('academyChat');
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
    if (!input.trim() || !conversationIdState) return;

    try {
      await sendMessage(conversationIdState, input.trim());
      setInput('');
      
      // Mark messages as read after sending
      await markMessagesAsRead(conversationIdState);
    } catch (error: any) {
      console.error('Error sending message:', error);
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
        <Text style={styles.headerTitle} numberOfLines={1}>{contact}</Text>
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
            return (
              <View style={[styles.messageBubble, isSent ? styles.myMessage : styles.systemMessage]}>
                <Text style={isSent ? styles.myMessageText : styles.systemMessageText}>
                  {item.content || (item.mediaUrl ? 'Media' : '')}
                </Text>
              </View>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <Text style={{ color: '#999', fontSize: 16 }}>{i18n.t('noMessages') || 'No messages yet'}</Text>
            </View>
          }
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={i18n.t('typeMessage')}
          placeholderTextColor="#aaa"
        />
        <TouchableOpacity 
          style={styles.sendBtn} 
          onPress={handleSendMessage}
          disabled={loading || !conversationIdState}
        >
          <Text style={styles.sendBtnText}>{i18n.t('send')}</Text>
        </TouchableOpacity>
      </View>
      <Image source={require('../assets/forsa-logo.png')} style={styles.forsaLogo} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  myMessage: {
    backgroundColor: '#000',
    alignSelf: 'flex-end',
    borderTopRightRadius: 4,
  },
  systemMessage: {
    backgroundColor: '#eee',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#eee',
    zIndex: 10,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#111',
    borderRadius: 16,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#111',
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: '#000',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  forsaLogo: { position: 'absolute', bottom: 18, left: '50%', transform: [{ translateX: -24 }], width: 48, height: 48, opacity: 0.18, zIndex: 1 },
});
