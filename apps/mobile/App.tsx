import 'react-native-get-random-values';
import { VisitCamera, VisitDetail, VisitDraft, VisitHistory } from './src/visits';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileProfile, UpdateNotice, useReleasePolicy } from './src/release';
import { OfflineQueue, useForegroundVisitSync } from './src/OfflineQueue';
import { SignInLayout, signInStyles } from './src/SignInLayout';
import {
  cachedEmployee,
  MobileApiError,
  loginEmployee,
  logoutEmployee,
  onSessionInvalid,
  restoreMobileSession,
} from './src/api';
import {
  Action,
  AttendanceDetails,
  AttendanceHistory,
  AttendanceHome,
  Problem,
  ShiftScreen,
  styles,
  type AttendanceStack,
} from './src/attendanceScreens';

const Stack = createNativeStackNavigator<AttendanceStack>();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
type Employee = Awaited<ReturnType<typeof loginEmployee>>;

function SessionApp() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [entering, setEntering] = useState(false);
  const release = useReleasePolicy();
  useForegroundVisitSync(
    release.data?.updateRequired ? undefined : employee?.id,
    release.data?.offlineSyncMaxRetries,
  );
  async function restore() {
    setRestoring(true);
    setRestoreError('');
    try {
      setEmployee((await restoreMobileSession())?.user ?? null);
    } catch (error) {
      if (error instanceof MobileApiError && error.status === 0) {
        const cached = await cachedEmployee();
        if (cached) {
          setEmployee(cached);
          return;
        }
      }
      setRestoreError(error instanceof Error ? error.message : 'Could not restore your session.');
    } finally {
      setRestoring(false);
    }
  }
  useEffect(() => {
    const unsubscribe = onSessionInvalid(() => {
      setEmployee(null);
      client.clear();
    });
    void restore();
    return unsubscribe;
  }, []);
  async function login() {
    if (!identifier.trim() || !password || entering) return;
    setEntering(true);
    setLoginError('');
    try {
      setEmployee(await loginEmployee(identifier.trim(), password));
      setPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setEntering(false);
    }
  }
  if (release.data?.updateRequired)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <UpdateNotice policy={release.data} required />
      </SafeAreaView>
    );
  if (!employee)
    return (
      <SignInLayout>
        {restoring ? (
          <ActivityIndicator accessibilityLabel="Restoring session" />
        ) : restoreError ? (
          <Problem message={restoreError} retry={() => void restore()} />
        ) : (
          <View style={signInStyles.form}>
            <Text accessibilityRole="header" style={styles.label}>
              Employee sign in
            </Text>
            <View style={signInStyles.field}>
              <Text style={signInStyles.fieldLabel}>Email or employee ID</Text>
              <TextInput
                accessibilityLabel="Email or employee ID"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                style={signInStyles.input}
                placeholder="e.g. EMP0001"
                placeholderTextColor="#625a78"
                value={identifier}
                onChangeText={setIdentifier}
              />
            </View>
            <View style={signInStyles.field}>
              <Text style={signInStyles.fieldLabel}>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                secureTextEntry
                autoComplete="current-password"
                maxLength={128}
                style={signInStyles.input}
                placeholder="Enter your password"
                placeholderTextColor="#625a78"
                value={password}
                onChangeText={setPassword}
                returnKeyType="go"
                onSubmitEditing={() => void login()}
              />
            </View>
            <Text style={styles.muted}>
              First time? Use the activation link from your administrator to set your password.
            </Text>
            {loginError && <Problem message={loginError} />}
            <Action
              title={entering ? 'Signing in…' : 'Sign in'}
              disabled={entering || !identifier.trim() || !password}
              onPress={() => void login()}
            />
          </View>
        )}
      </SignInLayout>
    );
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Attendance">
        <Stack.Screen name="Attendance">
          {(props) => (
            <View style={{ flex: 1 }}>
              {release.data?.updateAvailable && <UpdateNotice policy={release.data} />}
              <AttendanceHome {...props} employee={employee} onLogout={logoutEmployee} />
            </View>
          )}
        </Stack.Screen>
        <Stack.Screen name="CheckIn" component={ShiftScreen} options={{ title: 'Check in' }} />
        <Stack.Screen name="CheckOut" component={ShiftScreen} options={{ title: 'Check out' }} />
        <Stack.Screen
          name="History"
          component={AttendanceHistory}
          options={{ title: 'Attendance history' }}
        />
        <Stack.Screen
          name="Details"
          component={AttendanceDetails}
          options={{ title: 'Attendance details' }}
        />
        <Stack.Screen name="Profile" options={{ title: 'Profile and settings' }}>
          {() => <MobileProfile employee={employee} onLogout={logoutEmployee} />}
        </Stack.Screen>
        <Stack.Screen name="OfflineQueue" options={{ title: 'Offline visits' }}>
          {({ navigation }) => (
            <OfflineQueue
              enableCapture={release.data?.offlineEvidenceEnabled !== false}
              owner={employee.id}
              detail={(id) => navigation.replace('VisitDetail', { id })}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Visits" component={VisitHistory} options={{ title: 'Field visits' }} />
        <Stack.Screen name="VisitDraft" component={VisitDraft} options={{ title: 'Visit draft' }} />
        <Stack.Screen
          name="VisitCamera"
          component={VisitCamera}
          options={{ title: 'Visit photo' }}
        />
        <Stack.Screen
          name="VisitDetail"
          component={VisitDetail}
          options={{ title: 'Visit details' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionApp />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
