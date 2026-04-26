import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, Image, Alert, I18nManager } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { subscribeToConversations, Conversation, findAdminUserId, getOrCreateConversation, clearConversationUnreadCache } from '../services/MessagingService';
import { auth } from '../lib/firebase';
import FootballLoader from '../components/FootballLoader';

export default function PlayerMessagesScreen() {
  const { openMenu } = useHamburgerMenu();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const router = useRouter();
  const isRTL = I18nManager.isRTL;

  const openAdminChat = async () => {
    if (openingAdminChat) return;

    try {
      setOpeningAdminChat(true);
      const adminId = await findAdminUserId();
      if (!adminId) {
        Alert.alert(i18n.t('noAdminFound') || 'No admin found');
        return;
      }
      const convId = await getOrCreateConversation(adminId);
      router.push({ pathname: '/player-chat', params: { conversationId: convId, otherUserId: adminId, name: i18n.t('adminLabel') || 'Admin' } });
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

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToConversations((convs) => {
      setConversations(convs);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const openConversation = (conversation: Conversation, displayName: string) => {
    clearConversationUnreadCache(conversation.id);
    setConversations((prev) =>
      prev.map((item) => (item.id === conversation.id ? { ...item, unreadCount: 0 } : item))
    );
    router.push({
      pathname: '/player-chat',
      params: {
        conversationId: conversation.id,
        otherUserId: conversation.otherParticipantId || '',
        name: displayName,
      },
    });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#000000', '#111111']}
        style={styles.gradient}
      >
      <HamburgerMenu />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
                <Ionicons name="menu" size={24} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={openAdminChat} disabled={openingAdminChat} style={{ opacity: openingAdminChat ? 0.6 : 1 }}>
                <View style={styles.textAdminBtn}>
                  {openingAdminChat ? (
                    <FootballLoader size="small" color="#fff" style={{ marginRight: 6 }} />
                  ) : (
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.textAdminText}>{openingAdminChat ? (i18n.t('loading') || 'Loading...') : (i18n.t('textAdmin') || 'Text Admin')}</Text>
                </View>
              </TouchableOpacity>
            </View>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('messages') || 'Messages'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('yourConversations') || 'Your conversations'}</Text>
            </View>
          </View>

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.emptyContainer}>
                <FootballLoader size="large" color="#fff" />
                <Text style={styles.emptyText}>{i18n.t('loading') || 'Loading...'}</Text>
              </View>
            ) : conversations.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="chatbubbles-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
                <Text style={styles.emptyText}>{i18n.t('noConversations') || 'No conversations yet'}</Text>
                <Text style={styles.emptySubtext}>{i18n.t('adminOnlyMessagingHint') || 'You can start new chats with Admin only. Existing conversations will appear here.'}</Text>
                <TouchableOpacity
                  style={styles.viewBookingsButton}
                  onPress={() => router.push('/player-bookings')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.viewBookingsButtonText}>{i18n.t('viewMyBookings') || 'View My Bookings'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              conversations.map((item) => {
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
                    key={item.id}
                    style={styles.conversationCard} 
                    onPress={() => openConversation(item, displayName)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.avatarContainer}>
                      {item.otherParticipantPhoto ? (
                        <Image source={{ uri: item.otherParticipantPhoto }} style={styles.avatarImage} />
                      ) : (
                        <Ionicons name="person-circle" size={48} color="#000" />
                      )}
                    </View>
                    <View style={styles.conversationContent}>
                      <View style={styles.conversationHeader}>
                        <View style={styles.nameBlock}>
                          <Text style={styles.conversationName}>{displayName}</Text>
                          {!!item.otherParticipantRole && (
                            <Text style={styles.conversationRole}>{String(item.otherParticipantRole).replace(/_/g, ' ')}</Text>
                          )}
                        </View>
                        <View style={styles.metaColumn}>
                          {!!lastMsgTime && <Text style={styles.lastMessageTime}>{lastMsgTime}</Text>}
                          {unreadCount > 0 && (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Text style={[styles.lastMessage, unreadCount > 0 && styles.lastMessageUnread, isRTL ? styles.textRtl : styles.textLtr]} numberOfLines={1}>
                        {lastMsg || 'No messages yet'}
                      </Text>
                  </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                </TouchableOpacity>
                );
              })
            )}
        </ScrollView>
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
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  menuButton: {
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
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    marginTop: 8,
  },
  emptyText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 24,
    textAlign: 'center',
  },
  emptySubtext: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  conversationCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  avatarContainer: {
    marginRight: 14,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  nameBlock: {
    flex: 1,
    paddingRight: 10,
  },
  conversationName: {
    fontWeight: '700',
    fontSize: 16,
    color: '#000000',
  },
  textLtr: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  conversationRole: {
    marginTop: 3,
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  metaColumn: {
    alignItems: 'flex-end',
    gap: 6,
  },
  unreadBadge: {
    backgroundColor: '#000000',
    borderRadius: 999,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  unreadText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  lastMessage: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
  },
  lastMessageUnread: {
    color: '#374151',
    fontWeight: '600',
  },
  lastMessageTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
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

