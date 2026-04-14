import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { startConversationWithUser } from '../services/BookingMessagingService';
import i18n from '../locales/i18n';

const cityLabels = i18n.t('cities', { returnObjects: true }) as Record<string, string>;

type Agent = {
  id: string;
  name: string;
  city: string;
  description: string;
  profilePic?: string;
  agency?: string;
  license?: string;
  phone?: string;
  email?: string;
};

export default function AgentDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetchAgent = async () => {
      setLoading(true);
      try {
        const agentDoc = await getDoc(doc(db, 'agents', id as string));
        if (!agentDoc.exists()) throw new Error('Agent not found');
        const data = agentDoc.data();
        setAgent({
          id: agentDoc.id,
          name: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
          city: data.city || '',
          description: data.description || '',
          profilePic: data.profilePhoto || '',
          agency: data.agency || '',
          license: data.license || '',
          phone: data.phone || '',
          email: data.email || '',
        });
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAgent();
  }, [id]);

  const handleMessage = async () => {
    if (!agent) return;
    setMessaging(true);
    try {
      const conversationId = await startConversationWithUser(agent.id);
      router.push({
        pathname: '/agent-messages',
        params: { conversationId, otherUserId: agent.id, name: agent.name },
      });
    } catch (err: any) {
      Alert.alert(i18n.t('error') || 'Error', err.message || 'Failed to start conversation');
    } finally {
      setMessaging(false);
    }
  };

  if (loading) {
    return (
      <LinearGradient colors={['#000', '#1a1a1a', '#2d2d2d']} style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </LinearGradient>
    );
  }

  if (error || !agent) {
    return (
      <LinearGradient colors={['#000', '#1a1a1a', '#2d2d2d']} style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={56} color="rgba(255,255,255,0.4)" />
        <Text style={styles.errorText}>{i18n.t('noResults') || 'Agent not found.'}</Text>
        <TouchableOpacity style={styles.backBtnAlt} onPress={() => router.back()}>
          <Text style={styles.backBtnAltText}>{i18n.t('goBack') || 'Go Back'}</Text>
        </TouchableOpacity>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#000', '#1a1a1a', '#2d2d2d']} style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroPhotoWrap}>
            {agent.profilePic ? (
              <Image source={{ uri: agent.profilePic }} style={styles.heroPhoto} />
            ) : (
              <View style={styles.heroPhotoPlaceholder}>
                <Ionicons name="person" size={48} color="#999" />
              </View>
            )}
          </View>
          <Text style={styles.heroName}>{agent.name}</Text>
          {!!agent.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location" size={14} color="#666" />
              <Text style={styles.heroCity}>{cityLabels[agent.city] || agent.city}</Text>
            </View>
          )}
          {!!agent.agency && (
            <View style={styles.agencyBadge}>
              <Ionicons name="business" size={13} color="#555" style={{ marginRight: 5 }} />
              <Text style={styles.agencyText}>{agent.agency}</Text>
            </View>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={handleMessage}
            disabled={messaging}
            activeOpacity={0.85}
          >
            {messaging ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="chatbubble-ellipses" size={20} color="#000" style={{ marginRight: 8 }} />
                <Text style={styles.actionBtnTextPrimary}>{i18n.t('message') || 'Message'}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            onPress={() => router.push({ pathname: '/agent-user-posts', params: { ownerId: agent.id, ownerRole: 'agent', userName: agent.name } })}
            activeOpacity={0.85}
          >
            <Ionicons name="newspaper-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.actionBtnTextSecondary}>{i18n.t('viewPosts') || 'View Posts'}</Text>
          </TouchableOpacity>
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          {!!agent.description && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>{i18n.t('description') || 'About'}</Text>
              <Text style={styles.infoSectionBody}>{agent.description}</Text>
            </View>
          )}
          {(!!agent.agency || !!agent.license) && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>{i18n.t('agencyInfo') || 'Agency Info'}</Text>
              {!!agent.agency && (
                <View style={styles.infoRow}>
                  <Ionicons name="business-outline" size={16} color="#888" style={{ marginRight: 8 }} />
                  <Text style={styles.infoRowText}>{agent.agency}</Text>
                </View>
              )}
              {!!agent.license && (
                <View style={styles.infoRow}>
                  <Ionicons name="document-text-outline" size={16} color="#888" style={{ marginRight: 8 }} />
                  <Text style={styles.infoRowText}>{i18n.t('licenseNumber') || 'License'}: {agent.license}</Text>
                </View>
              )}
            </View>
          )}
          {!!agent.city && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>{i18n.t('location') || 'Location'}</Text>
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color="#888" style={{ marginRight: 8 }} />
                <Text style={styles.infoRowText}>{cityLabels[agent.city] || agent.city}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginTop: 12, textAlign: 'center', paddingHorizontal: 32 },
  backBtn: {
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    marginLeft: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnAlt: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtnAltText: { color: '#000', fontWeight: '700', fontSize: 15 },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  heroPhotoWrap: {
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  heroPhoto: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 4,
    borderColor: '#000',
    backgroundColor: '#f0f0f0',
  },
  heroPhotoPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#e0e0e0',
  },
  heroName: { fontSize: 26, fontWeight: '800', color: '#000', textAlign: 'center', marginBottom: 6 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  heroCity: { fontSize: 14, color: '#666', marginLeft: 4 },
  agencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },
  agencyText: { fontSize: 13, color: '#444', fontWeight: '600' },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnPrimary: { backgroundColor: '#fff' },
  actionBtnSecondary: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  actionBtnTextPrimary: { fontSize: 16, fontWeight: '700', color: '#000' },
  actionBtnTextSecondary: { fontSize: 16, fontWeight: '700', color: '#fff' },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  infoSection: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoSectionTitle: { fontSize: 13, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  infoSectionBody: { fontSize: 15, color: '#333', lineHeight: 22 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  infoRowText: { fontSize: 15, color: '#333', flex: 1 },
});
