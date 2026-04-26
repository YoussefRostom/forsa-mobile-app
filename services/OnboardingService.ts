import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (uid: string) => `onboarding_done_${uid}`;

export const hasSeenOnboarding = async (uid: string): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(key(uid))) === 'true';
  } catch {
    return false;
  }
};

export const markOnboardingComplete = async (uid: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(key(uid), 'true');
  } catch { }
};
