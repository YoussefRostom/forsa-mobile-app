import { router } from 'expo-router';
import React, { createContext, useContext, useState } from 'react';
import { auth } from '../lib/firebase';
import i18n from '../locales/i18n';
import { findAdminUserId, getOrCreateConversation } from '../services/MessagingService';
import { markOnboardingComplete } from '../services/OnboardingService';

export interface TourStep {
  route: string;
  titleKey: string;
  descKey: string;
}

interface OnboardingContextType {
  isActive: boolean;
  currentStep: number;
  steps: TourStep[];
  startOnboarding: (role: string) => void;
  nextStep: () => void;
  skipOnboarding: () => void;
}

const ROLE_FEEDS: Record<string, string> = {
  player: '/player-feed',
  parent: '/parent-feed',
  academy: '/academy-feed',
  clinic: '/clinic-feed',
  agent: '/agent-feed',
};

const TOUR_STEPS: Record<string, TourStep[]> = {
  player: [
    { route: '/player-feed',        titleKey: 'ob_t_player_1', descKey: 'ob_d_player_1' },
    { route: '/academy-search',     titleKey: 'ob_t_player_2', descKey: 'ob_d_player_2' },
    { route: '/clinic-search',      titleKey: 'ob_t_player_3', descKey: 'ob_d_player_3' },
    { route: '/player-bookings',    titleKey: 'ob_t_player_4', descKey: 'ob_d_player_4' },
    { route: '/my-qr-code',         titleKey: 'ob_t_player_5', descKey: 'ob_d_player_5' },
    { route: '/player-profile',     titleKey: 'ob_t_player_6', descKey: 'ob_d_player_6' },
    { route: '/player-upload-media',titleKey: 'ob_t_player_7', descKey: 'ob_d_player_7' },
    { route: '__admin_chat__',      titleKey: 'ob_t_player_8', descKey: 'ob_d_player_8' },
  ],
  parent: [
    { route: '/parent-feed',              titleKey: 'ob_t_parent_1', descKey: 'ob_d_parent_1' },
    { route: '/parent-search-academies',  titleKey: 'ob_t_parent_2', descKey: 'ob_d_parent_2' },
    { route: '/parent-search-clinics',    titleKey: 'ob_t_parent_3', descKey: 'ob_d_parent_3' },
    { route: '/parent-bookings',          titleKey: 'ob_t_parent_4', descKey: 'ob_d_parent_4' },
    { route: '/my-qr-code',               titleKey: 'ob_t_parent_5', descKey: 'ob_d_parent_5' },
    { route: '/parent-edit-profile',      titleKey: 'ob_t_parent_6', descKey: 'ob_d_parent_6' },
    { route: '__admin_chat__',            titleKey: 'ob_t_parent_7', descKey: 'ob_d_parent_7' },
  ],
  academy: [
    { route: '/academy-feed',         titleKey: 'ob_t_academy_1', descKey: 'ob_d_academy_1' },
    { route: '/academy-bookings',     titleKey: 'ob_t_academy_3', descKey: 'ob_d_academy_3' },
    { route: '/scan-checkin',         titleKey: 'ob_t_academy_4', descKey: 'ob_d_academy_4' },
    { route: '/academy-edit-profile', titleKey: 'ob_t_academy_5', descKey: 'ob_d_academy_5' },
    { route: '/academy-upload-media', titleKey: 'ob_t_academy_6', descKey: 'ob_d_academy_6' },
    { route: '__admin_chat__',        titleKey: 'ob_t_academy_7', descKey: 'ob_d_academy_7' },
  ],
  clinic: [
    { route: '/clinic-feed',         titleKey: 'ob_t_clinic_1', descKey: 'ob_d_clinic_1' },
    { route: '/clinic-bookings',     titleKey: 'ob_t_clinic_3', descKey: 'ob_d_clinic_3' },
    { route: '/scan-checkin',        titleKey: 'ob_t_clinic_4', descKey: 'ob_d_clinic_4' },
    { route: '/clinic-edit-profile', titleKey: 'ob_t_clinic_5', descKey: 'ob_d_clinic_5' },
    { route: '/clinic-upload-media', titleKey: 'ob_t_clinic_6', descKey: 'ob_d_clinic_6' },
    { route: '__admin_chat__',       titleKey: 'ob_t_clinic_7', descKey: 'ob_d_clinic_7' },
  ],
  agent: [
    { route: '/agent-feed',         titleKey: 'ob_t_agent_1', descKey: 'ob_d_agent_1' },
    { route: '/agent-edit-profile', titleKey: 'ob_t_agent_4', descKey: 'ob_d_agent_4' },
    { route: '/agent-upload-media', titleKey: 'ob_t_agent_5', descKey: 'ob_d_agent_5' },
    { route: '__admin_chat__',      titleKey: 'ob_t_agent_6', descKey: 'ob_d_agent_6' },
  ],
};

