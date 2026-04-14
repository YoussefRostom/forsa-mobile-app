import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { LinearGradient } from 'expo-linear-gradient';

export default function SeedAdmin() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSeed = async () => {
        if (!__DEV__) {
            Alert.alert("Unavailable", "Admin seeding is disabled in production builds.");
            return;
        }

        if (!email || !password) {
            Alert.alert("Error", "Please provide email and password");
            return;
        }

        setLoading(true);
        try {
            // 1. Create User in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Create User Document in Firestore with Admin Role
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: email,
                role: 'admin',
                status: 'active',
                name: 'System Admin',
                createdAt: new Date().toISOString()
            });

            // 3. Keep the legacy admin allowlist in sync for stricter rule paths
            await setDoc(doc(db, 'admins', user.uid), {
                uid: user.uid,
                email,
                createdAt: new Date().toISOString(),
            });

            Alert.alert("Success", "Admin account created successfully. You can now log in.");
            router.replace('/signin');
        } catch (error: any) {
            console.error("Seeding error:", error);
            Alert.alert("Error", error.message || "Failed to seed admin");
        } finally {
            setLoading(false);
        }
    };

    return (
        <LinearGradient colors={['#000', '#222']} style={styles.container}>
            <View style={styles.card}>
                <Text style={styles.title}>Seed Admin Account</Text>
                <Text style={styles.subtitle}>Use this once in development to create your primary admin account.</Text>
                {!__DEV__ && <Text style={[styles.subtitle, { color: '#c0392b', marginBottom: 16 }]}>Disabled in production for security.</Text>}

                <TextInput
                    style={styles.input}
                    placeholder="Admin Email"
                    placeholderTextColor="#999"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                />

                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#999"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                />

                <TouchableOpacity
                    style={[styles.button, loading && styles.disabled]}
                    onPress={handleSeed}
                    disabled={loading || !__DEV__}
                >
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Admin</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
                    <Text style={styles.backText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20 },
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 30, elevation: 5 },
    title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
    subtitle: { fontSize: 14, color: '#666', marginBottom: 30, textAlign: 'center' },
    input: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 15, marginBottom: 15, fontSize: 16 },
    button: { backgroundColor: '#000', borderRadius: 10, padding: 18, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    disabled: { opacity: 0.7 },
    backLink: { marginTop: 20, alignItems: 'center' },
    backText: { color: '#666' }
});
