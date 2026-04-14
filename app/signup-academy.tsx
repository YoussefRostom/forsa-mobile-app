import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import i18n from '../locales/i18n';

const SignupAcademy = () => {
  const router = useRouter();
  const [academyName, setAcademyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fees, setFees] = useState<{ [age: string]: string }>({});
  const [selectedAge, setSelectedAge] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  // Multiple private training entries
  const [privateTrainings, setPrivateTrainings] = useState([
    { coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '' }
  ]);

  const updateTraining = (index: number, field: string, value: string) => {
    setPrivateTrainings(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const addTraining = () => {
    setPrivateTrainings(prev => [...prev, { coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '' }]);
  };

  const removeTraining = (index: number) => {
    setPrivateTrainings(prev => prev.filter((_, i) => i !== index));
  };

  const districts = [
    'Maadi', 'New Cairo', 'Nasr City', 'Heliopolis', 'Sheikh Zayed',
    '6 October', 'Mokattam', 'Rehab', 'Madinaty', 'Shorouk',
    'Roushdy', 'Smouha', 'Sporting', 'Kafr Abdo', 'Gleem',
    'Sidi Bishr', 'Miami', 'Mandara', 'Agami', 'Montaza'
  ];

  const ageGroups: string[] = Array.from({ length: 10 }, (_, i) => (7 + i).toString());
  const renderAgeRows = (): string[][] => {
    const rows: string[][] = [];
    for (let i = 0; i < ageGroups.length; i += 3) {
      rows.push(ageGroups.slice(i, i + 3));
    }
    return rows;
  };

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

  const handleBack = () => router.back();

  const handleSignup = async () => {
    setError('');
    if (!academyName || !email || !phone || !password || !city || !address || !description) {
      setError(i18n.t('fillAllRequiredFields'));
      return;
    }
    const hasFee = Object.values(fees).some((v) => v && v.trim() !== '');
    const hasPrivateTrainingEntry = privateTrainings.some((training) =>
      training.coachName.trim() !== '' && training.privateTrainingPrice.trim() !== ''
    );
    if (!hasFee && !hasPrivateTrainingEntry) {
      setError(i18n.t('enterAtLeastOneFeeOrPrivateTrainer') || 'Enter at least one age price or add a private trainer');
      return;
    }
    setLoading(true);
    
    // Save private trainings to AsyncStorage to avoid URL parameter limits
    await AsyncStorage.setItem('draftPrivateTrainings', JSON.stringify(privateTrainings));

    // Navigate to profile setup with collected data
    router.push({
      pathname: '/signup-academy-profile',
      params: {
        academyName,
        email,
        phone,
        password,
        city,
        district,
        address,
        description,
        fees: JSON.stringify(fees),
        profileImage: profileImage || '',
      },
    });
  };

  const pickImage = async () => {
    let permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.status !== 'granted') {
      Alert.alert(i18n.t('permissionDeniedTitle'), i18n.t('permissionDeniedMsg'));
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfileImage(result.assets[0].uri);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: '#fff' }}>
        <View style={styles.curvedHeader}>
          <View style={styles.curvedBg} />
          <TouchableOpacity style={styles.backArrow} onPress={handleBack}>
            <Ionicons name="arrow-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('signup_academy')}</Text>
        </View>
        <ScrollView 
          contentContainerStyle={styles.container} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {/* Profile Picture Picker & Preview */}
        <View style={{ width: '100%', alignItems: 'center', marginBottom: 16 }}>
          <TouchableOpacity onPress={pickImage}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#111', marginBottom: 6 }} />
            ) : (
              <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#111', marginBottom: 6 }}>
                <Text style={{ color: '#888', fontSize: 32 }}>+</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={{ color: '#111', fontWeight: '600', fontSize: 15, marginTop: 2 }}>{i18n.t('profile_picture')}</Text>
        </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('academy_name')}</Text>
            <TextInput style={styles.input} value={academyName} onChangeText={setAcademyName} autoCapitalize="words" placeholder={i18n.t('academy_name_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('email')}</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder={i18n.t('email_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('phone')}</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={i18n.t('phone_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('password')}</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder={i18n.t('password_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('city')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 0 }}>
              <View style={{ flex: 1, marginHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#111', borderRadius: 8, minWidth: 140, maxWidth: 220 }}>
                <Picker
                  selectedValue={city}
                  onValueChange={setCity}
                  style={{ color: '#111', backgroundColor: '#fff', width: '100%' }}
                  itemStyle={{ color: '#111', textAlign: 'center' }}
                  mode="dropdown"
                >
                  <Picker.Item label={i18n.t('selectCity')} value="" color="#888" />
                  {Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => (
                    <Picker.Item key={key} label={label} value={key} color="#111" />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('district') || 'District'}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 0 }}>
              <View style={{ flex: 1, marginHorizontal: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#111', borderRadius: 8, minWidth: 140, maxWidth: 220 }}>
                <Picker
                  selectedValue={district}
                  onValueChange={setDistrict}
                  style={{ color: '#111', backgroundColor: '#fff', width: '100%' }}
                  itemStyle={{ color: '#111', textAlign: 'center' }}
                  mode="dropdown"
                >
                  <Picker.Item label={i18n.t('selectDistrict') || 'Select District'} value="" color="#888" />
                  {districts.map((name) => (
                    <Picker.Item key={name} label={name} value={name} color="#111" />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('address')}</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress} autoCapitalize="words" placeholder={i18n.t('address_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('description')}</Text>
            <TextInput style={[styles.input, { height: 80 }]} value={description} onChangeText={setDescription} multiline placeholder={i18n.t('description_placeholder')} placeholderTextColor="#aaa" />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>{i18n.t('monthlyFeesPerAgeGroup')}</Text>
            {renderAgeRows().map((row: string[], rowIdx: number) => (
              <View key={rowIdx} style={styles.feeBubblesRow}>
                {row.map((age: string) => (
                  <View key={age} style={{ alignItems: 'center', flex: 1 }}>
                    <TouchableOpacity
                      style={[
                        styles.feeBubble,
                        selectedAge === age && styles.feeBubbleSelected,
                      ]}
                      onPress={() => setSelectedAge(selectedAge === age ? null : age)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.feeBubbleText,
                        selectedAge === age && styles.feeBubbleTextSelected,
                      ]}>{age}</Text>
                    </TouchableOpacity>
                    {selectedAge === age && (
                      <Animated.View style={[styles.feeBubbleInputBox, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}> 
                        <Text style={styles.feeInputLabel}>{i18n.t('enterFeeForAge', { age })}</Text>
                        <TextInput
                          style={styles.feeBubbleInput}
                          value={fees[age] || ''}
                          onChangeText={(val) => setFees({ ...fees, [age]: val.replace(/[^0-9]/g, '') })}
                          keyboardType="numeric"
                          placeholder={i18n.t('feePlaceholder')}
                          placeholderTextColor="#aaa"
                          maxLength={6}
                        />
                      </Animated.View>
                    )}
                  </View>
                ))}
                {/* Fill empty columns if needed for last row */}
                {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, idx) => (
                  <View key={`empty-${idx}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))}
          </View>

          {/* Private Training Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{i18n.t('privateTraining') || 'Private Training'}</Text>
            <Text style={styles.sectionSubtitle}>{i18n.t('privateTrainingDesc') || 'Set up your private training services'}</Text>
          </View>

          {privateTrainings.map((training, index) => (
            <View key={index} style={styles.trainingBlock}>
              {privateTrainings.length > 1 && (
                <View style={styles.trainingBlockHeader}>
                  <Text style={styles.trainingBlockTitle}>Training #{index + 1}</Text>
                  <TouchableOpacity onPress={() => removeTraining(index)} style={styles.removeTrainingBtn}>
                    <Ionicons name="trash-outline" size={20} color="#c00" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Coach Name */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('coachName') || 'Coach Name'} *</Text>
                <TextInput
                  style={styles.input}
                  value={training.coachName}
                  onChangeText={(v) => updateTraining(index, 'coachName', v)}
                  placeholder={i18n.t('coachNamePlaceholder') || 'Enter coach name'}
                  placeholderTextColor="#aaa"
                />
              </View>

              {/* Coach Bio */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('coachBio') || 'Coach Bio'}</Text>
                <TextInput
                  style={[styles.input, { height: 80 }]}
                  value={training.coachBio}
                  onChangeText={(v) => updateTraining(index, 'coachBio', v)}
                  multiline
                  placeholder={i18n.t('coachBioPlaceholder') || 'Brief description of coach experience and qualifications'}
                  placeholderTextColor="#aaa"
                />
              </View>

              {/* Specializations */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('specializations') || 'Specializations'}</Text>
                <TextInput
                  style={styles.input}
                  value={training.specializations}
                  onChangeText={(v) => updateTraining(index, 'specializations', v)}
                  placeholder={i18n.t('specializationsPlaceholder') || 'e.g., Goalkeeper training, Fitness, Technique (comma-separated)'}
                  placeholderTextColor="#aaa"
                />
              </View>

              {/* Session Duration */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('sessionDuration') || 'Session Duration (minutes)'}</Text>
                <TextInput
                  style={styles.input}
                  value={training.sessionDuration}
                  onChangeText={(v) => updateTraining(index, 'sessionDuration', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="60"
                  placeholderTextColor="#aaa"
                  maxLength={3}
                />
              </View>

              {/* Private Training Price */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('privateTrainingPrice') || 'Price per Session'} *</Text>
                <TextInput
                  style={styles.input}
                  value={training.privateTrainingPrice}
                  onChangeText={(v) => updateTraining(index, 'privateTrainingPrice', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder={i18n.t('privateTrainingPricePlaceholder') || 'Enter price per session'}
                  placeholderTextColor="#aaa"
                  maxLength={6}
                />
              </View>

              {/* Availability */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>{i18n.t('availability') || 'General Availability'}</Text>
                <TextInput
                  style={[styles.input, { height: 80 }]}
                  value={training.availability}
                  onChangeText={(v) => updateTraining(index, 'availability', v)}
                  multiline
                  placeholder={i18n.t('availabilityPlaceholder') || 'e.g., Monday-Friday: 4-8 PM, Saturday: 9 AM-2 PM'}
                  placeholderTextColor="#aaa"
                />
              </View>
            </View>
          ))}

          <TouchableOpacity style={styles.addTrainingButton} onPress={addTraining}>
            <Ionicons name="add-circle-outline" size={20} color="#111" />
            <Text style={styles.addTrainingButtonText}>Add Another Private Training</Text>
          </TouchableOpacity>

          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleSignup} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? i18n.t('loading') : i18n.t('signup')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#fff', paddingBottom: 40 },
  curvedHeader: {
    height: 180, // increased to allow for profile image
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    alignItems: 'center',
    position: 'relative',
    marginBottom: 24,
  },
  curvedBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 150, // match header height
    backgroundColor: '#111',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    zIndex: 0,
  },
  backArrow: { position: 'absolute', left: 16, top: 48, zIndex: 2 },
  headerTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    textAlign: 'center',
    zIndex: 1,
    marginBottom: -20, // adjust to center title vertically
  },
  sectionHeader: {
    marginBottom: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  formGroup: { width: '100%', marginBottom: 18 },
  label: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 6, marginLeft: 2 },
  input: { width: '100%', borderWidth: 1, borderColor: '#111', borderRadius: 10, padding: 14, fontSize: 16, backgroundColor: '#fff', color: '#111' },
  button: { backgroundColor: '#111', padding: 16, borderRadius: 10, alignItems: 'center', width: '100%', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  error: { color: '#c00', fontSize: 15, marginBottom: 10, alignSelf: 'center' },
  feeBubblesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    width: '100%',
    gap: 0,
  },
  feeBubble: {
    backgroundColor: '#eee',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 0,
    marginHorizontal: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#bbb',
    minWidth: 48,
    alignItems: 'center',
  },
  feeBubbleSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  feeBubbleText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 18,
  },
  feeBubbleTextSelected: {
    color: '#fff',
  },
  feeBubbleInputBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#111',
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'flex-start', // changed from 'center' to 'flex-start'
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    minWidth: 120,
    zIndex: 10,
  },
  feeBubbleInput: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 16,
    color: '#111',
    minWidth: 60,
    marginTop: 2,
    textAlign: 'center',
  },
  feeInputLabel: {
    fontSize: 15,
    color: '#111',
    marginBottom: 4,
    fontWeight: '500',
  },
  trainingBlock: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  trainingBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  trainingBlockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
  },
  removeTrainingBtn: {
    padding: 4,
  },
  addTrainingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#111',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  addTrainingButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
});

export default SignupAcademy;