const OnboardingContext = createContext<OnboardingContextType>({
  isActive: false,
  currentStep: 0,
  steps: [],
  startOnboarding: () => {},
  nextStep: () => {},
  skipOnboarding: () => {},
});

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [activeRole, setActiveRole] = useState<string>('player');

  const roleFeedRoute = (role: string) => ROLE_FEEDS[role] ?? ROLE_FEEDS.player;

  const finishOnboarding = () => {
    const uid = auth.currentUser?.uid;
    if (uid) markOnboardingComplete(uid).catch(() => {});
    router.replace(roleFeedRoute(activeRole) as any);
  };

  const chatPathnameForRole = (role: string) => {
    switch (role) {
      case 'academy':
        return '/academy-chat';
      case 'clinic':
        return '/clinic-chat';
      case 'parent':
        return '/parent-chat';
      case 'agent':
        return '/agent-messages';
      default:
        return '/player-chat';
    }
  };

  const adminChatParamKey = (role: string) => (role === 'agent' || role === 'player' ? 'name' : 'contact');

  const navigateToStep = (step: TourStep, role: string) => {
    if (step.route !== '__admin_chat__') {
      router.replace(step.route as any);
      return;
    }

    void (async () => {
      try {
        const adminId = await findAdminUserId();
        if (!adminId) {
          router.replace('/notifications' as any);
          return;
        }

        const conversationId = await getOrCreateConversation(adminId);
        router.replace({
          pathname: chatPathnameForRole(role) as any,
          params: {
            conversationId,
            otherUserId: adminId,
            [adminChatParamKey(role)]: i18n.t('adminConversation') || 'Admin',
          },
        });
      } catch {
        router.replace('/notifications' as any);
      }
    })();
  };

  const startOnboarding = (role: string) => {
    const tourSteps = TOUR_STEPS[role] ?? TOUR_STEPS.player;
    setActiveRole(role);
    setSteps(tourSteps);
    setCurrentStep(0);
    setIsActive(true);
    navigateToStep(tourSteps[0], role);
  };

  const nextStep = () => {
    const next = currentStep + 1;
    if (next >= steps.length) {
      setIsActive(false);
      setCurrentStep(0);
      setSteps([]);
      const completedRole = activeRole;
      setActiveRole('player');
      const uid = auth.currentUser?.uid;
      if (uid) markOnboardingComplete(uid).catch(() => {});
      router.replace(roleFeedRoute(completedRole) as any);
    } else {
      setCurrentStep(next);
      navigateToStep(steps[next], activeRole);
    }
  };

  const skipOnboarding = () => {
    setIsActive(false);
    setCurrentStep(0);
    setSteps([]);
    finishOnboarding();
    setActiveRole('player');
  };

  return (
    <OnboardingContext.Provider value={{ isActive, currentStep, steps, startOnboarding, nextStep, skipOnboarding }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export const useOnboarding = () => useContext(OnboardingContext);
