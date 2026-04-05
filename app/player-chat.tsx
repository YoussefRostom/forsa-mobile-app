import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
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
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  hamburgerBox: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#000' },
  line: { width: 24, height: 3, backgroundColor: '#000', marginVertical: 2, borderRadius: 2 },
  bubble: { maxWidth: '80%', padding: 14, borderRadius: 22, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  bubbleSent: { backgroundColor: '#000', alignSelf: 'flex-end', borderTopRightRadius: 6 },
  bubbleReceived: { backgroundColor: '#eee', alignSelf: 'flex-start', borderTopLeftRadius: 6 },
  textSent: { color: '#fff', fontSize: 16, fontWeight: '400', lineHeight: 20 },
  textReceived: { color: '#222', fontSize: 16, fontWeight: '400', lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 18, borderTopWidth: 1, borderTopColor: '#bbb', zIndex: 10 },
  input: { flex: 1, borderWidth: 1.5, borderColor: '#bbb', borderRadius: 22, padding: 18, marginRight: 12, color: '#000', backgroundColor: '#fff', fontSize: 17 },
  sendBtn: { backgroundColor: '#000', borderRadius: 22, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#bbb' },
  sendBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 17 },
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
    if (!input.trim() || !conversationIdState) return;
    
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
      await sendMessage(conversationIdState, input.trim());
      setInput('');
      
      // Mark messages as read after sending
      await markMessagesAsRead(conversationIdState);
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Optionally show error to user
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
            return (
              <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
                <Text style={isSent ? styles.textSent : styles.textReceived}>
                  {item.content || (item.mediaUrl ? 'Media' : '')}
                </Text>
              </View>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 }}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
              <Text style={{ color: '#999', fontSize: 16 }}>{i18n.t('noMessages') || 'No messages yet'}</Text>
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
          editable={!limitReached}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSendMessage} disabled={limitReached || loading || !conversationIdState}>
          <Text style={styles.sendBtnText}>{i18n.t('send') || 'Send'}</Text>
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
