import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import i18n from '../locales/i18n';

const extractCoordinatesFromMapUrl = (mapUrl?: string) => {
  if (!mapUrl?.trim()) return null;

  const decodedUrl = decodeURIComponent(mapUrl.trim());
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = decodedUrl.match(pattern);
    if (match) {
      const latitude = Number(match[1]);
      const longitude = Number(match[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }

  return null;
};

export default function AcademyMapViewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string;
    address?: string;
    city?: string;
    district?: string;
    latitude?: string;
    longitude?: string;
    mapUrl?: string;
  }>();

  const academyTitle = typeof params.title === 'string' && params.title.trim()
    ? params.title.trim()
    : (i18n.t('mapPreview') || 'Map preview');

  const sharedMapUrl = typeof params.mapUrl === 'string' ? params.mapUrl.trim() : '';
  const parsedFromMapUrl = useMemo(() => extractCoordinatesFromMapUrl(sharedMapUrl), [sharedMapUrl]);

  const latitude = typeof params.latitude === 'string'
    ? Number(params.latitude)
    : (parsedFromMapUrl?.latitude ?? NaN);
  const longitude = typeof params.longitude === 'string'
    ? Number(params.longitude)
    : (parsedFromMapUrl?.longitude ?? NaN);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  const addressText = [params.address, params.district, params.city]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ');

  const fallbackQuery = useMemo(() => {
    return [academyTitle, params.address, params.district, params.city]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(', ');
  }, [academyTitle, params.address, params.city, params.district]);

  const mapHtml = useMemo(() => {
    if (!hasCoordinates) return '';

    const safeTitle = academyTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
      body { background: #ffffff; }
      .leaflet-container { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      var map = L.map('map').setView([${latitude}, ${longitude}], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      L.marker([${latitude}, ${longitude}]).addTo(map).bindPopup(${JSON.stringify(safeTitle)}).openPopup();
    </script>
  </body>
</html>`;
  }, [academyTitle, hasCoordinates, latitude, longitude]);

  const previewUrl = useMemo(() => {
    if (hasCoordinates) {
      return `https://www.google.com/maps?q=${latitude},${longitude}`;
    }

    if (sharedMapUrl && /^https?:\/\//i.test(sharedMapUrl)) {
      return sharedMapUrl;
    }

    if (fallbackQuery) {
      return `https://www.google.com/maps?q=${encodeURIComponent(fallbackQuery)}`;
    }

    return '';
  }, [fallbackQuery, hasCoordinates, latitude, longitude, sharedMapUrl]);

  const directionsUrl = useMemo(() => {
    if (sharedMapUrl && /^(https?:\/\/|geo:|maps:|comgooglemaps:\/\/)/i.test(sharedMapUrl)) {
      return sharedMapUrl;
    }

    if (hasCoordinates) {
      return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
    }

    if (fallbackQuery) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fallbackQuery)}`;
    }

    return '';
  }, [fallbackQuery, hasCoordinates, latitude, longitude, sharedMapUrl]);

  const handleOpenInMaps = async () => {
    if (!directionsUrl) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('mapNotAvailable') || 'Map location is not available yet.');
      return;
    }

    if (/^https?:\/\//i.test(directionsUrl)) {
      await Linking.openURL(directionsUrl);
      return;
    }

    const canOpen = await Linking.canOpenURL(directionsUrl);
    if (canOpen) {
      await Linking.openURL(directionsUrl);
      return;
    }

    Alert.alert(i18n.t('error') || 'Error', i18n.t('invalidUrl') || 'Cannot open this link.');
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{academyTitle}</Text>
            <Text style={styles.headerSubtitle}>{i18n.t('mapPreview') || 'Map preview'}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={18} color="#111827" />
              <Text style={styles.infoText}>{addressText || (i18n.t('locationUnavailable') || 'Location unavailable')}</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleOpenInMaps}>
              <Ionicons name="navigate-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>{i18n.t('openInMaps') || 'Open in Maps'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.mapCard}>
            {mapHtml ? (
              <WebView
                originWhitelist={['*']}
                source={{ html: mapHtml }}
                style={styles.webview}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.loaderWrap}>
                    <ActivityIndicator size="large" color="#000" />
                  </View>
                )}
              />
            ) : previewUrl ? (
              <WebView
                source={{ uri: previewUrl }}
                style={styles.webview}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.loaderWrap}>
                    <ActivityIndicator size="large" color="#000" />
                  </View>
                )}
              />
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="map-outline" size={48} color="#6b7280" />
                <Text style={styles.emptyText}>{i18n.t('mapNotAvailable') || 'Map location is not available yet.'}</Text>
              </View>
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 14,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    lineHeight: 21,
  },
  primaryButton: {
    backgroundColor: '#000',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  mapCard: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderRadius: 20,
    minHeight: 320,
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    marginTop: 10,
    textAlign: 'center',
    color: '#374151',
    fontSize: 15,
    lineHeight: 21,
  },
});
