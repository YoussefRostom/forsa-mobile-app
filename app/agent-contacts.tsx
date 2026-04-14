import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useEffect } from 'react';
import { Animated, Easing, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Image } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { subscribeToConversations, Conversation } from '../services/MessagingService';
import { getChattableUsers, startConversationWithUser } from '../services/BookingMessagingService';
import { Alert } from 'react-native';
import { auth } from '../lib/firebase';

export default function AgentContactsScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chattableUsers, setChattableUsers] = useState<Array<{userId: string; name: string; photo?: string; role: string}>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingChattable, setLoadingChattable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    setLoading(true);
    setErrorMessage(null);

    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToConversations((convs) => {
        setConversations(convs);
        setLoading(false);
      });
    } catch (error: any) {
      setConversations([]);
      setLoading(false);
      setErrorMessage(error?.message || (i18n.t('failedToLoadConversations') || 'Failed to load conversations.'));
    }

    loadChattableUsers();

    return () => {
      unsubscribe();
    };
  }, [refreshKey]);

  const loadChattableUsers = async () => {
    try {
      setLoadingChattable(true);
      const users = await getChattableUsers();
      setChattableUsers(users);
    } catch (error) {
      console.error('Error loading chattable users:', error);
      setErrorMessage(i18n.t('failedToLoadContacts') || 'Failed to load contacts. Please try again.');
    } finally {
      setLoadingChattable(false);
    }
  };

  const handleRetry = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleStartChat = async (userId: string, name: string) => {
    try {
      const conversationId = await startConversationWithUser(userId);
      router.push({
        pathname: '/agent-messages',
        params: {
          conversationId,
          otherUserId: userId,
          name
        }
      });
    } catch (error: any) {
      console.error('Error starting chat:', error);
      Alert.alert(i18n.t('error') || 'Error', error.message || 'Failed to start conversation');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#0f172a', '#111827', '#1f2937']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
        </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('messages') || 'Messages'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('yourConversations') || 'Your conversations'}</Text>
            </View>
        </View>

        <HamburgerMenu />

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.emptyText}>{i18n.t('loading') || 'Loading...'}</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          renderItem={({ item }) => {
            const displayName = item.otherParticipantName || 'Unknown';
            const unreadCount = item.unreadCount || 0;
            const lastMsg = item.lastMessage
              ? `${item.lastMessageSenderId === auth.currentUser?.uid ? `${i18n.t('you') || 'You'}: ` : ''}${item.lastMessage}`
              : '';
            const lastMsgTime = item.lastMessageAt?.toDate?.()
              ? new Date(item.lastMessageAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
            
            return (
              <TouchableOpacity
                style={styles.contactCard}
                onPress={() => router.push({ 
                  pathname: '/agent-messages', 
                  params: { 
                    conversationId: item.id,
                    otherUserId: item.otherParticipantId || '',
                    name: displayName 
                  } 
                })}
                activeOpacity={0.8}
              >
                <View style={styles.avatar}>
                  {item.otherParticipantPhoto ? (
                    <Image source={{ uri: item.otherParticipantPhoto }} style={styles.avatarImage} />
                  ) : (
                    <Ionicons name="person" size={24} color="#000" />
                  )}
                  {unreadCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{unreadCount}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.contactInfo}>
                  <View style={styles.contactHeader}>
                    <View style={styles.nameBlock}>
                      <Text style={styles.contactName}>{displayName}</Text>
                      {!!item.otherParticipantRole && (
                        <Text style={styles.contactRole}>{String(item.otherParticipantRole).replace(/_/g, ' ')}</Text>
                      )}
                    </View>
                    {!!lastMsgTime && <Text style={styles.lastMessageTime}>{lastMsgTime}</Text>}
                  </View>
                  <Text style={[styles.lastMessage, unreadCount > 0 && styles.lastMessageUnread]} numberOfLines={1}>{lastMsg || 'No messages yet'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name={errorMessage ? 'alert-circle-outline' : 'chatbubbles-outline'} size={64} color="#666" />
                <Text style={styles.emptyText}>{errorMessage || (i18n.t('noMessages') || 'No messages')}</Text>
                <Text style={styles.emptySubtext}>{errorMessage ? (i18n.t('tapToRetry') || 'Tap retry to try again.') : (i18n.t('startChatting') || 'Start chatting with your players!')}</Text>

                {!!errorMessage && (
                  <TouchableOpacity style={styles.viewBookingsButton} onPress={handleRetry} activeOpacity={0.8}>
                    <Text style={styles.viewBookingsButtonText}>{i18n.t('retry') || 'Retry'}</Text>
                  </TouchableOpacity>
                )}

                {loadingChattable ? (
                  <ActivityIndicator size="small" color="#fff" style={{ marginTop: 20 }} />
                ) : chattableUsers.length > 0 ? (
                  <View style={styles.chattableUsersContainer}>
                    <Text style={styles.chattableUsersTitle}>{i18n.t('startConversationLabel') || 'Start a conversation:'}</Text>
                    {chattableUsers.map((user) => (
                      <TouchableOpacity
                        key={user.userId}
                        style={styles.chattableUserCard}
                        onPress={() => handleStartChat(user.userId, user.name)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.chattableUserAvatar}>
                          {user.photo ? (
                            <Image source={{ uri: user.photo }} style={styles.chattableUserAvatarImage} />
                          ) : (
                            <Ionicons name="person-circle" size={32} color="#fff" />
                          )}
                        </View>
                        <Text style={styles.chattableUserName}>{user.name}</Text>
                        <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.viewBookingsButton}
                    onPress={() => router.push('/agent-players')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.viewBookingsButtonText}>{i18n.t('viewMyPlayers') || 'View My Players'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            }
        />
      )}
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
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
    marginLeft: -44, // Negative margin to center title while keeping menu button on left
    paddingHorizontal: 44, // Add padding to ensure title doesn't overlap with menu button
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  contactCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  avatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  unreadText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  contactInfo: {
    flex: 1,
  },
  contactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  nameBlock: {
    flex: 1,
    paddingRight: 10,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  contactRole: {
    marginTop: 3,
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  lastMessageTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  lastMessage: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  lastMessageUnread: {
    color: '#374151',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 8,
  },
  chattableUsersContainer: {
    marginTop: 24,
    width: '100%',
    paddingHorizontal: 20,
  },
  chattableUsersTitle: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  chattableUserCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  chattableUserAvatar: {
    marginRight: 12,
  },
  chattableUserAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  chattableUserName: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  viewBookingsButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  viewBookingsButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
