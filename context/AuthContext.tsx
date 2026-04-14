import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { captureAppException } from '../services/CrashReportingService';

type Role = 'user' | 'admin' | 'player' | 'parent' | 'agent' | 'academy' | 'clinic';

interface User {
  id: string;
  uid: string;
  name: string;
  email: string;
  role: Role;
  status?: string | null;
  isSuspended?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, role?: Role) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const buildUserFromFirebase = async (firebaseUser: FirebaseUser): Promise<User> => {
  const fallbackName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';

  try {
    const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const role = String(userData?.role || 'user').toLowerCase() as Role;
    const fullName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim();

    return {
      id: firebaseUser.uid,
      uid: firebaseUser.uid,
      name:
        userData?.name ||
        userData?.parentName ||
        userData?.academyName ||
        userData?.clinicName ||
        userData?.agentName ||
        userData?.adminName ||
        fullName ||
        fallbackName,
      email: firebaseUser.email || String(userData?.email || ''),
      role,
      status: userData?.status ?? null,
      isSuspended: userData?.isSuspended === true,
    };
  } catch (error) {
    console.error('[AuthContext] Failed to sync user profile:', error);
    captureAppException(error, { source: 'AuthContext.buildUserFromFirebase' });
    return {
      id: firebaseUser.uid,
      uid: firebaseUser.uid,
      name: fallbackName,
      email: firebaseUser.email || '',
      role: 'user',
      status: null,
      isSuspended: false,
    };
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const nextUser = await buildUserFromFirebase(currentUser);
    setUser(nextUser);
    setIsLoading(false);
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      if (!firebaseUser) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const nextUser = await buildUserFromFirebase(firebaseUser);
      if (!isMounted) return;

      setUser(nextUser);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const login = async (_email: string, fallbackRole: Role = 'user') => {
    if (auth.currentUser) {
      await refreshUser();
      return;
    }

    setUser((prev) => prev ?? {
      id: _email,
      uid: _email,
      name: _email.split('@')[0] || 'User',
      email: _email,
      role: fallbackRole,
      status: null,
      isSuspended: false,
    });
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('[AuthContext] Logout failed:', error);
      captureAppException(error, { source: 'AuthContext.logout' });
    } finally {
      setUser(null);
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
